import { Clapperboard, Download, History } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { GalleryCard } from '../components/GalleryCard.js';
import { GenerateForm } from '../components/GenerateForm.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { VideoLightbox } from '../components/VideoLightbox.js';
import { VideoPlayer } from '../components/VideoPlayer.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { useJobHistory } from '../hooks/useJobHistory.js';
import { useLocalFlag } from '../hooks/useLocalFlag.js';
import { useMultiJobEvents } from '../hooks/useMultiJobEvents.js';
import { formatDuration } from '../lib/format-duration.js';
import { api } from '../lib/api-client.js';

interface GeneratePageLocationState {
  continueFrom?: { sourceImage: string; modelId: string };
  /** Set by the Assistant page's "Use in Create →" hand-off. */
  prefillPrompt?: string;
  prefillModelId?: string;
}

export function GeneratePage() {
  const { id: routeJobId } = useParams<{ id?: string }>();
  const location = useLocation();
  const continueFrom = (location.state as GeneratePageLocationState | null)?.continueFrom;
  const prefillPrompt = (location.state as GeneratePageLocationState | null)?.prefillPrompt;
  const prefillModelId = (location.state as GeneratePageLocationState | null)?.prefillModelId;
  const { config, loading } = useAppConfig();
  // Every job submitted this session, oldest first -- lets the Create page
  // show a live queue of everything in flight instead of only the single
  // most recently submitted job. Seeded from the route id (the /jobs/:id
  // deep link) when present.
  const [activeJobIds, setActiveJobIds] = useState<string[]>(routeJobId ? [routeJobId] : []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [recentOpenId, setRecentOpenId] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [openVideosOnFinish] = useLocalFlag('openVideosOnFinish', false);

  const { jobsById, connectionErrorsById } = useMultiJobEvents(activeJobIds);
  const { jobs: recentJobs, refresh: refreshRecent } = useJobHistory();

  // Recovers any job still queued/running on the backend that this page
  // isn't already watching -- e.g. the user navigated to History/My
  // Creations and back (this page unmounts, losing activeJobIds entirely),
  // or just refreshed the tab. Without this, a still-in-progress job
  // silently disappears from the Preview/Queue panels even though it's
  // still running server-side.
  useEffect(() => {
    const inFlightIds = recentJobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.id);
    if (inFlightIds.length === 0) return;
    setActiveJobIds((ids) => {
      const missing = inFlightIds.filter((id) => !ids.includes(id));
      return missing.length > 0 ? [...ids, ...missing] : ids;
    });
  }, [recentJobs]);

  // "Open videos when they finish" (Settings > General) -- brings the
  // Preview panel into view the moment the most recent job completes,
  // rather than leaving the user to notice it on their own.
  const latestJobId = activeJobIds[activeJobIds.length - 1];
  const latestJobStatus = latestJobId ? jobsById[latestJobId]?.status : undefined;
  useEffect(() => {
    if (openVideosOnFinish && latestJobStatus === 'done') {
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [openVideosOnFinish, latestJobStatus]);

  if (loading) {
    return <p className="p-6 text-neutral-500">Loading…</p>;
  }
  if (!config) {
    return <p className="p-6 text-red-400">Couldn't load configuration from the server.</p>;
  }

  async function handleSubmit(request: unknown) {
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.post<{ id: string }>('/api/generate', request);
      // Appended, not replaced -- lets multiple submissions queue up and
      // all stay visible rather than the newest one hiding the last.
      setActiveJobIds((ids) => [...ids, created.id]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start generation.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(jobId: string) {
    setCancellingId(jobId);
    try {
      await api.post(`/api/jobs/${jobId}/cancel`);
    } finally {
      setCancellingId(null);
    }
  }

  async function handleRerun(id: string) {
    const created = await api.post<{ id: string }>(`/api/jobs/${id}/rerun`);
    setActiveJobIds((ids) => [...ids, created.id]);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleDelete(id: string) {
    await api.del(`/api/jobs/${id}`);
    setRecentOpenId(null);
    refreshRecent();
  }

  // Oldest first, so new submissions append at the bottom of the queue list
  // in the order they were made. The Preview panel highlights whichever one
  // was submitted most recently.
  const queuedJobs = activeJobIds.map((id) => jobsById[id]).filter((j): j is NonNullable<typeof j> => Boolean(j));
  const latestJob = queuedJobs[queuedJobs.length - 1] ?? null;
  const latestBusy = latestJob?.status === 'queued' || latestJob?.status === 'running';
  const videos = recentJobs.filter((j) => j.videoUrl && (!modelFilter || j.params.modelId === modelFilter));
  const openJob = videos.find((j) => j.id === recentOpenId) ?? null;
  const latestJobModelLabel = latestJob
    ? (config.models.find((m) => m.id === latestJob.params.modelId)?.label ?? latestJob.params.modelId)
    : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-900 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Create a video</h1>
          <p className="mt-1 text-sm text-neutral-500">Turn a prompt into a short clip.</p>
        </div>
        <Link
          to="/history"
          className="flex flex-none items-center gap-1.5 rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:border-neutral-600"
        >
          <History className="h-4 w-4" strokeWidth={2} /> View history
        </Link>
      </div>

      {/* Create workspace -- capped width so the preview pane doesn't turn into
          an arbitrarily large empty void on wide screens */}
      <div ref={formRef} className="mx-auto flex max-w-5xl flex-col lg:flex-row">
        <div className="w-full flex-none p-6 lg:w-[420px]">
          <GenerateForm
            config={config}
            disabled={submitting}
            onSubmit={handleSubmit}
            initialModelId={continueFrom?.modelId ?? prefillModelId}
            initialSourceImage={continueFrom?.sourceImage}
            initialPrompt={prefillPrompt}
          />
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
          {/* Preview -- the most recently submitted job. Lifted a shade
              lighter than the surrounding cards since it's the primary
              focal point of the page. */}
          <div ref={previewRef} className="rounded-2xl border border-neutral-700 bg-neutral-800 shadow-lg shadow-black/30">
            <div className="flex items-center justify-between border-b border-neutral-700 px-4 py-3">
              <span className="text-sm font-semibold text-neutral-300">Preview</span>
              {latestJob && <span className="text-xs text-neutral-500">{latestJobModelLabel}</span>}
            </div>
            <div className="p-4">
              {!latestJob && (
                <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-700 text-center text-neutral-600">
                  <Clapperboard className="h-9 w-9" strokeWidth={1.5} />
                  <p className="text-sm">Your video will appear here</p>
                  <p className="text-xs text-neutral-700">Pick a model, describe a scene, then press Generate.</p>
                </div>
              )}
              {latestJob && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <StatusBadge status={latestJob.status} />
                    {latestBusy && (
                      <button
                        onClick={() => handleCancel(latestJob.id)}
                        disabled={cancellingId === latestJob.id}
                        className="rounded-md border border-red-900 px-3 py-1 text-xs text-red-400 hover:bg-red-950 disabled:opacity-40"
                      >
                        {cancellingId === latestJob.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}
                  </div>
                  {latestBusy && (
                    <div className="space-y-2">
                      <ProgressBar percent={latestJob.progress} />
                      <span className="text-xs text-neutral-500">{latestJob.progress}%</span>
                    </div>
                  )}
                  {latestJob.status === 'failed' && latestJob.error && (
                    <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{latestJob.error}</p>
                  )}
                  {latestJob.videoUrl && <VideoPlayer src={latestJob.videoUrl} />}
                </div>
              )}
            </div>
            {latestJob?.videoUrl && (
              <div className="flex items-center justify-end gap-2 border-t border-neutral-700 px-4 py-3">
                <a
                  href={latestJob.videoUrl}
                  download
                  className="flex items-center gap-1 rounded-lg border border-neutral-600 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={2} /> Download
                </a>
                <Link to="/gallery" className="rounded-lg border border-neutral-600 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700">
                  Open in My Creations
                </Link>
              </div>
            )}
          </div>

          {/* Queue -- every job submitted this session, compact status only */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 shadow-lg shadow-black/30">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <span className="text-sm font-semibold text-neutral-300">Queue</span>
              <span className="text-xs text-neutral-500">
                {queuedJobs.length === 0 ? 'No runs in progress' : `${queuedJobs.length} job${queuedJobs.length !== 1 ? 's' : ''} this session`}
              </span>
            </div>
            {queuedJobs.length > 0 && (
              <div className="divide-y divide-neutral-800">
                {queuedJobs.map((job) => {
                  const busy = job.status === 'queued' || job.status === 'running';
                  const generationTime = formatDuration(job.startedAt, job.completedAt);
                  return (
                    <div key={job.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-neutral-300">{job.params.prompt}</p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                          <StatusBadge status={job.status} />
                          {busy && <span>{job.progress}%</span>}
                          {generationTime && <span>{generationTime}</span>}
                          {connectionErrorsById[job.id] && <span className="text-amber-400">Live updates disconnected</span>}
                        </div>
                      </div>
                      {busy && (
                        <button
                          onClick={() => handleCancel(job.id)}
                          disabled={cancellingId === job.id}
                          className="flex-none rounded-md border border-red-900 px-3 py-1 text-xs text-red-400 hover:bg-red-950 disabled:opacity-40"
                        >
                          {cancellingId === job.id ? 'Cancelling…' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent creations */}
      {videos.length > 0 && (
        <div className="border-t border-neutral-900 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Recent creations</h2>
              <p className="text-sm text-neutral-500">Your last generations from this studio.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1 rounded-full border border-neutral-800 bg-neutral-900 p-1">
                <button
                  onClick={() => setModelFilter(null)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    modelFilter === null ? 'bg-white text-black' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  All
                </button>
                {config.models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => setModelFilter(model.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      modelFilter === model.id ? 'bg-white text-black' : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {model.label}
                  </button>
                ))}
              </div>
              <Link to="/gallery" className="text-sm text-blue-400 hover:underline">
                See all
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {videos.slice(0, 10).map((recentJob) => (
              <GalleryCard key={recentJob.id} job={recentJob} onOpen={() => setRecentOpenId(recentJob.id)} />
            ))}
          </div>
        </div>
      )}

      {openJob && (
        <VideoLightbox
          job={openJob}
          onClose={() => setRecentOpenId(null)}
          onDelete={() => handleDelete(openJob.id)}
          onRerun={() => handleRerun(openJob.id)}
        />
      )}
    </div>
  );
}
