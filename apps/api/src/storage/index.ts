import path from 'node:path';
import type { Env } from '../config/env.js';
import { createLocalVideoStorage } from './local-video-storage.js';
import { createGoogleDriveVideoStorage } from './google-drive-video-storage.js';
import type { VideoStorage } from './video-storage.js';

export function createVideoStorage(env: Env, dataDir: string): VideoStorage {
  if (env.VIDEO_STORAGE_PROVIDER === 'google-drive') {
    if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET || !env.GOOGLE_DRIVE_REFRESH_TOKEN) {
      throw new Error(
        'VIDEO_STORAGE_PROVIDER=google-drive requires GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN to be set.'
      );
    }
    return createGoogleDriveVideoStorage({
      clientId: env.GOOGLE_DRIVE_CLIENT_ID,
      clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_DRIVE_REFRESH_TOKEN,
      folderId: env.GOOGLE_DRIVE_FOLDER_ID,
    });
  }
  return createLocalVideoStorage(path.join(dataDir, 'videos'));
}

export type { VideoStorage } from './video-storage.js';
