import { z } from 'zod';

export const ResolutionPresetSchema = z.object({
  label: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.string(),
});
export type ResolutionPreset = z.infer<typeof ResolutionPresetSchema>;

export const ModelOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  supportsImageToVideo: z.boolean(),
  // 'comfy' (the default AI text/image-to-video pipeline) vs 'stock-video'
  // (stock Pexels footage + TTS narration, generated natively in-process) --
  // the frontend uses this to decide which set of fields to show for a
  // selected model (see GenerateForm.tsx).
  engine: z.enum(['comfy', 'stock-video']).default('comfy'),
});
export type ModelOption = z.infer<typeof ModelOptionSchema>;

export const VoiceOptionSchema = z.object({
  id: z.string(), // edge-tts voice name, e.g. "hi-IN-SwaraNeural-Female"
  label: z.string(),
  language: z.enum(['hi', 'en']),
  gender: z.enum(['male', 'female']),
});
export type VoiceOption = z.infer<typeof VoiceOptionSchema>;

// The NON-secret subset of config/app.config.ts served via GET /api/config.
// Secrets (COMFYUI_AUTH_TOKEN, admin credentials) never appear here -- only
// whether login is required, not any credential itself.
export const PublicAppConfigSchema = z.object({
  appName: z.string(),
  allowedDurationsSeconds: z.array(z.number().positive()).min(1),
  allowedResolutions: z.array(ResolutionPresetSchema).min(1),
  allowedFps: z.array(z.number().int().positive()).min(1),
  maxPromptLength: z.number().int().positive(),
  models: z.array(ModelOptionSchema).min(1),
  defaultModelId: z.string(),
  imageToVideoEnabled: z.boolean(),
  passwordRequired: z.boolean(),
  // Voices for engine: 'stock-video' models -- Hindi + English narration
  // options (see config/voices.config.ts). Empty when none are configured.
  voices: z.array(VoiceOptionSchema),
});

export type PublicAppConfig = z.infer<typeof PublicAppConfigSchema>;
