import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, EnvSettingsInput, EnvSettingsView } from '@app/shared';
import { api } from '../lib/api-client.js';

interface SettingsView {
  env: EnvSettingsView;
  app: AppSettings;
}

export function useSettings() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await api.get<SettingsView>('/api/settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveApp = useCallback(async (next: AppSettings) => {
    setError(null);
    try {
      const updated = await api.post<AppSettings>('/api/settings/app', next);
      setSettings((prev) => (prev ? { ...prev, app: updated } : prev));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
      return false;
    }
  }, []);

  const saveEnv = useCallback(
    async (next: EnvSettingsInput) => {
      setError(null);
      try {
        await api.post('/api/settings/env', next);
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save.');
        return false;
      }
    },
    [refresh]
  );

  return { settings, loading, error, saveApp, saveEnv, refresh };
}
