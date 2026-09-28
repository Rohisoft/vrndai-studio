import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { OAuth2Client } from 'google-auth-library';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export interface GoogleDriveClientConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Uploads go to this Drive folder when set, or the account's root "My Drive" otherwise. */
  folderId?: string;
}

// Only google-auth-library is used here (not the much heavier `googleapis`
// package) -- it's purely for OAuth2Client's token refresh (auto re-fetches
// an access token from the refresh token when expired/missing), every
// actual Drive operation below is a plain REST call via fetch, matching
// this codebase's existing no-heavy-SDK pattern (llm/groq-client.ts,
// stock-video's Pexels client).
export function createGoogleDriveClient(config: GoogleDriveClientConfig) {
  const oauth2Client = new OAuth2Client(config.clientId, config.clientSecret);
  oauth2Client.setCredentials({ refresh_token: config.refreshToken });

  async function getAccessToken(): Promise<string> {
    const { token } = await oauth2Client.getAccessToken();
    if (!token) {
      throw new Error('Failed to obtain a Google Drive access token -- check GOOGLE_DRIVE_REFRESH_TOKEN is still valid.');
    }
    return token;
  }

  // Drive's multipart upload wants `multipart/related` (metadata JSON part +
  // raw media part), which is a different format from the `multipart/form-
  // data` Node's built-in FormData produces -- hand-built here since no
  // existing dependency covers this shape.
  async function uploadVideo(filename: string, bytes: Buffer): Promise<string> {
    const accessToken = await getAccessToken();
    const boundary = `drive-upload-${randomUUID()}`;
    const metadata = JSON.stringify({ name: filename, ...(config.folderId ? { parents: [config.folderId] } : {}) });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const res = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) {
      throw new Error(`Google Drive upload failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  // null (not thrown) for a 404 -- callers treat "doesn't exist" as a normal
  // outcome (e.g. getVideoMeta returning null), not an error condition.
  async function getFileSize(fileId: string): Promise<number | null> {
    const accessToken = await getAccessToken();
    const res = await fetch(`${DRIVE_API_BASE}/files/${fileId}?fields=size`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`Google Drive metadata lookup failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { size?: string };
    // Drive returns size as a decimal string, not a number.
    return data.size ? Number(data.size) : 0;
  }

  // Range is forwarded as a real HTTP Range header -- Drive's alt=media
  // download supports it directly (returns 206 + the requested slice), so
  // this streams straight through without ever buffering the whole video
  // in this process's memory.
  async function downloadStream(fileId: string, range?: { start: number; end: number }): Promise<NodeJS.ReadableStream> {
    const accessToken = await getAccessToken();
    const res = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      },
    });
    if (!res.ok || !res.body) {
      throw new Error(`Google Drive download failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    return Readable.fromWeb(res.body as import('stream/web').ReadableStream);
  }

  async function deleteFile(fileId: string): Promise<void> {
    const accessToken = await getAccessToken();
    const res = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // A 404 means it's already gone -- same "deleting something absent is
    // fine" semantics as local storage's fs.rm(..., { force: true }).
    if (!res.ok && res.status !== 404) {
      throw new Error(`Google Drive delete failed: ${res.status} ${await res.text()}`);
    }
  }

  return { uploadVideo, getFileSize, downloadStream, deleteFile };
}

export type GoogleDriveClient = ReturnType<typeof createGoogleDriveClient>;
