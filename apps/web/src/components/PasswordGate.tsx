import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const { status, loading, error, login } = useAuth();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading || !status) {
    return <div className="p-8 text-center text-neutral-500">Loading…</div>;
  }

  if (!status.passwordRequired || status.authenticated) {
    return <>{children}</>;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    await login(password);
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-6 shadow-2xl shadow-black/60">
        <h1 className="mb-4 text-lg font-semibold">Password required</h1>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={!password || submitting}
          className="mt-4 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {submitting ? 'Checking…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
