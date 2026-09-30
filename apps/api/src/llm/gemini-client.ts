import type { ChatMessage, LlmClient, ToolCallResult, ToolDefinition } from './types.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiContent {
  role: 'user' | 'model';
  parts: [{ text: string }];
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

// Gemini's REST shape is different from the OpenAI-style chat APIs: no
// "system" role inside the message list -- a system prompt is a separate
// top-level `systemInstruction` field, and roles are 'user'/'model' (not
// 'assistant'). splitMessages() below does that translation so callers
// still just pass the same ChatMessage[] shape everything else uses.
function splitMessages(messages: ChatMessage[]): { systemInstruction?: { parts: [{ text: string }] }; contents: GeminiContent[] } {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const contents: GeminiContent[] = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  return systemParts.length > 0 ? { systemInstruction: { parts: [{ text: systemParts.join('\n\n') }] }, contents } : { contents };
}

export function createGeminiClient(options: { apiKey: string; model: string }): LlmClient {
  async function chat(messages: ChatMessage[]): Promise<string> {
    const url = `${GEMINI_BASE}/${options.model}:generateContent?key=${options.apiKey}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(splitMessages(messages)),
      });
    } catch (err) {
      throw new Error(`Could not reach Gemini: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      throw new Error(`Gemini request failed (${res.status}): ${await res.text().catch(() => '')}`);
    }
    const data = (await res.json()) as GeminiResponse;
    if (data.error) {
      throw new Error(`Gemini error: ${data.error.message ?? 'unknown error'}`);
    }
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  }

  async function streamChat(messages: ChatMessage[], onToken: (token: string) => void): Promise<void> {
    const url = `${GEMINI_BASE}/${options.model}:streamGenerateContent?alt=sse&key=${options.apiKey}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(splitMessages(messages)),
      });
    } catch (err) {
      throw new Error(`Could not reach Gemini: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok || !res.body) {
      throw new Error(`Gemini request failed (${res.status}): ${await res.text().catch(() => '')}`);
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
        const chunk = JSON.parse(line.slice('data: '.length)) as GeminiResponse;
        if (chunk.error) {
          throw new Error(`Gemini error: ${chunk.error.message ?? 'unknown error'}`);
        }
        const token = chunk.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
        if (token) {
          onToken(token);
        }
      }
    }
  }

  // Gemini's tool calling uses `tools: [{functionDeclarations: [...]}]`,
  // and a tool-calling response part comes back as
  // `{functionCall: {name, args}}` -- `args` is already a real object
  // (unlike Groq, which returns a JSON string that needs parsing).
  async function chatWithTools(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ToolCallResult> {
    const url = `${GEMINI_BASE}/${options.model}:generateContent?key=${options.apiKey}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...splitMessages(messages),
          tools: [{ functionDeclarations: tools }],
        }),
      });
    } catch (err) {
      throw new Error(`Could not reach Gemini: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      throw new Error(`Gemini request failed (${res.status}): ${await res.text().catch(() => '')}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> } }>;
      error?: { message?: string };
    };
    if (data.error) {
      throw new Error(`Gemini error: ${data.error.message ?? 'unknown error'}`);
    }
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const functionCall = parts.find((p) => p.functionCall)?.functionCall;
    if (functionCall) {
      return { type: 'tool_call', name: functionCall.name, arguments: functionCall.args };
    }
    return { type: 'text', content: parts.map((p) => p.text ?? '').join('') };
  }

  return { chat, streamChat, chatWithTools };
}
