import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import type { GenerationRequest } from '@app/shared';
import type { ComfyClient, ComfyImageInput } from '../comfy/types.js';
import type { StockVideoJobParams } from '../stock-video/types.js';
import { getModelConfig } from '../../../../config/models.config.js';
import type { AppSettingsStore } from '../settings/app-settings-store.js';
import type { JobEventBus } from '../sse/job-events.js';
import { toJobRecord, type JobRow, type JobStore } from '../store/job-store.js';
import type { VideoStorage } from '../storage/video-storage.js';
import type { ImageCache } from '../storage/local-image-cache.js';
import { computeFrameCount } from '../workflow/frames.js';
import { renderWorkflow } from '../workflow/template.js';

export interface WorkerDeps {
  jobStore: JobStore;
  comfyClient: ComfyClient;
  stockVideoClient: ComfyClient;
  videoStorage: VideoStorage;
  imageCache: ImageCache;
  eventBus: JobEventBus;
  appSettingsStore: AppSettingsStore;
  workflowsDir: string;
}

// The Stock Footage engine's "graph" isn't a ComfyUI node graph at all --
// just its job params, shaped for StockVideoClient.submitWorkflow() to read
// back out (see stock-video/stock-video-client.ts's comment on why it still
// goes through the same ComfyClient-shaped call).
//
// Async because narrationAudio (a real-voice upload) needs its bytes
// resolved from the cache here -- same "resolve a reference filename to
// bytes at the point of use" pattern this file already uses for
// jobRow.params.sourceImage below, just for the stock-video branch instead
// of the ComfyUI one.
async function buildStockVideoParams(params: GenerationRequest, imageCache: ImageCache): Promise<StockVideoJobParams> {
  return {
    subject: params.prompt,
    script: params.script,
    voiceName: params.voiceId ?? 'en-US-JennyNeural-Female',
    narrationAudioBytes: params.narrationAudio ? await imageCache.readImage(params.narrationAudio) : undefined,
    narrationAudioExt: params.narrationAudio ? path.extname(params.narrationAudio) : undefined,
    aspect: params.aspectRatio === '16:9' ? '16:9' : '9:16',
    clipDurationSeconds: params.stockClipDurationSeconds ?? 4,
    subtitlesEnabled: params.subtitlesEnabled ?? true,
    scriptParagraphs: params.scriptParagraphs ?? 3,
  };
}

const workflowCache = new Map<string, unknown>();

function loadWorkflow(workflowsDir: string, filename: string): unknown {
  const cached = workflowCache.get(filename);
  if (cached) {
    return cached;
  }
  const raw = JSON.parse(fs.readFileSync(path.join(workflowsDir, filename), 'utf-8'));
  workflowCache.set(filename, raw);
  return raw;
}

async function publish(deps: WorkerDeps, jobId: string, type: 'status' | 'progress' | 'done' | 'error'): Promise<void> {
  const row = await deps.jobStore.getById(jobId);
  if (row) {
    deps.eventBus.publish(jobId, type, toJobRecord(row));
  }
}

export async function processJob(jobRow: JobRow, deps: WorkerDeps): Promise<void> {
  const modelConfig = getModelConfig(jobRow.modelId);
  if (!modelConfig) {
    await deps.jobStore.markFailed(jobRow.id, `Unknown model '${jobRow.modelId}'.`);
    await publish(deps, jobRow.id, 'error');
    return;
  }

  const started = await deps.jobStore.markRunning(jobRow.id);
  if (!started) {
    // Cancelled (or otherwise moved off 'queued') between being picked up
    // and this call -- nothing to run.
    return;
  }
  await publish(deps, jobRow.id, 'status');

  const settings = deps.appSettingsStore.load();
  let unsubscribeProgress: (() => void) | null = null;

  // Both engines' clients implement the exact same ComfyClient shape (see
  // stock-video/stock-video-client.ts's comment), so only how the "graph"
  // gets built below differs -- everything from submit onward is shared.
  const client: ComfyClient = modelConfig.engine === 'stock-video' ? deps.stockVideoClient : deps.comfyClient;

  try {
    let graph: Record<string, unknown>;
    let images: ComfyImageInput[] | undefined;

    if (modelConfig.engine === 'stock-video') {
      graph = (await buildStockVideoParams(jobRow.params, deps.imageCache)) as unknown as Record<string, unknown>;
    } else {
      const workflowFile =
        jobRow.params.sourceImage && modelConfig.workflowFileImageToVideo
          ? modelConfig.workflowFileImageToVideo
          : modelConfig.workflowFile!;
      const workflowRaw = loadWorkflow(deps.workflowsDir, workflowFile);
      const frames = computeFrameCount(
        jobRow.params.durationSeconds,
        jobRow.params.fps,
        modelConfig.requiresFourNPlusOneFrames
      );
      const seed = jobRow.params.seed ?? (settings.defaults.seedMode === 'fixed' ? settings.defaults.fixedSeed : randomInt(0, 2 ** 31));

      graph = renderWorkflow(workflowRaw, {
        prompt: jobRow.params.prompt,
        negative_prompt: jobRow.params.negativePrompt ?? settings.defaults.negativePrompt,
        width: jobRow.params.width,
        height: jobRow.params.height,
        frames,
        // Only Wan's workflow uses the pre-computed `frames` value above --
        // LTX's own graph computes frame count itself from duration + fps, so
        // this is provided as a raw value too. Unused placeholders are fine;
        // renderWorkflow only requires that placeholders actually present in
        // a given workflow file have a matching value.
        duration_seconds: jobRow.params.durationSeconds,
        fps: jobRow.params.fps,
        steps: settings.defaults.steps,
        seed,
        // Only present in the image-to-video workflow variant (see
        // workflowFile selection above); harmless unused key otherwise.
        source_image: jobRow.params.sourceImage ?? '',
      });

      images = jobRow.params.sourceImage
        ? [{ name: jobRow.params.sourceImage, buffer: await deps.imageCache.readImage(jobRow.params.sourceImage) }]
        : undefined;
    }

    const { promptId } = await client.submitWorkflow(graph, { images, modelId: jobRow.modelId });
    await deps.jobStore.setComfyPromptId(jobRow.id, promptId);

    unsubscribeProgress = client.onProgress(promptId, (progress) => {
      const percent = progress.max > 0 ? Math.round((progress.value / progress.max) * 100) : 0;
      // Best-effort, fire-and-forget -- onProgress's callback type is
      // synchronous (`() => void`), and a dropped progress update should
      // never take down the job, so failures here are swallowed rather
      // than propagated.
      void (async () => {
        await deps.jobStore.updateProgress(jobRow.id, percent);
        await publish(deps, jobRow.id, 'progress');
      })().catch(() => {});
    });

    const result = await client.waitForCompletion(promptId, { timeoutMs: settings.jobTimeoutMs });
    unsubscribeProgress();
    unsubscribeProgress = null;

    // The job may have been cancelled by a separate request while we were
    // awaiting completion -- don't clobber that terminal state.
    const current = await deps.jobStore.getById(jobRow.id);
    if (!current || current.status !== 'running') {
      return;
    }

    if (result.status !== 'success' || result.outputs.length === 0) {
      throw new Error(result.error || 'Video generation did not produce an output.');
    }

    const bytes = await client.fetchOutputBytes(result.outputs[0]);
    const videoPath = await deps.videoStorage.saveVideo(jobRow.id, bytes);
    await deps.jobStore.markDone(jobRow.id, videoPath, null);
    await publish(deps, jobRow.id, 'done');
  } catch (err) {
    unsubscribeProgress?.();
    const current = await deps.jobStore.getById(jobRow.id);
    if (!current || current.status !== 'running') {
      return; // already cancelled elsewhere
    }

    const message = err instanceof Error ? err.message : String(err);
    const retryCount = await deps.jobStore.incrementRetryCount(jobRow.id);

    if (retryCount <= settings.maxRetries) {
      await deps.jobStore.requeue(jobRow.id);
      await publish(deps, jobRow.id, 'status');
    } else {
      await deps.jobStore.markFailed(jobRow.id, message);
      await publish(deps, jobRow.id, 'error');
    }
  }
}
