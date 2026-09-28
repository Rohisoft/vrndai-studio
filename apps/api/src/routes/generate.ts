import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { GenerationRequestSchema, JobRecordSchema } from '@app/shared';
import { ErrorResponseSchema } from '../lib/error-response.js';
import { toJobRecord } from '../store/job-store.js';
import type { AppDeps } from '../app.js';

export function registerGenerateRoute(app: FastifyInstance, deps: AppDeps): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/generate',
    { schema: { body: GenerationRequestSchema, response: { 200: JobRecordSchema, 400: ErrorResponseSchema } } },
    async (request, reply) => {
      const settings = deps.appSettingsStore.load();

      if (request.body.prompt.length > settings.maxPromptLength) {
        reply.status(400).send({
          error: 'ValidationError',
          issues: [{ path: 'prompt', message: `Prompt exceeds maxPromptLength (${settings.maxPromptLength}).` }],
        });
        return;
      }

      const row = await deps.jobStore.create({ id: randomUUID(), modelId: request.body.modelId, params: request.body });
      deps.queue.notify();
      return toJobRecord(row);
    }
  );
}
