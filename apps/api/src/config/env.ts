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
  // Job storage -- MongoDB Atlas, required (no localhost default; this app
  // no longer runs a local database at all). Plain non-empty string rather
  // than .url() -- Atlas's mongodb+srv:// connection strings are fine
  // either way, but this avoids any edge case with the WHATWG URL parser
  // and unusual connection-string formats; a malformed value still fails
  // fast, just via the driver's own connection error instead.
  MONGODB_URI: z.string().min(1),
  // Super-admin account -- only used to seed the one admin user in MongoDB
  // on first boot (see auth/users.ts's seedSuperAdminIfNeeded()). Ignored
  // on every later boot once that user exists, so leaving these set in
  // .env permanently doesn't reset the account. Optional in the schema
  // itself since they're only truly required the very first time -- the
  // seeding function enforces that, not this parse step.
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
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
  // Voice cloning for Stock Footage narration -- calls the tonyassi/
  // voice-clone Hugging Face Space via @gradio/client (see stock-video/
  // voice-clone-client.ts). A free community Space, not a stable paid API
  // -- deliberately kept swappable for a real provider (e.g. ElevenLabs)
  // once/if this proves worth relying on long-term.
  HF_TOKEN: z.string().optional(),
  // Where generated videos are stored -- 'local' writes to DATA_DIR/videos
  // (fine for local dev / a host with a persistent disk), 'google-drive'
  // uploads to a Google account's Drive instead, so videos survive on a
  // host with no persistent disk at all (e.g. Render's free tier). See
  // storage/google-drive-client.ts for the OAuth flow these four values
  // come from -- all four are required together when this is 'google-drive'
  // (enforced where the storage backend is constructed, not by this schema,
  // same pattern as ADMIN_USERNAME/ADMIN_PASSWORD's conditional need).
  VIDEO_STORAGE_PROVIDER: z.enum(['local', 'google-drive']).default('local'),
  GOOGLE_DRIVE_CLIENT_ID: z.string().optional(),
  GOOGLE_DRIVE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_DRIVE_REFRESH_TOKEN: z.string().optional(),
  // Optional -- uploads go to this Drive folder's id when set, or the
  // account's root "My Drive" otherwise.
  GOOGLE_DRIVE_FOLDER_ID: z.string().optional(),
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
