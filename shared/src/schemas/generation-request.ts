import { z } from 'zod';

// Shared by the API route validation AND the web form's pre-submit check --
// one schema, no duplication. Numeric bounds are deliberately loose here;
// the *allowed* durations/resolutions/fps come from app config (GET
// /api/config) and are enforced by the form only showing valid options --
// this schema just guards against malformed/malicious input.
export const GenerationRequestSchema = z.object({
  modelId: z.string().min(1),
  prompt: z.string().min(1).max(20000),
  negativePrompt: z.string().max(20000).optional(),
  durationSeconds: z.number().positive().max(60),
  fps: z.number().int().positive().max(60),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
  aspectRatio: z.string().min(1),
  seed: z.number().int().nonnegative().optional(), // omitted => random
  sourceImage: z.string().optional(), // uploaded filename, only used when image-to-video is enabled
  // Only meaningful for engine: 'stock-video' models (see config/models.config.ts)
  // -- ignored entirely by the ComfyUI/RunPod path. `prompt` above doubles as
  // the video's subject/topic for this engine; `script` is an optional
  // full-narration override (when omitted, a script gets written from the
  // subject via Ollama -- see apps/api/src/stock-video/script-writer.ts).
  script: z.string().max(20000).optional(),
  voiceId: z.string().optional(), // e.g. "hi-IN-SwaraNeural-Female" -- see config/voices.config.ts
  // Uploaded filename (see POST /api/audio/upload) for narrating with the
  // user's own recorded voice instead of TTS -- when set, voiceId/script
  // auto-writing are skipped entirely (see stock-video/pipeline.ts).
  narrationAudio: z.string().optional(),
  // Uploaded filename of a SHORT voice sample to clone -- unlike
  // narrationAudio (the full narration itself), this is a reference clip
  // that gets synthesized speaking the script (auto-written or supplied),
  // same as the AI-voice path but with a cloned voice instead of a fixed
  // TTS one. See stock-video/voice-clone-client.ts.
  voiceCloneSample: z.string().optional(),
  stockClipDurationSeconds: z.number().positive().max(30).optional(),
  subtitlesEnabled: z.boolean().optional(),
  // How many paragraphs to write for an auto-generated script (1-10) -- the
  // nearest thing to a "target video length" knob, since actual duration is
  // narration-length driven rather than directly settable. Ignored when
  // `script` above is supplied directly (nothing to auto-write).
  scriptParagraphs: z.number().int().min(1).max(10).optional(),
});

export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;
