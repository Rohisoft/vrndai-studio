import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AssembleVideoOptions {
  /** Downloaded Pexels clip paths, in the order they should play. */
  clipPaths: string[];
  /** Seconds to use from the start of each clip, same order as clipPaths. */
  clipTrimSeconds: number[];
  audioPath: string;
  audioDurationSeconds: number;
  srtPath: string | null;
  targetWidth: number;
  targetHeight: number;
  targetFps: number;
  outputPath: string;
  signal?: AbortSignal;
}

// One ffmpeg call per job: normalize N silent Pexels clips to one
// resolution/fps, concat them, trim the result to exactly the narration's
// length, mux in that one audio track, and optionally burn in an SRT.
// Pexels clips' own ambient audio is dropped automatically -- the filter
// graph and -map list never reference any clip's audio stream, only the
// separate TTS audio input.
export async function assembleVideo(opts: AssembleVideoOptions): Promise<void> {
  const { clipPaths, clipTrimSeconds, audioPath, audioDurationSeconds, srtPath, targetWidth, targetHeight, targetFps, outputPath } = opts;

  const inputArgs = [...clipPaths.flatMap((p) => ['-i', p]), '-i', audioPath];
  const audioInputIndex = clipPaths.length;

  // scale with force_original_aspect_ratio=increase + crop = fill the frame
  // edge-to-edge (not letterbox pad) -- b-roll should look like real
  // short-form video, not have black bars.
  const perClipFilters = clipPaths
    .map(
      (_, i) =>
        `[${i}:v]trim=duration=${clipTrimSeconds[i]},setpts=PTS-STARTPTS,` +
        `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,` +
        `crop=${targetWidth}:${targetHeight},setsar=1,fps=${targetFps}[v${i}]`
    )
    .join(';');

  const concatRefs = clipPaths.map((_, i) => `[v${i}]`).join('');
  const concatStage = `${concatRefs}concat=n=${clipPaths.length}:v=1:a=0[vconcat]`;

  // Clips are pre-selected so their summed duration covers the narration
  // with room to spare -- trim the concatenated timeline down to exactly
  // the audio's length so video and narration end together.
  const trimStage = `[vconcat]trim=duration=${audioDurationSeconds},setpts=PTS-STARTPTS[vtrimmed]`;

  let videoLabel = 'vtrimmed';
  let subtitleStage = '';
  if (srtPath) {
    const escaped = srtPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
    subtitleStage =
      `;[vtrimmed]subtitles='${escaped}':force_style=` +
      `'FontName=DejaVu Sans,FontSize=20,PrimaryColour=&H00FFFFFF,` +
      `OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=60'[vsub]`;
    videoLabel = 'vsub';
  }

  const filterComplex = `${perClipFilters};${concatStage};${trimStage}${subtitleStage}`;

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      ...inputArgs,
      '-filter_complex',
      filterComplex,
      '-map',
      `[${videoLabel}]`,
      '-map',
      `${audioInputIndex}:a`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      outputPath,
    ],
    { signal: opts.signal, maxBuffer: 1024 * 1024 * 64 }
  );
}
