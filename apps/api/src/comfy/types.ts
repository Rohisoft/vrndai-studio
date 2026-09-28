// The interface both MockComfyClient and RealComfyClient implement. The
// queue/worker only ever talks to this interface, never to either
// implementation directly -- that's what makes mock-mode testing meaningful
// (it's exercising the same code paths the real client would run through).

export interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string; // 'output' | 'temp' | 'input' | 'mock'
  // Set only by clients whose completion response already carries the bytes
  // inline (e.g. RunPod Serverless's base64 output) -- when present,
  // fetchOutputBytes returns this directly instead of making a network
  // call, since there's nothing left to fetch.
  data?: Buffer;
}

export interface ComfyProgress {
  value: number;
  max: number;
  node?: string;
}

export interface ComfySubmitResult {
  promptId: string;
  queuePosition: number;
}

export interface ComfyCompletionResult {
  status: 'success' | 'error';
  outputs: ComfyOutputFile[];
  error?: string;
}

export interface ComfyImageInput {
  /** The name a LoadImage node's `image` field references this by. */
  name: string;
  buffer: Buffer;
}

export interface SubmitWorkflowOptions {
  // Travels with the submission itself rather than being uploaded ahead of
  // time -- required for RunPod Serverless, where there's no persistent
  // container to pre-upload into between requests. Pod-based clients that
  // DO have a persistent ComfyUI instance can still implement this by
  // uploading internally, right before submitting.
  images?: ComfyImageInput[];
  // Which config/models.config.ts model this job is for. Single-endpoint
  // clients (Pod, mock) ignore this; a Serverless client backed by one
  // endpoint per model needs it to pick the right endpoint.
  modelId?: string;
}

export interface ComfyClient {
  healthCheck(): Promise<boolean>;
  submitWorkflow(graph: Record<string, unknown>, options?: SubmitWorkflowOptions): Promise<ComfySubmitResult>;
  /** Returns an unsubscribe function. */
  onProgress(promptId: string, callback: (progress: ComfyProgress) => void): () => void;
  waitForCompletion(promptId: string, options: { timeoutMs: number }): Promise<ComfyCompletionResult>;
  fetchOutputBytes(file: ComfyOutputFile): Promise<Buffer>;
  interrupt(promptId?: string): Promise<void>;
}
