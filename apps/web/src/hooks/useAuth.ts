import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api-client.js';

interface AuthStatus {
  passwordRequired: boolean;
  authenticated: boolean;
}

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await api.get<AuthStatus>('/api/auth/status'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (password: string) => {
      setError(null);
      try {
        await api.post('/api/auth/login', { password });
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed.');
        return false;
      }
    },
    [refresh]
  );

  return { status, loading, error, login };
}
