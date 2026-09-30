import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Db } from 'mongodb';
import type { Env } from './config/env.js';
import type { ComfyClient } from './comfy/types.js';
import type { LlmClient } from './llm/types.js';
import type { JobStore } from './store/job-store.js';
import type { VideoStorage } from './storage/video-storage.js';
import type { ImageCache } from './storage/local-image-cache.js';
import type { JobEventBus } from './sse/job-events.js';
import type { JobQueue } from './queue/in-memory-queue.js';
import type { AppSettingsStore } from './settings/app-settings-store.js';
import type { EnvSettingsStore } from './settings/env-settings-store.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerAssistantRoutes } from './routes/assistant.js';
import { registerAudioRoutes } from './routes/audio.js';
import { registerGenerateRoute } from './routes/generate.js';
import { registerImagesRoutes } from './routes/images.js';
import { registerJobsRoutes } from './routes/jobs.js';
import { registerJobsStreamRoute } from './routes/jobs-stream.js';
import { registerVideoRoutes } from './routes/videos.js';

export interface AppDeps {
  env: Env;
  db: Db;
  // Path to the built frontend (apps/web/dist) -- only set in single-
  // service deployments (Render) where this API also serves the SPA.
  // Local dev runs the Vite dev server separately, so this is undefined
  // there (see index.ts).
  webDistDir?: string;
  comfyClient: ComfyClient;
  llmClient: LlmClient;
  jobStore: JobStore;
  videoStorage: VideoStorage;
  imageCache: ImageCache;
  eventBus: JobEventBus;
  queue: JobQueue;
  appSettingsStore: AppSettingsStore;
  envSettingsStore: EnvSettingsStore;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
      },
    },

    connectionTimeout: 120000,
    keepAliveTimeout: 120000,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024,
    },
  });

  registerErrorHandler(app);
  await registerAuth(app, deps.env, deps.db);

  registerHealthRoutes(app, deps);
  registerConfigRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerAssistantRoutes(app, deps);
  registerGenerateRoute(app, deps);
  registerImagesRoutes(app, deps);
  registerAudioRoutes(app, deps);
  registerJobsRoutes(app, deps);
  registerJobsStreamRoute(app, deps);
  registerVideoRoutes(app, deps);

  if (deps.webDistDir) {
    await app.register(fastifyStatic, {
      root: deps.webDistDir,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api/')) {
        reply.status(404).send({
          error: 'NotFound',
          message: `Route ${request.method}:${request.raw.url} not found.`,
        });
        return;
      }

      reply.type('text/html').sendFile('index.html');
    });
  }

  return app;
}
