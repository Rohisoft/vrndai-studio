import { z } from 'zod';

// Shared shape for hand-sent error responses (404s, custom 400s) so routes
// can declare it in their response schema map alongside the success shape --
// without this, Zod's response serializer validates every reply.send() call
// against whichever schema is registered for that status code, and an error
// payload sent without a matching entry either fails validation or (worse)
// silently gets coerced/dropped.
export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
