import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';

// HTTP Range support is required for <video> scrubbing/seeking to work at
// all -- without it the browser can only play from the start. Fastify's
// built-in static-file helpers don't cover this path (videos live under a
// runtime data dir, not a static assets dir), so this is hand-rolled.
export function registerVideoRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { filename: string } }>('/api/videos/:filename', async (request, reply) => {
    const { filename } = request.params;

    if (!deps.videoStorage.videoExists(filename)) {
      return reply.status(404).send({ error: 'NotFound', message: `Video '${filename}' not found.` });
    }

    const filePath = deps.videoStorage.getVideoPath(filename);
    const stat = fs.statSync(filePath);
    const range = request.headers.range;

    if (!range) {
      reply.header('Content-Type', 'video/mp4');
      reply.header('Content-Length', stat.size);
      reply.header('Accept-Ranges', 'bytes');
      // Fastify docs: in an async handler you must RETURN reply.send(...) --
      // calling .send() and then a separate bare `return;` resolves the
      // handler's promise before the stream finishes, which silently
      // truncates the response to zero bytes. Caught this by testing the
      // actual downloaded file size, not just the HTTP status code.
      return reply.send(fs.createReadStream(filePath));
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return reply.status(416).header('Content-Range', `bytes */${stat.size}`).send();
    }

    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;

    if (start >= stat.size || end >= stat.size || start > end) {
      return reply.status(416).header('Content-Range', `bytes */${stat.size}`).send();
    }

    reply.status(206);
    reply.header('Content-Type', 'video/mp4');
    reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', end - start + 1);
    return reply.send(fs.createReadStream(filePath, { start, end }));
  });
}
