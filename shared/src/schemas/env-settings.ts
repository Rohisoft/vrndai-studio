import { z } from 'zod';

// What GET /api/settings returns for the "env" section. Secrets are masked
// to a boolean ("is it set") -- the actual value is never sent to the
// browser after the initial write.
export const EnvSettingsViewSchema = z.object({
  comfyuiBaseUrl: z.string(),
  comfyuiAuthTokenSet: z.boolean(),
  comfyuiMock: z.boolean(),
  appPasswordSet: z.boolean(),
  port: z.number().int(),
  dataDir: z.string(),
});

// What POST /api/settings/env accepts. comfyuiAuthToken/appPassword are
// write-only and optional: omit the field entirely to leave the current
// secret unchanged, send it (including an explicit empty string, via a
// dedicated "clear" action in the UI) to replace/clear it.
export const EnvSettingsInputSchema = z.object({
  comfyuiBaseUrl: z.string().url(),
  comfyuiAuthToken: z.string().optional(),
  comfyuiMock: z.boolean(),
  appPassword: z.string().optional(),
  port: z.number().int().positive().max(65535),
  dataDir: z.string().min(1),
});

export type EnvSettingsView = z.infer<typeof EnvSettingsViewSchema>;
export type EnvSettingsInput = z.infer<typeof EnvSettingsInputSchema>;
