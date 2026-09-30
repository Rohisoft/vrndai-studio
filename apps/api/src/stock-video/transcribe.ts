import type { WordTiming } from './tts.js';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

interface GroqTranscriptionResponse {
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
}

// Real-voice narration has no word-boundary data the way TTS does (it's
// not being synthesized from text we already know the timing of) -- Groq's
// Whisper-large-v3 endpoint is used here specifically because it supports
// word-level timestamps directly (timestamp_granularities=word), giving
// back exactly the WordTiming shape the existing ASS caption builder
// already expects, so buildAss() needs zero changes to work with real
// voice too. This is intentionally NOT part of the swappable LlmClient
// interface -- Ollama/Gemini don't do word-level transcription the same
// way, so this always needs a real Groq key regardless of LLM_PROVIDER.
export async function transcribeAudio(opts: { groqApiKey: string; audioBytes: Buffer }): Promise<{
  text: string;
  wordTimings: WordTiming[];
}> {
  const form = new FormData();
  form.append('file', new Blob([opts.audioBytes]), 'narration.audio');
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');

  const res = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.groqApiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Groq transcription failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as GroqTranscriptionResponse;
  const wordTimings: WordTiming[] = (data.words ?? []).map((w) => ({
    text: w.word.trim(),
    startSeconds: w.start,
    endSeconds: w.end,
  }));
  return { text: data.text, wordTimings };
}
