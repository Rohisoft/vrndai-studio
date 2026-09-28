import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { VideoStorage } from './video-storage.js';

export function createLocalVideoStorage(videosDir: string): VideoStorage {
  fs.mkdirSync(videosDir, { recursive: true });

  function getVideoPath(filename: string): string {
    // Prevent path traversal via a crafted filename (e.g. "../../etc/passwd") --
    // only the basename is ever honored.
    return path.join(videosDir, path.basename(filename));
  }

  async function saveVideo(jobId: string, bytes: Buffer): Promise<string> {
    const filename = `${jobId}-${randomUUID().slice(0, 8)}.mp4`;
    const filePath = getVideoPath(filename);
    await fsp.writeFile(filePath, bytes);
    return filePath;
  }

  async function readVideo(filename: string): Promise<Buffer> {
    return fsp.readFile(getVideoPath(filename));
  }

  function videoExists(filename: string): boolean {
    return fs.existsSync(getVideoPath(filename));
  }

  async function deleteVideo(filename: string): Promise<void> {
    await fsp.rm(getVideoPath(filename), { force: true });
  }

  async function listVideos(): Promise<{ filename: string; sizeBytes: number; createdAt: Date }[]> {
    const entries = await fsp.readdir(videosDir);
    const stats = await Promise.all(
      entries.map(async (filename) => {
        const stat = await fsp.stat(getVideoPath(filename));
        return { filename, sizeBytes: stat.size, createdAt: stat.birthtime };
      })
    );
    return stats;
  }

  return { saveVideo, readVideo, getVideoPath, videoExists, deleteVideo, listVideos };
}
