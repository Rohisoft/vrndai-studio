import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function createJobWorkDir(jobId: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = path.join(os.tmpdir(), `stockvideo-${jobId}-${randomUUID().slice(0, 8)}`);
  await fsp.mkdir(dir, { recursive: true });
  return { dir, cleanup: () => fsp.rm(dir, { recursive: true, force: true }) };
}
