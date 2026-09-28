import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// npm workspace scripts run with CWD set to the workspace dir (apps/api),
// not the repo root, so dotenv's default "look in CWD" behavior would miss
// the root .env entirely -- point it there explicitly. This must run before
// parseEnv() is called below, but doesn't need to precede these imports:
// none of them read process.env at module-evaluation time, only when
// parseEnv() is explicitly invoked.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

import { buildApp } from './app.js';
import { createComfyClient } from './comfy/index.js';
import { createLlmClient } from './llm/index.js';
import { createStockVideoClient } from './stock-video/stock-video-client.js';
import { parseEnv } from './config/env.js';
import { runCleanup } from './cleanup/cleanup.js';
import { createJobQueue } from './queue/in-memory-queue.js';
import type { WorkerDeps } from './queue/worker.js';
import { createAppSettingsStore } from './settings/app-settings-store.js';
import { createEnvSettingsStore } from './settings/env-settings-store.js';
import { createJobEventBus } from './sse/job-events.js';
import { openDatabase } from './store/db.js';
import { createSqliteJobStore } from './store/sqlite-job-store.js';
import { createLocalVideoStorage } from './storage/local-video-storage.js';
import { createLocalImageCache } from './storage/local-image-cache.js';

const env = parseEnv();
const dataDir = path.isAbsolute(env.DATA_DIR) ? env.DATA_DIR : path.join(REPO_ROOT, env.DATA_DIR);
const workflowsDir = path.join(REPO_ROOT, 'workflows');

const db = openDatabase(dataDir);
const jobStore = createSqliteJobStore(db);
const videoStorage = createLocalVideoStorage(path.join(dataDir, 'videos'));
const imageCache = createLocalImageCache(path.join(dataDir, 'pending-uploads'));
const eventBus = createJobEventBus();
const appSettingsStore = createAppSettingsStore(dataDir);
const envSettingsStore = createEnvSettingsStore(env);
const comfyClient = createComfyClient(env);
const llmClient = createLlmClient(env);
const stockVideoClient = createStockVideoClient({
  pexelsApiKey: env.PEXELS_API_KEY ?? '',
  llmClient,
});

const workerDeps: WorkerDeps = {
  jobStore,
  comfyClient,
  stockVideoClient,
  videoStorage,
  imageCache,
  eventBus,
  appSettingsStore,
  workflowsDir,
};
const queue = createJobQueue(workerDeps);

// Crash recovery: anything still "running" when the process last stopped
// didn't actually finish -- mark it failed before the worker resumes
// whatever's left in "queued".
jobStore.markAllRunningAsFailed();
await runCleanup({ jobStore, videoStorage, imageCache, appSettingsStore });
queue.notify();

const app = await buildApp({
  env,
  comfyClient,
  llmClient,
  jobStore,
  videoStorage,
  imageCache,
  eventBus,
  queue,
  appSettingsStore,
  envSettingsStore,
});

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`API listening on http://localhost:${env.PORT} (mock=${env.COMFYUI_MOCK})`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
