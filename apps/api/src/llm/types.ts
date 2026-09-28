export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// One interface, three interchangeable backends (Ollama/Groq/Gemini) -- lets
// the Assistant route and the Stock Footage script/keyword generators stay
// completely unaware of which provider is actually configured (see
// llm/index.ts's createLlmClient() factory, selected by env.LLM_PROVIDER).
export interface LlmClient {
  chat(messages: ChatMessage[]): Promise<string>;
  /** Returns an unsubscribe-free promise that resolves once the stream ends -- onToken fires for each incremental chunk. */
  streamChat(messages: ChatMessage[], onToken: (token: string) => void): Promise<void>;
}
