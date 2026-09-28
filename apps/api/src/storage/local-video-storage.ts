import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { VideoStorage } from './video-storage.js';

export function createLocalVideoStorage(videosDir: string): VideoStorage {
  fs.mkdirSync(videosDir, { recursive: true });

  // Prevent path traversal via a crafted key (e.g. "../../etc/passwd") --
  // only the basename is ever honored, regardless of what's stored as
  // job.videoPath.
  function resolvePath(key: string): string {
    return path.join(videosDir, path.basename(key));
  }

  async function saveVideo(jobId: string, bytes: Buffer): Promise<string> {
    const filename = `${jobId}-${randomUUID().slice(0, 8)}.mp4`;
    const filePath = resolvePath(filename);
    await fsp.writeFile(filePath, bytes);
    return filePath;
  }

  async function getLocalFile(key: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
    return { path: resolvePath(key), cleanup: async () => {} };
  }

  async function getVideoMeta(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const stat = await fsp.stat(resolvePath(key));
      return { sizeBytes: stat.size };
    } catch {
      return null;
    }
  }

  async function streamVideo(key: string, range?: { start: number; end: number }): Promise<NodeJS.ReadableStream> {
    return fs.createReadStream(resolvePath(key), range);
  }

  async function deleteVideo(key: string): Promise<void> {
    await fsp.rm(resolvePath(key), { force: true });
  }

  return { saveVideo, getLocalFile, getVideoMeta, streamVideo, deleteVideo };
}
