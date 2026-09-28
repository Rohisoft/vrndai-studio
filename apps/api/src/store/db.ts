import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

export function openDatabase(dataDir: string): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'jobs.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
      prompt TEXT NOT NULL,
      negative_prompt TEXT,
      params_json TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      comfy_prompt_id TEXT,
      video_path TEXT,
      thumbnail_path TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      source_job_id TEXT,
      combined_from_job_ids TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
  `);

  // CREATE TABLE IF NOT EXISTS above only applies to brand-new databases --
  // an existing jobs.db from before this column was added needs it patched
  // in. SQLite has no "ADD COLUMN IF NOT EXISTS", so check first.
  const columns = db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[];
  if (!columns.some((col) => col.name === 'combined_from_job_ids')) {
    db.exec('ALTER TABLE jobs ADD COLUMN combined_from_job_ids TEXT');
  }

  return db;
}
