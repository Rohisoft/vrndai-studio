import type { JobStatus } from '@app/shared';

const STYLES: Record<JobStatus, string> = {
  queued: 'bg-amber-900/40 text-amber-300 border-amber-700',
  running: 'bg-blue-900/40 text-blue-300 border-blue-700',
  done: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  failed: 'bg-red-900/40 text-red-300 border-red-700',
  cancelled: 'bg-neutral-800 text-neutral-400 border-neutral-700',
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ${STYLES[status]}`}>
      {status}
    </span>
  );
}
