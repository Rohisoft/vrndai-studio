// One-time migration: reads every row out of the old SQLite jobs database
// (from before the MongoDB Atlas job-storage switch) and inserts it into
// MongoDB's `jobs` collection, preserving the original id and videoPath so
// existing video files on disk still resolve correctly. Safe to re-run --
// any id already present in Mongo is left untouched, not overwritten.
//
// Run with: npx tsx apps/api/scripts/migrate-jobs-to-mongo.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { MongoClient, type Document } from 'mongodb';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const SQLITE_PATH = path.join(REPO_ROOT, 'data/jobs.db');

interface SqliteRow {
  id: string;
  model_id: string;
  status: string;
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

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI not set -- check .env at the repo root.');
  }

  const raw = execFileSync('sqlite3', ['-json', SQLITE_PATH, 'SELECT * FROM jobs;'], {
    maxBuffer: 1024 * 1024 * 50,
  }).toString();
  const rows: SqliteRow[] = raw.trim() ? JSON.parse(raw) : [];
  console.log(`Read ${rows.length} rows from ${SQLITE_PATH}`);

  const client = new MongoClient(uri);
  await client.connect();
  const jobs = client.db().collection('jobs');

  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const existing = await jobs.findOne({ _id: row.id });
    if (existing) {
      skipped++;
      continue;
    }
    const doc: Document = {
      _id: row.id,
      modelId: row.model_id,
      status: row.status,
      prompt: row.prompt,
      negativePrompt: row.negative_prompt,
      params: JSON.parse(row.params_json),
      progress: row.progress,
      comfyPromptId: row.comfy_prompt_id,
      videoPath: row.video_path,
      thumbnailPath: row.thumbnail_path,
      error: row.error,
      retryCount: row.retry_count,
      sourceJobId: row.source_job_id,
      combinedFromJobIds: row.combined_from_job_ids ? JSON.parse(row.combined_from_job_ids) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
    await jobs.insertOne(doc);
    inserted++;
  }

  console.log(`Inserted ${inserted} job(s), skipped ${skipped} already present.`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
