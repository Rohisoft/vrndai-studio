import { z } from 'zod';
import { JobStatusSchema } from './job-status.js';
import { GenerationRequestSchema } from './generation-request.js';

// The shape returned to the client for a job (list, get-by-id, and each SSE
// snapshot). Mirrors the SQLite `jobs` row but with params nested back into
// an object (stored as params_json on disk) and no internal-only fields
// (comfy_prompt_id, retry_count) exposed.
export const JobRecordSchema = z.object({
  id: z.string(),
  status: JobStatusSchema,
  params: GenerationRequestSchema,
  progress: z.number().min(0).max(100),
  videoUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  error: z.string().nullable(),
  sourceJobId: z.string().nullable(),
  combinedFromJobIds: z.array(z.string()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export type JobRecord = z.infer<typeof JobRecordSchema>;
