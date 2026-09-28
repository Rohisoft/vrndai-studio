# AI Video Studio

A personal, single-user web app for generating short videos two different ways — real AI text/image-to-video rendering, or a script + real stock footage + AI voiceover — from one interface, with a shared job queue, gallery, and history.

Not a SaaS product: no multi-tenancy, no billing, no accounts beyond an optional single shared password. It's built to run on your own machine (or a box you control) and talk to services you already have access to (a GPU render backend, Ollama, Pexels).

---

## 1. What it actually does

Two completely different video-generation engines live behind one "Create" form:

### Engine A — AI-rendered video (`engine: 'comfy'`)
A text prompt (and optionally a reference image) goes through **ComfyUI**, running on **RunPod Serverless** — a cloud GPU worker with the model weights baked into a custom Docker image. Today that's **LTX-2.5** (text-to-video and image-to-video, with audio). The app renders a ComfyUI node graph from a JSON workflow template, submits it, polls progress, and downloads the finished clip.

### Engine B — Stock Footage + Voiceover (`engine: 'stock-video'`)
No AI video rendering at all. Given just a topic:
1. An LLM (Ollama, Groq, or Gemini — configurable) writes a short narration script.
2. The same LLM picks 5–8 English search terms from that script.
3. Real stock video clips are searched for and downloaded from **Pexels**.
4. The script is turned into speech via Microsoft's TTS service (`msedge-tts`), capturing word-level timing.
5. `ffmpeg` normalizes the clips to one resolution/fps, concatenates them to match the narration's length, muxes in the voiceover, and optionally burns in word-timed subtitles.

This entire pipeline runs **in-process** in the API server — no external video-generation service, no separate container to keep running. (It used to call a separately-hosted tool called MoneyPrinterTurbo over HTTP; that dependency was removed and reimplemented natively — see `apps/api/src/stock-video/`.)

### Everything else is shared between both engines
Once a job produces a video, it's identical from there on: saved into local storage, shown in **My Creations** and **History**, combinable with other clips into one video, deletable, and (for Engine A models) usable as the starting frame for a follow-up clip via **Continue clip**.

---

## 2. How a generation actually flows, end to end

1. **Create page** — pick a model. Picking an `engine: 'comfy'` model shows the usual prompt/duration/resolution/seed form; picking the Stock Footage model swaps in subject/script/voice/orientation/subtitle fields instead (`apps/web/src/components/GenerateForm.tsx` renders either set based on the selected model's `engine`).
2. **`POST /api/generate`** validates the request against `GenerationRequestSchema` (shared between client and server) and writes a row to SQLite with status `queued`.
3. A **single-worker, strictly-FIFO in-memory queue** (`apps/api/src/queue/in-memory-queue.ts`) picks up the oldest queued job. One job runs at a time, by design — simple, and correct for a personal tool where you're the only one submitting jobs.
4. `queue/worker.ts` looks up the model's `engine` and picks the matching client — either the RunPod-backed `ComfyClient` or the native `StockVideoClient` — both of which implement the **exact same interface** (`submitWorkflow → onProgress → waitForCompletion → fetchOutputBytes`). This is why adding the whole Stock Footage engine only needed a small branch in the worker instead of a parallel pipeline.
5. Progress updates flow to the browser over **Server-Sent Events** (`GET /api/jobs/:id/events`) — the Create page's Preview panel and Queue list, and the video lightbox everywhere else, all subscribe to the same stream.
6. On success, the finished video's bytes are saved to local disk (`data/videos/`) and the job flips to `done`; on failure it retries up to `maxRetries` times, then `failed`.

---

## 3. Features by page

| Page | Route | What it does |
|---|---|---|
| **Create** | `/` , `/jobs/:id` | Submit a new generation (either engine). Shows a live Preview of the most recent job plus a Queue of every job submitted this session. |
| **Assistant** | `/assistant` | Chat with a configurable LLM to draft/improve a prompt or ask questions about the app; "Use in Create" hands the drafted prompt + chosen model straight to the Create form. |
| **My Creations** | `/gallery` | Grid of every finished clip. Search by prompt, sort, filter by model, multi-select clips and send them to the Editor to combine. |
| **History** | `/history` | Full table of every job ever run (any status), with search, pagination, retry/re-run, and bulk "clear failed runs". |
| **Editor** | `/editor` (no nav link — reached via "Edit in Timeline" from My Creations) | Combine 2+ finished clips into one video via `ffmpeg concat`, normalizing mismatched resolutions/fps and handling mixed audio/silent clips. |
| **Settings** | `/settings` | Four tabs: General (app name, output folder, default model), Generation defaults (durations/resolutions/fps/sampler/etc.), Backend & performance (ComfyUI/RunPod connection, mock mode, app password, port), Models (read-only list). |

Other notable behaviors:
- **Continue clip**: pause a finished clip at any frame (not just the last one) and use it as the starting image for a new image-to-video generation — lets you pick a moment where the composition/characters are right, rather than always the literal last frame.
- **Direct image upload**: manually switch to an image-to-video model and attach any image, independent of the Continue-clip flow.
- **Password gate**: if `APP_PASSWORD` is set, the whole app sits behind one shared password (cookie-based session) — otherwise it's open.
- **Mock mode**: `COMFYUI_MOCK=true` returns a bundled sample video instead of calling ComfyUI at all, so the app is fully testable without any GPU backend.

---

## 4. Project layout

```
apps/
  api/     Fastify backend — job queue, SQLite store, all the actual generation logic
  web/     React + Vite + Tailwind frontend
shared/    Zod schemas used by BOTH the client and server (one source of truth for validation)
config/    Non-secret, code-level config: models.config.ts, voices.config.ts, app.config.ts
workflows/ ComfyUI node-graph JSON templates (one per Engine-A model, +i2v variants)
data/      Runtime data -- SQLite DB, generated videos, pending image uploads, app-settings.json
           (gitignored; this is the ONE directory that needs to persist/be backed up)
```

Inside `apps/api/src/`, the pieces worth knowing:
- `comfy/` — the RunPod/ComfyUI client(s): `real-client.ts` (a persistent Pod), `runpod-serverless-client.ts` (RunPod Serverless, the one actually in use), `mock-client.ts`.
- `stock-video/` — the native Engine-B pipeline: `pipeline.ts` (orchestrator), `script-writer.ts` / `search-terms.ts` (LLM calls), `pexels-client.ts`, `tts.ts`, `subtitles.ts`, `assemble.ts` (the ffmpeg step), `stock-video-client.ts` (the adapter matching `ComfyClient`'s shape).
- `llm/` — the provider-agnostic chat client: `ollama-client.ts`, `groq-client.ts`, `gemini-client.ts`, all behind one `LlmClient` interface picked by `index.ts`'s factory based on `LLM_PROVIDER`. Used by both the Assistant route and the Stock Footage script/keyword steps.
- `queue/` — `worker.ts` (per-job dispatch) + `in-memory-queue.ts` (the FIFO loop + cancel logic).
- `store/` — SQLite job store (`better-sqlite3`).
- `video/` — `combine.ts` (multi-clip ffmpeg concat for the Editor) and `frame-extract.ts` (Continue-clip's frame grab).
- `settings/` — two separate settings stores: `app-settings-store.ts` (the JSON-file-backed, live-editable generation defaults) and `env-settings-store.ts` (the `.env`-backed, restart-required connection settings).

---

## 5. Running it

```bash
cp .env.example .env    # fill in whatever you need, see the config reference below
docker compose up       # api on :3001, web (Vite dev server) on :5173
```

Without Docker: `npm install` at the repo root, then `npm run dev` (runs both workspaces concurrently via `concurrently`). Other root scripts: `npm run typecheck`, `npm test`.

There is currently **no production build/deploy path** — the Docker setup and `npm run dev` are both dev-mode only (`tsx watch`, Vite dev server). This is a local/self-hosted tool as-is; deploying it publicly (e.g. Render) needs additional work (a static-served frontend build, a non-watch start command, persistent disk, and — critically — `LLM_PROVIDER` switched away from `ollama` since there's no local Ollama to reach from a cloud host).

---

## 6. Configuration reference

All of this lives in `.env` at the repo root (gitignored — `.env.example` is the committed template). Fields with **no default** below are optional; the feature they gate just won't work until set.

### Server
| Var | Default | Notes |
|---|---|---|
| `PORT` | `3001` | |
| `DATA_DIR` | `./data` | Where the SQLite DB, videos, uploads, and settings live. **Use an absolute path** if you ever run this somewhere the working directory might differ from the repo root — a relative path is resolved inconsistently between the main process and the auth-secret file today (`plugins/auth.ts`). |
| `APP_PASSWORD` | *(none — open)* | Set this if the app is reachable by anyone other than you. |

### Engine A — AI video (ComfyUI / RunPod)
| Var | Default | Notes |
|---|---|---|
| `COMFYUI_MOCK` | `false` | `true` = skip real generation, return a bundled sample video. Good for testing the UI without any backend. |
| `COMFYUI_BASE_URL` | `http://127.0.0.1:8188` | Used only when `RUNPOD_API_KEY` is unset (a self-hosted/Pod-based ComfyUI instead of Serverless). |
| `COMFYUI_AUTH_TOKEN` | *(none)* | Only if your ComfyUI/tunnel needs it. |
| `RUNPOD_API_KEY` | *(none)* | Set this to use RunPod **Serverless** instead of a plain Pod — this is the actual current setup. |
| `RUNPOD_ENDPOINT_IDS` | *(none)* | JSON object mapping each `config/models.config.ts` model id → its own Serverless endpoint id, e.g. `{"ltx2.5-t2v":"abc123"}`. One endpoint per model — each is a separate custom Docker image with that model's weights baked in (see `RUNPOD_RUNBOOK.md` for how one was built). |

### Engine B — Stock Footage (Pexels + Voiceover)
| Var | Default | Notes |
|---|---|---|
| `PEXELS_API_KEY` | *(none)* | Free key at [pexels.com/api](https://www.pexels.com/api/). Required for this engine to work at all. |

No separate TTS key is needed — `msedge-tts` talks to Microsoft's Edge Read Aloud service directly, no account required. Voice options are curated in `config/voices.config.ts` (currently 2 Hindi voices + 6 English voices across US/UK/Indian-accent variants, male & female each).

### AI Assistant + Stock Footage's script/keyword writing (shared)
| Var | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` \| `groq` \| `gemini`. Pick one; the other two providers' settings below are simply unused. |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Only used when `LLM_PROVIDER=ollama`. Must be a locally-running Ollama — `host.docker.internal` (not `localhost`) so the Docker container can reach a host-installed Ollama. **Won't work on a cloud host with no Ollama of yours running anywhere** — use `groq`/`gemini` there instead. |
| `OLLAMA_MODEL` | `llama3.1:8b` | |
| `GROQ_API_KEY` | *(none)* | Only used when `LLM_PROVIDER=groq`. Free key at [console.groq.com/keys](https://console.groq.com/keys). |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | |
| `GEMINI_API_KEY` | *(none)* | Only used when `LLM_PROVIDER=gemini`. Free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| `GEMINI_MODEL` | `gemini-2.5-flash` | |

A misconfigured provider (e.g. `LLM_PROVIDER=groq` with no key) fails only the specific request that needed it — it never crashes the server at boot.

---

## 7. In-app editable settings (Settings page)

Separate from the `.env` vars above — these live in `data/app-settings.json`, are editable straight from the **Settings** page, and (unlike env vars) take effect **immediately, no restart needed**:

- App name, output folder label, default model
- Allowed durations / resolutions / fps lists (what shows up as choices on the Create form)
- Sampling defaults: steps, CFG scale, sampler name, default negative prompt, seed mode
- Max prompt length, max retries per job, max stored videos (oldest get auto-deleted beyond this), auto-delete-after-N-days
- Image-to-video feature flag

The **Backend & performance** tab shows/edits the `.env`-backed connection settings (ComfyUI/RunPod URL, auth token, mock mode, app password, port) — these *do* require a server restart, and the UI says so.

---

## 8. API reference (all under the api container's port)

```
GET    /health, /health/comfyui
GET    /api/config                     Public, non-secret config (models, voices, limits, defaults)
GET    /api/settings                   Both settings stores (app + env view)
POST   /api/settings/app               Edit generation defaults (live)
POST   /api/settings/env               Edit connection settings (restart required)
POST   /api/generate                   Submit a new job (either engine)
GET    /api/jobs                       List all jobs
GET    /api/jobs/:id                   One job's current state
GET    /api/jobs/:id/events            SSE progress stream for one job
POST   /api/jobs/:id/cancel
POST   /api/jobs/:id/rerun
POST   /api/jobs/:id/continue          Extract a frame from a finished clip as a new source image
POST   /api/jobs/combine               ffmpeg-concat 2+ finished clips into one new job
DELETE /api/jobs/:id
POST   /api/images/upload              Direct image upload for a manually-selected image-to-video model
GET    /api/videos/:filename           Serves a generated video (range-request aware, for scrubbing)
POST   /api/assistant/chat             SSE-streamed chat with the configured LLM provider
```

---

## 9. Data & persistence

Everything that needs to survive a restart lives under `DATA_DIR` (default `./data`):
- `jobs.db` (+ WAL files) — every job ever created, its full params, status, timestamps
- `videos/` — every finished/combined clip
- `pending-uploads/` — images awaiting a job submission (Continue-clip frames, direct uploads); swept after 24h if unused
- `app-settings.json` — the live-editable Settings-page values
- `.auth-secret` — the password-gate session signing key (auto-generated on first boot)

This is the one directory worth backing up. Old videos/jobs are pruned automatically per the `maxStoredVideos`/`autoDeleteAfterDays` settings.

---

## 10. Architecture decisions worth knowing

- **Single-worker job queue, on purpose.** Only one generation runs at a time, regardless of engine. Simple and correct for one person submitting jobs; a Stock Footage job with a long target length can take several minutes and will make everything else wait — this is expected, not a bug.
- **Both engines implement one shared client interface.** `ComfyClient` (`submitWorkflow`/`onProgress`/`waitForCompletion`/`fetchOutputBytes`/`interrupt`) is implemented by the RunPod client *and* by the native Stock Footage pipeline's adapter — that's what let the whole stock-footage rewrite drop into the existing worker with only a small branch, no parallel job-handling code.
- **`GenerationRequestSchema` is genuinely shared** between `apps/web` and `apps/api` (via the `shared` workspace) — one schema validates the form client-side and the request server-side, so they can never drift.
- **Interrupting a Stock Footage job actually stops the work** (an `AbortController` threaded through every fetch/ffmpeg call) — a real improvement over the old MoneyPrinterTurbo-based version, whose external service had no way to be told "stop."
- **Not multi-tenant, not horizontally scalable, intentionally.** No user accounts, no per-user isolation, in-memory queue state that doesn't survive a restart (recovered via `markAllRunningAsFailed()` on boot). This is correct for what it is; don't mistake it for an oversight if you're extending it.

## 11. Related docs

- `RUNPOD_RUNBOOK.md` — everything learned standing up the RunPod side for real. Part 1 documents the **current** setup (RunPod Serverless, the custom `runpod-worker/Dockerfile.ltx25` image, `handler.py`'s two upstream deviations, deploying/updating an endpoint). Part 2 is the older self-hosted-Pod setup, kept because its exact model-weight download commands (including for Wan 2.2 5B/14B, which don't have a Serverless image yet) are what you'd reuse to build a new model's Serverless image. Read this before touching the RunPod/ComfyUI side of Engine A.
