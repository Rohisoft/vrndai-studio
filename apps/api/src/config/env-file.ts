import fs from 'node:fs';

// The full set of keys this app reads from .env (mirrors config/env.ts's
// EnvSchema). Rewriting the file always writes exactly these keys, in this
// order -- comments in a hand-edited .env won't survive a UI-triggered save,
// which is an accepted simplicity trade-off for a personal single-user tool.
const ENV_KEYS = [
  'COMFYUI_BASE_URL',
  'COMFYUI_AUTH_TOKEN',
  'COMFYUI_MOCK',
  'PORT',
  'DATA_DIR',
  'MONGODB_URI',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'RUNPOD_API_KEY',
  'RUNPOD_ENDPOINT_IDS',
  'LLM_PROVIDER',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'PEXELS_API_KEY',
  'VIDEO_STORAGE_PROVIDER',
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_FOLDER_ID',
] as const;

export function readEnvFile(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    result[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return result;
}

export function writeEnvFile(envPath: string, values: Record<string, string>): void {
  const lines = ENV_KEYS.map((key) => `${key}=${values[key] ?? ''}`);
  fs.writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf-8');
}
