import { useEffect, useState } from 'react';
import type { JobRecord } from '@app/shared';
import { api } from '../lib/api-client.js';

export interface BackendStatus {
  /** null while the first check is still in flight. */
  connected: boolean | null;
  generating: boolean;
}

const POLL_INTERVAL_MS = 8000;

// Backs the sidebar's status card -- deliberately just Ready/Generating +
// Connected/Disconnected, no VRAM numbers: this app runs on RunPod
// Serverless, not a literal local GPU, so there's no real telemetry to show
// beyond what these two real signals already give us (the same
// /health/comfyui check Settings already had, and whether any job in
// GET /api/jobs is currently 'running').
export function useBackendStatus(): BackendStatus {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const health = await api.get<{ connected: boolean }>('/health/comfyui');
        if (!cancelled) {
          setConnected(health.connected);
        }
      } catch {
        if (!cancelled) {
          setConnected(false);
        }
      }

      try {
        const jobs = await api.get<JobRecord[]>('/api/jobs');
        if (!cancelled) {
          setGenerating(jobs.some((job) => job.status === 'running'));
        }
      } catch {
        // Transient fetch failure -- leave the last-known generating state alone.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { connected, generating };
}
