import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppSettingsSchema, EnvSettingsInputSchema, EnvSettingsViewSchema } from '@app/shared';
import { z } from 'zod';
import type { AppDeps } from '../app.js';

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/api/settings',
    { schema: { response: { 200: z.object({ env: EnvSettingsViewSchema, app: AppSettingsSchema }) } } },
    async () => ({
      env: deps.envSettingsStore.view(),
      app: deps.appSettingsStore.load(),
    })
  );

  // Takes effect immediately -- no restart needed, unlike the env settings
  // below. app.config.ts values are only ever read fresh per-request.
  server.post(
    '/api/settings/app',
    { schema: { body: AppSettingsSchema, response: { 200: AppSettingsSchema } } },
    async (request) => deps.appSettingsStore.save(request.body)
  );

  // Every field here requires a server restart to actually take effect
  // (the ComfyUI client, port binding, and data dir are all fixed at boot),
  // so the response always signals that rather than trying to distinguish
  // which specific field would need one.
  server.post(
    '/api/settings/env',
    {
      schema: {
        body: EnvSettingsInputSchema,
        response: { 200: z.object({ saved: z.literal(true), restartRequired: z.literal(true) }) },
      },
    },
    async (request) => {
      deps.envSettingsStore.save(request.body);
      return { saved: true as const, restartRequired: true as const };
    }
  );
}
