export interface VideoStorage {
  /** Saves bytes as a new video for a job, returns the storage key persisted as job.videoPath. */
  saveVideo(jobId: string, bytes: Buffer): Promise<string>;
  /**
   * Resolves a stored video to a real local file for ffmpeg to read directly
   * (frame-extract.ts, combine.ts). MUST call cleanup() when done -- for
   * local storage this is a no-op (the file already lives on disk), for a
   * remote backend it deletes the downloaded temp copy.
   */
  getLocalFile(key: string): Promise<{ path: string; cleanup: () => Promise<void> }>;
  /** null when the video doesn't exist. */
  getVideoMeta(key: string): Promise<{ sizeBytes: number } | null>;
  /** Streams a video's bytes for the HTTP response -- range is an already-validated, fully-resolved byte range (see routes/videos.ts). */
  streamVideo(key: string, range?: { start: number; end: number }): Promise<NodeJS.ReadableStream>;
  deleteVideo(key: string): Promise<void>;
}
