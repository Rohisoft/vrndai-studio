import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { voices } from '../../../../config/voices.config.js';
import { generateScript } from './script-writer.js';
import { generateSearchTerms } from './search-terms.js';
import { downloadClip, pickVideoFile, searchClips, type PexelsVideo } from './pexels-client.js';
import { probeAudioDuration, synthesizeNarration, type NarrationResult } from './tts.js';
import { transcribeAudio } from './transcribe.js';
import { cloneVoiceAndSynthesize } from './voice-clone-client.js';
import { buildAss } from './subtitles.js';
import { assembleVideo } from './assemble.js';
import { createJobWorkDir } from './workdir.js';
import type { StockVideoJobParams } from './types.js';
import type { LlmClient } from '../llm/types.js';

export interface StockVideoPipelineOptions {
  pexelsApiKey: string;
  llmClient: LlmClient;
  /** Only needed when a job actually uses real-voice narration (see useRealVoice() below) -- unrelated to LLM_PROVIDER, since word-level transcription isn't something Ollama/Gemini do here. */
  groqApiKey?: string;
  /** Only needed for "Clone my voice" narration (see useClonedVoice() below) -- a free Hugging Face Space, see voice-clone-client.ts's comment on why this is kept isolated to one file. */
  hfToken?: string;
  onProgress?: (value: number, label: string) => void;
  signal?: AbortSignal;
}

// Produces the same NarrationResult shape synthesizeNarration() does, from
// an uploaded recording instead of TTS -- everything downstream (clip
// gathering, buildAss()'s captions, assembleVideo()) stays identical either
// way. The transcript doubles as the "script" text for generateSearchTerms()
// below -- more accurate stock-clip matching than a guessed script, since
// it's what was actually said.
async function useRealVoice(opts: { audioBytes: Buffer; audioExt: string; groqApiKey: string | undefined; workDir: string }): Promise<{
  narration: NarrationResult;
  transcript: string;
}> {
  if (!opts.groqApiKey) {
    throw new Error('Real-voice narration needs GROQ_API_KEY set -- Whisper transcription (for word-timed captions) is only available via Groq.');
  }
  const ext = opts.audioExt || '.mp3';
  const audioPath = path.join(opts.workDir, `narration${ext}`);
  await fsp.writeFile(audioPath, opts.audioBytes);
  const [durationSeconds, transcription] = await Promise.all([
    probeAudioDuration(audioPath),
    transcribeAudio({ groqApiKey: opts.groqApiKey, audioBytes: opts.audioBytes, filename: `narration${ext}` }),
  ]);
  return {
    narration: { audioPath, durationSeconds, wordTimings: transcription.wordTimings },
    transcript: transcription.text,
  };
}

const execFileAsync = promisify(execFile);

// A script still gets written/used here (unlike useRealVoice() -- the
// sample is only a reference to clone FROM, not the narration itself).
// The clone service returns only audio, no word timings, so those are
// recovered the same way useRealVoice() does: transcribe the result via
// Groq Whisper.
async function useClonedVoice(opts: {
  sampleBytes: Buffer;
  script: string;
  language: 'en' | 'hi';
  hfToken: string | undefined;
  groqApiKey: string | undefined;
  workDir: string;
}): Promise<NarrationResult> {
  if (!opts.hfToken) {
    throw new Error('Voice cloning needs HF_TOKEN set -- see voice-clone-client.ts.');
  }
  if (!opts.groqApiKey) {
    throw new Error('Voice cloning needs GROQ_API_KEY set -- Whisper transcription (for word-timed captions) is only available via Groq.');
  }

  // The clone Space always decodes the reference audio it downloads AS
  // WAV, regardless of the source URL's (extension-less) path -- an MP3
  // upload (e.g. from msedge-tts's own output format) fails server-side
  // with a decode error even though the bytes are perfectly valid audio.
  // Confirmed live. Re-encoding to real WAV here, before it ever reaches
  // the Space, sidesteps that entirely.
  const rawSamplePath = path.join(opts.workDir, 'clone-sample-raw');
  const wavSamplePath = path.join(opts.workDir, 'clone-sample.wav');
  await fsp.writeFile(rawSamplePath, opts.sampleBytes);
  await execFileAsync('ffmpeg', ['-y', '-i', rawSamplePath, '-ar', '24000', '-ac', '1', wavSamplePath]);
  const wavSampleBytes = await fsp.readFile(wavSamplePath);

  const { audioBytes, extension } = await cloneVoiceAndSynthesize({
    hfToken: opts.hfToken,
    sampleBytes: wavSampleBytes,
    text: opts.script,
    language: opts.language,
  });
  const filename = `narration-cloned.${extension}`;
  const audioPath = path.join(opts.workDir, filename);
  await fsp.writeFile(audioPath, audioBytes);
  const [durationSeconds, transcription] = await Promise.all([
    probeAudioDuration(audioPath),
    transcribeAudio({ groqApiKey: opts.groqApiKey, audioBytes, filename }),
  ]);
  return { audioPath, durationSeconds, wordTimings: transcription.wordTimings };
}

const MAX_CLIPS = 40;

interface DownloadedClip {
  localPath: string;
  useSeconds: number;
}

async function gatherClips(
  terms: string[],
  opts: {
    apiKey: string;
    orientation: 'landscape' | 'portrait';
    targetWidth: number;
    targetHeight: number;
    maxClipSeconds: number;
    totalSecondsNeeded: number;
    workDir: string;
    signal?: AbortSignal;
    onEach?: (downloaded: number, target: number) => void;
  }
): Promise<DownloadedClip[]> {
  const seenVideoIds = new Set<number>();
  const clips: DownloadedClip[] = [];
  let totalSeconds = 0;
  // Estimate an upper bound purely for progress reporting -- refined as real
  // clips get added below.
  let estimatedTarget = Math.max(1, Math.ceil(opts.totalSecondsNeeded / opts.maxClipSeconds));

  termLoop: for (let round = 0; round < 3 && totalSeconds < opts.totalSecondsNeeded; round++) {
    for (const term of terms) {
      if (totalSeconds >= opts.totalSecondsNeeded || clips.length >= MAX_CLIPS) {
        break termLoop;
      }
      let results: PexelsVideo[];
      try {
        results = await searchClips(term, { apiKey: opts.apiKey, orientation: opts.orientation, perPage: 8, minDurationSeconds: 2 });
      } catch {
        continue; // one bad term shouldn't sink the whole job -- try the next
      }
      for (const video of results) {
        if (seenVideoIds.has(video.id)) {
          continue;
        }
        const file = pickVideoFile(video, opts.targetWidth, opts.targetHeight);
        if (!file) {
          continue;
        }
        seenVideoIds.add(video.id);
        const destPath = path.join(opts.workDir, `clip-${video.id}.mp4`);
        try {
          await downloadClip(file.link, destPath, opts.signal);
        } catch {
          continue;
        }
        const useSeconds = Math.min(video.duration, opts.maxClipSeconds);
        clips.push({ localPath: destPath, useSeconds });
        totalSeconds += useSeconds;
        estimatedTarget = Math.max(estimatedTarget, Math.ceil(opts.totalSecondsNeeded / opts.maxClipSeconds));
        opts.onEach?.(clips.length, estimatedTarget);
        if (totalSeconds >= opts.totalSecondsNeeded || clips.length >= MAX_CLIPS) {
          break termLoop;
        }
      }
    }
  }

  if (clips.length === 0) {
    throw new Error('No stock clips could be found or downloaded for this topic -- try a different subject or check the Pexels API key.');
  }
  return clips;
}

export async function runStockVideoPipeline(params: StockVideoJobParams, opts: StockVideoPipelineOptions): Promise<Buffer> {
  const { dir: workDir, cleanup } = await createJobWorkDir(randomUUID());
  try {
    let narration: NarrationResult;
    let searchTermsScript: string;

    if (params.narrationAudioBytes) {
      // Real voice: no script to write, no TTS to run -- the upload IS the
      // narration, transcribed for its word timings and search-term text.
      opts.onProgress?.(10, 'Transcribing your voice');
      const result = await useRealVoice({
        audioBytes: params.narrationAudioBytes,
        audioExt: params.narrationAudioExt || '.mp3',
        groqApiKey: opts.groqApiKey,
        workDir,
      });
      narration = result.narration;
      searchTermsScript = result.transcript;
    } else {
      const voice = voices.find((v) => v.id === params.voiceName);
      const language: 'hi' | 'en' = voice?.language ?? (params.voiceName.startsWith('hi-') ? 'hi' : 'en');

      opts.onProgress?.(5, 'Writing script');
      const script =
        params.script?.trim() ||
        (await generateScript({
          llmClient: opts.llmClient,
          subject: params.subject,
          paragraphs: params.scriptParagraphs,
          language,
        }));
      if (!script) {
        throw new Error('Failed to produce a narration script.');
      }
      searchTermsScript = script;

      if (params.voiceCloneSampleBytes) {
        opts.onProgress?.(35, 'Cloning your voice');
        narration = await useClonedVoice({
          sampleBytes: params.voiceCloneSampleBytes,
          script,
          language,
          hfToken: opts.hfToken,
          groqApiKey: opts.groqApiKey,
          workDir,
        });
      } else {
        opts.onProgress?.(35, 'Synthesizing narration');
        narration = await synthesizeNarration({ text: script, voiceName: params.voiceName, workDir });
      }
    }

    opts.onProgress?.(20, 'Picking search terms');
    const terms = await generateSearchTerms({ llmClient: opts.llmClient, script: searchTermsScript, subject: params.subject });

    opts.onProgress?.(50, 'Downloading stock clips');
    const { width, height } = params.aspect === '16:9' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
    const orientation: 'landscape' | 'portrait' = params.aspect === '16:9' ? 'landscape' : 'portrait';
    const clips = await gatherClips(terms, {
      apiKey: opts.pexelsApiKey,
      orientation,
      targetWidth: width,
      targetHeight: height,
      maxClipSeconds: params.clipDurationSeconds,
      totalSecondsNeeded: narration.durationSeconds,
      workDir,
      signal: opts.signal,
      onEach: (i, n) => opts.onProgress?.(50 + Math.round((Math.min(i, n) / n) * 25), 'Downloading stock clips'),
    });

    let subtitlePath: string | null = null;
    if (params.subtitlesEnabled && narration.wordTimings.length > 0) {
      opts.onProgress?.(80, 'Building subtitles');
      subtitlePath = path.join(workDir, 'subtitles.ass');
      await fsp.writeFile(subtitlePath, buildAss(narration.wordTimings), 'utf-8');
    }

    opts.onProgress?.(90, 'Assembling final video');
    const outputPath = path.join(workDir, 'output.mp4');
    await assembleVideo({
      clipPaths: clips.map((c) => c.localPath),
      clipTrimSeconds: clips.map((c) => c.useSeconds),
      audioPath: narration.audioPath,
      audioDurationSeconds: narration.durationSeconds,
      subtitlePath,
      targetWidth: width,
      targetHeight: height,
      targetFps: 30,
      outputPath,
      signal: opts.signal,
    });

    opts.onProgress?.(100, 'Done');
    return await fsp.readFile(outputPath);
  } finally {
    await cleanup();
  }
}
