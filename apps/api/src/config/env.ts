import { z } from 'zod';

// Coerces the common "true"/"false" string forms env vars actually arrive as.
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : value.toLowerCase() === 'true'))
  .default(false);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATA_DIR: z.string().default('./data'),
  COMFYUI_BASE_URL: z.string().url().default('http://127.0.0.1:8188'),
  COMFYUI_AUTH_TOKEN: z.string().optional(),
  COMFYUI_MOCK: booleanFromEnv,
  APP_PASSWORD: z.string().optional(),
  // RunPod Serverless (alternative to COMFYUI_BASE_URL's Pod-based
  // transport) -- when RUNPOD_API_KEY is set, createComfyClient() uses it
  // instead. RUNPOD_ENDPOINT_IDS is a JSON object string mapping each
  // config/models.config.ts model id to that model's own Serverless
  // endpoint id (one endpoint per model -- see the migration plan for why).
  RUNPOD_API_KEY: z.string().optional(),
  RUNPOD_ENDPOINT_IDS: z.string().optional(),
  // AI assistant + stock-video script/keyword generation -- one of three
  // interchangeable providers (see llm/index.ts's createLlmClient()).
  // 'ollama' (default) keeps local dev exactly as before: a locally-
  // installed Ollama on the host, not a cloud API -- host.docker.internal
  // (not localhost/127.0.0.1) is required for the api container to reach
  // it, confirmed live during planning. 'groq'/'gemini' are for
  // deployments (e.g. Render) where there's no host machine running Ollama
  // to reach at all -- just cloud APIs, only need their own API key set.
  LLM_PROVIDER: z.enum(['ollama', 'groq', 'gemini']).default('ollama'),
  OLLAMA_BASE_URL: z.string().url().default('http://host.docker.internal:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1:8b'),
  // Groq (OpenAI-compatible API) -- no default baked in, same reasoning as
  // PEXELS_API_KEY below: a real credential never belongs in committed
  // source. Model default confirmed current via Groq's own docs.
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  // Gemini -- same no-baked-default reasoning. Model default confirmed
  // current via Google's docs; has a genuinely usable free tier.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  // Stock Footage engine -- Pexels stock-clip search API key (confirmed
  // live against https://api.pexels.com/videos/search). No default baked in
  // here -- the real key lives only in the gitignored .env, same as
  // RUNPOD_API_KEY/COMFYUI_AUTH_TOKEN above.
  PEXELS_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

// Fail fast with a clear, field-level error message rather than letting a
// misconfigured server start and fail confusingly later.
export function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}
