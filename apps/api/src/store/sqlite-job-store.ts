import type Database from 'better-sqlite3';
import type { CreateJobInput, JobRow, JobStore } from './job-store.js';

interface JobRowRaw {
  id: string;
  model_id: string;
  status: JobRow['status'];
  prompt: string;
  negative_prompt: string | null;
  params_json: string;
  progress: number;
  comfy_prompt_id: string | null;
  video_path: string | null;
  thumbnail_path: string | null;
  error: string | null;
  retry_count: number;
  source_job_id: string | null;
  combined_from_job_ids: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function fromRaw(raw: JobRowRaw): JobRow {
  return {
    id: raw.id,
    modelId: raw.model_id,
    status: raw.status,
    prompt: raw.prompt,
    negativePrompt: raw.negative_prompt,
    params: JSON.parse(raw.params_json),
    progress: raw.progress,
    comfyPromptId: raw.comfy_prompt_id,
    videoPath: raw.video_path,
    thumbnailPath: raw.thumbnail_path,
    error: raw.error,
    retryCount: raw.retry_count,
    sourceJobId: raw.source_job_id,
    combinedFromJobIds: raw.combined_from_job_ids ? JSON.parse(raw.combined_from_job_ids) : null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    startedAt: raw.started_at,
    completedAt: raw.completed_at,
  };
}

// better-sqlite3 is synchronous, so every method here is a plain sync
// function -- no artificial Promise wrapping. Only the ComfyUI/queue I/O
// elsewhere in the app is actually async.
export function createSqliteJobStore(db: Database.Database): JobStore {
  function now(): string {
    return new Date().toISOString();
  }

  function getById(id: string): JobRow | null {
    const raw = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRowRaw | undefined;
    return raw ? fromRaw(raw) : null;
  }

  function create(input: CreateJobInput): JobRow {
    const timestamp = now();
    db.prepare(
      `INSERT INTO jobs (id, model_id, status, prompt, negative_prompt, params_json, progress, source_job_id, combined_from_job_ids, created_at, updated_at)
       VALUES (@id, @modelId, 'queued', @prompt, @negativePrompt, @paramsJson, 0, @sourceJobId, @combinedFromJobIds, @createdAt, @updatedAt)`
    ).run({
      id: input.id,
      modelId: input.modelId,
      prompt: input.params.prompt,
      negativePrompt: input.params.negativePrompt ?? null,
      paramsJson: JSON.stringify(input.params),
      sourceJobId: input.sourceJobId ?? null,
      combinedFromJobIds: input.combinedFromJobIds ? JSON.stringify(input.combinedFromJobIds) : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const row = getById(input.id);
    if (!row) {
      throw new Error(`Failed to read back newly created job '${input.id}'.`);
    }
    return row;
  }

  function list(): JobRow[] {
    const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as JobRowRaw[];
    return rows.map(fromRaw);
  }

  function getOldestQueued(): JobRow | null {
    const raw = db
      .prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
      .get() as JobRowRaw | undefined;
    return raw ? fromRaw(raw) : null;
  }

  function markRunning(id: string): boolean {
    // Guarded on status = 'queued' so a job cancelled in the brief window
    // between the queue picking it up and this call (still marked 'queued'
    // in the DB at that point) doesn't get silently resurrected back to
    // 'running' by this unconditional-looking write.
    const result = db
      .prepare("UPDATE jobs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
      .run(now(), now(), id);
    return result.changes > 0;
  }

  function setComfyPromptId(id: string, comfyPromptId: string): void {
    db.prepare('UPDATE jobs SET comfy_prompt_id = ?, updated_at = ? WHERE id = ?').run(comfyPromptId, now(), id);
  }

  function updateProgress(id: string, progress: number): void {
    db.prepare('UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?').run(progress, now(), id);
  }

  function markDone(id: string, videoPath: string, thumbnailPath: string | null): void {
    db.prepare(
      "UPDATE jobs SET status = 'done', progress = 100, video_path = ?, thumbnail_path = ?, completed_at = ?, updated_at = ? WHERE id = ?"
    ).run(videoPath, thumbnailPath, now(), now(), id);
  }

  function markFailed(id: string, error: string): void {
    db.prepare("UPDATE jobs SET status = 'failed', error = ?, completed_at = ?, updated_at = ? WHERE id = ?").run(
      error,
      now(),
      now(),
      id
    );
  }

  function markCancelled(id: string): void {
    db.prepare("UPDATE jobs SET status = 'cancelled', completed_at = ?, updated_at = ? WHERE id = ?").run(
      now(),
      now(),
      id
    );
  }

  function requeue(id: string): void {
    db.prepare(
      "UPDATE jobs SET status = 'queued', progress = 0, comfy_prompt_id = NULL, started_at = NULL, updated_at = ? WHERE id = ?"
    ).run(now(), id);
  }

  function incrementRetryCount(id: string): number {
    db.prepare('UPDATE jobs SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?').run(now(), id);
    const row = getById(id);
    return row?.retryCount ?? 0;
  }

  function markAllRunningAsFailed(): void {
    db.prepare(
      "UPDATE jobs SET status = 'failed', error = 'Server restarted while this job was running.', completed_at = ?, updated_at = ? WHERE status = 'running'"
    ).run(now(), now());
  }

  function deleteJob(id: string): void {
    db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  }

  return {
    create,
    getById,
    list,
    getOldestQueued,
    markRunning,
    setComfyPromptId,
    updateProgress,
    markDone,
    markFailed,
    markCancelled,
    requeue,
    incrementRetryCount,
    markAllRunningAsFailed,
    delete: deleteJob,
  };
}
