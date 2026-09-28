import { useEffect, useState } from 'react';
import type { AppSettings, EnvSettingsInput, EnvSettingsView, ResolutionPreset } from '@app/shared';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { useLocalFlag } from '../hooks/useLocalFlag.js';
import { useSettings } from '../hooks/useSettings.js';
import { api } from '../lib/api-client.js';

interface ComfyHealth {
  connected: boolean;
  mock: boolean;
}

type TabId = 'general' | 'generation' | 'backend' | 'models';

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'generation', label: 'Generation defaults' },
  { id: 'backend', label: 'Backend & performance' },
  { id: 'models', label: 'Models' },
];

export function SettingsPage() {
  const { settings, loading, error, saveApp, saveEnv } = useSettings();
  const { config } = useAppConfig();
  const [health, setHealth] = useState<ComfyHealth | null>(null);
  const [tab, setTab] = useState<TabId>('general');

  useEffect(() => {
    api.get<ComfyHealth>('/health/comfyui').then(setHealth).catch(() => setHealth(null));
  }, []);

  // Shared drafts so a field edited on one tab is never lost by saving from
  // another -- both tabs that touch AppSettings (General, Generation
  // defaults) share one draft, and both tabs that touch env vars (General's
  // data directory, Backend & performance) share the other. Only one tab is
  // ever mounted at a time, so the save/notice state below is safe to share.
  const [appDraft, setAppDraft] = useState<AppSettings | null>(null);
  const [envDraft, setEnvDraft] = useState<EnvSettingsInput | null>(null);
  const [comfyuiAuthToken, setComfyuiAuthToken] = useState('');
  const [savingApp, setSavingApp] = useState(false);
  const [savedApp, setSavedApp] = useState(false);
  const [savingEnv, setSavingEnv] = useState(false);
  const [savedEnv, setSavedEnv] = useState(false);

  useEffect(() => {
    if (settings && !appDraft) {
      setAppDraft(settings.app);
    }
    if (settings && !envDraft) {
      setEnvDraft({
        comfyuiBaseUrl: settings.env.comfyuiBaseUrl,
        comfyuiMock: settings.env.comfyuiMock,
        port: settings.env.port,
        dataDir: settings.env.dataDir,
      });
    }
  }, [settings, appDraft, envDraft]);

  if (loading || !settings || !appDraft || !envDraft) {
    return <p className="p-6 text-neutral-500">Loading…</p>;
  }

  function updateApp<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setAppDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateResolution(index: number, patch: Partial<ResolutionPreset>) {
    setAppDraft((prev) =>
      prev
        ? { ...prev, allowedResolutions: prev.allowedResolutions.map((preset, i) => (i === index ? { ...preset, ...patch } : preset)) }
        : prev
    );
  }

  function updateEnv<K extends keyof EnvSettingsInput>(key: K, value: EnvSettingsInput[K]) {
    setEnvDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSaveApp(event: React.FormEvent) {
    event.preventDefault();
    if (!appDraft) return;
    setSavingApp(true);
    setSavedApp(false);
    const ok = await saveApp(appDraft);
    setSavingApp(false);
    setSavedApp(ok);
  }

  async function handleSaveEnv(event: React.FormEvent) {
    event.preventDefault();
    if (!envDraft) return;
    setSavingEnv(true);
    setSavedEnv(false);
    const ok = await saveEnv({
      ...envDraft,
      // Omit entirely when left blank so the current secret is kept --
      // see EnvSettingsInputSchema's comment on this.
      ...(comfyuiAuthToken ? { comfyuiAuthToken } : {}),
    });
    setSavingEnv(false);
    if (ok) {
      setComfyuiAuthToken('');
      setSavedEnv(true);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-neutral-500">App preferences, generation defaults, and backend connection.</p>
      </div>

      <div className="flex gap-1 border-b border-neutral-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? 'border-blue-500 text-neutral-100' : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="space-y-6">
          <form onSubmit={handleSaveApp} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4 shadow-lg shadow-black/30">
            <h2 className="text-sm font-semibold text-neutral-200">App</h2>
            <p className="text-xs text-neutral-500">These take effect immediately -- no restart needed.</p>

            <Field label="App name">
              <input
                value={appDraft.appName}
                onChange={(event) => updateApp('appName', event.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Default model">
              <select
                value={appDraft.defaultModelId}
                onChange={(event) => updateApp('defaultModelId', event.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              >
                {config?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </Field>

            <OpenVideosToggle />

            <SaveRow saving={savingApp} error={error} savedNotice={savedApp && 'Saved and active.'} />
          </form>

          <form onSubmit={handleSaveEnv} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4 shadow-lg shadow-black/30">
            <h2 className="text-sm font-semibold text-neutral-200">Storage</h2>
            <p className="text-xs text-neutral-500">
              Requires restarting the server (<code>npm run dev</code>) to take effect.
            </p>

            <Field label="Output folder (data directory)">
              <input
                value={envDraft.dataDir}
                onChange={(event) => updateEnv('dataDir', event.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </Field>

            <SaveRow saving={savingEnv} error={error} savedNotice={savedEnv && 'Saved -- restart the server to apply.'} />
          </form>
        </div>
      )}

      {tab === 'generation' && (
        <form onSubmit={handleSaveApp} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4 shadow-lg shadow-black/30">
          <h2 className="text-sm font-semibold text-neutral-200">Generation defaults</h2>
          <p className="text-xs text-neutral-500">These take effect immediately -- no restart needed.</p>

          <Field label="Allowed durations (seconds, comma-separated)">
            <input
              value={appDraft.allowedDurationsSeconds.join(', ')}
              onChange={(event) => updateApp('allowedDurationsSeconds', parseNumberList(event.target.value))}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Allowed FPS (comma-separated)">
            <input
              value={appDraft.allowedFps.join(', ')}
              onChange={(event) => updateApp('allowedFps', parseNumberList(event.target.value))}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Max prompt length">
            <input
              type="number"
              value={appDraft.maxPromptLength}
              onChange={(event) => updateApp('maxPromptLength', Number(event.target.value))}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-neutral-300">Resolutions</p>
            <div className="space-y-2">
              {appDraft.allowedResolutions.map((preset, index) => (
                <div key={index} className="grid grid-cols-4 gap-2">
                  <input
                    value={preset.label}
                    onChange={(event) => updateResolution(index, { label: event.target.value })}
                    placeholder="Label"
                    className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    value={preset.width}
                    onChange={(event) => updateResolution(index, { width: Number(event.target.value) })}
                    placeholder="Width"
                    className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    value={preset.height}
                    onChange={(event) => updateResolution(index, { height: Number(event.target.value) })}
                    placeholder="Height"
                    className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
                  />
                  <input
                    value={preset.aspectRatio}
                    onChange={(event) => updateResolution(index, { aspectRatio: event.target.value })}
                    placeholder="16:9"
                    className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Sampling steps">
              <input
                type="number"
                value={appDraft.defaults.steps}
                onChange={(event) => updateApp('defaults', { ...appDraft.defaults, steps: Number(event.target.value) })}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="CFG scale">
              <input
                type="number"
                step="0.1"
                value={appDraft.defaults.cfg}
                onChange={(event) => updateApp('defaults', { ...appDraft.defaults, cfg: Number(event.target.value) })}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Sampler">
              <input
                value={appDraft.defaults.sampler}
                onChange={(event) => updateApp('defaults', { ...appDraft.defaults, sampler: event.target.value })}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </Field>
          </div>

          <Field label="Default negative prompt">
            <input
              value={appDraft.defaults.negativePrompt}
              onChange={(event) => updateApp('defaults', { ...appDraft.defaults, negativePrompt: event.target.value })}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Max retries">
              <input
                type="number"
                value={appDraft.maxRetries}
                onChange={(event) => updateApp('maxRetries', Number(event.target.value))}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Max stored videos">
              <input
                type="number"
                value={appDraft.maxStoredVideos}
                onChange={(event) => updateApp('maxStoredVideos', Number(event.target.value))}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Auto-delete after (days)">
              <input
                type="number"
                value={appDraft.autoDeleteAfterDays}
                onChange={(event) => updateApp('autoDeleteAfterDays', Number(event.target.value))}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={appDraft.imageToVideoEnabled}
              onChange={(event) => updateApp('imageToVideoEnabled', event.target.checked)}
            />
            Enable image-to-video
          </label>

          <SaveRow saving={savingApp} error={error} savedNotice={savedApp && 'Saved and active.'} />
        </form>
      )}

      {tab === 'backend' && (
        <form onSubmit={handleSaveEnv} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4 shadow-lg shadow-black/30">
          <h2 className="text-sm font-semibold text-neutral-200">Backend & performance</h2>
          {health ? (
            <p className="text-sm text-neutral-400">
              Status:{' '}
              <span className={health.connected ? 'text-emerald-400' : 'text-red-400'}>
                {health.connected ? 'Connected' : 'Not connected'}
              </span>
              {health.mock && <span className="ml-2 rounded-full bg-amber-900/40 px-2 py-0.5 text-xs text-amber-300">mock mode</span>}
            </p>
          ) : (
            <p className="text-sm text-neutral-500">Checking…</p>
          )}
          <p className="text-xs text-neutral-500">
            These require restarting the server (<code>npm run dev</code>) to take effect.
          </p>

          <Field label="ComfyUI / RunPod base URL">
            <input
              value={envDraft.comfyuiBaseUrl}
              onChange={(event) => updateEnv('comfyuiBaseUrl', event.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            />
          </Field>

          <Field label={`Auth token ${settings.env.comfyuiAuthTokenSet ? '(currently set)' : '(not set)'}`}>
            <input
              type="password"
              value={comfyuiAuthToken}
              onChange={(event) => setComfyuiAuthToken(event.target.value)}
              placeholder="Leave blank to keep current value"
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" checked={envDraft.comfyuiMock} onChange={(event) => updateEnv('comfyuiMock', event.target.checked)} />
            Mock mode (return a sample video instead of calling ComfyUI)
          </label>

          <p className="text-xs text-neutral-500">
            Login is a single admin account seeded from <code>ADMIN_USERNAME</code>/<code>ADMIN_PASSWORD</code> in{' '}
            <code>.env</code> on first boot. To change the password, update <code>.env</code> directly and reset the
            account in MongoDB -- there's no account-management UI yet.
          </p>

          <Field label="Port">
            <input
              type="number"
              value={envDraft.port}
              onChange={(event) => updateEnv('port', Number(event.target.value))}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            />
          </Field>

          <SaveRow saving={savingEnv} error={error} savedNotice={savedEnv && 'Saved -- restart the server to apply.'} />
        </form>
      )}

      {tab === 'models' && (
        <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4 shadow-lg shadow-black/30">
          <h2 className="text-sm font-semibold text-neutral-200">Models</h2>
          <p className="text-xs text-neutral-500">
            Configured in <code>config/models.config.ts</code> and deployed as part of the worker image -- models can't be added or
            removed from here.
          </p>
          <div className="divide-y divide-neutral-800">
            {config?.models.map((model) => (
              <div key={model.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm text-neutral-200">{model.label}</p>
                  <p className="text-xs text-neutral-600">{model.id}</p>
                </div>
                <div className="flex flex-none items-center gap-2">
                  {model.id === appDraft.defaultModelId && (
                    <span className="rounded-full bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">Default</span>
                  )}
                  {model.supportsImageToVideo && (
                    <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">Image</span>
                  )}
                  {model.label.toLowerCase().includes('audio') && (
                    <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">Audio</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OpenVideosToggle() {
  const [enabled, setEnabled] = useLocalFlag('openVideosOnFinish', false);
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-300">
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      Open videos when they finish
    </label>
  );
}

function parseNumberList(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => !Number.isNaN(n) && n > 0);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-neutral-300">{label}</label>
      {children}
    </div>
  );
}

function SaveRow({ saving, error, savedNotice }: { saving: boolean; error: string | null; savedNotice: string | false }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
      {!error && savedNotice && <span className="text-sm text-emerald-400">{savedNotice}</span>}
    </div>
  );
}
