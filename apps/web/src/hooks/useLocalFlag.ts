import { useCallback, useState } from 'react';

// A frontend-only preference persisted to localStorage -- no backend field
// exists or is needed for something this purely presentational.
export function useLocalFlag(key: string, defaultValue: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? defaultValue : raw === 'true';
    } catch {
      return defaultValue;
    }
  });

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        /* ignore -- preference just won't persist across reloads */
      }
    },
    [key]
  );

  return [value, update];
}
