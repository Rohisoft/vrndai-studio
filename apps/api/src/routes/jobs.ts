import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { JobRecordSchema } from '@app/shared';
import { z } from 'zod';
import { getModelConfig } from '../../../../config/models.config.js';
import { ErrorResponseSchema } from '../lib/error-response.js';
import { toJobRecord } from '../store/job-store.js';
import { extractFrame } from '../video/frame-extract.js';
import { combineVideos } from '../video/combine.js';
import type { AppDeps } from '../app.js';

export function registerJobsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get('/api/jobs', { schema: { response: { 200: z.array(JobRecordSchema) } } }, async () =>
    (await deps.jobStore.list()).map(toJobRecord)
  );

  server.get(
    '/api/jobs/:id',
    { schema: { params: z.object({ id: z.string() }), response: { 200: JobRecordSchema, 404: ErrorResponseSchema } } },
    async (request, reply) => {
      const row = await deps.jobStore.getById(request.params.id);
      if (!row) {
        reply.status(404).send({ error: 'NotFound', message: `Job '${request.params.id}' not found.` });
        return;
      }
      return toJobRecord(row);
    }
  );

  server.delete(
    '/api/jobs/:id',
    { schema: { params: z.object({ id: z.string() }), response: { 204: z.null() } } },
    async (request, reply) => {
      const row = await deps.jobStore.getById(request.params.id);
      if (row?.videoPath) {
        // deleteVideo internally takes just the basename regardless -- see
        // local-video-storage.ts's path-traversal guard in getVideoPath.
        await deps.videoStorage.deleteVideo(row.videoPath).catch(() => {});
      }
      await deps.jobStore.delete(request.params.id);
      reply.status(204).send();
    }
  );

  server.post(
    '/api/jobs/:id/cancel',
    { schema: { params: z.object({ id: z.string() }), response: { 200: JobRecordSchema, 404: ErrorResponseSchema } } },
    async (request, reply) => {
      const before = await deps.jobStore.getById(request.params.id);
      if (!before) {
        reply.status(404).send({ error: 'NotFound', message: `Job '${request.params.id}' not found.` });
        return;
      }
      await deps.queue.cancel(request.params.id);
      return toJobRecord((await deps.jobStore.getById(request.params.id))!);
    }
  );

  server.post(
    '/api/jobs/:id/rerun',
    { schema: { params: z.object({ id: z.string() }), response: { 200: JobRecordSchema, 404: ErrorResponseSchema } } },
    async (request, reply) => {
      const source = await deps.jobStore.getById(request.params.id);
      if (!source) {
        reply.status(404).send({ error: 'NotFound', message: `Job '${request.params.id}' not found.` });
        return;
      }
      const row = await deps.jobStore.create({
        id: randomUUID(),
        modelId: source.modelId,
        params: source.params,
        sourceJobId: source.id,
      });
      deps.queue.notify();
      return toJobRecord(row);
    }
  );

  // Prepares a continuation off a frame of an existing clip -- extracts the
  // frame locally (ffmpeg) and caches it, then hands back a reference the
  // frontend can submit as sourceImage. Does NOT create or queue a job: the
  // frontend takes this back to the Create page with the right model
  // pre-selected and the prompt left empty, so the user writes what
  // happens NEXT rather than silently reusing the source clip's old
  // prompt. The actual generation goes through the normal POST
  // /api/generate once the user submits, with sourceImage included in the
  // request body (GenerationRequestSchema already supports it). An
  // optional modelId in the body lets the NEXT clip use a different model
  // than the source (e.g. continuing a 5B clip into a 14B one) -- needed
  // since some image-to-video-only models (14B) can never produce a first
  // clip on their own to continue FROM, only be continued INTO. An optional
  // frameTimeSeconds lets the user pause the video wherever the composition
  // is right (e.g. where multiple characters are still in frame, unlike
  // whatever the literal last frame happens to show) and continue from that
  // exact moment instead -- omitted, it falls back to the last frame.
  const ContinueResponseSchema = z.object({
    sourceImage: z.string(),
    modelId: z.string(),
    sourceJobId: z.string(),
  });

  server.post(
    '/api/jobs/:id/continue',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ modelId: z.string().optional(), frameTimeSeconds: z.number().nonnegative().optional() }).optional(),
        response: { 200: ContinueResponseSchema, 400: ErrorResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const source = await deps.jobStore.getById(request.params.id);
      if (!source) {
        reply.status(404).send({ error: 'NotFound', message: `Job '${request.params.id}' not found.` });
        return;
      }
      if (source.status !== 'done' || !source.videoPath) {
        reply.status(400).send({ error: 'ValidationError', issues: [{ path: 'id', message: 'Source job has no finished video to continue from.' }] });
        return;
      }
      const targetModelId = request.body?.modelId ?? source.modelId;
      const modelConfig = getModelConfig(targetModelId);
      if (!modelConfig?.supportsImageToVideo) {
        reply.status(400).send({ error: 'ValidationError', issues: [{ path: 'modelId', message: `Model '${targetModelId}' does not support continuing from a clip.` }] });
        return;
      }

      const frame = await extractFrame(source.videoPath, request.body?.frameTimeSeconds);
      try {
        // Cached locally rather than uploaded to ComfyUI right away -- which
        // ComfyClient ends up doing the actual upload (and when) depends on
        // the deployment (Pod vs Serverless), decided later in
        // queue/worker.ts when the user actually submits a new prompt.
        const name = `continue-${source.id}-${randomUUID().slice(0, 8)}.jpg`;
        await deps.imageCache.saveImage(name, await fs.readFile(frame.path));
        return { sourceImage: name, modelId: targetModelId, sourceJobId: source.id };
      } finally {
        await frame.cleanup();
      }
    }
  );

  // Concatenates multiple finished clips (in the given order) into one new
  // video, synchronously -- ffmpeg concat is fast (seconds) compared to an
  // actual generation, so this doesn't need the queue/worker pipeline. The
  // result is stored as an ordinary done job so it shows up in
  // Gallery/History with no new display code needed.
  server.post(
    '/api/jobs/combine',
    {
      schema: {
        body: z.object({ jobIds: z.array(z.string()).min(2) }),
        response: { 200: JobRecordSchema, 400: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const sources = await Promise.all(request.body.jobIds.map((id) => deps.jobStore.getById(id)));
      const missingIndex = sources.findIndex((row) => !row || row.status !== 'done' || !row.videoPath);
      if (missingIndex !== -1) {
        reply.status(400).send({
          error: 'ValidationError',
          issues: [{ path: 'jobIds', message: `Job '${request.body.jobIds[missingIndex]}' isn't a finished clip with a video.` }],
        });
        return;
      }
      const resolved = sources as NonNullable<(typeof sources)[number]>[];

      const outputFilename = `${randomUUID()}-combined.mp4`;
      const outputPath = deps.videoStorage.getVideoPath(outputFilename);
      await combineVideos(
        resolved.map((row) => row.videoPath!),
        outputPath
      );

      const first = resolved[0];
      const row = await deps.jobStore.create({
        id: randomUUID(),
        modelId: 'combined',
        params: {
          ...first.params,
          modelId: 'combined',
          prompt: `Combined ${resolved.length} clips`,
          sourceImage: undefined,
        },
        combinedFromJobIds: resolved.map((r) => r.id),
      });
      await deps.jobStore.markDone(row.id, outputPath, null);
      return toJobRecord((await deps.jobStore.getById(row.id))!);
    }
  );
}
