import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { GenerationRequestSchema, JobRecordSchema } from '@app/shared';
import { ErrorResponseSchema } from '../lib/error-response.js';
import { createGenerationJob } from '../generation/create-job.js';
import type { AppDeps } from '../app.js';

export function registerGenerateRoute(app: FastifyInstance, deps: AppDeps): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/generate',
    { schema: { body: GenerationRequestSchema, response: { 200: JobRecordSchema, 400: ErrorResponseSchema } } },
    async (request, reply) => {
      const result = await createGenerationJob(deps, request.body);
      if (!result.ok) {
        reply.status(400).send({ error: 'ValidationError', issues: result.issues });
        return;
      }
      return result.job;
    }
  );
}
