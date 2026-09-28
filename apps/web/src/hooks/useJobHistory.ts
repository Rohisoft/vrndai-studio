import { useCallback, useEffect, useState } from 'react';
import type { JobRecord } from '@app/shared';
import { api } from '../lib/api-client.js';

export function useJobHistory() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setJobs(await api.get<JobRecord[]>('/api/jobs'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { jobs, loading, refresh };
}
