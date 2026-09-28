// Typed, non-secret app configuration. No environment-specific values or
// secrets here (those live in apps/api/src/config/env.ts) -- this file is
// safe to import from anywhere, including (indirectly, via GET /api/config)
// values shown to the browser.
//
// Every "magic number" for generation behavior belongs here, not scattered
// through route/worker code.

export interface ResolutionPreset {
  label: string;
  width: number;
  height: number;
  aspectRatio: string;
}

export const appConfig = {
  appName: 'AI Video Generator',

  // Generate-page option lists -- the form only ever renders these, and the
  // API re-validates against them server-side (never trust the client).
  // Whichever entry is listed first in each array is the pre-selected
  // default on the Generate form (see GenerateForm.tsx's initial useState).
  allowedDurationsSeconds: [10, 2, 3, 5, 8, 15, 30, 60] as const,
  allowedResolutions: [
    { label: '1080p Portrait', width: 1080, height: 1920, aspectRatio: '9:16' },
    { label: '1080p Landscape', width: 1920, height: 1080, aspectRatio: '16:9' },
    { label: '512p Square', width: 512, height: 512, aspectRatio: '1:1' },
    { label: '720p Landscape', width: 1280, height: 720, aspectRatio: '16:9' },
    { label: '720p Portrait', width: 720, height: 1280, aspectRatio: '9:16' },
  ] satisfies ResolutionPreset[],
  allowedFps: [24, 16] as const,
  maxPromptLength: 20000,

  // Model sampling defaults, used when a model's own config.models.config.ts
  // entry doesn't override a value.
  defaults: {
    // uni_pc converges well below the usual 20-step default; 15 trims
    // sampling time noticeably with little visible quality loss.
    steps: 15,
    cfg: 6.0,
    sampler: 'uni_pc',
    negativePrompt: 'blurry, distorted, low quality, watermark',
    seedMode: 'random' as 'random' | 'fixed',
    fixedSeed: 0,
  },

  // Job lifecycle limits.
  // 45 minutes -- durations up to 60s produce far more frames than these
  // models were designed for (60s @ 24fps = ~1440 frames vs. the ~193 frames
  // of the old 8s max), so a run needs real headroom before being killed.
  jobTimeoutMs: 45 * 60 * 1000,
  maxRetries: 1,
  maxStoredVideos: 100,
  autoDeleteAfterDays: 30,

  // Feature flags.
  imageToVideoEnabled: false,

  // Which config/models.config.ts model id is pre-selected on the Create
  // form -- editable via Settings -> General, this is just the fallback
  // used until data/app-settings.json exists.
  defaultModelId: 'ltx2.5-t2v',
};

export type AppConfig = typeof appConfig;
