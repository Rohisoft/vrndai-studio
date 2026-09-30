import type { ChatMessage, LlmClient, ToolCallResult, ToolDefinition } from './types.js';

// Talks to Ollama's native /api/chat endpoint (verified live against a real
// running instance -- not guessed): POST {model, messages, stream: true}
// returns the response body as newline-delimited JSON, each line shaped
// like { message: { role, content }, done, ... }, with `message.content`
// holding that chunk's incremental token(s) and a final line carrying
// `done: true`. host.docker.internal (not localhost) is required for this
// to reach a host-installed Ollama from inside the api container --
// confirmed live during planning.
export function createOllamaClient(options: { baseUrl: string; model: string }): LlmClient {
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  async function streamChat(messages: ChatMessage[], onToken: (token: string) => void): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: options.model, messages, stream: true }),
      });
    } catch (err) {
      throw new Error(`Could not reach Ollama at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok || !res.body) {
      throw new Error(`Ollama /api/chat request failed (${res.status}): ${await res.text().catch(() => '')}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
        if (chunk.error) {
          throw new Error(`Ollama error: ${chunk.error}`);
        }
        if (chunk.message?.content) {
          onToken(chunk.message.content);
        }
        if (chunk.done) {
          return;
        }
      }
    }
  }

  // Non-streaming variant for callers that just want one final string
  // (script writing, keyword extraction) -- verified live against a real
  // Ollama instance: stream:false returns a single JSON object shaped
  // { message: { content }, done: true, ... }, not NDJSON.
  async function chat(messages: ChatMessage[]): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: options.model, messages, stream: false }),
      });
    } catch (err) {
      throw new Error(`Could not reach Ollama at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      throw new Error(`Ollama /api/chat request failed (${res.status}): ${await res.text().catch(() => '')}`);
    }

    const data = (await res.json()) as { message?: { content?: string }; error?: string };
    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }
    return data.message?.content ?? '';
  }

  // Ollama's tool calling (model-dependent -- only works with tool-capable
  // models, verify against whatever OLLAMA_MODEL is actually configured
  // rather than assuming) takes the same {type:'function', function:{...}}
  // shape Groq does, but a response's tool_calls[].function.arguments
  // comes back as an already-parsed object, not a JSON string.
  async function chatWithTools(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ToolCallResult> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          messages,
          stream: false,
          tools: tools.map((tool) => ({ type: 'function', function: tool })),
        }),
      });
    } catch (err) {
      throw new Error(`Could not reach Ollama at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      throw new Error(`Ollama /api/chat request failed (${res.status}): ${await res.text().catch(() => '')}`);
    }
    const data = (await res.json()) as {
      message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> };
      error?: string;
    };
    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }
    const toolCall = data.message?.tool_calls?.[0];
    if (toolCall) {
      return { type: 'tool_call', name: toolCall.function.name, arguments: toolCall.function.arguments };
    }
    return { type: 'text', content: data.message?.content ?? '' };
  }

  return { chat, streamChat, chatWithTools };
}
