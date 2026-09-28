import type { LlmClient } from '../llm/types.js';

export async function generateScript(opts: {
  llmClient: LlmClient;
  subject: string;
  paragraphs: number;
  language: 'hi' | 'en';
}): Promise<string> {
  const languageInstruction = opts.language === 'hi' ? 'Write the script in Hindi (Devanagari script).' : 'Write the script in English.';
  const content = await opts.llmClient.chat([
    {
      role: 'system',
      content: `You write short, engaging narration scripts for short-form video. ${languageInstruction} Write exactly ${opts.paragraphs} paragraph(s). Get straight to the point -- do not start with things like "welcome to this video". Output ONLY the narration text, no titles, headers, markdown, or stage directions.`,
    },
    { role: 'user', content: opts.subject },
  ]);
  return content.trim();
}
