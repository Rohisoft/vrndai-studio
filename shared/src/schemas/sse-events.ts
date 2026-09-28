import { z } from 'zod';
import { JobRecordSchema } from './job.js';

// Every SSE tick carries the FULL current job record, not a partial diff --
// simpler for clients (no merge logic that can go stale/inconsistent) at
// negligible cost given how small a job record is. The SSE "event:" name
// (status|progress|done|error) still lets the client branch cheaply
// (e.g. close the connection on done/error) without inspecting the payload.
export const SseJobEventSchema = z.object({
  type: z.enum(['status', 'progress', 'done', 'error']),
  job: JobRecordSchema,
});

export type SseJobEvent = z.infer<typeof SseJobEventSchema>;
