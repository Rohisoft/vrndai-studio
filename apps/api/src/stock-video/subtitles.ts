import type { WordTiming } from './tts.js';

interface CaptionLine {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

// Groups word-boundary timings into readable caption-line-sized chunks --
// flushes on sentence-ending punctuation, a word-count cap, or a
// max-duration cap, whichever comes first. Returns the raw word groups
// (not just line text) so callers that need per-word detail -- buildAss()'s
// karaoke timing -- don't have to re-derive line membership from timestamps.
export function groupWordsIntoLines(words: WordTiming[], opts?: { maxWords?: number; maxSeconds?: number }): WordTiming[][] {
  const maxWords = opts?.maxWords ?? 8;
  const maxSeconds = opts?.maxSeconds ?? 5;
  const groups: WordTiming[][] = [];
  let current: WordTiming[] = [];

  function flush(): void {
    if (current.length === 0) {
      return;
    }
    groups.push(current);
    current = [];
  }

  for (const word of words) {
    current.push(word);
    const duration = current[current.length - 1].endSeconds - current[0].startSeconds;
    const endsSentence = /[.!?]$/.test(word.text);
    if (current.length >= maxWords || duration >= maxSeconds || endsSentence) {
      flush();
    }
  }
  flush();
  return groups;
}

export function groupIntoCaptionLines(words: WordTiming[], opts?: { maxWords?: number; maxSeconds?: number }): CaptionLine[] {
  return groupWordsIntoLines(words, opts).map((group) => ({
    text: group.map((w) => w.text).join(' '),
    startSeconds: group[0].startSeconds,
    endSeconds: group[group.length - 1].endSeconds,
  }));
}

function formatTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hh = Math.floor(totalMs / 3_600_000);
  const mm = Math.floor((totalMs % 3_600_000) / 60_000);
  const ss = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)},${pad(ms, 3)}`;
}

export function buildSrt(words: WordTiming[]): string {
  const lines = groupIntoCaptionLines(words);
  return lines.map((line, i) => `${i + 1}\n${formatTimestamp(line.startSeconds)} --> ${formatTimestamp(line.endSeconds)}\n${line.text}\n`).join('\n');
}

function formatAssTimestamp(seconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const hh = Math.floor(totalCentiseconds / 360_000);
  const mm = Math.floor((totalCentiseconds % 360_000) / 6_000);
  const ss = Math.floor((totalCentiseconds % 6_000) / 100);
  const cs = totalCentiseconds % 100;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${hh}:${pad(mm, 2)}:${pad(ss, 2)}.${pad(cs, 2)}`;
}

// Escapes ASS's own inline-formatting braces so a word containing a literal
// "{" or "}" (rare, but not impossible in generated narration) can't be
// mistaken for a style/karaoke override tag.
function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/[{}]/g, (c) => (c === '{' ? '\\{' : '\\}'));
}

// Word-by-word karaoke captions -- ASS's `\k<centiseconds>` tag makes
// libass progressively switch each word from the style's SecondaryColour
// (upcoming, dim) to PrimaryColour (spoken, highlighted) as playback
// reaches it -- the classic short-form-video "highlight as it's said"
// caption look, versus a flat static line. Reuses the same line-grouping
// as buildSrt() -- only how each line's timing is expressed differs.
//
// Each word's \k duration is measured from ITS start to the NEXT word's
// start (not its own end) so the durations across a line sum to exactly
// that line's total span, keeping the highlight perfectly in sync with the
// line's Start/End instead of drifting from inter-word silence gaps.
export function buildAss(words: WordTiming[]): string {
  const lineGroups = groupWordsIntoLines(words);

  const header = `[Script Info]
ScriptType: v4.00+
Collisions: Normal

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,20,&H0000FFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2,0,2,10,10,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = lineGroups.map((lineWords) => {
    const lineStart = lineWords[0].startSeconds;
    const lineEnd = lineWords[lineWords.length - 1].endSeconds;
    const karaokeText = lineWords
      .map((word, i) => {
        const nextStart = i + 1 < lineWords.length ? lineWords[i + 1].startSeconds : lineEnd;
        const centiseconds = Math.max(1, Math.round((nextStart - word.startSeconds) * 100));
        return `{\\k${centiseconds}}${escapeAssText(word.text)} `;
      })
      .join('');
    return `Dialogue: 0,${formatAssTimestamp(lineStart)},${formatAssTimestamp(lineEnd)},Default,,0,0,0,,${karaokeText.trimEnd()}`;
  });

  return header + events.join('\n') + '\n';
}
