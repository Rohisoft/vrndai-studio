import type { JobRow } from '../store/job-store.js';

// Always 0 for now -- self-hosted generation has no per-job API cost. This
// is the hook a later credits/billing system would plug into: swap the
// body, keep the signature, and every call site (there are none needing
// changes) already expects a number back.
export function estimateCost(_job: JobRow): number {
  return 0;
}
