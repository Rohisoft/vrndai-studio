import { useCallback, useState } from 'react';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT: ChatMessage = {
  role: 'system',
  content:
    "You are a helpful assistant embedded in a self-hosted AI video generation app. You answer general questions about using the app, and you're especially good at helping write vivid, detailed prompts for AI video generation -- when asked to write a video script or prompt, write it as a single detailed paragraph description (not screenplay format), since that's what the underlying video model expects.",
};

// POST, not GET -- EventSource only supports GET, so the SSE stream
// (routes/assistant.ts's `event: type\ndata: {...}\n\n` frames, same
// format used by jobs-stream.ts) is parsed manually here off a fetch
// ReadableStream instead.
export function useAssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      setError(null);
      const history: ChatMessage[] = [...messages, { role: 'user', content }];
      setMessages([...history, { role: 'assistant', content: '' }]);
      setSending(true);

      try {
        const res = await fetch('/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [SYSTEM_PROMPT, ...history] }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`Request failed (${res.status})`);
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

          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            const lines = rawEvent.split('\n');
            const eventLine = lines.find((line) => line.startsWith('event: '));
            const dataLine = lines.find((line) => line.startsWith('data: '));
            if (!eventLine || !dataLine) {
              continue;
            }

            const type = eventLine.slice('event: '.length);
            const data = JSON.parse(dataLine.slice('data: '.length)) as { token?: string; message?: string };

            if (type === 'token' && data.token) {
              const token = data.token;
              setMessages((current) => {
                const next = [...current];
                const last = next[next.length - 1];
                next[next.length - 1] = { ...last, content: last.content + token };
                return next;
              });
            } else if (type === 'error') {
              setError(data.message || 'Assistant unavailable.');
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reach the assistant.');
      } finally {
        setSending(false);
      }
    },
    [messages]
  );

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, sending, error, sendMessage, reset };
}
