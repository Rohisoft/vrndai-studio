import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { JobRecord } from '@app/shared';
import { ClipPicker } from '../components/ClipPicker.js';
import { useJobHistory } from '../hooks/useJobHistory.js';
import { api } from '../lib/api-client.js';

interface EditorLocationState {
  clips?: JobRecord[];
}

export function EditorPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { jobs } = useJobHistory();

  const [clips, setClips] = useState<JobRecord[]>((location.state as EditorLocationState | null)?.clips ?? []);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [combining, setCombining] = useState(false);

  const activeClip = clips[activeIndex] ?? null;
  const availableToAdd = jobs.filter((job) => job.videoUrl && !clips.some((clip) => clip.id === job.id));

  if (clips.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-neutral-500">
        <p>No clips in the timeline yet.</p>
        <Link to="/gallery" className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
          Go to My Creations and select clips
        </Link>
      </div>
    );
  }

  function removeClip(index: number) {
    setClips((current) => current.filter((_, i) => i !== index));
    setActiveIndex((current) => Math.min(current, clips.length - 2 < 0 ? 0 : clips.length - 2));
  }

  function addClip(job: JobRecord) {
    setClips((current) => [...current, job]);
    setShowPicker(false);
  }

  async function handleExport() {
    setCombining(true);
    try {
      const job = await api.post<{ id: string }>('/api/jobs/combine', { jobIds: clips.map((clip) => clip.id) });
      navigate(`/jobs/${job.id}`);
    } finally {
      setCombining(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6 lg:flex-row">
        {/* Main preview */}
        <div className="flex min-w-0 flex-1 items-center justify-center">
          {activeClip?.videoUrl && (
            <video
              key={activeClip.id}
              src={activeClip.videoUrl}
              controls
              autoPlay
              loop
              playsInline
              className="max-h-[60vh] w-full max-w-3xl rounded-xl border border-neutral-800 bg-black shadow-2xl shadow-black/50"
            />
          )}
        </div>

        {/* Side info panel */}
        <div className="w-full flex-none lg:w-72">
          {activeClip && (
            <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-lg shadow-black/30">
              <video src={activeClip.videoUrl!} muted loop autoPlay playsInline className="aspect-video w-full object-cover" />
              <div className="p-3">
                <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Clip {activeIndex + 1}</p>
                <p className="line-clamp-4 text-sm text-neutral-300">{activeClip.params.prompt}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="border-t border-neutral-800 bg-neutral-900/70 p-4 shadow-[0_-6px_24px_-8px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {clips.map((clip, index) => (
            <button
              key={clip.id}
              onClick={() => setActiveIndex(index)}
              className={`group relative h-16 w-28 flex-none overflow-hidden rounded-lg border transition-colors ${
                index === activeIndex ? 'border-blue-500' : 'border-neutral-800 hover:border-neutral-600'
              }`}
            >
              {clip.videoUrl && <video src={clip.videoUrl} muted className="h-full w-full object-cover" />}
              <span className="absolute bottom-0.5 right-1 rounded bg-black/60 px-1 text-[10px] text-white">{index + 1}</span>
              <span
                onClick={(event) => {
                  event.stopPropagation();
                  removeClip(index);
                }}
                className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white group-hover:flex"
                aria-label={`Remove clip ${index + 1}`}
              >
                <X className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
            </button>
          ))}
          <button
            onClick={() => setShowPicker(true)}
            className="flex h-16 w-16 flex-none items-center justify-center rounded-lg border border-dashed border-neutral-700 text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-300"
            aria-label="Add clip"
          >
            <Plus className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-neutral-500">
            {clips.length} clip{clips.length !== 1 ? 's' : ''} in this sequence
            {clips.length < 2 && ' -- add at least one more to combine'}
          </p>
          <button
            onClick={handleExport}
            disabled={clips.length < 2 || combining}
            className="rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {combining ? 'Combining…' : 'Combine & Export'}
          </button>
        </div>
      </div>

      {showPicker && <ClipPicker jobs={availableToAdd} onSelect={addClip} onClose={() => setShowPicker(false)} />}
    </div>
  );
}
