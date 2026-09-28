import { Check } from 'lucide-react';
import { useRef } from 'react';
import type { JobRecord } from '@app/shared';
import { StatusBadge } from './StatusBadge.js';

interface GalleryCardProps {
  job: JobRecord;
  onOpen: () => void;
  /** When set, clicking the card toggles selection instead of opening the lightbox -- used by the "combine clips" flow. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

// Thumbnail-style card: static poster frame until hovered, then plays
// muted/looped in place -- the standard "creative gallery" pattern (Kling's
// "My Creatives", Midjourney's grid) rather than an always-playing feed.
export function GalleryCard({ job, onOpen, selectable, selected, onToggleSelect }: GalleryCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const duration = job.params.durationSeconds;

  return (
    <button
      onClick={selectable ? onToggleSelect : onOpen}
      onMouseEnter={() => videoRef.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const el = videoRef.current;
        if (el) {
          el.pause();
          el.currentTime = 0;
        }
      }}
      className={`group relative aspect-video overflow-hidden rounded-xl border bg-neutral-900 text-left shadow-md shadow-black/30 transition-colors ${
        selected ? 'border-blue-500' : 'border-neutral-800 hover:border-neutral-600'
      }`}
    >
      {job.videoUrl ? (
        <video ref={videoRef} src={job.videoUrl} muted loop playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-neutral-600">no video</div>
      )}

      <div className="absolute left-2 top-2">
        <StatusBadge status={job.status} />
      </div>

      {duration != null && (
        <div className="absolute bottom-2 right-2 z-10 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-neutral-200">
          {duration}s
        </div>
      )}

      {selectable && (
        <div
          className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
            selected ? 'border-blue-500 bg-blue-500 text-white' : 'border-white/40 bg-black/50 text-transparent'
          }`}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <p className="line-clamp-2 text-xs text-neutral-200">{job.params.prompt}</p>
      </div>
    </button>
  );
}
