import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

// Grabs a frame of a finished clip as a JPEG, for use as the starting image
// of a "continue this clip" generation.
//
// With `atSeconds` given: seeks to that exact timestamp and grabs the frame
// showing there -- this is what lets the user pause the video wherever both
// characters/the right composition are visible and continue from that
// moment instead of always the last frame (post-input `-ss` is
// frame-accurate, not the fast-but-approximate pre-input form; acceptable
// speed-wise since these are short clips).
//
// Without it: falls back to the original last-frame behavior. `-sseof -1`
// seeks to one second before end of file (cheap -- avoids decoding the
// whole video just to reach the end) and `-update 1` tells the image2 muxer
// to keep overwriting a single output file with each frame it decodes from
// there, so what's left on disk is the last one.
export async function extractFrame(videoPath: string, atSeconds?: number): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const outputPath = path.join(os.tmpdir(), `frame-${randomUUID()}.jpg`);
  const args =
    typeof atSeconds === 'number'
      ? ['-i', videoPath, '-ss', String(atSeconds), '-frames:v', '1', '-q:v', '2', outputPath]
      : ['-sseof', '-1', '-i', videoPath, '-update', '1', '-q:v', '2', outputPath];
  await execFileAsync('ffmpeg', args);
  return {
    path: outputPath,
    cleanup: () => fs.rm(outputPath, { force: true }),
  };
}
