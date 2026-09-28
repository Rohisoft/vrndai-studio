import { getModelConfig } from '../../../../config/models.config.js';
import { toJobRecord, type JobStore } from '../store/job-store.js';
import { processJob, type WorkerDeps } from './worker.js';

export interface JobQueue {
  /** Wakes the worker loop if it's idle; safe to call any time a new/requeued job may exist. */
  notify(): void;
  /** Best-effort cancel: interrupts the job if it's the one currently running, or just flips a queued job to cancelled. */
  cancel(jobId: string): Promise<void>;
}

// MongoDB is the actual source of truth (see JobStore) -- this is only a
// wake signal plus a "one job at a time" guard, which is how state
// "survives what it can" across restarts: on boot, markAllRunningAsFailed()
// runs before the worker starts, then the worker resumes any remaining
// queued rows FIFO by created_at.
export function createJobQueue(workerDeps: WorkerDeps): JobQueue {
  const { jobStore, comfyClient, stockVideoClient } = workerDeps;
  let running = false;
  let currentJobId: string | null = null;

  async function runLoop(): Promise<void> {
    if (running) {
      return;
    }
    running = true;

    try {
      let next = await jobStore.getOldestQueued();
      while (next) {
        currentJobId = next.id;
        await processJob(next, workerDeps);
        currentJobId = null;
        next = await jobStore.getOldestQueued();
      }
    } finally {
      running = false;
    }
  }

  function notify(): void {
    void runLoop();
  }

  async function cancel(jobId: string): Promise<void> {
    const job = await jobStore.getById(jobId);
    if (!job) {
      return;
    }

    if (job.id === currentJobId) {
      // job.comfyPromptId reflects the DB, which processJob writes as soon as
      // submitWorkflow resolves -- there's a brief window right after submit
      // where it's still null and this interrupt is a no-op; the job still
      // ends up correctly marked cancelled below either way, the worker just
      // won't abort generation early in that narrow case.
      const client = getModelConfig(job.modelId)?.engine === 'stock-video' ? stockVideoClient : comfyClient;
      await client.interrupt(job.comfyPromptId ?? undefined).catch(() => {
        // Best-effort -- even if the interrupt call itself fails, still mark cancelled below.
      });
      await jobStore.markCancelled(jobId);
      workerDeps.eventBus.publish(jobId, 'error', toJobRecord((await jobStore.getById(jobId))!));
      return;
    }

    if (job.status === 'queued') {
      await jobStore.markCancelled(jobId);
      workerDeps.eventBus.publish(jobId, 'error', toJobRecord((await jobStore.getById(jobId))!));
    }
  }

  return { notify, cancel };
}
