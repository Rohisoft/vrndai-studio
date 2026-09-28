import type { LlmClient } from '../llm/types.js';

// Pexels' own tagging/search index is overwhelmingly English regardless of
// narration language, so search terms are always requested in English --
// mirrors how similar keyword-extraction tools approach it.
export async function generateSearchTerms(opts: { llmClient: LlmClient; script: string; subject: string }): Promise<string[]> {
  try {
    const content = await opts.llmClient.chat([
      {
        role: 'system',
        content:
          'You find stock video b-roll search terms. Given a narration script, output 5-8 short ENGLISH search queries (2-4 words each) that would find relevant stock footage on Pexels. Respond with ONLY a JSON array of strings, nothing else -- no markdown, no explanation.',
      },
      { role: 'user', content: opts.script },
    ]);
    const start = content.indexOf('[');
    const end = content.lastIndexOf(']');
    if (start === -1 || end === -1) {
      return [opts.subject];
    }
    const parsed = JSON.parse(content.slice(start, end + 1));
    const terms = Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string' && t.trim().length > 0) : [];
    return terms.length > 0 ? terms : [opts.subject];
  } catch {
    // A malformed LLM response shouldn't fail the whole job -- fall back to
    // searching on the raw subject instead.
    return [opts.subject];
  }
}
