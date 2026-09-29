import type { LlmClient } from '../llm/types.js';

export interface ContentIdea {
  title: string;
  hook: string;
  prompt: string;
}

const DEFAULT_COUNT = 5;

// Same shape as stock-video/search-terms.ts's generateSearchTerms(): ask
// the LLM for JSON-only output, parse defensively, fall back gracefully on
// a malformed response rather than failing the whole request.
export async function generateContentIdeas(opts: { llmClient: LlmClient; niche: string; count?: number }): Promise<ContentIdea[]> {
  const count = opts.count ?? DEFAULT_COUNT;
  const content = await opts.llmClient.chat([
    {
      role: 'system',
      content:
        `You brainstorm short-form video content ideas (for YouTube Shorts/Instagram Reels style videos). Given a niche/topic, ` +
        `output exactly ${count} distinct ideas. For each idea provide: "title" (a short label, under 8 words), "hook" (the ` +
        `opening line/angle that grabs attention in the first second), and "prompt" (a single detailed paragraph describing the ` +
        `video's subject, action, and visual style, ready to hand directly to an AI video generator). Respond with ONLY a JSON ` +
        `array of objects with keys "title", "hook", "prompt" -- no markdown, no explanation, nothing else.`,
    },
    { role: 'user', content: opts.niche },
  ]);

  try {
    const start = content.indexOf('[');
    const end = content.lastIndexOf(']');
    if (start === -1 || end === -1) {
      return [];
    }
    const parsed = JSON.parse(content.slice(start, end + 1));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (idea): idea is ContentIdea =>
        idea &&
        typeof idea.title === 'string' &&
        typeof idea.hook === 'string' &&
        typeof idea.prompt === 'string' &&
        idea.title.trim().length > 0 &&
        idea.prompt.trim().length > 0
    );
  } catch {
    // A malformed LLM response shouldn't crash the request -- the route
    // surfaces an empty list, and the frontend shows a clear "try again".
    return [];
  }
}
