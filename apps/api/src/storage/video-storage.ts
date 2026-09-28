export interface VideoStorage {
  /** Saves bytes under a unique filename derived from jobId, returns the full local path. */
  saveVideo(jobId: string, bytes: Buffer): Promise<string>;
  readVideo(filename: string): Promise<Buffer>;
  getVideoPath(filename: string): string;
  videoExists(filename: string): boolean;
  deleteVideo(filename: string): Promise<void>;
  listVideos(): Promise<{ filename: string; sizeBytes: number; createdAt: Date }[]>;
}
