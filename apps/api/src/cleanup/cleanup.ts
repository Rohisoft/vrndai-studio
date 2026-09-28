import path from 'node:path';
import type { AppSettingsStore } from '../settings/app-settings-store.js';
import type { JobStore } from '../store/job-store.js';
import type { VideoStorage } from '../storage/video-storage.js';
import type { ImageCache } from '../storage/local-image-cache.js';

export interface CleanupDeps {
  jobStore: JobStore;
  videoStorage: VideoStorage;
  imageCache: ImageCache;
  appSettingsStore: AppSettingsStore;
}

// Reference frames for "continue this clip" only need to live between the
// /continue prepare step and the user actually submitting -- a day is far
// more than enough headroom, so anything older than this is an abandoned
// prepare (or an already-consumed one that a retry never needed again).
const PENDING_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Runs once at boot (simple, matches "as simple as possible" -- no cron/
// interval scheduler for a personal single-user tool). Enforces both limits
// from config: delete anything older than autoDeleteAfterDays, then trim
// down to maxStoredVideos by deleting the oldest completed jobs beyond it.
export async function runCleanup(deps: CleanupDeps): Promise<void> {
  await deps.imageCache.sweepOlderThan(PENDING_UPLOAD_MAX_AGE_MS);

  const settings = deps.appSettingsStore.load();
  const done = deps.jobStore.list().filter((job) => job.status === 'done' && job.videoPath);

  const cutoff = Date.now() - settings.autoDeleteAfterDays * 24 * 60 * 60 * 1000;
  const expired = done.filter((job) => job.completedAt && new Date(job.completedAt).getTime() < cutoff);

  const stillFresh = done.filter((job) => !expired.includes(job));
  const overLimit =
    stillFresh.length > settings.maxStoredVideos
      ? [...stillFresh].sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? '')).slice(
          0,
          stillFresh.length - settings.maxStoredVideos
        )
      : [];

  for (const job of [...expired, ...overLimit]) {
    if (job.videoPath) {
      await deps.videoStorage.deleteVideo(path.basename(job.videoPath)).catch(() => {});
    }
    deps.jobStore.delete(job.id);
  }
}
