import type { Db } from 'mongodb';
import type { CreateJobInput, JobRow, JobStore } from './job-store.js';

// Mongo document shape mirrors JobRow exactly, except `_id` takes the place
// of `id` (Mongo's own primary key convention) -- every other field is
// stored as-is, including `params` as a native nested document instead of
// JSON-stringified text (no serialize/parse step needed, unlike SQLite).
interface JobDoc extends Omit<JobRow, 'id'> {
  _id: string;
}

function fromDoc(doc: JobDoc): JobRow {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

export async function createMongoJobStore(db: Db): Promise<JobStore> {
  const jobs = db.collection<JobDoc>('jobs');
  // Mirrors SQLite's idx_jobs_status_created -- getOldestQueued() below
  // filters on status and sorts by createdAt.
  await jobs.createIndex({ status: 1, createdAt: 1 });

  function now(): string {
    return new Date().toISOString();
  }

  async function getById(id: string): Promise<JobRow | null> {
    const doc = await jobs.findOne({ _id: id });
    return doc ? fromDoc(doc) : null;
  }

  async function create(input: CreateJobInput): Promise<JobRow> {
    const timestamp = now();
    const doc: JobDoc = {
      _id: input.id,
      modelId: input.modelId,
      status: 'queued',
      prompt: input.params.prompt,
      negativePrompt: input.params.negativePrompt ?? null,
      params: input.params,
      progress: 0,
      comfyPromptId: null,
      videoPath: null,
      thumbnailPath: null,
      error: null,
      retryCount: 0,
      sourceJobId: input.sourceJobId ?? null,
      combinedFromJobIds: input.combinedFromJobIds ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
    };
    await jobs.insertOne(doc);
    return fromDoc(doc);
  }

  async function list(): Promise<JobRow[]> {
    const docs = await jobs.find().sort({ createdAt: -1 }).toArray();
    return docs.map(fromDoc);
  }

  async function getOldestQueued(): Promise<JobRow | null> {
    const doc = await jobs.find({ status: 'queued' }).sort({ createdAt: 1 }).limit(1).next();
    return doc ? fromDoc(doc as JobDoc) : null;
  }

  async function markRunning(id: string): Promise<boolean> {
    // Guarded on status = 'queued' so a job cancelled in the brief window
    // between the queue picking it up and this call doesn't get silently
    // resurrected back to 'running' by this unconditional-looking write.
    const result = await jobs.updateOne(
      { _id: id, status: 'queued' },
      { $set: { status: 'running', startedAt: now(), updatedAt: now() } }
    );
    return result.modifiedCount > 0;
  }

  async function setComfyPromptId(id: string, comfyPromptId: string): Promise<void> {
    await jobs.updateOne({ _id: id }, { $set: { comfyPromptId, updatedAt: now() } });
  }

  async function updateProgress(id: string, progress: number): Promise<void> {
    await jobs.updateOne({ _id: id }, { $set: { progress, updatedAt: now() } });
  }

  async function markDone(id: string, videoPath: string, thumbnailPath: string | null): Promise<void> {
    await jobs.updateOne(
      { _id: id },
      { $set: { status: 'done', progress: 100, videoPath, thumbnailPath, completedAt: now(), updatedAt: now() } }
    );
  }

  async function markFailed(id: string, error: string): Promise<void> {
    await jobs.updateOne({ _id: id }, { $set: { status: 'failed', error, completedAt: now(), updatedAt: now() } });
  }

  async function markCancelled(id: string): Promise<void> {
    await jobs.updateOne({ _id: id }, { $set: { status: 'cancelled', completedAt: now(), updatedAt: now() } });
  }

  async function requeue(id: string): Promise<void> {
    await jobs.updateOne(
      { _id: id },
      { $set: { status: 'queued', progress: 0, comfyPromptId: null, startedAt: null, updatedAt: now() } }
    );
  }

  async function incrementRetryCount(id: string): Promise<number> {
    const result = await jobs.findOneAndUpdate(
      { _id: id },
      { $inc: { retryCount: 1 }, $set: { updatedAt: now() } },
      { returnDocument: 'after' }
    );
    return result?.retryCount ?? 0;
  }

  async function markAllRunningAsFailed(): Promise<void> {
    await jobs.updateMany(
      { status: 'running' },
      { $set: { status: 'failed', error: 'Server restarted while this job was running.', completedAt: now(), updatedAt: now() } }
    );
  }

  async function deleteJob(id: string): Promise<void> {
    await jobs.deleteOne({ _id: id });
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
