import { randomUUID } from 'node:crypto';
import type {
  ComfyClient,
  ComfyCompletionResult,
  ComfyOutputFile,
  ComfyProgress,
  ComfySubmitResult,
  SubmitWorkflowOptions,
} from '../comfy/types.js';
import { runStockVideoPipeline } from './pipeline.js';
import type { StockVideoJobParams } from './types.js';
import type { LlmClient } from '../llm/types.js';

interface PendingJob {
  progressCallbacks: Set<(progress: ComfyProgress) => void>;
  settled: boolean;
  resolve: (result: ComfyCompletionResult) => void;
  completion: Promise<ComfyCompletionResult>;
  abortController: AbortController;
}

// Runs the whole Stock Footage pipeline (script -> search terms -> Pexels
// clips -> TTS narration -> subtitles -> ffmpeg assembly) entirely
// in-process -- no external service, no HTTP polling. Implements the same
// ComfyClient shape the ComfyUI/RunPod clients do purely so
// queue/worker.ts's existing submit/poll/fetch dispatch code works
// unchanged; submitWorkflow kicks the pipeline off immediately and
// onProgress/waitForCompletion just observe its progress.
export function createStockVideoClient(options: {
  pexelsApiKey: string;
  llmClient: LlmClient;
  groqApiKey?: string;
  hfToken?: string;
}): ComfyClient {
  const pendingJobs = new Map<string, PendingJob>();

  async function healthCheck(): Promise<boolean> {
    if (!options.pexelsApiKey) {
      return false;
    }
    try {
      const res = await fetch('https://api.pexels.com/videos/search?per_page=1&query=test', {
        headers: { Authorization: options.pexelsApiKey },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function submitWorkflow(graph: Record<string, unknown>, _submitOptions?: SubmitWorkflowOptions): Promise<ComfySubmitResult> {
    if (!options.pexelsApiKey) {
      throw new Error('No Pexels API key configured -- set PEXELS_API_KEY in .env to use the Stock Footage engine.');
    }
    const params = graph as unknown as StockVideoJobParams;
    const promptId = randomUUID();

    let resolve!: (result: ComfyCompletionResult) => void;
    const completion = new Promise<ComfyCompletionResult>((res) => {
      resolve = res;
    });
    const abortController = new AbortController();
    const job: PendingJob = { progressCallbacks: new Set(), settled: false, resolve, completion, abortController };
    pendingJobs.set(promptId, job);

    void runStockVideoPipeline(params, {
      pexelsApiKey: options.pexelsApiKey,
      llmClient: options.llmClient,
      groqApiKey: options.groqApiKey,
      hfToken: options.hfToken,
      signal: abortController.signal,
      onProgress: (value) => {
        for (const callback of job.progressCallbacks) {
          callback({ value, max: 100 });
        }
      },
    })
      .then((bytes) => {
        settle(job, { status: 'success', outputs: [{ filename: 'output.mp4', subfolder: '', type: 'output', data: bytes }] });
      })
      .catch((err) => {
        settle(job, { status: 'error', outputs: [], error: err instanceof Error ? err.message : String(err) });
      });

    return { promptId, queuePosition: 0 };
  }

  function settle(job: PendingJob, result: ComfyCompletionResult): void {
    if (job.settled) {
      return;
    }
    job.settled = true;
    job.resolve(result);
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
      return { status: 'error', outputs: [], error: `Unknown stock video job '${promptId}'.` };
    }

    const timeout = new Promise<ComfyCompletionResult>((resolve) => {
      setTimeout(() => resolve({ status: 'error', outputs: [], error: 'Stock video generation timed out.' }), opts.timeoutMs);
    });

    const result = await Promise.race([job.completion, timeout]);
    if (!job.settled) {
      job.abortController.abort();
    }
    pendingJobs.delete(promptId);
    return result;
  }

  async function fetchOutputBytes(file: ComfyOutputFile): Promise<Buffer> {
    if (!file.data) {
      throw new Error(`Stock video output '${file.filename}' has no inline bytes -- this should never happen.`);
    }
    return file.data;
  }

  async function interrupt(promptId?: string): Promise<void> {
    if (!promptId) {
      return;
    }
    const job = pendingJobs.get(promptId);
    if (!job || job.settled) {
      return;
    }
    // Unlike the old external-service integration, this genuinely stops the
    // in-flight work -- aborting kills any in-progress fetch()/ffmpeg calls
    // via the AbortSignal threaded through the whole pipeline.
    job.abortController.abort();
    settle(job, { status: 'error', outputs: [], error: 'Interrupted.' });
  }

  return { healthCheck, submitWorkflow, onProgress, waitForCompletion, fetchOutputBytes, interrupt };
}
