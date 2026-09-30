import { Client } from '@gradio/client';

// Groq's transcription API (called on this result in pipeline.ts) keys
// off the file EXTENSION, not the actual bytes -- guessing wrong (or using
// a fake one) gets a real request rejected with "unsupported_audio_format"
// even though the audio itself is fine (confirmed live). Only trust an
// extension Groq's docs actually list; anything else falls back to .wav,
// the common default for this kind of Gradio audio-output Space.
const GROQ_SUPPORTED_EXTENSIONS = new Set(['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'opus', 'wav', 'webm']);

function guessExtension(output: { orig_name?: string; mime_type?: string; path?: string }): string {
  const fromName = output.orig_name?.split('.').pop() ?? output.path?.split('.').pop();
  if (fromName && GROQ_SUPPORTED_EXTENSIONS.has(fromName.toLowerCase())) {
    return fromName.toLowerCase();
  }
  const fromMime = output.mime_type?.split('/')[1];
  if (fromMime && GROQ_SUPPORTED_EXTENSIONS.has(fromMime.toLowerCase())) {
    return fromMime.toLowerCase();
  }
  return 'wav';
}

// Calls a free, community-run Hugging Face Space (tonyassi/voice-clone)
// via Gradio's own JS client -- NOT a stable paid API, deliberately kept
// isolated behind this one function so swapping to a real provider (e.g.
// ElevenLabs) later only means rewriting this file, nothing that calls it.
// Returns only audio bytes -- this Space has no word-level timing output,
// so pipeline.ts recovers that separately via transcribeAudio() (Groq
// Whisper) on the result, exactly like the real-voice-upload path already
// does for a user's own recording.
export async function cloneVoiceAndSynthesize(opts: { hfToken: string; sampleBytes: Buffer; text: string }): Promise<{
  audioBytes: Buffer;
  extension: string;
}> {
  const client = await Client.connect('tonyassi/voice-clone', { hf_token: opts.hfToken as `hf_${string}` });

  const sampleBlob = new Blob([opts.sampleBytes]);
  const result = await client.predict('/clone', { text: opts.text, audio: sampleBlob });

  const output = (result.data as Array<{ url?: string; path?: string; orig_name?: string; mime_type?: string } | undefined>)?.[0];
  if (!output?.url) {
    throw new Error('Voice clone Space did not return an audio file -- its response shape may have changed.');
  }

  const res = await fetch(output.url);
  if (!res.ok) {
    throw new Error(`Failed to download cloned voice audio: ${res.status}`);
  }
  return { audioBytes: Buffer.from(await res.arrayBuffer()), extension: guessExtension(output) };
}
