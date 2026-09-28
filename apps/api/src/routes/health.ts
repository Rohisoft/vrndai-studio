import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../app.js';

export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/health',
    { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } },
    async () => ({ status: 'ok' as const })
  );

  server.get(
    '/health/comfyui',
    { schema: { response: { 200: z.object({ connected: z.boolean(), mock: z.boolean() }) } } },
    async () => {
      const connected = await deps.comfyClient.healthCheck();
      return { connected, mock: deps.env.COMFYUI_MOCK };
    }
  );
}
