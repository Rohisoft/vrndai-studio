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
  /** edge-tts voice name WITH the "-Female"/"-Male" suffix, e.g. "hi-IN-SwaraNeural-Female" -- see config/voices.config.ts. Stripped before being passed to msedge-tts. Ignored when narrationAudioBytes is set. */
  voiceName: string;
  /** Already-resolved bytes of a user-uploaded voice recording (see routes/audio.ts + worker.ts's buildStockVideoParams()) -- when set, this replaces TTS entirely: no script auto-writing, no msedge-tts synthesis, narration and its word timings come from transcribing this instead (see pipeline.ts, transcribe.ts). */
  narrationAudioBytes?: Buffer;
  /** The uploaded file's original extension (e.g. ".mp3") -- written back out with the same extension so ffmpeg's format detection has a real hint to go on. */
  narrationAudioExt?: string;
  /** Already-resolved bytes of a SHORT voice sample to clone (see routes/audio.ts + worker.ts's buildStockVideoParams()) -- unlike narrationAudioBytes, this is not the narration itself: script-writing still happens, and the script gets synthesized in this cloned voice (see voice-clone-client.ts, pipeline.ts). */
  voiceCloneSampleBytes?: Buffer;
  aspect: '16:9' | '9:16';
  clipDurationSeconds: number;
  subtitlesEnabled: boolean;
  scriptParagraphs: number;
}
