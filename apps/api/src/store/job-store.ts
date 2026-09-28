import path from 'node:path';
import type { GenerationRequest, JobRecord, JobStatus } from '@app/shared';

// Internal row shape -- includes fields the client never sees (comfyPromptId,
// retryCount) alongside everything JobRecord has. toJobRecord() strips those
// and turns a raw file path into a servable URL.
export interface JobRow {
  id: string;
  modelId: string;
  status: JobStatus;
  prompt: string;
  negativePrompt: string | null;
  params: GenerationRequest;
  progress: number;
  comfyPromptId: string | null;
  videoPath: string | null;
  thumbnailPath: string | null;
  error: string | null;
  retryCount: number;
  sourceJobId: string | null;
  combinedFromJobIds: string[] | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CreateJobInput {
  id: string;
  modelId: string;
  params: GenerationRequest;
  sourceJobId?: string | null;
  combinedFromJobIds?: string[] | null;
}

// All async -- backed by MongoDB (see mongo-job-store.ts), not the
// synchronous better-sqlite3 API this interface originally shadowed. Every
// call site is already inside an async function (route handlers, the
// worker/queue loop, boot/cleanup code), so this is a mechanical
// s/foo()/await foo()/ everywhere it's called.
export interface JobStore {
  create(input: CreateJobInput): Promise<JobRow>;
  getById(id: string): Promise<JobRow | null>;
  list(): Promise<JobRow[]>;
  getOldestQueued(): Promise<JobRow | null>;
  /** Resolves false (no-op) if the job wasn't still 'queued' -- e.g. it was cancelled in the gap between being picked up and this call. */
  markRunning(id: string): Promise<boolean>;
  setComfyPromptId(id: string, comfyPromptId: string): Promise<void>;
  updateProgress(id: string, progress: number): Promise<void>;
  markDone(id: string, videoPath: string, thumbnailPath: string | null): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  markCancelled(id: string): Promise<void>;
  /** Resets a failed attempt back to 'queued' so the worker picks it up again. */
  requeue(id: string): Promise<void>;
  incrementRetryCount(id: string): Promise<number>;
  markAllRunningAsFailed(): Promise<void>;
  delete(id: string): Promise<void>;
}

export function toJobRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    status: row.status,
    params: row.params,
    progress: row.progress,
    videoUrl: row.videoPath ? `/api/videos/${path.basename(row.videoPath)}` : null,
    thumbnailUrl: row.thumbnailPath ? `/api/videos/${path.basename(row.thumbnailPath)}` : null,
    error: row.error,
    sourceJobId: row.sourceJobId,
    combinedFromJobIds: row.combinedFromJobIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}
