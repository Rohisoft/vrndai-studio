import type { ChatMessage, LlmClient } from './types.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Groq's API is OpenAI-compatible: POST {model, messages, stream} with
// Authorization: Bearer <key>. Non-streaming returns
// {choices:[{message:{content}}]}; streaming returns SSE lines
// `data: {"choices":[{"delta":{"content":"..."}}]}` ending in `data: [DONE]`.
export function createGroqClient(options: { apiKey: string; model: string }): LlmClient {
  const headers = { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' };

  async function chat(messages: ChatMessage[]): Promise<string> {
    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: options.model, messages, stream: false }),
      });
    } catch (err) {
      throw new Error(`Could not reach Groq: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      throw new Error(`Groq request failed (${res.status}): ${await res.text().catch(() => '')}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (data.error) {
      throw new Error(`Groq error: ${data.error.message ?? 'unknown error'}`);
    }
    return data.choices?.[0]?.message?.content ?? '';
  }

  async function streamChat(messages: ChatMessage[], onToken: (token: string) => void): Promise<void> {
    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: options.model, messages, stream: true }),
      });
    } catch (err) {
      throw new Error(`Could not reach Groq: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok || !res.body) {
      throw new Error(`Groq request failed (${res.status}): ${await res.text().catch(() => '')}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith('data: ')) {
          continue;
        }
        const payload = line.slice('data: '.length);
        if (payload === '[DONE]') {
          return;
        }
        const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        const token = chunk.choices?.[0]?.delta?.content;
        if (token) {
          onToken(token);
        }
      }
    }
  }

  return { chat, streamChat };
}
