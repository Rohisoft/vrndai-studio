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

export interface JobStore {
  create(input: CreateJobInput): JobRow;
  getById(id: string): JobRow | null;
  list(): JobRow[];
  getOldestQueued(): JobRow | null;
  /** Returns false (no-op) if the job wasn't still 'queued' -- e.g. it was cancelled in the gap between being picked up and this call. */
  markRunning(id: string): boolean;
  setComfyPromptId(id: string, comfyPromptId: string): void;
  updateProgress(id: string, progress: number): void;
  markDone(id: string, videoPath: string, thumbnailPath: string | null): void;
  markFailed(id: string, error: string): void;
  markCancelled(id: string): void;
  /** Resets a failed attempt back to 'queued' so the worker picks it up again. */
  requeue(id: string): void;
  incrementRetryCount(id: string): number;
  markAllRunningAsFailed(): void;
  delete(id: string): void;
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
