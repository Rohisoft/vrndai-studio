import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createGoogleDriveClient, type GoogleDriveClientConfig } from './google-drive-client.js';
import type { VideoStorage } from './video-storage.js';

// job.videoPath becomes the Drive file id itself (an opaque string, same as
// a local filesystem path was before) -- every call site already treats it
// as an opaque key, not something to parse, so this swap is transparent to
// the rest of the app (worker.ts, jobs.ts, cleanup.ts).
export function createGoogleDriveVideoStorage(config: GoogleDriveClientConfig): VideoStorage {
  const drive = createGoogleDriveClient(config);

  async function saveVideo(jobId: string, bytes: Buffer): Promise<string> {
    const filename = `${jobId}-${randomUUID().slice(0, 8)}.mp4`;
    return drive.uploadVideo(filename, bytes);
  }

  // ffmpeg (frame-extract.ts, combine.ts) needs a real local file to read --
  // downloaded to a temp path and streamed straight to disk rather than
  // buffered in memory first, since these are full-length videos.
  async function getLocalFile(key: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const tempPath = path.join(os.tmpdir(), `drive-${key}-${randomUUID()}.mp4`);
    const stream = await drive.downloadStream(key);
    await pipeline(stream, fs.createWriteStream(tempPath));
    return { path: tempPath, cleanup: () => fs.promises.rm(tempPath, { force: true }) };
  }

  async function getVideoMeta(key: string): Promise<{ sizeBytes: number } | null> {
    const size = await drive.getFileSize(key);
    return size === null ? null : { sizeBytes: size };
  }

  async function streamVideo(key: string, range?: { start: number; end: number }): Promise<NodeJS.ReadableStream> {
    return drive.downloadStream(key, range);
  }

  async function deleteVideo(key: string): Promise<void> {
    await drive.deleteFile(key);
  }

  return { saveVideo, getLocalFile, getVideoMeta, streamVideo, deleteVideo };
}
