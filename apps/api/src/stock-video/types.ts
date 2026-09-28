// Job params for the Stock Footage engine -- these travel through
// ComfyClient.submitWorkflow()'s generic `graph: Record<string, unknown>`
// parameter (see stock-video-client.ts and queue/worker.ts's
// buildStockVideoParams()) since StockVideoClient deliberately implements
// the same ComfyClient shape as the ComfyUI clients, letting worker.ts
// share its submit/poll/fetch dispatch code across every engine.
export interface StockVideoJobParams {
  /** The video's subject/topic -- also what gets a script written from it when `script` is omitted. */
  subject: string;
  script?: string;
  /** edge-tts voice name WITH the "-Female"/"-Male" suffix, e.g. "hi-IN-SwaraNeural-Female" -- see config/voices.config.ts. Stripped before being passed to msedge-tts. */
  voiceName: string;
  aspect: '16:9' | '9:16';
  clipDurationSeconds: number;
  subtitlesEnabled: boolean;
  scriptParagraphs: number;
}
