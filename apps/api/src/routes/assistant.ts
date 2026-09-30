import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { JobRecordSchema, type GenerationRequest } from '@app/shared';
import type { ChatMessage } from '../llm/types.js';
import { generateContentIdeas } from '../assistant/idea-generator.js';
import { CREATE_VIDEO_TOOL, mapToolArgsToGenerationRequest } from '../assistant/create-video-tool.js';
import { createGenerationJob } from '../generation/create-job.js';
import { ErrorResponseSchema } from '../lib/error-response.js';
import type { AppDeps } from '../app.js';

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const ContentIdeaSchema = z.object({
  title: z.string(),
  hook: z.string(),
  prompt: z.string(),
});

const AgentChatResponseSchema = z.union([
  z.object({ type: z.literal('text'), content: z.string() }),
  z.object({ type: z.literal('proposed_action'), arguments: z.record(z.unknown()), summary: z.string() }),
]);

// Built from the MAPPED GenerationRequest, not the LLM's raw arguments --
// the raw ask might not match what actually gets created (e.g. a
// durationSeconds outside what the engine actually allows gets snapped to
// the nearest valid value in mapToolArgsToGenerationRequest()), and the
// confirmation card must never promise something different from what
// Confirm actually submits.
function summarizeProposedAction(request: GenerationRequest): string {
  const engine = request.modelId === 'pexels-stock-video' ? 'a narrated stock-footage video' : 'an AI-generated video';
  const duration = request.modelId === 'pexels-stock-video' ? '' : ` (${request.durationSeconds}s)`;
  const orientation = request.aspectRatio === '16:9' ? ', landscape' : '';
  return `I'll create ${engine}${duration}${orientation} about: "${request.prompt}"`;
}

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

  // Structured, non-streaming -- a single JSON result, not a token stream,
  // so this reuses the same llmClient.chat() + JSON-parse pattern as
  // stock-video/search-terms.ts rather than the SSE hijack above.
  server.post(
    '/api/assistant/ideas',
    {
      schema: {
        body: z.object({ niche: z.string().min(1), count: z.number().int().positive().max(10).optional() }),
        response: { 200: z.array(ContentIdeaSchema) },
      },
    },
    async (request) => generateContentIdeas({ llmClient: deps.llmClient, niche: request.body.niche, count: request.body.count })
  );

  // Agentic mode: the model either replies conversationally (e.g. asking a
  // clarifying question) or decides it has enough info to propose creating
  // a video. Deliberately NOT SSE -- tool-call responses don't arrive
  // incrementally the way plain text does, and the three providers'
  // tool-call formats differ enough (see llm/*-client.ts) that streaming
  // partial tool-call JSON isn't worth the complexity here. Never creates
  // a job itself -- that only happens if the frontend calls agent-confirm
  // with the proposed arguments, i.e. after the user explicitly approves.
  server.post(
    '/api/assistant/agent-chat',
    { schema: { body: z.object({ messages: z.array(ChatMessageSchema).min(1) }), response: { 200: AgentChatResponseSchema } } },
    async (request, reply) => {
      const result = await deps.llmClient.chatWithTools(request.body.messages as ChatMessage[], [CREATE_VIDEO_TOOL]);
      if (result.type === 'text') {
        return { type: 'text' as const, content: result.content };
      }
      const generationRequest = result.name === CREATE_VIDEO_TOOL.name ? mapToolArgsToGenerationRequest(result.arguments) : null;
      if (!generationRequest) {
        reply.status(200);
        return { type: 'text' as const, content: "Sorry, I wasn't able to work out enough detail to create that -- could you describe it differently?" };
      }
      return { type: 'proposed_action' as const, arguments: result.arguments, summary: summarizeProposedAction(generationRequest) };
    }
  );

  server.post(
    '/api/assistant/agent-confirm',
    {
      schema: {
        body: z.object({ arguments: z.record(z.unknown()) }),
        response: { 200: JobRecordSchema, 400: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const generationRequest = mapToolArgsToGenerationRequest(request.body.arguments);
      if (!generationRequest) {
        reply.status(400).send({ error: 'ValidationError', issues: [{ path: 'arguments', message: 'Could not map these arguments to a valid generation request.' }] });
        return;
      }
      const result = await createGenerationJob(deps, generationRequest);
      if (!result.ok) {
        reply.status(400).send({ error: 'ValidationError', issues: result.issues });
        return;
      }
      return result.job;
    }
  );
}
