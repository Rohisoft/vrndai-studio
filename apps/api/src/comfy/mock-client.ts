import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ComfyClient,
  ComfyCompletionResult,
  ComfyOutputFile,
  ComfyProgress,
  ComfySubmitResult,
  SubmitWorkflowOptions,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_VIDEO_PATH = path.join(__dirname, '..', '..', 'assets', 'mock', 'sample.mp4');
const MOCK_OUTPUT: ComfyOutputFile = { filename: 'sample.mp4', subfolder: '', type: 'mock' };

const TICK_COUNT = 8;
const TICK_INTERVAL_MS = 400;

interface MockJob {
  progressCallbacks: Set<(progress: ComfyProgress) => void>;
  completion: Promise<ComfyCompletionResult>;
  interrupted: boolean;
  timer?: NodeJS.Timeout;
}

// Fabricates a believable submit -> progress -> completion sequence so the
// entire rest of the app (queue, SSE, UI, history) can be built and tested
// without a GPU or a running ComfyUI instance. Resolves against a real
// bundled sample video, not a placeholder path, so playback/download
// actually works end to end in mock mode too.
export function createMockComfyClient(): ComfyClient {
  const jobs = new Map<string, MockJob>();
  let counter = 0;

  function healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }

  function submitWorkflow(_graph: Record<string, unknown>, _options?: SubmitWorkflowOptions): Promise<ComfySubmitResult> {
    const promptId = `mock-${++counter}-${Date.now()}`;
    let resolveCompletion!: (result: ComfyCompletionResult) => void;
    const completion = new Promise<ComfyCompletionResult>((resolve) => {
      resolveCompletion = resolve;
    });

    const job: MockJob = { progressCallbacks: new Set(), completion, interrupted: false };
    jobs.set(promptId, job);

    let tick = 0;
    job.timer = setInterval(() => {
      if (job.interrupted) {
        clearInterval(job.timer);
        return;
      }

      tick += 1;
      const progress: ComfyProgress = { value: tick, max: TICK_COUNT };
      for (const callback of job.progressCallbacks) {
        callback(progress);
      }

      if (tick >= TICK_COUNT) {
        clearInterval(job.timer);
        resolveCompletion({ status: 'success', outputs: [MOCK_OUTPUT] });
      }
    }, TICK_INTERVAL_MS);

    return Promise.resolve({ promptId, queuePosition: 0 });
  }

  function onProgress(promptId: string, callback: (progress: ComfyProgress) => void): () => void {
    const job = jobs.get(promptId);
    if (!job) {
      return () => {};
    }
    job.progressCallbacks.add(callback);
    return () => job.progressCallbacks.delete(callback);
  }

  function waitForCompletion(promptId: string, options: { timeoutMs: number }): Promise<ComfyCompletionResult> {
    const job = jobs.get(promptId);
    if (!job) {
      return Promise.resolve({ status: 'error', outputs: [], error: `Unknown mock job '${promptId}'.` });
    }

    const timeout = new Promise<ComfyCompletionResult>((resolve) => {
      setTimeout(() => resolve({ status: 'error', outputs: [], error: 'Mock job timed out.' }), options.timeoutMs);
    });

    return Promise.race([job.completion, timeout]);
  }

  function fetchOutputBytes(_file: ComfyOutputFile): Promise<Buffer> {
    return readFile(SAMPLE_VIDEO_PATH);
  }

  function interrupt(promptId?: string): Promise<void> {
    if (promptId) {
      const job = jobs.get(promptId);
      if (job) {
        job.interrupted = true;
        if (job.timer) {
          clearInterval(job.timer);
        }
      }
    }
    return Promise.resolve();
  }

  return { healthCheck, submitWorkflow, onProgress, waitForCompletion, fetchOutputBytes, interrupt };
}
