import type { GenerationRequest } from '@app/shared';
import { appConfig } from '../../../../config/app.config.js';
import { voices } from '../../../../config/voices.config.js';
import type { ToolDefinition } from '../llm/types.js';

// A simplified surface over GenerationRequestSchema for the LLM to fill in
// -- covers both engines (ai-video -> LTX, stock-video -> Pexels+TTS)
// without exposing every low-level field (fps, seed, etc.) a conversation
// has no reason to specify.
export const CREATE_VIDEO_TOOL: ToolDefinition = {
  name: 'create_video',
  description:
    'Creates a video generation job from a conversation. Use engine="stock-video" for narrated stock-footage videos ' +
    '(facts, tips, quotes, motivational content) with real voiceover and stock clips. Use engine="ai-video" for an ' +
    'AI-generated video rendered directly from a text description, with no narration.',
  parameters: {
    type: 'object',
    properties: {
      engine: { type: 'string', enum: ['ai-video', 'stock-video'], description: 'Which video engine to use.' },
      description: { type: 'string', description: "What the video should be about or show -- the video's subject/prompt." },
      voiceLanguage: { type: 'string', enum: ['en', 'hi'], description: 'Narration language -- only used for engine="stock-video".' },
      durationSeconds: { type: 'number', description: 'Approximate desired length in seconds.' },
      orientation: { type: 'string', enum: ['9:16', '16:9'], description: 'Portrait (9:16) or landscape (16:9).' },
    },
    required: ['engine', 'description'],
  },
};

interface CreateVideoToolArgs {
  [key: string]: unknown;
  engine: 'ai-video' | 'stock-video';
  description: string;
  voiceLanguage?: 'en' | 'hi';
  durationSeconds?: number;
  orientation?: '9:16' | '16:9';
}

function isValidArgs(args: Record<string, unknown>): args is CreateVideoToolArgs {
  return (
    (args.engine === 'ai-video' || args.engine === 'stock-video') &&
    typeof args.description === 'string' &&
    args.description.trim().length > 0
  );
}

// Snaps to whatever's actually in appConfig.allowedDurationsSeconds --
// the LTX engine only accepts these specific values, so a raw silent
// Math.min/max clamp would risk the confirmation summary (built from this
// same duration) saying one thing while a mismatched value gets used
// underneath. Picking the nearest *valid* value keeps the summary and the
// actual job in agreement.
function nearestAllowedDuration(requested: number | undefined): number {
  const allowed = appConfig.allowedDurationsSeconds;
  if (!requested) {
    return allowed[0];
  }
  return allowed.reduce((closest, candidate) => (Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest));
}

// Same 20s/40s/60s -> 1/2/3 paragraph mapping GenerateForm.tsx's
// TARGET_LENGTHS uses for the manual form's "target length" pill group --
// kept in sync deliberately since this is the same approximate proxy for
// the same underlying limitation (Stock Footage duration is narration-
// length driven, not directly settable).
function paragraphsForDuration(durationSeconds: number | undefined): number {
  if (!durationSeconds || durationSeconds <= 25) return 1;
  if (durationSeconds <= 50) return 2;
  return 3;
}

// Mirrors GenerateForm.tsx's own defaults for whichever engine is picked,
// so a conversation that only specifies "engine" and "description" still
// produces a sensible, submittable request -- same reasoning as the
// manual form's own default state.
export function mapToolArgsToGenerationRequest(args: Record<string, unknown>): GenerationRequest | null {
  if (!isValidArgs(args)) {
    return null;
  }

  if (args.engine === 'stock-video') {
    const language = args.voiceLanguage ?? 'en';
    const voiceId = voices.find((v) => v.language === language)?.id ?? voices[0].id;
    const orientation = args.orientation ?? '9:16';
    return {
      modelId: 'pexels-stock-video',
      prompt: args.description,
      voiceId,
      aspectRatio: orientation,
      stockClipDurationSeconds: 4,
      scriptParagraphs: paragraphsForDuration(args.durationSeconds),
      subtitlesEnabled: true,
      // GenerationRequestSchema still requires these -- harmless
      // placeholders the stock-video engine ignores entirely (matches
      // GenerateForm.tsx's own submit payload for this engine).
      durationSeconds: 30,
      fps: 30,
      width: orientation === '16:9' ? 1920 : 1080,
      height: orientation === '16:9' ? 1080 : 1920,
    };
  }

  const orientation = args.orientation ?? '9:16';
  return {
    modelId: 'ltx2.5-t2v',
    prompt: args.description,
    durationSeconds: nearestAllowedDuration(args.durationSeconds),
    fps: 24,
    width: orientation === '16:9' ? 1280 : 720,
    height: orientation === '16:9' ? 720 : 1280,
    aspectRatio: orientation,
  };
}
