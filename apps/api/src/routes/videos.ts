import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';

// HTTP Range support is required for <video> scrubbing/seeking to work at
// all -- without it the browser can only play from the start. Works
// identically for both storage backends (local disk, Google Drive) since
// VideoStorage.streamVideo() takes the same already-resolved {start, end}
// either way.
export function registerVideoRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { filename: string } }>('/api/videos/:filename', async (request, reply) => {
    const { filename } = request.params;

    const meta = await deps.videoStorage.getVideoMeta(filename);
    if (!meta) {
      return reply.status(404).send({ error: 'NotFound', message: `Video '${filename}' not found.` });
    }

    const range = request.headers.range;

    if (!range) {
      reply.header('Content-Type', 'video/mp4');
      reply.header('Content-Length', meta.sizeBytes);
      reply.header('Accept-Ranges', 'bytes');
      // Fastify docs: in an async handler you must RETURN reply.send(...) --
      // calling .send() and then a separate bare `return;` resolves the
      // handler's promise before the stream finishes, which silently
      // truncates the response to zero bytes. Caught this by testing the
      // actual downloaded file size, not just the HTTP status code.
      return reply.send(await deps.videoStorage.streamVideo(filename));
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return reply.status(416).header('Content-Range', `bytes */${meta.sizeBytes}`).send();
    }

    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : meta.sizeBytes - 1;

    if (start >= meta.sizeBytes || end >= meta.sizeBytes || start > end) {
      return reply.status(416).header('Content-Range', `bytes */${meta.sizeBytes}`).send();
    }

    reply.status(206);
    reply.header('Content-Type', 'video/mp4');
    reply.header('Content-Range', `bytes ${start}-${end}/${meta.sizeBytes}`);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', end - start + 1);
    return reply.send(await deps.videoStorage.streamVideo(filename, { start, end }));
  });
}
