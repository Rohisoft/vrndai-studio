import type { Env } from '../config/env.js';
import { createOllamaClient } from './ollama-client.js';
import { createGroqClient } from './groq-client.js';
import { createGeminiClient } from './gemini-client.js';
import type { LlmClient } from './types.js';

// A client whose every method rejects with the same clear message --
// returned instead of throwing directly out of createLlmClient() below, so
// a misconfigured LLM provider fails per-request (Assistant chat errors,
// stock-video jobs fail cleanly with a retry/fail cycle) rather than
// crashing the whole server at boot. Matches how a missing PEXELS_API_KEY
// or unconfigured RunPod endpoint already behave elsewhere in this app.
function createMisconfiguredClient(message: string): LlmClient {
  return {
    chat: () => Promise.reject(new Error(message)),
    streamChat: () => Promise.reject(new Error(message)),
    chatWithTools: () => Promise.reject(new Error(message)),
  };
}

// One switch, three interchangeable backends -- 'ollama' (the default)
// keeps local dev unchanged; 'groq'/'gemini' are for deployments with no
// reachable local Ollama instance (e.g. Render), selected purely via
// LLM_PROVIDER + that provider's own API key, no code changes needed.
export function createLlmClient(env: Env): LlmClient {
  switch (env.LLM_PROVIDER) {
    case 'groq':
      if (!env.GROQ_API_KEY) {
        return createMisconfiguredClient('LLM_PROVIDER=groq but GROQ_API_KEY is not set.');
      }
      return createGroqClient({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL });
    case 'gemini':
      if (!env.GEMINI_API_KEY) {
        return createMisconfiguredClient('LLM_PROVIDER=gemini but GEMINI_API_KEY is not set.');
      }
      return createGeminiClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
    case 'ollama':
    default:
      return createOllamaClient({ baseUrl: env.OLLAMA_BASE_URL, model: env.OLLAMA_MODEL });
  }
}

export type { ChatMessage, LlmClient } from './types.js';
