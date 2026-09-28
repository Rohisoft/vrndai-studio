import type { FastifyInstance } from 'fastify';
import { toJobRecord } from '../store/job-store.js';
import type { AppDeps } from '../app.js';

const HEARTBEAT_INTERVAL_MS = 15000;

export function registerJobsStreamRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { id: string } }>('/api/jobs/:id/events', async (request, reply) => {
    const jobId = request.params.id;
    const initial = await deps.jobStore.getById(jobId);
    if (!initial) {
      reply.status(404).send({ error: 'NotFound', message: `Job '${jobId}' not found.` });
      return;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    function write(type: string, job: ReturnType<typeof toJobRecord>): void {
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify({ type, job })}\n\n`);
    }

    // Send current state immediately -- handles late subscribers and
    // reconnects without the client needing a separate GET first.
    write('status', toJobRecord(initial));

    const unsubscribe = deps.eventBus.subscribe(jobId, (type, job) => {
      write(type, job);
      if (type === 'done' || type === 'error') {
        cleanup();
      }
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    function cleanup(): void {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    }

    request.raw.on('close', cleanup);
  });
}
