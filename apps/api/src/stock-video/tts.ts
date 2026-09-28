import '../stock-video/webcrypto-polyfill.js';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import { promisify } from 'node:util';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const execFileAsync = promisify(execFile);

export interface WordTiming {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface NarrationResult {
  audioPath: string;
  durationSeconds: number;
  wordTimings: WordTiming[];
}

// edge-tts reports Offset/Duration in 100-nanosecond ticks -- confirmed live
// against a real synthesis (e.g. Offset: 1000000 === 0.1s).
const TICKS_PER_SECOND = 10_000_000;

export async function synthesizeNarration(opts: { text: string; voiceName: string; workDir: string }): Promise<NarrationResult> {
  // config/voices.config.ts's ids carry a "-Female"/"-Male" suffix for
  // display grouping -- msedge-tts needs the bare edge-tts ShortName.
  const voiceShortName = opts.voiceName.replace(/-(Female|Male)$/, '');

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voiceShortName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
    const { audioFilePath, metadataFilePath } = await tts.toFile(opts.workDir, opts.text);
    const wordTimings = metadataFilePath ? parseWordTimings(await fsp.readFile(metadataFilePath, 'utf-8')) : [];
    const durationSeconds = await probeAudioDuration(audioFilePath);
    return { audioPath: audioFilePath, durationSeconds, wordTimings };
  } finally {
    tts.close();
  }
}

function parseWordTimings(raw: string): WordTiming[] {
  const parsed = JSON.parse(raw) as {
    Metadata: Array<{ Type: string; Data: { Offset: number; Duration: number; text: { Text: string } } }>;
  };
  return parsed.Metadata.filter((m) => m.Type === 'WordBoundary').map((m) => ({
    text: m.Data.text.Text,
    startSeconds: m.Data.Offset / TICKS_PER_SECOND,
    endSeconds: (m.Data.Offset + m.Data.Duration) / TICKS_PER_SECOND,
  }));
}

async function probeAudioDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]);
  return parseFloat(stdout.trim());
}
