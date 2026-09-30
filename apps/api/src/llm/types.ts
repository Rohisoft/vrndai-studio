export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

export type ToolCallResult =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; arguments: Record<string, unknown> };

// One interface, three interchangeable backends (Ollama/Groq/Gemini) -- lets
// the Assistant route and the Stock Footage script/keyword generators stay
// completely unaware of which provider is actually configured (see
// llm/index.ts's createLlmClient() factory, selected by env.LLM_PROVIDER).
export interface LlmClient {
  chat(messages: ChatMessage[]): Promise<string>;
  /** Returns an unsubscribe-free promise that resolves once the stream ends -- onToken fires for each incremental chunk. */
  streamChat(messages: ChatMessage[], onToken: (token: string) => void): Promise<void>;
  /**
   * Gives the model a set of callable tools and lets it decide to either
   * reply with plain text or call one of them -- used by the agentic
   * Assistant (apps/api/src/assistant/create-video-tool.ts) to let a
   * conversation actually propose creating a video, never to execute
   * anything automatically (the caller always confirms before acting on a
   * 'tool_call' result).
   */
  chatWithTools(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ToolCallResult>;
}
