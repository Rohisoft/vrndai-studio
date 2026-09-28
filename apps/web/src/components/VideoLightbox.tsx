import { ArrowRight, Download, RotateCw, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { JobRecord } from '@app/shared';
import { formatDuration } from '../lib/format-duration.js';
import { StatusBadge } from './StatusBadge.js';

interface ImageToVideoModelOption {
  id: string;
  label: string;
}

interface VideoLightboxProps {
  job: JobRecord;
  onClose: () => void;
  onDelete: () => void;
  onRerun: () => void;
  /** Models that can be used to continue this clip -- shown as a picker when there's more than one. */
  imageToVideoModels?: ImageToVideoModelOption[];
  /** frameTimeSeconds is wherever the video was paused/scrubbed to when clicked -- lets the user pick a moment with the right characters/composition in frame instead of always the last frame. */
  onContinue?: (modelId: string, frameTimeSeconds: number) => void;
}

export function VideoLightbox({ job, onClose, onDelete, onRerun, imageToVideoModels, onContinue }: VideoLightboxProps) {
  // Default to the clip's own model only when it's actually a valid
  // continuation target -- a combined reel's synthetic 'combined' modelId
  // never appears in imageToVideoModels, so fall back to the first real
  // image-to-video-capable model instead.
  const defaultContinueModelId = imageToVideoModels?.some((model) => model.id === job.params.modelId)
    ? job.params.modelId
    : (imageToVideoModels?.[0]?.id ?? job.params.modelId);
  const [continueModelId, setContinueModelId] = useState(defaultContinueModelId);
  const generationTime = formatDuration(job.startedAt, job.completedAt);
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl shadow-black/60 sm:flex-row"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl bg-black">
          {job.videoUrl && (
            <video ref={videoRef} src={job.videoUrl} controls autoPlay loop playsInline className="max-h-[70vh] w-full" />
          )}
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-56">
          <div className="flex items-center justify-between">
            <StatusBadge status={job.status} />
            <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300" aria-label="Close">
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <p className="text-sm text-neutral-300">{job.params.prompt}</p>
          <p className="text-xs text-neutral-500">
            {new Date(job.createdAt).toLocaleString()}
            {generationTime && <span> · Generated in {generationTime}</span>}
          </p>

          <div className="mt-auto flex flex-col gap-2">
            {job.videoUrl && (
              <a
                href={job.videoUrl}
                download
                className="flex items-center justify-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                <Download className="h-4 w-4" strokeWidth={2} /> Download
              </a>
            )}
            <button
              onClick={onRerun}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              <RotateCw className="h-4 w-4" strokeWidth={2} /> Re-run
            </button>
            {onContinue && (
              <div className="space-y-1.5">
                <p className="text-[11px] leading-snug text-neutral-500">
                  Pause the video where you want to continue from, then click Continue.
                </p>
                {imageToVideoModels && imageToVideoModels.length > 1 && (
                  <select
                    value={continueModelId}
                    onChange={(event) => setContinueModelId(event.target.value)}
                    className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-300"
                  >
                    {imageToVideoModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => onContinue(continueModelId, videoRef.current?.currentTime ?? 0)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
                >
                  Continue clip <ArrowRight className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            )}
            <button
              onClick={onDelete}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-red-900 px-3 py-2 text-sm text-red-400 hover:bg-red-950"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} /> Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
