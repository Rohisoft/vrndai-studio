import type { Env } from '../config/env.js';
import { createMockComfyClient } from './mock-client.js';
import { createRealComfyClient } from './real-client.js';
import { createRunpodServerlessComfyClient } from './runpod-serverless-client.js';
import type { ComfyClient } from './types.js';

export function createComfyClient(env: Env): ComfyClient {
  if (env.COMFYUI_MOCK) {
    return createMockComfyClient();
  }
  if (env.RUNPOD_API_KEY) {
    let endpointIds: Record<string, string>;
    try {
      endpointIds = env.RUNPOD_ENDPOINT_IDS ? JSON.parse(env.RUNPOD_ENDPOINT_IDS) : {};
    } catch {
      throw new Error('RUNPOD_ENDPOINT_IDS must be a JSON object string, e.g. {"ltx2.5-t2v":"abc123"}.');
    }
    return createRunpodServerlessComfyClient({ apiKey: env.RUNPOD_API_KEY, endpointIds });
  }
  return createRealComfyClient({ baseUrl: env.COMFYUI_BASE_URL, authToken: env.COMFYUI_AUTH_TOKEN });
}

export type { ComfyClient, ComfyCompletionResult, ComfyOutputFile, ComfyProgress, ComfySubmitResult } from './types.js';
