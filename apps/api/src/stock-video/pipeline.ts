import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { voices } from '../../../../config/voices.config.js';
import { generateScript } from './script-writer.js';
import { generateSearchTerms } from './search-terms.js';
import { downloadClip, pickVideoFile, searchClips, type PexelsVideo } from './pexels-client.js';
import { synthesizeNarration } from './tts.js';
import { buildAss } from './subtitles.js';
import { assembleVideo } from './assemble.js';
import { createJobWorkDir } from './workdir.js';
import type { StockVideoJobParams } from './types.js';
import type { LlmClient } from '../llm/types.js';

export interface StockVideoPipelineOptions {
  pexelsApiKey: string;
  llmClient: LlmClient;
  onProgress?: (value: number, label: string) => void;
  signal?: AbortSignal;
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

    opts.onProgress?.(20, 'Picking search terms');
    const terms = await generateSearchTerms({ llmClient: opts.llmClient, script, subject: params.subject });

    opts.onProgress?.(35, 'Synthesizing narration');
    const narration = await synthesizeNarration({ text: script, voiceName: params.voiceName, workDir });

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
