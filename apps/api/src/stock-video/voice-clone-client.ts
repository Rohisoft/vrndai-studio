import { Client } from '@gradio/client';

// Calls a free, community-run Hugging Face Space (tonyassi/voice-clone)
// via Gradio's own JS client -- NOT a stable paid API, deliberately kept
// isolated behind this one function so swapping to a real provider (e.g.
// ElevenLabs) later only means rewriting this file, nothing that calls it.
// Returns only audio bytes -- this Space has no word-level timing output,
// so pipeline.ts recovers that separately via transcribeAudio() (Groq
// Whisper) on the result, exactly like the real-voice-upload path already
// does for a user's own recording.
export async function cloneVoiceAndSynthesize(opts: { hfToken: string; sampleBytes: Buffer; text: string }): Promise<Buffer> {
  const client = await Client.connect('tonyassi/voice-clone', { hf_token: opts.hfToken as `hf_${string}` });

  const sampleBlob = new Blob([opts.sampleBytes]);
  const result = await client.predict('/clone', { text: opts.text, audio: sampleBlob });

  const output = (result.data as Array<{ url?: string; path?: string } | undefined>)?.[0];
  if (!output?.url) {
    throw new Error('Voice clone Space did not return an audio file -- its response shape may have changed.');
  }

  const res = await fetch(output.url);
  if (!res.ok) {
    throw new Error(`Failed to download cloned voice audio: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
