import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PublicAppConfigSchema } from '@app/shared';
import { models } from '../../../../config/models.config.js';
import { voices } from '../../../../config/voices.config.js';
import type { AppDeps } from '../app.js';

export function registerConfigRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/config',
    { schema: { response: { 200: PublicAppConfigSchema } } },
    async () => {
      const settings = deps.appSettingsStore.load();
      return {
        appName: settings.appName,
        allowedDurationsSeconds: settings.allowedDurationsSeconds,
        allowedResolutions: settings.allowedResolutions,
        allowedFps: settings.allowedFps,
        maxPromptLength: settings.maxPromptLength,
        models: models.map((model) => ({
          id: model.id,
          label: model.label,
          supportsImageToVideo: model.supportsImageToVideo,
          engine: model.engine ?? 'comfy',
        })),
        defaultModelId: settings.defaultModelId,
        imageToVideoEnabled: settings.imageToVideoEnabled,
        passwordRequired: Boolean(deps.env.APP_PASSWORD),
        voices,
      };
    }
  );
}
