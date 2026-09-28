import { EventEmitter } from 'node:events';
import type { JobRecord } from '@app/shared';

export type JobEventType = 'status' | 'progress' | 'done' | 'error';

export interface JobEventBus {
  publish(jobId: string, type: JobEventType, job: JobRecord): void;
  subscribe(jobId: string, listener: (type: JobEventType, job: JobRecord) => void): () => void;
}

// One EventEmitter per process, topics keyed by "job:<id>" so subscribers
// for one job never see another job's events. Purely in-memory -- fine
// since SSE connections only ever live as long as the server process does.
export function createJobEventBus(): JobEventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // unbounded: many jobs, few listeners each, no leak risk from this alone

  function topic(jobId: string): string {
    return `job:${jobId}`;
  }

  function publish(jobId: string, type: JobEventType, job: JobRecord): void {
    emitter.emit(topic(jobId), type, job);
  }

  function subscribe(jobId: string, listener: (type: JobEventType, job: JobRecord) => void): () => void {
    emitter.on(topic(jobId), listener);
    return () => emitter.off(topic(jobId), listener);
  }

  return { publish, subscribe };
}
