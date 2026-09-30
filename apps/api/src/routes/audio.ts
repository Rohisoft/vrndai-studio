import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ErrorResponseSchema } from '../lib/error-response.js';
import type { AppDeps } from '../app.js';

const ALLOWED_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg']);

// Lets a user upload their own recorded narration for the Stock Footage
// engine instead of using TTS (see stock-video/pipeline.ts's real-voice
// branch and transcribe.ts). Same upload-then-reference-a-filename shape
// as routes/images.ts's existing /api/images/upload -- reuses the exact
// same cache (it's already generic byte storage, nothing image-specific
// despite the name) rather than standing up a separate one.
export function registerAudioRoutes(app: FastifyInstance, deps: AppDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/api/audio/upload',
    { schema: { response: { 200: z.object({ narrationAudio: z.string() }), 400: ErrorResponseSchema } } },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        reply.status(400).send({ error: 'ValidationError', issues: [{ path: 'file', message: 'No file uploaded.' }] });
        return;
      }
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        reply.status(400).send({
          error: 'ValidationError',
          issues: [{ path: 'file', message: `Unsupported audio type '${file.mimetype}'. Use MP3, WAV, M4A, WebM, or OGG.` }],
        });
        return;
      }

      const buffer = await file.toBuffer();
      const extension = file.mimetype.split('/')[1]?.replace('x-wav', 'wav') || 'mp3';
      const name = `voice-upload-${randomUUID().slice(0, 8)}.${extension}`;
      await deps.imageCache.saveImage(name, buffer);
      return { narrationAudio: name };
    }
  );
}
