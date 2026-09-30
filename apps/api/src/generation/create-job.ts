import { randomUUID } from 'node:crypto';
import type { GenerationRequest, JobRecord } from '@app/shared';
import { toJobRecord } from '../store/job-store.js';
import type { AppDeps } from '../app.js';

export type CreateGenerationJobResult =
  | { ok: true; job: JobRecord }
  | { ok: false; issues: { path: string; message: string }[] };

// The one real entry point for turning a GenerationRequest into a queued
// job -- shared by the manual Create-form route (routes/generate.ts) and
// the agentic Assistant's confirm step (routes/assistant.ts), so both
// paths get the exact same validation and queuing behavior instead of two
// copies that could drift apart.
export async function createGenerationJob(deps: AppDeps, request: GenerationRequest): Promise<CreateGenerationJobResult> {
  const settings = deps.appSettingsStore.load();

  if (request.prompt.length > settings.maxPromptLength) {
    return {
      ok: false,
      issues: [{ path: 'prompt', message: `Prompt exceeds maxPromptLength (${settings.maxPromptLength}).` }],
    };
  }

  const row = await deps.jobStore.create({ id: randomUUID(), modelId: request.modelId, params: request });
  deps.queue.notify();
  return { ok: true, job: toJobRecord(row) };
}
