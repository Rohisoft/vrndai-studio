import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { JobRecord } from '@app/shared';
import { GalleryCard } from '../components/GalleryCard.js';
import { VideoLightbox } from '../components/VideoLightbox.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { useJobHistory } from '../hooks/useJobHistory.js';
import { api } from '../lib/api-client.js';

type SortOrder = 'newest' | 'oldest';

export function GalleryPage() {
  const { jobs, loading, refresh } = useJobHistory();
  const { config } = useAppConfig();
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOrder>('newest');
  const navigate = useNavigate();

  const allVideos = jobs.filter((job) => job.videoUrl);

  const videos = useMemo(() => {
    let result = allVideos;
    if (modelFilter) {
      result = result.filter((job) => job.params.modelId === modelFilter);
    }
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      result = result.filter((job) => job.params.prompt.toLowerCase().includes(needle));
    }
    return [...result].sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sort === 'newest' ? -diff : diff;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVideos, modelFilter, search, sort]);

  const openJob = allVideos.find((job) => job.id === openId) ?? null;

  // Any finished clip (including combined reels, whose synthetic 'combined'
  // modelId never matches a real ModelConfig) can be continued as long as
  // some model in the current config supports image-to-video -- the model
  // that produced the clip is irrelevant, since continuation always picks a
  // target model explicitly (see VideoLightbox's model picker).
  const hasImageToVideoModel = config?.models.some((model) => model.supportsImageToVideo) ?? false;

  async function handleDelete(id: string) {
    await api.del(`/api/jobs/${id}`);
    setOpenId(null);
    refresh();
  }

  async function handleRerun(id: string) {
    const job = await api.post<{ id: string }>(`/api/jobs/${id}/rerun`);
    navigate(`/jobs/${job.id}`);
  }

  async function handleContinue(id: string, modelId: string, frameTimeSeconds: number) {
    const result = await api.post<{ sourceImage: string; modelId: string; sourceJobId: string }>(`/api/jobs/${id}/continue`, {
      modelId,
      frameTimeSeconds,
    });
    navigate('/', { state: { continueFrom: { sourceImage: result.sourceImage, modelId: result.modelId } } });
  }

  function toggleSelectMode() {
    setSelectMode((current) => !current);
    setSelectedIds([]);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id]));
  }

  function openInEditor() {
    const selectedClips = selectedIds.map((id) => allVideos.find((job) => job.id === id)).filter((job): job is JobRecord => Boolean(job));
    setSelectMode(false);
    setSelectedIds([]);
    navigate('/editor', { state: { clips: selectedClips } });
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Creations</h1>
          <p className="mt-1 text-sm text-neutral-500">Every finished clip, ready to watch, download or reuse. {allVideos.length} clips</p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {allVideos.length > 1 && (
            <>
              {selectMode && selectedIds.length >= 1 && (
                <button
                  onClick={openInEditor}
                  className="rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-1.5 text-sm font-medium text-white"
                >
                  Edit in Timeline ({selectedIds.length})
                </button>
              )}
              <button
                onClick={toggleSelectMode}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                  selectMode ? 'border-white bg-white text-black' : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
                }`}
              >
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            </>
          )}
          <Link to="/" className="rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-1.5 text-sm font-medium text-white">
            + New video
          </Link>
        </div>
      </div>

      {allVideos.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-lg shadow-black/30">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by prompt…"
            className="w-64 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />
          <div className="flex gap-1 rounded-full border border-neutral-700 bg-neutral-800 p-1">
            <button
              onClick={() => setModelFilter(null)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                modelFilter === null ? 'bg-white text-black' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              All
            </button>
            {config?.models.map((model) => (
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
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortOrder)}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-300"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500">Loading…</p>
      ) : allVideos.length === 0 ? (
        <p className="text-neutral-500">No generations yet -- head to Create to make your first video.</p>
      ) : videos.length === 0 ? (
        <p className="text-neutral-500">No clips match your search.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {videos.map((job) => (
            <GalleryCard
              key={job.id}
              job={job}
              onOpen={() => setOpenId(job.id)}
              selectable={selectMode}
              selected={selectedIds.includes(job.id)}
              onToggleSelect={() => toggleSelected(job.id)}
            />
          ))}
        </div>
      )}

      {openJob && (
        <VideoLightbox
          job={openJob}
          onClose={() => setOpenId(null)}
          onDelete={() => handleDelete(openJob.id)}
          onRerun={() => handleRerun(openJob.id)}
          imageToVideoModels={config?.models.filter((model) => model.supportsImageToVideo)}
          onContinue={
            hasImageToVideoModel ? (modelId, frameTimeSeconds) => handleContinue(openJob.id, modelId, frameTimeSeconds) : undefined
          }
        />
      )}
    </div>
  );
}
