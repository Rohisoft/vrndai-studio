import { Client } from '@gradio/client';

const SPACE = 'yasirs/XTTS-V2';

// Confirmed live via this Space's actual API schema (view_api()) that this
// endpoint's "Language" dropdown includes 'Hindi' -- unlike the first
// Space tried (tonyassi/voice-clone), which had no language parameter at
// all and produced poor results. Only the languages this app's own voice
// picker uses are mapped here.
const LANGUAGE_LABELS: Record<'en' | 'hi', string> = { en: 'English', hi: 'Hindi' };

// Groq's transcription API (called on this result in pipeline.ts) keys
// off the file EXTENSION, not the actual bytes -- guessing wrong (or using
// a fake one) gets a real request rejected with "unsupported_audio_format"
// even though the audio itself is fine (confirmed live). Only trust an
// extension Groq's docs actually list; anything else falls back to .mp3,
// this Space's confirmed live output format.
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
  return 'mp3';
}

// Calls a free, community-run Hugging Face Space (yasirs/XTTS-V2, a real
// Coqui XTTS-v2 deployment -- confirmed via live testing to actually
// clone the reference voice, unlike the first Space tried) via Gradio's
// own JS client. NOT a stable paid API, deliberately kept isolated behind
// this one function so swapping to a real provider (e.g. ElevenLabs)
// later only means rewriting this file, nothing that calls it.
//
// This Space's /voice_clone_synthesis takes reference_audio_url (a URL),
// not a direct file upload -- confirmed live that Gradio's own
// upload_files() (uploads straight to the Space's own server, no public
// URL of our own needed) plus {root}{api_prefix}/file={path} produces a
// URL that endpoint actually accepts. example_audio_name must be
// explicitly nulled or the Space errors ("provide either... but not
// both") since it otherwise defaults to one of its own bundled samples.
//
// Returns only audio bytes -- this Space has no word-level timing output,
// so pipeline.ts recovers that separately via transcribeAudio() (Groq
// Whisper) on the result, exactly like the real-voice-upload path already
// does for a user's own recording.
export async function cloneVoiceAndSynthesize(opts: {
  hfToken: string;
  sampleBytes: Buffer;
  text: string;
  language: 'en' | 'hi';
}): Promise<{ audioBytes: Buffer; extension: string }> {
  const client = await Client.connect(SPACE, { hf_token: opts.hfToken as `hf_${string}` });
  if (!client.config) {
    throw new Error('Voice clone Space did not return its app config after connecting.');
  }

  const sampleBlob = new Blob([opts.sampleBytes]);
  const uploadResult = await client.upload_files(client.config.root, [sampleBlob]);
  const uploadedPath = uploadResult.files?.[0];
  if (!uploadedPath) {
    throw new Error('Voice clone Space rejected the reference sample upload.');
  }
  const referenceAudioUrl = `${client.config.root}${client.api_prefix}/file=${uploadedPath}`;

  const result = await client.predict('/voice_clone_synthesis', {
    text: opts.text,
    reference_audio_url: referenceAudioUrl,
    example_audio_name: null,
    language: LANGUAGE_LABELS[opts.language],
  });

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
