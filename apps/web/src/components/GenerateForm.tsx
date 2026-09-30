import { ChevronDown, Clapperboard, Image as ImageIcon, Mic, SlidersHorizontal, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GenerationRequestSchema, type PublicAppConfig } from '@app/shared';
import { api } from '../lib/api-client.js';

const PROMPT_CHIPS = ['Slow dolly-in', 'Golden hour light', 'Handheld camera', 'Cinematic, 35mm film'];

interface GenerateFormProps {
  config: PublicAppConfig;
  disabled: boolean;
  onSubmit: (request: unknown) => void;
  /** Pre-fills model + attaches a reference image, coming back from "Continue clip" -- the prompt is deliberately left blank either way, for the user to write what happens next. */
  initialModelId?: string;
  initialSourceImage?: string;
  /** Pre-fills the prompt text, coming back from the Assistant page's "Use as my prompt" hand-off. */
  initialPrompt?: string;
}

const STOCK_CLIP_DURATIONS = [3, 4, 5, 6, 8];

// The Stock Footage pipeline has no direct "total video length" input --
// its actual duration comes from however long the narration runs, which
// depends on script length. Paragraph count (1-10, its own hard limit) is
// the nearest proxy, so this maps a few human time buckets onto it -- approximate by
// nature, since the LLM decides how long each paragraph actually is.
// Calibrated against a live run (our configured Ollama model): 10
// paragraphs produced ~185s of narration, i.e. roughly 18s/paragraph --
// paragraph_number=10 is NOT "~60s", it's closer to 3 minutes.
const TARGET_LENGTHS = [
  { label: '~20s', paragraphs: 1 },
  { label: '~40s', paragraphs: 2 },
  { label: '~60s', paragraphs: 3 },
];

export function GenerateForm({ config, disabled, onSubmit, initialModelId, initialSourceImage, initialPrompt }: GenerateFormProps) {
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [modelId, setModelId] = useState(initialModelId ?? config.defaultModelId);
  const [duration, setDuration] = useState(config.allowedDurationsSeconds[0]);
  const [resolutionIndex, setResolutionIndex] = useState(0);
  const [fps, setFps] = useState(config.allowedFps[0]);
  const [seed, setSeed] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Stock Footage (Pexels) engine only -- a fundamentally different job
  // shape (subject/script/voice, no width/height/fps/seed), see
  // config/models.config.ts's engine field and worker.ts's dispatch.
  const [script, setScript] = useState('');
  const [voiceLanguage, setVoiceLanguage] = useState<'hi' | 'en'>('en');
  const [voiceId, setVoiceId] = useState(() => config.voices.find((v) => v.language === 'en')?.id ?? config.voices[0]?.id ?? '');
  const [orientation, setOrientation] = useState<'9:16' | '16:9'>('9:16');
  const [stockClipDuration, setStockClipDuration] = useState(STOCK_CLIP_DURATIONS[1]);
  const [targetLengthParagraphs, setTargetLengthParagraphs] = useState(TARGET_LENGTHS[1].paragraphs);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [narrationMode, setNarrationMode] = useState<'ai' | 'own' | 'clone'>('ai');
  const [narrationAudio, setNarrationAudio] = useState<string | null>(null);
  const [narrationAudioFileName, setNarrationAudioFileName] = useState<string | null>(null);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [audioUploadError, setAudioUploadError] = useState<string | null>(null);
  const [voiceCloneSample, setVoiceCloneSample] = useState<string | null>(null);
  const [voiceCloneSampleFileName, setVoiceCloneSampleFileName] = useState<string | null>(null);
  const [uploadingCloneSample, setUploadingCloneSample] = useState(false);
  const [cloneSampleUploadError, setCloneSampleUploadError] = useState<string | null>(null);

  // Only relevant when the user manually switches to an image-to-video
  // model outside the "Continue clip" flow (initialSourceImage unset) --
  // lets them attach any image directly instead of only ever being able to
  // continue from a previous generation's frame.
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [uploadedSourceImage, setUploadedSourceImage] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const resolution = config.allowedResolutions[resolutionIndex];
  const selectedModel = config.models.find((model) => model.id === modelId);
  const isStockFootage = selectedModel?.engine === 'stock-video';
  const showUpload = !isStockFootage && !initialSourceImage && Boolean(selectedModel?.supportsImageToVideo);
  const effectiveSourceImage = initialSourceImage ?? uploadedSourceImage ?? undefined;
  const voicesForLanguage = config.voices.filter((v) => v.language === voiceLanguage);

  function changeVoiceLanguage(language: 'hi' | 'en') {
    setVoiceLanguage(language);
    const firstForLanguage = config.voices.find((v) => v.language === language);
    if (firstForLanguage) {
      setVoiceId(firstForLanguage.id);
    }
  }

  // Switching away from an image-to-video model (or back to one, fresh)
  // clears a stale upload so it doesn't silently attach to an unrelated
  // generation.
  useEffect(() => {
    if (!showUpload && uploadedSourceImage) {
      setUploadedSourceImage(null);
      setUploadError(null);
      setUploadFileName(null);
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl);
      }
      setUploadPreviewUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUpload]);

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl);
      }
    };
  }, [uploadPreviewUrl]);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (uploadPreviewUrl) {
      URL.revokeObjectURL(uploadPreviewUrl);
    }
    setUploadPreviewUrl(URL.createObjectURL(file));
    setUploadedSourceImage(null);
    setUploadFileName(file.name);
    setUploadError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.postForm<{ sourceImage: string }>('/api/images/upload', formData);
      setUploadedSourceImage(result.sourceImage);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload image.');
    } finally {
      setUploading(false);
    }
  }

  async function handleAudioFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setNarrationAudio(null);
    setNarrationAudioFileName(file.name);
    setAudioUploadError(null);
    setUploadingAudio(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.postForm<{ narrationAudio: string }>('/api/audio/upload', formData);
      setNarrationAudio(result.narrationAudio);
    } catch (err) {
      setAudioUploadError(err instanceof Error ? err.message : 'Failed to upload audio.');
    } finally {
      setUploadingAudio(false);
    }
  }

  async function handleVoiceCloneSampleSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setVoiceCloneSample(null);
    setVoiceCloneSampleFileName(file.name);
    setCloneSampleUploadError(null);
    setUploadingCloneSample(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      // Same generic upload endpoint the "My own voice" mode uses -- the
      // response's field name (narrationAudio) is just this route's fixed
      // shape, the returned reference works the same regardless of which
      // narration mode uses it afterward.
      const result = await api.postForm<{ narrationAudio: string }>('/api/audio/upload', formData);
      setVoiceCloneSample(result.narrationAudio);
    } catch (err) {
      setCloneSampleUploadError(err instanceof Error ? err.message : 'Failed to upload voice sample.');
    } finally {
      setUploadingCloneSample(false);
    }
  }

  function addChip(chip: string) {
    setPrompt((current) => (current.trim() ? `${current.trim()}, ${chip}` : chip));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const candidate = isStockFootage
      ? {
          modelId,
          prompt, // doubles as the video's subject/topic for this engine
          script: script || undefined,
          voiceId,
          narrationAudio: narrationMode === 'own' ? (narrationAudio ?? undefined) : undefined,
          voiceCloneSample: narrationMode === 'clone' ? (voiceCloneSample ?? undefined) : undefined,
          aspectRatio: orientation,
          stockClipDurationSeconds: stockClipDuration,
          scriptParagraphs: targetLengthParagraphs,
          subtitlesEnabled,
          // GenerationRequestSchema still requires these -- harmless
          // placeholders the stock-video engine ignores entirely (see
          // worker.ts's buildStockVideoParams).
          durationSeconds: 30,
          fps: 30,
          width: orientation === '16:9' ? 1920 : 1080,
          height: orientation === '16:9' ? 1080 : 1920,
        }
      : {
          modelId,
          prompt,
          negativePrompt: negativePrompt || undefined,
          durationSeconds: duration,
          fps,
          width: resolution.width,
          height: resolution.height,
          aspectRatio: resolution.aspectRatio,
          seed: seed ? Number(seed) : undefined,
          sourceImage: effectiveSourceImage,
        };

    // Validate client-side against the SAME schema the server uses (see
    // GenerationRequestSchema in shared/) -- catches obvious problems
    // (empty prompt, out-of-range values) before a round trip, with the
    // server re-validating regardless since the client can't be trusted.
    const result = GenerationRequestSchema.safeParse(candidate);
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        errors[String(issue.path[0])] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    onSubmit(result.data);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-xl shadow-black/40"
    >
      {/* Step 1 -- model picker, one card per model with capability badges */}
      <div className="space-y-2 p-6">
        <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-200">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-[11px]">1</span>
          Choose a model
        </label>
        <div className="space-y-2">
          {config.models.map((model) => {
            const isSelected = model.id === modelId;
            const hasAudio = model.label.toLowerCase().includes('audio');
            const isStock = model.engine === 'stock-video';
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => setModelId(model.id)}
                className={`flex w-full items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                  isSelected ? 'border-violet-500 bg-violet-950/20' : 'border-neutral-800 bg-neutral-950 hover:border-neutral-600'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 ${
                      isSelected ? 'border-violet-500' : 'border-neutral-600'
                    }`}
                  >
                    {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-neutral-100">{model.label.replace(/\s*\(.*\)\s*$/, '')}</span>
                    <span className="block text-xs text-neutral-500">
                      {isStock
                        ? 'Real stock clips + narration, no AI rendering'
                        : model.supportsImageToVideo
                          ? 'Image to video'
                          : 'Text to video'}
                      {hasAudio ? ', with audio' : ''}
                    </span>
                  </span>
                </div>
                <div className="flex flex-none gap-1">
                  {isStock && (
                    <span className="flex items-center gap-1 rounded-md border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
                      <Clapperboard className="h-3 w-3" strokeWidth={2} /> Stock + voice
                    </span>
                  )}
                  {model.supportsImageToVideo && (
                    <span className="flex items-center gap-1 rounded-md border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
                      <ImageIcon className="h-3 w-3" strokeWidth={2} /> Image
                    </span>
                  )}
                  {hasAudio && (
                    <span className="flex items-center gap-1 rounded-md border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
                      <Volume2 className="h-3 w-3" strokeWidth={2} /> Audio
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2 -- prompt (subject/topic for Stock Footage) */}
      <div className="space-y-2 border-t border-neutral-800 p-6">
        <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-200">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-[11px]">2</span>
          {isStockFootage ? "What's the video about?" : 'Describe the scene'}
        </label>

        {initialSourceImage && (
          <div className="flex items-center gap-1.5 rounded-lg border border-blue-900 bg-blue-950/40 px-3 py-2 text-xs text-blue-300">
            <Clapperboard className="h-3.5 w-3.5 flex-none" strokeWidth={2} /> Continuing from your previous clip's last frame -- describe
            what happens next.
          </div>
        )}
        {showUpload && (
          <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
            <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
              <ImageIcon className="h-3.5 w-3.5" strokeWidth={2} /> Starting image ({selectedModel?.label} needs a reference image)
            </label>
            <div className="flex items-center gap-3">
              {uploadPreviewUrl && (
                <img src={uploadPreviewUrl} alt="Upload preview" className="h-14 w-14 flex-none rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <label className="inline-flex flex-none cursor-pointer items-center rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800">
                    Choose file
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileSelected}
                      className="sr-only"
                    />
                  </label>
                  <span className="truncate text-xs text-neutral-500">{uploadFileName ?? 'No file chosen'}</span>
                </div>
                {uploading && <p className="text-xs text-neutral-500">Uploading…</p>}
                {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
              </div>
            </div>
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={config.maxPromptLength}
          rows={isStockFootage ? 2 : 6}
          placeholder={isStockFootage ? 'e.g. 5 morning habits that boost focus' : 'Describe the video you want to generate...'}
          className="w-full resize-none rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
        />

        {!isStockFootage && (
          <div className="flex flex-wrap gap-1.5">
            {PROMPT_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => addChip(chip)}
                className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-200"
              >
                + {chip}
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-between text-xs text-neutral-500">
          <span>
            {fieldErrors.prompt ? (
              <span className="text-red-400">{fieldErrors.prompt}</span>
            ) : isStockFootage ? (
              'A topic is enough -- a script gets written for you below if you leave it blank.'
            ) : (
              'Subject, motion, camera and light work best.'
            )}
          </span>
          <span>
            {prompt.length} / {config.maxPromptLength}
          </span>
        </div>

        {isStockFootage && (
          <div className="space-y-4 border-t border-neutral-800 pt-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">Narration</label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setNarrationMode('ai')}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    narrationMode === 'ai'
                      ? 'border-white bg-white text-black'
                      : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
                  }`}
                >
                  AI voice
                </button>
                <button
                  type="button"
                  onClick={() => setNarrationMode('own')}
                  className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    narrationMode === 'own'
                      ? 'border-white bg-white text-black'
                      : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
                  }`}
                >
                  <Mic className="h-3 w-3" strokeWidth={2} /> My own voice
                </button>
                <button
                  type="button"
                  onClick={() => setNarrationMode('clone')}
                  className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    narrationMode === 'clone'
                      ? 'border-white bg-white text-black'
                      : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
                  }`}
                >
                  <Mic className="h-3 w-3" strokeWidth={2} /> Clone my voice
                </button>
              </div>
            </div>

            {(narrationMode === 'ai' || narrationMode === 'clone') && (
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Script (optional)
                </label>
                <textarea
                  value={script}
                  onChange={(event) => setScript(event.target.value)}
                  rows={4}
                  placeholder="Leave blank to have a script written from the topic above, or write your own narration here."
                  className="w-full resize-none rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                />
              </div>
            )}

            {narrationMode === 'own' ? (
              <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                  <Mic className="h-3.5 w-3.5" strokeWidth={2} /> Your voice recording
                </label>
                <div className="flex items-center gap-2">
                  <label className="inline-flex flex-none cursor-pointer items-center rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800">
                    Choose file
                    <input
                      type="file"
                      accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/webm,audio/ogg"
                      onChange={handleAudioFileSelected}
                      className="sr-only"
                    />
                  </label>
                  <span className="truncate text-xs text-neutral-500">{narrationAudioFileName ?? 'No file chosen'}</span>
                </div>
                {uploadingAudio && <p className="text-xs text-neutral-500">Uploading…</p>}
                {audioUploadError && <p className="text-xs text-red-400">{audioUploadError}</p>}
                {narrationAudio && !uploadingAudio && <p className="text-xs text-emerald-400">Uploaded -- ready to use.</p>}
                <p className="text-[11px] text-neutral-600">
                  Captions and stock clips are matched from your recording automatically -- no script needed.
                </p>
              </div>
            ) : narrationMode === 'clone' ? (
              <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                  <Mic className="h-3.5 w-3.5" strokeWidth={2} /> Voice sample to clone
                </label>
                <div className="flex items-center gap-2">
                  <label className="inline-flex flex-none cursor-pointer items-center rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800">
                    Choose file
                    <input
                      type="file"
                      accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/webm,audio/ogg"
                      onChange={handleVoiceCloneSampleSelected}
                      className="sr-only"
                    />
                  </label>
                  <span className="truncate text-xs text-neutral-500">{voiceCloneSampleFileName ?? 'No file chosen'}</span>
                </div>
                {uploadingCloneSample && <p className="text-xs text-neutral-500">Uploading…</p>}
                {cloneSampleUploadError && <p className="text-xs text-red-400">{cloneSampleUploadError}</p>}
                {voiceCloneSample && !uploadingCloneSample && <p className="text-xs text-emerald-400">Uploaded -- ready to use.</p>}
                <p className="text-[11px] text-neutral-600">
                  A short clip (a few seconds to a minute) of a real voice. The script above gets spoken in that voice, via a
                  free XTTS-v2 model -- a free third-party service, so occasional slowness or downtime is possible.
                </p>
              </div>
            ) : null}

            {(narrationMode === 'ai' || narrationMode === 'clone') && (
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">Voice language</label>
                <div className="flex gap-1.5">
                  {(['en', 'hi'] as const).map((language) => (
                    <button
                      key={language}
                      type="button"
                      onClick={() => changeVoiceLanguage(language)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        voiceLanguage === language
                          ? 'border-white bg-white text-black'
                          : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
                      }`}
                    >
                      {language === 'en' ? 'English' : 'Hindi'}
                    </button>
                  ))}
                </div>
                {narrationMode === 'clone' && (
                  <p className="mt-1.5 text-[11px] text-neutral-600">
                    Sets both the script's language and the clone model's language setting.
                  </p>
                )}
              </div>
            )}

            {narrationMode === 'ai' && (
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">Voice</label>
                <select
                  value={voiceId}
                  onChange={(event) => setVoiceId(event.target.value)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-300 focus:border-neutral-500 focus:outline-none"
                >
                  {voicesForLanguage.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label} ({voice.gender === 'female' ? 'Female' : 'Male'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <PillGroup
                label="Orientation"
                options={['9:16', '16:9'] as const}
                value={orientation}
                onChange={setOrientation}
                renderLabel={(v) => (v === '9:16' ? 'Portrait' : 'Landscape')}
              />
              <PillGroup
                label="Stock clip length"
                options={STOCK_CLIP_DURATIONS}
                value={stockClipDuration}
                onChange={setStockClipDuration}
                renderLabel={(v) => `${v}s`}
              />
            </div>

            <div>
              <PillGroup
                label="Target length"
                options={TARGET_LENGTHS.map((t) => t.paragraphs)}
                value={targetLengthParagraphs}
                onChange={setTargetLengthParagraphs}
                renderLabel={(p) => TARGET_LENGTHS.find((t) => t.paragraphs === p)?.label ?? `${p}`}
              />
              <p className="mt-1.5 text-[11px] text-neutral-600">
                Approximate -- controls how much script gets written. Ignored if you write your own script above.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={subtitlesEnabled}
                onChange={(event) => setSubtitlesEnabled(event.target.checked)}
                className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 accent-violet-500"
              />
              Burn in subtitles
            </label>
          </div>
        )}
      </div>

      {/* Advanced -- duration/resolution/fps/seed/negative prompt, tucked
          behind a disclosure so the common path stays clean. Not relevant to
          the Stock Footage engine, which has its own fields above instead. */}
      {!isStockFootage && (
      <details className="group border-t border-neutral-800">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-6 py-4 text-sm font-medium text-neutral-300 hover:text-white">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-4 w-4 flex-none" strokeWidth={2} /> Advanced options
            </span>
            <span className="mt-0.5 block text-xs font-normal text-neutral-500">
              {duration}s · {resolution.label} · {fps} fps
            </span>
          </span>
          <ChevronDown className="mt-0.5 h-4 w-4 flex-none transition-transform group-open:rotate-180" strokeWidth={2} />
        </summary>
        <div className="space-y-4 px-6 pb-6">
          <div className="grid grid-cols-2 gap-4">
            <PillGroup label="Duration" options={config.allowedDurationsSeconds} value={duration} onChange={setDuration} renderLabel={(v) => `${v}s`} />
            <PillGroup label="FPS" options={config.allowedFps} value={fps} onChange={setFps} renderLabel={(v) => `${v} fps`} />
          </div>
          <PillGroup
            label="Resolution"
            options={config.allowedResolutions.map((_, index) => index)}
            value={resolutionIndex}
            onChange={setResolutionIndex}
            renderLabel={(index) => config.allowedResolutions[index].label}
          />
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">Negative prompt</label>
            <input
              type="text"
              value={negativePrompt}
              onChange={(event) => setNegativePrompt(event.target.value)}
              placeholder="What to avoid in the result"
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">Seed</label>
            <input
              type="number"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="Random"
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
            />
          </div>
        </div>
      </details>
      )}

      <div className="border-t border-neutral-800 p-6">
        <button
          type="submit"
          disabled={
            disabled ||
            uploading ||
            uploadingAudio ||
            uploadingCloneSample ||
            !prompt.trim() ||
            (isStockFootage && narrationMode === 'own' && !narrationAudio) ||
            (isStockFootage && narrationMode === 'clone' && !voiceCloneSample)
          }
          className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {disabled
            ? 'Generating…'
            : uploading
              ? 'Uploading image…'
              : uploadingAudio
                ? 'Uploading voice…'
                : uploadingCloneSample
                  ? 'Uploading sample…'
                  : 'Generate video'}
        </button>
        {!prompt.trim() && <p className="mt-2 text-center text-xs text-neutral-600">Write a prompt to enable Generate.</p>}
        {isStockFootage && narrationMode === 'own' && !narrationAudio && prompt.trim() && (
          <p className="mt-2 text-center text-xs text-neutral-600">Upload your voice recording to enable Generate.</p>
        )}
        {isStockFootage && narrationMode === 'clone' && !voiceCloneSample && prompt.trim() && (
          <p className="mt-2 text-center text-xs text-neutral-600">Upload a voice sample to clone to enable Generate.</p>
        )}
      </div>
    </form>
  );
}

interface PillGroupProps<T extends string | number> {
  label: string;
  options: T[];
  value: T;
  onChange: (value: T) => void;
  renderLabel: (value: T) => string;
}

function PillGroup<T extends string | number>({ label, options, value, onChange, renderLabel }: PillGroupProps<T>) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={String(option)}
            type="button"
            onClick={() => onChange(option)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              value === option ? 'border-white bg-white text-black' : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
            }`}
          >
            {renderLabel(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
