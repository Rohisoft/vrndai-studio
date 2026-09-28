import type { WordTiming } from './tts.js';

interface CaptionLine {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

// Groups word-boundary timings into readable caption lines -- flushes on
// sentence-ending punctuation, a word-count cap, or a max-duration cap,
// whichever comes first.
export function groupIntoCaptionLines(words: WordTiming[], opts?: { maxWords?: number; maxSeconds?: number }): CaptionLine[] {
  const maxWords = opts?.maxWords ?? 8;
  const maxSeconds = opts?.maxSeconds ?? 5;
  const lines: CaptionLine[] = [];
  let current: WordTiming[] = [];

  function flush(): void {
    if (current.length === 0) {
      return;
    }
    lines.push({
      text: current.map((w) => w.text).join(' '),
      startSeconds: current[0].startSeconds,
      endSeconds: current[current.length - 1].endSeconds,
    });
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
  return lines;
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
