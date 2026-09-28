import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { VideoLightbox } from '../components/VideoLightbox.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { useJobHistory } from '../hooks/useJobHistory.js';
import { api } from '../lib/api-client.js';
import { formatDuration } from '../lib/format-duration.js';

const PAGE_SIZE = 20;

export function HistoryPage() {
  const { jobs, loading, refresh } = useJobHistory();
  const { config } = useAppConfig();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [clearingFailed, setClearingFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const navigate = useNavigate();

  const openJob = jobs.find((job) => job.id === openId) ?? null;
  // Any finished clip (including combined reels, whose synthetic 'combined'
  // modelId never matches a real ModelConfig) can be continued as long as
  // some model in the current config supports image-to-video -- the model
  // that produced the clip is irrelevant, since continuation always picks a
  // target model explicitly (see VideoLightbox's model picker).
  const canContinue = config?.models.some((model) => model.supportsImageToVideo) ?? false;

  const filtered = useMemo(() => {
    if (!search.trim()) {
      return jobs;
    }
    const needle = search.trim().toLowerCase();
    return jobs.filter((job) => job.params.prompt.toLowerCase().includes(needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, search]);

  const failedCount = jobs.filter((job) => job.status === 'failed').length;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageJobs = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  function modelLabel(modelId: string) {
    return config?.models.find((model) => model.id === modelId)?.label ?? modelId;
  }

  async function handleDelete(id: string) {
    await api.del(`/api/jobs/${id}`);
    setPendingDelete(null);
    setOpenId(null);
    refresh();
  }

  async function handleCancel(id: string) {
    await api.post(`/api/jobs/${id}/cancel`);
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

  async function handleClearFailed() {
    setClearingFailed(true);
    try {
      const failed = jobs.filter((job) => job.status === 'failed');
      await Promise.all(failed.map((job) => api.del(`/api/jobs/${job.id}`)));
      refresh();
    } finally {
      setClearingFailed(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="mt-1 text-sm text-neutral-500">Every generation this studio has run, in one place.</p>
        </div>
        {failedCount > 0 && (
          <button
            onClick={handleClearFailed}
            disabled={clearingFailed}
            className="flex-none rounded-lg border border-red-900 px-3 py-2 text-sm text-red-400 hover:bg-red-950 disabled:opacity-40"
          >
            {clearingFailed ? 'Clearing…' : `Clear failed runs (${failedCount})`}
          </button>
        )}
      </div>

      {jobs.length > 0 && (
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="Search by prompt…"
            className="w-64 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-neutral-500">No generations yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-neutral-500">No runs match your search.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-neutral-800 shadow-lg shadow-black/30">
            {/* table-fixed + explicit column widths -- without this, the
                auto-layout algorithm sizes the Prompt column off the full
                unwrapped prompt text (truncate can't stop that on its own,
                since it only kicks in once a width is already set), and long
                prompts blow out the table width until columns/rows overlap. */}
            <table className="w-full min-w-[900px] table-fixed text-left text-sm">
              <thead className="bg-neutral-800 text-xs uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="w-20 px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Prompt</th>
                  <th className="w-52 px-3 py-2 font-medium">Model</th>
                  <th className="w-20 px-3 py-2 font-medium">Length</th>
                  <th className="w-40 px-3 py-2 font-medium">Started</th>
                  <th className="w-44 px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {pageJobs.map((job) => {
                  const busy = job.status === 'queued' || job.status === 'running';
                  const generationTime = formatDuration(job.startedAt, job.completedAt);
                  return (
                    <tr key={job.id} className="bg-neutral-950 hover:bg-neutral-900/60">
                      <td className="px-3 py-2 align-top">
                        <StatusBadge status={job.status} />
                        {busy && <div className="mt-1 text-xs text-neutral-500">{job.progress}%</div>}
                      </td>
                      <td className="min-w-0 px-3 py-2 align-top">
                        <button
                          onClick={() => job.videoUrl && setOpenId(job.id)}
                          disabled={!job.videoUrl}
                          className="block w-full truncate text-left text-neutral-200 hover:underline disabled:no-underline disabled:text-neutral-400"
                          title={job.params.prompt}
                        >
                          {job.params.prompt}
                        </button>
                        {job.error && (
                          <p className="mt-1 truncate text-xs text-red-400" title={job.error}>
                            {job.error}
                          </p>
                        )}
                      </td>
                      <td className="min-w-0 px-3 py-2 align-top text-neutral-400">
                        <span className="block truncate" title={modelLabel(job.params.modelId)}>
                          {modelLabel(job.params.modelId)}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top text-neutral-400">
                        {job.params.durationSeconds}s
                        {generationTime && <div className="text-xs text-neutral-600">took {generationTime}</div>}
                      </td>
                      <td className="px-3 py-2 align-top text-neutral-400">{new Date(job.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-none flex-wrap gap-1.5">
                          {busy ? (
                            <button
                              onClick={() => handleCancel(job.id)}
                              className="rounded-lg border border-red-900 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
                            >
                              Cancel
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRerun(job.id)}
                              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
                            >
                              {job.status === 'failed' ? 'Retry' : 'Re-run'}
                            </button>
                          )}
                          <button
                            onClick={() => setPendingDelete(job.id)}
                            className="rounded-lg border border-red-900 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
              <span>
                Page {currentPage + 1} of {pageCount}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-30"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={currentPage >= pageCount - 1}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {openJob && (
        <VideoLightbox
          job={openJob}
          onClose={() => setOpenId(null)}
          onDelete={() => handleDelete(openJob.id)}
          onRerun={() => handleRerun(openJob.id)}
          imageToVideoModels={config?.models.filter((model) => model.supportsImageToVideo)}
          onContinue={canContinue ? (modelId, frameTimeSeconds) => handleContinue(openJob.id, modelId, frameTimeSeconds) : undefined}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          message="Delete this generation? This can't be undone."
          onConfirm={() => handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
