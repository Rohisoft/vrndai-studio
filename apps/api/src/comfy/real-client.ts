import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type {
  ComfyClient,
  ComfyCompletionResult,
  ComfyImageInput,
  ComfyOutputFile,
  ComfyProgress,
  ComfySubmitResult,
  SubmitWorkflowOptions,
} from './types.js';

interface PendingJob {
  progressCallbacks: Set<(progress: ComfyProgress) => void>;
  settled: boolean;
  resolve: (result: ComfyCompletionResult) => void;
  completion: Promise<ComfyCompletionResult>;
}

// Talks to ComfyUI's documented HTTP/WS surface (verified against
// docs.comfy.org): POST /prompt to submit, one persistent WebSocket
// correlating "progress"/"executing"/"execution_error" messages by
// prompt_id, GET /history/{id} for the result, GET /view for bytes,
// POST /upload/image, POST /interrupt.
export function createRealComfyClient(options: { baseUrl: string; authToken?: string }): ComfyClient {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const clientId = randomUUID();
  const headers: Record<string, string> = options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {};

  // Some deployments (e.g. ComfyUI reached through a Jupyter server-proxy
  // tunnel, as used for RunPod pods that only expose one HTTP port) require
  // a token on every request -- including the WebSocket upgrade, which
  // rejects with 403 if it's missing even though plain GETs can succeed
  // without it. Query-param auth works uniformly for both HTTP and WS, so
  // authToken is appended this way rather than relying on headers alone.
  function withToken(url: string): string {
    if (!options.authToken) {
      return url;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(options.authToken)}`;
  }

  const wsUrl = withToken(`${baseUrl.replace(/^http/, 'ws')}/ws?clientId=${clientId}`);

  const pendingJobs = new Map<string, PendingJob>();
  let socket: WebSocket | null = null;
  let socketReady: Promise<void> | null = null;

  function ensureSocket(): Promise<void> {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (socketReady) {
      return socketReady;
    }
    socketReady = new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { headers });
      ws.on('open', () => {
        socket = ws;
        resolve();
      });
      ws.on('message', (raw) => handleMessage(raw));
      ws.on('close', () => {
        socket = null;
        socketReady = null;
      });
      ws.on('error', (err) => {
        socketReady = null;
        reject(err);
      });
    });
    return socketReady;
  }

  function handleMessage(raw: unknown): void {
    let message: { type?: string; data?: Record<string, unknown> };
    try {
      message = JSON.parse(String(raw));
    } catch {
      return; // binary preview frames etc. -- not something we need
    }

    const promptId = message.data?.prompt_id as string | undefined;
    if (!promptId) {
      return;
    }
    const job = pendingJobs.get(promptId);
    if (!job || job.settled) {
      return;
    }

    if (message.type === 'progress') {
      const progress: ComfyProgress = {
        value: Number(message.data?.value ?? 0),
        max: Number(message.data?.max ?? 0),
        node: message.data?.node as string | undefined,
      };
      for (const callback of job.progressCallbacks) {
        callback(progress);
      }
    } else if (message.type === 'executing' && message.data?.node === null) {
      settleFromHistory(promptId, job);
    } else if (message.type === 'execution_error') {
      job.settled = true;
      job.resolve({
        status: 'error',
        outputs: [],
        error: String(message.data?.exception_message ?? 'ComfyUI reported an execution error.'),
      });
    }
  }

  async function settleFromHistory(promptId: string, job: PendingJob): Promise<void> {
    job.settled = true;
    try {
      const res = await fetch(withToken(`${baseUrl}/history/${promptId}`), { headers });
      if (!res.ok) {
        throw new Error(`ComfyUI /history request failed: ${res.status}`);
      }
      const history = (await res.json()) as Record<string, { outputs?: Record<string, unknown> }>;
      const outputs = extractOutputFiles(history[promptId]?.outputs ?? {});
      if (outputs.length === 0) {
        job.resolve({ status: 'error', outputs: [], error: 'ComfyUI finished but produced no output files.' });
      } else {
        job.resolve({ status: 'success', outputs });
      }
    } catch (err) {
      job.resolve({ status: 'error', outputs: [], error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Deliberately generic rather than keyed on a specific node's output field
  // name: SaveVideo reports its file under "images" (with an "animated"
  // flag) while other save-node types use "gifs" or "videos". Scanning every
  // array-of-file-entries shape in the node's outputs means this keeps
  // working if the workflow's terminal save node ever changes.
  function extractOutputFiles(outputs: Record<string, unknown>): ComfyOutputFile[] {
    const files: ComfyOutputFile[] = [];
    for (const nodeOutput of Object.values(outputs)) {
      if (!nodeOutput || typeof nodeOutput !== 'object') {
        continue;
      }
      for (const value of Object.values(nodeOutput as Record<string, unknown>)) {
        if (!Array.isArray(value)) {
          continue;
        }
        for (const item of value) {
          if (item && typeof item === 'object' && 'filename' in item && 'type' in item) {
            const file = item as { filename: string; subfolder?: string; type: string };
            files.push({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type });
          }
        }
      }
    }
    return files;
  }

  async function healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(withToken(`${baseUrl}/system_stats`), { headers });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function submitWorkflow(graph: Record<string, unknown>, options?: SubmitWorkflowOptions): Promise<ComfySubmitResult> {
    await ensureSocket();

    for (const image of options?.images ?? []) {
      await uploadImage(image);
    }

    const res = await fetch(withToken(`${baseUrl}/prompt`), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    });
    if (!res.ok) {
      throw new Error(`ComfyUI /prompt request failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as { prompt_id: string; number: number; node_errors?: Record<string, unknown> };
    if (data.node_errors && Object.keys(data.node_errors).length > 0) {
      throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(data.node_errors)}`);
    }

    let resolve!: (result: ComfyCompletionResult) => void;
    const completion = new Promise<ComfyCompletionResult>((res2) => {
      resolve = res2;
    });
    pendingJobs.set(data.prompt_id, { progressCallbacks: new Set(), settled: false, resolve, completion });

    return { promptId: data.prompt_id, queuePosition: data.number ?? 0 };
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
      return { status: 'error', outputs: [], error: `Unknown ComfyUI job '${promptId}'.` };
    }

    const timeout = new Promise<ComfyCompletionResult>((resolve) => {
      setTimeout(() => resolve({ status: 'error', outputs: [], error: 'ComfyUI job timed out.' }), opts.timeoutMs);
    });

    const result = await Promise.race([job.completion, timeout]);
    pendingJobs.delete(promptId);
    return result;
  }

  async function fetchOutputBytes(file: ComfyOutputFile): Promise<Buffer> {
    const params = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
    const res = await fetch(withToken(`${baseUrl}/view?${params.toString()}`), { headers });
    if (!res.ok) {
      throw new Error(`ComfyUI /view request failed (${res.status}) for '${file.filename}'.`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // The graph is rendered (and its LoadImage node's `image` field baked in)
  // before this runs, using `image.name` as the reference -- `overwrite`
  // forces ComfyUI to actually save under that exact name rather than
  // silently renaming on a collision, so the two stay guaranteed in sync.
  async function uploadImage(image: ComfyImageInput): Promise<void> {
    const form = new FormData();
    form.append('image', new Blob([image.buffer]), image.name);
    form.append('overwrite', 'true');

    const res = await fetch(withToken(`${baseUrl}/upload/image`), { method: 'POST', headers, body: form });
    if (!res.ok) {
      throw new Error(`ComfyUI /upload/image request failed: ${res.status}`);
    }
  }

  async function interrupt(promptId?: string): Promise<void> {
    await fetch(withToken(`${baseUrl}/interrupt`), { method: 'POST', headers });
    if (promptId) {
      const job = pendingJobs.get(promptId);
      if (job && !job.settled) {
        job.settled = true;
        job.resolve({ status: 'error', outputs: [], error: 'Interrupted.' });
      }
    }
  }

  return { healthCheck, submitWorkflow, onProgress, waitForCompletion, fetchOutputBytes, interrupt };
}
