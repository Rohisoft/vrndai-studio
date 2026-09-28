import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface StreamInfo {
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

async function probeStream(filePath: string): Promise<StreamInfo> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,width,height,r_frame_rate',
    '-of',
    'json',
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ codec_type: string; width?: number; height?: number; r_frame_rate?: string }>;
  };
  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  if (!videoStream || !videoStream.width || !videoStream.height || !videoStream.r_frame_rate) {
    throw new Error(`Could not read video stream info for '${filePath}'.`);
  }
  const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
  const hasAudio = parsed.streams?.some((s) => s.codec_type === 'audio') ?? false;
  return { width: videoStream.width, height: videoStream.height, fps: den ? num / den : num, hasAudio };
}

// Concatenates multiple video files into one, re-encoding via the concat
// *filter* (not the faster concat *demuxer* with -c copy) so clips that
// differ in codec -- which ours can, since they may come from different
// models -- still combine correctly instead of producing broken output.
// The concat filter additionally requires every input to already share the
// same frame size/SAR/fps, which our clips generally do NOT (different
// models default to different resolutions and fps) -- so each input is
// first scaled+letterboxed to a common target size (the largest width and
// height among the inputs, so nothing upscales past its own source
// resolution) and resampled to a common fps (the largest among inputs)
// before concatenation.
//
// Audio is included only when every input actually has an audio stream --
// LTX-2.5 always does (native dialogue/sound), but Wan's clips don't, and
// ffmpeg's concat filter fails outright if segments disagree on whether
// they have audio. When any input lacks it, this falls back to a
// video-only output (still correct, just silent) rather than erroring.
export async function combineVideos(inputPaths: string[], outputPath: string): Promise<void> {
  if (inputPaths.length < 2) {
    throw new Error('combineVideos requires at least 2 input paths.');
  }

  const streams = await Promise.all(inputPaths.map(probeStream));
  const targetWidth = Math.round(Math.max(...streams.map((s) => s.width)) / 2) * 2;
  const targetHeight = Math.round(Math.max(...streams.map((s) => s.height)) / 2) * 2;
  const targetFps = Math.max(...streams.map((s) => s.fps));
  const combineAudio = streams.every((s) => s.hasAudio);

  const inputArgs = inputPaths.flatMap((filePath) => ['-i', filePath]);
  const videoStages = inputPaths
    .map(
      (_, index) =>
        `[${index}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${targetFps}[v${index}]`
    )
    .join(';');

  let filter: string;
  let mapArgs: string[];
  let audioCodecArgs: string[];

  if (combineAudio) {
    // Sample rate/channel layout can differ per clip same as resolution
    // can -- normalized here the same way video gets scaled+padded above.
    const audioStages = inputPaths
      .map((_, index) => `[${index}:a]aresample=48000,aformat=channel_layouts=stereo[a${index}]`)
      .join(';');
    const concatRefs = inputPaths.map((_, index) => `[v${index}][a${index}]`).join('');
    filter = `${videoStages};${audioStages};${concatRefs}concat=n=${inputPaths.length}:v=1:a=1[outv][outa]`;
    mapArgs = ['-map', '[outv]', '-map', '[outa]'];
    audioCodecArgs = ['-c:a', 'aac', '-b:a', '192k'];
  } else {
    const concatRefs = inputPaths.map((_, index) => `[v${index}]`).join('');
    filter = `${videoStages};${concatRefs}concat=n=${inputPaths.length}:v=1:a=0[outv]`;
    mapArgs = ['-map', '[outv]'];
    audioCodecArgs = [];
  }

  await execFileAsync('ffmpeg', [
    ...inputArgs,
    '-filter_complex',
    filter,
    ...mapArgs,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    ...audioCodecArgs,
    outputPath,
  ]);
}
