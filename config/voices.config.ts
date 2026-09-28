// Curated edge-tts voices for the Stock Footage (Pexels) engine's narration.
// Ids are the real edge-tts ShortName plus a "-Female"/"-Male" suffix for
// display grouping, stripped back off before being passed to msedge-tts
// (see apps/api/src/stock-video/tts.ts). Verified live via
// `edge_tts.list_voices()` before picking this list, so these are
// known-good, not guessed.

export interface VoiceConfig {
  id: string;
  label: string;
  language: 'hi' | 'en';
  gender: 'male' | 'female';
}

export const voices: VoiceConfig[] = [
  { id: 'hi-IN-SwaraNeural-Female', label: 'Swara (Hindi)', language: 'hi', gender: 'female' },
  { id: 'hi-IN-MadhurNeural-Male', label: 'Madhur (Hindi)', language: 'hi', gender: 'male' },
  { id: 'en-IN-NeerjaNeural-Female', label: 'Neerja (English, Indian accent)', language: 'en', gender: 'female' },
  { id: 'en-IN-PrabhatNeural-Male', label: 'Prabhat (English, Indian accent)', language: 'en', gender: 'male' },
  { id: 'en-US-JennyNeural-Female', label: 'Jenny (English, US)', language: 'en', gender: 'female' },
  { id: 'en-US-GuyNeural-Male', label: 'Guy (English, US)', language: 'en', gender: 'male' },
  { id: 'en-GB-SoniaNeural-Female', label: 'Sonia (English, UK)', language: 'en', gender: 'female' },
  { id: 'en-GB-RyanNeural-Male', label: 'Ryan (English, UK)', language: 'en', gender: 'male' },
];
