import fsp from 'node:fs/promises';

export interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number;
  height: number;
  fps: number;
  link: string;
}

export interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  video_files: PexelsVideoFile[];
}

const SEARCH_TIMEOUT_MS = 10000;
const DOWNLOAD_TIMEOUT_MS = 60000;

// Verified live against the real API: GET https://api.pexels.com/videos/search
// with an `Authorization: <key>` header (no "Bearer" prefix), `orientation`
// and `min_duration` query params are genuinely honored server-side.
export async function searchClips(
  term: string,
  opts: { apiKey: string; orientation: 'landscape' | 'portrait'; perPage?: number; minDurationSeconds?: number }
): Promise<PexelsVideo[]> {
  const url = new URL('https://api.pexels.com/videos/search');
  url.searchParams.set('query', term);
  url.searchParams.set('orientation', opts.orientation);
  url.searchParams.set('per_page', String(opts.perPage ?? 6));
  if (opts.minDurationSeconds) {
    url.searchParams.set('min_duration', String(opts.minDurationSeconds));
  }
  const res = await fetch(url, { headers: { Authorization: opts.apiKey }, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Pexels search failed (${res.status}) for "${term}": ${await res.text().catch(() => '')}`);
  }
  const body = (await res.json()) as { videos: PexelsVideo[] };
  return body.videos;
}

// Prefers the smallest mp4 file that's still >= the target resolution
// (avoids pointless large downloads), falling back to the largest available
// when nothing is big enough.
export function pickVideoFile(video: PexelsVideo, targetWidth: number, targetHeight: number): PexelsVideoFile | null {
  const mp4s = video.video_files.filter((f) => f.file_type === 'video/mp4');
  if (mp4s.length === 0) {
    return null;
  }
  const bigEnough = mp4s.filter((f) => f.width >= targetWidth && f.height >= targetHeight).sort((a, b) => a.width - b.width);
  return bigEnough[0] ?? [...mp4s].sort((a, b) => b.width - a.width)[0];
}

export async function downloadClip(url: string, destPath: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Failed to download Pexels clip (${res.status}).`);
  }
  await fsp.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
}
