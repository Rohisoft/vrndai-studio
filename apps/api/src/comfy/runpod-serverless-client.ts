import type {
  ComfyClient,
  ComfyCompletionResult,
  ComfyOutputFile,
  ComfyProgress,
  ComfySubmitResult,
  SubmitWorkflowOptions,
} from './types.js';

interface PendingJob {
  endpointId: string;
  progressCallbacks: Set<(progress: ComfyProgress) => void>;
  settled: boolean;
  resolve: (result: ComfyCompletionResult) => void;
  completion: Promise<ComfyCompletionResult>;
  pollTimer: NodeJS.Timeout;
}

const POLL_INTERVAL_MS = 2000;

// Talks to RunPod Serverless's own job API (https://api.runpod.ai/v2/<endpointId>/...)
// instead of ComfyUI's native HTTP/WS surface -- ComfyUI itself is unchanged,
// it's just running inside a RunPod Serverless worker (our forked
// runpod-workers/worker-comfyui image) rather than a persistent Pod. One
// endpoint per model (see config/models.config.ts's ids), since each is a
// separate custom image with that model's weights baked in.
//
// NEEDS LIVE VERIFICATION (see the migration plan's Verification section):
// the exact shape of the progress payload below assumes our *patched*
// handler.py calls `runpod.serverless.progress_update(job, json.dumps({value,
// max}))` and that this JSON string shows up verbatim as `status.output`
// while a job is IN_PROGRESS -- confirm this against a real deployment
// before relying on it; progress is best-effort and silently skipped if the
// shape doesn't match, it never blocks completion.
export function createRunpodServerlessComfyClient(options: { apiKey: string; endpointIds: Record<string, string> }): ComfyClient {
  const headers = { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' };
  const pendingJobs = new Map<string, PendingJob>();

  function endpointFor(modelId: string | undefined): string {
    const id = modelId ? options.endpointIds[modelId] : undefined;
    if (!id) {
      throw new Error(
        `No RunPod Serverless endpoint configured for model '${modelId ?? '(none given)'}' -- check RUNPOD_ENDPOINT_IDS.`
      );
    }
    return id;
  }

  async function healthCheck(): Promise<boolean> {
    const ids = Object.values(options.endpointIds);
    if (ids.length === 0) {
      return false;
    }
    // Endpoints scale to zero and cold-start on demand, so "healthy" here
    // just means "RunPod accepts our credentials and knows this endpoint" --
    // not that a worker is currently warm.
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`https://api.runpod.ai/v2/${id}/health`, { headers });
          return res.ok;
        } catch {
          return false;
        }
      })
    );
    return results.some(Boolean);
  }

  async function submitWorkflow(graph: Record<string, unknown>, submitOptions?: SubmitWorkflowOptions): Promise<ComfySubmitResult> {
    const endpointId = endpointFor(submitOptions?.modelId);

    const body = {
      input: {
        workflow: graph,
        images: (submitOptions?.images ?? []).map((image) => ({
          name: image.name,
          image: image.buffer.toString('base64'),
        })),
      },
    };

    const res = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`RunPod /run request failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { id: string };

    let resolve!: (result: ComfyCompletionResult) => void;
    const completion = new Promise<ComfyCompletionResult>((res2) => {
      resolve = res2;
    });

    const job: PendingJob = {
      endpointId,
      progressCallbacks: new Set(),
      settled: false,
      resolve,
      completion,
      pollTimer: setInterval(() => pollStatus(data.id), POLL_INTERVAL_MS),
    };
    pendingJobs.set(data.id, job);

    return { promptId: data.id, queuePosition: 0 };
  }

  async function pollStatus(jobId: string): Promise<void> {
    const job = pendingJobs.get(jobId);
    if (!job || job.settled) {
      return;
    }

    let statusRes: Response;
    try {
      statusRes = await fetch(`https://api.runpod.ai/v2/${job.endpointId}/status/${jobId}`, { headers });
    } catch {
      return; // transient network hiccup -- next poll tick will retry
    }
    if (!statusRes.ok) {
      return;
    }
    const status = (await statusRes.json()) as {
      status: string;
      // COMPLETED responses carry a real object here. IN_PROGRESS responses
      // carry whatever our patched handler.py's progress_update() sent as
      // its `progress` argument -- confirmed directly from the RunPod SDK
      // source (rp_progress.py: `{"status": "IN_PROGRESS", "output":
      // progress}`, with `progress` passed through verbatim), which is the
      // JSON *string* our handler builds via `json.dumps(...)`, not an
      // already-parsed object -- hence the `string | object` union below.
      output?:
        | { images?: Array<{ filename: string; type: string; data: string }>; errors?: string[] }
        | string;
      error?: string;
    };

    if (status.status === 'IN_PROGRESS' && typeof status.output === 'string') {
      try {
        const parsed = JSON.parse(status.output) as { value?: number; max?: number };
        if (typeof parsed.value === 'number') {
          const progress: ComfyProgress = { value: parsed.value, max: parsed.max ?? 0 };
          for (const callback of job.progressCallbacks) {
            callback(progress);
          }
        }
      } catch {
        // Not our progress payload shape -- ignore, best-effort only.
      }
      return;
    }

    if (status.status === 'COMPLETED') {
      settle(job, jobId, () => {
        const outputPayload = typeof status.output === 'object' ? status.output : undefined;
        const images = outputPayload?.images ?? [];
        if (images.length === 0) {
          return { status: 'error', outputs: [], error: outputPayload?.errors?.join('; ') || 'RunPod job produced no output files.' };
        }
        const outputs: ComfyOutputFile[] = images.map((img) => ({
          filename: img.filename,
          subfolder: '',
          type: img.type,
          data: Buffer.from(img.data, 'base64'),
        }));
        return { status: 'success', outputs };
      });
    } else if (status.status === 'FAILED' || status.status === 'CANCELLED' || status.status === 'TIMED_OUT') {
      settle(job, jobId, () => ({
        status: 'error',
        outputs: [],
        error: status.error || `RunPod job ended with status '${status.status}'.`,
      }));
    }
  }

  function settle(job: PendingJob, jobId: string, buildResult: () => ComfyCompletionResult): void {
    job.settled = true;
    clearInterval(job.pollTimer);
    job.resolve(buildResult());
  }

  function onProgress(promptId: string, callback: (progress: ComfyProgress) => void): () => void {
    const job = pendingJobs.get(promptId);
    if (!job) {
      return () => {};
    }
    job.progressCallbacks.add(callback);
    return () => job.progressCallbacks.delete(callback);
  }

  async function waitForCompletion(promptId: string, opts: { timeoutMs: number }): Promise<ComfyCompletionResult> {
    const job = pendingJobs.get(promptId);
    if (!job) {
      return { status: 'error', outputs: [], error: `Unknown RunPod job '${promptId}'.` };
    }

    const timeout = new Promise<ComfyCompletionResult>((resolve) => {
      setTimeout(() => resolve({ status: 'error', outputs: [], error: 'RunPod job timed out.' }), opts.timeoutMs);
    });

    const result = await Promise.race([job.completion, timeout]);
    if (!job.settled) {
      job.settled = true;
      clearInterval(job.pollTimer);
      await fetch(`https://api.runpod.ai/v2/${job.endpointId}/cancel/${promptId}`, { method: 'POST', headers }).catch(() => {});
    }
    pendingJobs.delete(promptId);
    return result;
  }

  async function fetchOutputBytes(file: ComfyOutputFile): Promise<Buffer> {
    if (!file.data) {
      throw new Error(`RunPod Serverless output '${file.filename}' has no inline bytes -- this should never happen.`);
    }
    return file.data;
  }

  async function interrupt(promptId?: string): Promise<void> {
    // Unlike a Pod's single shared ComfyUI instance, there's no single
    // "whatever's currently running" to interrupt without a job id -- a
    // bare interrupt() call (no promptId) is a no-op here.
    if (!promptId) {
      return;
    }
    const job = pendingJobs.get(promptId);
    if (!job || job.settled) {
      return;
    }
    await fetch(`https://api.runpod.ai/v2/${job.endpointId}/cancel/${promptId}`, { method: 'POST', headers }).catch(() => {});
    settle(job, promptId, () => ({ status: 'error', outputs: [], error: 'Interrupted.' }));
  }

  return { healthCheck, submitWorkflow, onProgress, waitForCompletion, fetchOutputBytes, interrupt };
}
