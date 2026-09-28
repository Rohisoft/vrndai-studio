import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ChatMessage } from '../llm/types.js';
import type { AppDeps } from '../app.js';

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

// Streams a chat response from whichever LLM provider is configured
// (Ollama/Groq/Gemini -- see llm/index.ts), token by token, via SSE -- same
// hijack-the-reply pattern already proven in routes/jobs-stream.ts, just
// emitting token/done/error events instead of job status ones.
export function registerAssistantRoutes(app: FastifyInstance, deps: AppDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/api/assistant/chat',
    { schema: { body: z.object({ messages: z.array(ChatMessageSchema).min(1) }) } },
    async (request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      function write(type: string, data: Record<string, unknown>): void {
        reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      }

      try {
        await deps.llmClient.streamChat(request.body.messages as ChatMessage[], (token) => write('token', { token }));
        write('done', {});
      } catch (err) {
        write('error', { message: err instanceof Error ? err.message : 'Assistant unavailable.' });
      } finally {
        reply.raw.end();
      }
    }
  );
}
