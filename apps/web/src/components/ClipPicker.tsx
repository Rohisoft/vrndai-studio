import { X } from 'lucide-react';
import type { JobRecord } from '@app/shared';
import { GalleryCard } from './GalleryCard.js';

interface ClipPickerProps {
  jobs: JobRecord[];
  onSelect: (job: JobRecord) => void;
  onClose: () => void;
}

export function ClipPicker({ jobs, onSelect, onClose }: ClipPickerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Add a clip to the timeline</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300" aria-label="Close">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {jobs.length === 0 ? (
          <p className="text-sm text-neutral-500">No other finished clips available to add.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {jobs.map((job) => (
              <GalleryCard key={job.id} job={job} onOpen={() => onSelect(job)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
