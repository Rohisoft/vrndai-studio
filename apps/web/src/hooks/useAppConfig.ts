import { useEffect, useState } from 'react';
import type { PublicAppConfig } from '@app/shared';
import { api } from '../lib/api-client.js';

export function useAppConfig() {
  const [config, setConfig] = useState<PublicAppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<PublicAppConfig>('/api/config')
      .then(setConfig)
      .finally(() => setLoading(false));
  }, []);

  return { config, loading };
}
