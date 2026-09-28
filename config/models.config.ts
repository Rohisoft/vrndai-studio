// Maps a model id to its ComfyUI workflow file and the options it supports.
// Adding a new model should only ever require: a new JSON file in
// workflows/, and one new entry here -- no other code changes.

export interface ModelConfig {
  id: string;
  label: string;
  /**
   * 'comfy' (default): ComfyUI/RunPod graph rendering, via workflowFile below.
   * 'stock-video': stock Pexels footage + TTS narration, generated natively
   * in-process (see apps/api/src/stock-video/) -- no external service, no
   * workflow file, workflowFile/requiresFourNPlusOneFrames are unused.
   */
  engine?: 'comfy' | 'stock-video';
  /** Relative to the workflows/ directory. Required for engine 'comfy', unused otherwise. */
  workflowFile?: string;
  /** Used instead of workflowFile when the job has a sourceImage (see queue/worker.ts). Only set when supportsImageToVideo is true. */
  workflowFileImageToVideo?: string;
  /** Some video models need frame counts of the form 4n+1 -- see workflow/frames.ts. */
  requiresFourNPlusOneFrames: boolean;
  supportsImageToVideo: boolean;
}

// Wan 2.2 5B/14B workflow files (workflows/wan22-*.json) are kept in the
// repo but deliberately not listed here -- there's no RunPod Serverless
// endpoint deployed for them yet (only LTX-2.5 is baked into a worker
// image), so offering them in the picker would let a job get submitted
// that fails immediately with "no endpoint configured". Re-add an entry
// here once a Wan image is actually deployed (see RUNPOD_RUNBOOK.md).
export const models: ModelConfig[] = [
  {
    id: 'ltx2.5-t2v',
    label: 'LTX-2.5 (Text-to-Video, with audio)',
    workflowFile: 'ltx2.5-t2v.json',
    workflowFileImageToVideo: 'ltx2.5-i2v.json',
    // Frame count is computed inside this workflow's own graph (duration *
    // fps + 1 via a ComfyMathExpression node), not by our frames.ts -- this
    // flag has no effect for this model.
    requiresFourNPlusOneFrames: false,
    supportsImageToVideo: true,
  },
  {
    id: 'pexels-stock-video',
    label: 'Stock Footage (Pexels + Voiceover)',
    engine: 'stock-video',
    requiresFourNPlusOneFrames: false,
    supportsImageToVideo: false,
  },
];

// The default model id now lives in AppSettings (config/app.config.ts's
// `defaultModelId`, editable via Settings -> General) rather than here --
// see apps/api/src/routes/config.ts, which reads it from the settings
// store instead of this file.

export function getModelConfig(modelId: string): ModelConfig | undefined {
  return models.find((model) => model.id === modelId);
}
