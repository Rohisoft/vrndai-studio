import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// Holds reference-frame images extracted for "continue this clip" between
// the /continue prepare step and the later /generate submission -- these
// need to survive that gap (the user may sit on the Create page for a
// while) without being tied to any particular ComfyClient, since which
// client ends up uploading them depends on the deployment (Pod vs
// Serverless), decided later in queue/worker.ts.
export interface ImageCache {
  saveImage(name: string, bytes: Buffer): Promise<void>;
  readImage(name: string): Promise<Buffer>;
  deleteImage(name: string): Promise<void>;
  /** Sweeps anything older than maxAgeMs -- a failed job can retry (see
   * queue/worker.ts's retryCount), so entries aren't deleted right after
   * one read; this age-based sweep is what actually reclaims them once
   * they're genuinely done with (whether consumed or abandoned). */
  sweepOlderThan(maxAgeMs: number): Promise<void>;
}

export function createLocalImageCache(cacheDir: string): ImageCache {
  fs.mkdirSync(cacheDir, { recursive: true });

  function getImagePath(name: string): string {
    // Prevent path traversal via a crafted name -- only the basename is
    // ever honored, matching local-video-storage.ts's same guard.
    return path.join(cacheDir, path.basename(name));
  }

  async function saveImage(name: string, bytes: Buffer): Promise<void> {
    await fsp.writeFile(getImagePath(name), bytes);
  }

  async function readImage(name: string): Promise<Buffer> {
    return fsp.readFile(getImagePath(name));
  }

  async function deleteImage(name: string): Promise<void> {
    await fsp.rm(getImagePath(name), { force: true });
  }

  async function sweepOlderThan(maxAgeMs: number): Promise<void> {
    const entries = await fsp.readdir(cacheDir);
    const cutoff = Date.now() - maxAgeMs;
    await Promise.all(
      entries.map(async (name) => {
        const filePath = getImagePath(name);
        const stat = await fsp.stat(filePath).catch(() => null);
        if (stat && stat.birthtimeMs < cutoff) {
          await fsp.rm(filePath, { force: true });
        }
      })
    );
  }

  return { saveImage, readImage, deleteImage, sweepOlderThan };
}
