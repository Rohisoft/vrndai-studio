import { useEffect, useRef, useState } from 'react';
import type { JobRecord, SseJobEvent } from '@app/shared';

// Same per-job SSE stream useJobEvents uses (/api/jobs/:id/events), just one
// connection per tracked job instead of one -- the backend already supports
// any number of simultaneous subscribers per job with no changes needed
// (see routes/jobs-stream.ts's deps.eventBus.subscribe). Lets the Create
// page show live status for every job the user has queued up in this
// session, not just the single most recent one.
export interface MultiJobEvents {
  jobsById: Record<string, JobRecord>;
  connectionErrorsById: Record<string, boolean>;
}

export function useMultiJobEvents(jobIds: string[]): MultiJobEvents {
  const [jobsById, setJobsById] = useState<Record<string, JobRecord>>({});
  const [connectionErrorsById, setConnectionErrorsById] = useState<Record<string, boolean>>({});
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());

  useEffect(() => {
    const sources = sourcesRef.current;

    for (const jobId of jobIds) {
      if (sources.has(jobId)) {
        continue;
      }
      const source = new EventSource(`/api/jobs/${jobId}/events`);
      const handle = (event: MessageEvent) => {
        if (typeof event.data !== 'string') {
          return;
        }
        const parsed = JSON.parse(event.data) as SseJobEvent;
        setJobsById((current) => ({ ...current, [jobId]: parsed.job }));
        if (parsed.type === 'done' || parsed.type === 'error') {
          source.close();
          sources.delete(jobId);
        }
      };
      source.addEventListener('status', handle);
      source.addEventListener('progress', handle);
      source.addEventListener('done', handle);
      source.addEventListener('error', handle);
      source.onerror = () => setConnectionErrorsById((current) => ({ ...current, [jobId]: true }));
      sources.set(jobId, source);
    }

    for (const [jobId, source] of sources) {
      if (!jobIds.includes(jobId)) {
        source.close();
        sources.delete(jobId);
      }
    }
  }, [jobIds]);

  // Unmount only -- closes whatever's still open when the page is left.
  useEffect(() => {
    const sources = sourcesRef.current;
    return () => {
      for (const source of sources.values()) {
        source.close();
      }
      sources.clear();
    };
  }, []);

  return { jobsById, connectionErrorsById };
}
