import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ErrorResponseSchema } from '../lib/error-response.js';
import type { AppDeps } from '../app.js';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Lets the user attach a starting image directly on the Create form when
// they manually pick an image-to-video model, rather than only being able
// to get a sourceImage via "Continue clip" (which extracts one from an
// existing video). Returns the same { sourceImage } shape the /continue
// route already returns, so the frontend's existing sourceImage submission
// path (GenerationRequestSchema.sourceImage) needs no changes to consume
// either source.
export function registerImagesRoutes(app: FastifyInstance, deps: AppDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/api/images/upload',
    { schema: { response: { 200: z.object({ sourceImage: z.string() }), 400: ErrorResponseSchema } } },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        reply.status(400).send({ error: 'ValidationError', issues: [{ path: 'file', message: 'No file uploaded.' }] });
        return;
      }
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        reply.status(400).send({
          error: 'ValidationError',
          issues: [{ path: 'file', message: `Unsupported image type '${file.mimetype}'. Use JPEG, PNG, or WebP.` }],
        });
        return;
      }

      const buffer = await file.toBuffer();
      const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
      const name = `upload-${randomUUID().slice(0, 8)}.${extension}`;
      await deps.imageCache.saveImage(name, buffer);
      return { sourceImage: name };
    }
  );
}
