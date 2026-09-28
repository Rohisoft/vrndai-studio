// Some video models need a frame count of the form 4n+1 (a consequence of
// their temporal VAE compression). Nearest-rounding rather than always
// rounding up keeps the deviation from the requested duration small
// (at most ~2 frames) and is simpler than a directional rule.
export function computeFrameCount(durationSeconds: number, fps: number, requiresFourNPlusOne: boolean): number {
  const raw = Math.round(durationSeconds * fps);

  if (!requiresFourNPlusOne) {
    return Math.max(1, raw);
  }

  const n = Math.max(0, Math.round((raw - 1) / 4));
  return n * 4 + 1;
}
