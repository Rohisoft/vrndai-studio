import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EnvSettingsInput, EnvSettingsView } from '@app/shared';
import type { Env } from '../config/env.js';
import { readEnvFile, writeEnvFile } from '../config/env-file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_ENV_PATH = path.resolve(__dirname, '../../../../.env');

// Reads reflect the LIVE running config (the env this process actually
// booted with), not the file -- if someone hand-edited .env after boot
// those wouldn't match, and "what is the server actually using right now"
// is the more useful answer to show. Writes go to the file; every env
// change requires a restart to take effect (no live-reloading of the
// ComfyUI client / port binding), so the UI always shows a restart notice
// after saving here, regardless of which field changed.
export function createEnvSettingsStore(currentEnv: Env) {
  function view(): EnvSettingsView {
    return {
      comfyuiBaseUrl: currentEnv.COMFYUI_BASE_URL,
      comfyuiAuthTokenSet: Boolean(currentEnv.COMFYUI_AUTH_TOKEN),
      comfyuiMock: currentEnv.COMFYUI_MOCK,
      port: currentEnv.PORT,
      dataDir: currentEnv.DATA_DIR,
    };
  }

  function save(input: EnvSettingsInput): void {
    const existing = readEnvFile(ROOT_ENV_PATH);

    writeEnvFile(ROOT_ENV_PATH, {
      COMFYUI_BASE_URL: input.comfyuiBaseUrl,
      // Field omitted in the request -> keep whatever's currently on disk.
      // Field present (including '' from an explicit "clear") -> use it.
      COMFYUI_AUTH_TOKEN: input.comfyuiAuthToken ?? existing.COMFYUI_AUTH_TOKEN ?? '',
      COMFYUI_MOCK: String(input.comfyuiMock),
      PORT: String(input.port),
      DATA_DIR: input.dataDir,
      // Not yet exposed in the settings UI (set directly in .env) -- always
      // preserved so an unrelated save from this UI can't silently wipe
      // RunPod Serverless / MongoDB / admin / LLM configuration.
      RUNPOD_API_KEY: existing.RUNPOD_API_KEY ?? '',
      RUNPOD_ENDPOINT_IDS: existing.RUNPOD_ENDPOINT_IDS ?? '',
      LLM_PROVIDER: existing.LLM_PROVIDER ?? '',
      OLLAMA_BASE_URL: existing.OLLAMA_BASE_URL ?? '',
      OLLAMA_MODEL: existing.OLLAMA_MODEL ?? '',
      GROQ_API_KEY: existing.GROQ_API_KEY ?? '',
      GROQ_MODEL: existing.GROQ_MODEL ?? '',
      GEMINI_API_KEY: existing.GEMINI_API_KEY ?? '',
      GEMINI_MODEL: existing.GEMINI_MODEL ?? '',
      PEXELS_API_KEY: existing.PEXELS_API_KEY ?? '',
      MONGODB_URI: existing.MONGODB_URI ?? '',
      ADMIN_USERNAME: existing.ADMIN_USERNAME ?? '',
      ADMIN_PASSWORD: existing.ADMIN_PASSWORD ?? '',
    });
  }

  return { view, save };
}

export type EnvSettingsStore = ReturnType<typeof createEnvSettingsStore>;
