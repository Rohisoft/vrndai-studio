import { z } from 'zod';
import { ResolutionPresetSchema } from './config.js';

export const ModelDefaultsSchema = z.object({
  steps: z.number().int().positive().max(150),
  cfg: z.number().positive().max(30),
  sampler: z.string().min(1),
  negativePrompt: z.string().max(2000),
  seedMode: z.enum(['random', 'fixed']),
  fixedSeed: z.number().int().nonnegative(),
});

// The full editable subset of config/app.config.ts. Used both to validate
// incoming edits from the Settings page and to type what GET /api/settings
// returns for the "app" section.
export const AppSettingsSchema = z.object({
  appName: z.string().min(1).max(100),
  allowedDurationsSeconds: z.array(z.number().positive().max(60)).min(1),
  allowedResolutions: z.array(ResolutionPresetSchema).min(1),
  allowedFps: z.array(z.number().int().positive().max(60)).min(1),
  maxPromptLength: z.number().int().positive().max(20000),
  defaults: ModelDefaultsSchema,
  jobTimeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative().max(10),
  maxStoredVideos: z.number().int().positive(),
  autoDeleteAfterDays: z.number().int().positive(),
  imageToVideoEnabled: z.boolean(),
  // Which config/models.config.ts model id is pre-selected on the Create
  // form. Editable here (Settings -> General) rather than a hardcoded
  // export, so switching the default doesn't need a code change.
  defaultModelId: z.string(),
});

export type ModelDefaults = z.infer<typeof ModelDefaultsSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
