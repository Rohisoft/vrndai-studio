# RunPod Setup Runbook

Everything learned running this app's video-generation backend on RunPod — both the **current setup** (RunPod Serverless, a custom Docker image with LTX-2.5's weights baked in) and the **self-hosted Pod** setup that came before it and is kept here because its weight-download commands are still exactly what you need when building a new Serverless image for another model (e.g. Wan 2.2).

Full styled version of the original Pod runbook: https://claude.ai/artifact/D4fcXMuJ3TpzUFE3gtUZJA

---

# Part 1 — Current setup: RunPod Serverless

This is what the app actually talks to today (`RUNPOD_API_KEY` + `RUNPOD_ENDPOINT_IDS` in `.env`, handled by `apps/api/src/comfy/runpod-serverless-client.ts`). No Pod, no network volume, no manual "reinstall ComfyUI every session" — the whole point of moving here (see Part 2, section 9) was to stop needing any of Part 2's workarounds.

**Why Serverless over a Pod:** a Pod bills hourly the whole time it's running, whether you're actively generating or not. Serverless bills per second of actual compute, scales to zero between requests, and cold-starts a worker on demand. For this app's usage pattern — sporadic generations, not constant load — Serverless is meaningfully cheaper despite a higher nominal per-hour rate, purely because it isn't paying for idle time.

## 1.1 The image

Source: `runpod-worker/Dockerfile.ltx25` + `runpod-worker/handler.py`, both in this repo.

- **Base:** `runpod/worker-comfyui:5.10.0-base` — RunPod's own ComfyUI worker image, not the bare PyTorch template Part 2 uses.
- **LTX-2.5's node pack** (`ComfyUI-LTXVideo`) is `git clone`'d and its requirements installed — this works fine in a Docker build even though the exact same `git clone` fails on the Pod's FUSE network volume (Part 2, root cause #2). No FUSE involved here.
- **Weights are baked into the image at build time**, not loaded from a network volume — so a cold worker never waits on a slow network read before it can start generating. The exact files (5 of them: diffusion model, latent upscaler, text encoder, audio VAE, video VAE) are the same ones Part 2 section 3 step 3 downloads for a Pod, verified against this repo's own `workflows/ltx2.5-t2v.json` and `workflows/ltx2.5-i2v.json`.
- **Two build-time smoke tests** (`python main.py --quick-test-for-ci --cpu`) actually import the full node graph on CPU — an import-breaking dependency shows up as a build failure here, not as a mysterious "worker unreachable" on a live job.

Build (needs Docker BuildKit, for the `--secret` flag that keeps your HF token out of the image's layer history):
```bash
export HUGGINGFACE_TOKEN=<your gated-access token for Lightricks/LTX-2.5>
DOCKER_BUILDKIT=1 docker build \
  --secret id=hf_token,env=HUGGINGFACE_TOKEN \
  -t <your-registry>/ltx25-comfyui-worker:v2 \
  -f runpod-worker/Dockerfile.ltx25 runpod-worker
docker push <your-registry>/ltx25-comfyui-worker:v2
```

> **Use a real version tag (`:v2`, `:v3`, ...), never just `:latest`.** RunPod has cached a stale image under `:latest` even after a fresh push before — a genuinely new tag, combined with RunPod's endpoint "New release" action, is what actually forces a fresh pull. This cost real debugging time once; don't repeat it.

## 1.2 The `huggingface_hub` version trap (already fixed in the Dockerfile, but know why)

`ComfyUI-LTXVideo`'s `requirements.txt` only pins a *floor* for `huggingface_hub`, and the resolved version on a fresh build was too old for the `hf download` CLI (`hf: command not found` — same as Part 2 root cause seen on the Pod). The fix is `pip install -U huggingface_hub` before downloading weights.

But upgrading it *unpinned* goes too far: it force-upgrades past what the base image's pinned `transformers` tolerates, which crashes ComfyUI at startup with:
```
ImportError: huggingface-hub>=1.5.0,<2.0 is required ... but found huggingface-hub==2.x
```
confirmed live via a real failed RunPod job's logs. The Dockerfile's fix is a **second, separate `RUN pip install "huggingface_hub>=1.5.0,<2.0"` layer placed AFTER the weight download**, specifically so re-pinning it doesn't invalidate the cached download layer (that download is easily a multi-hour step — losing its cache on a rebuild is the difference between a 5-minute and 3-hour build). If you ever touch this Dockerfile, keep that ordering.

## 1.3 `handler.py`'s two deviations from upstream

Forked from `runpod-workers/worker-comfyui`'s `handler.py` (tag `5.11.0`). The file's own header comment has both diffs; re-diff against upstream before pulling in any future update from them:

1. **Progress forwarding.** Upstream only watches ComfyUI's websocket for an `"executing"` message to detect completion — it silently drops the `"progress"` messages ComfyUI sends throughout a run. This fork forwards those via `runpod.serverless.progress_update(job, json.dumps({value, max, node}))`. Our own client (`runpod-serverless-client.ts`) polls RunPod's `/status` endpoint and — confirmed by reading the real `runpod-python` SDK source, not assumed — that progress payload arrives back as a JSON *string* under `status.output` while a job is `IN_PROGRESS`, which the client `JSON.parse()`s to drive the app's progress bar.
2. **Generic output collection.** Upstream's `handler.py` only ever looks for an output node's `"images"` key. Video/audio-producing save nodes report their files under a different key (`"videos"`, `"gifs"`, etc., depending on the node), so the stock handler silently dropped every video output. This fork scans every key on every output node whose value looks like a list of file entries — mirrors this app's own `extractOutputFiles()` in `apps/api/src/comfy/real-client.ts`.

## 1.4 Deploying the endpoint

1. RunPod dashboard → Serverless → New Endpoint → point it at the image you pushed (the versioned tag, not `:latest`).
2. Pick a GPU tier with enough VRAM — LTX-2.5 at higher resolutions/durations needs real headroom; an under-provisioned tier OOMs mid-generation rather than failing to start (this has happened at 1080p/10s on a 24GB tier — if you hit it, the fix is a bigger tier or lower resolution/duration, not a code change).
3. Copy the endpoint id it gives you.

## 1.5 Wiring the app to it

```
RUNPOD_API_KEY=<your RunPod API key>
RUNPOD_ENDPOINT_IDS={"ltx2.5-t2v":"<the endpoint id from 1.4>"}
```
`RUNPOD_ENDPOINT_IDS` is a JSON object mapping **each `config/models.config.ts` model id to its own endpoint id** — one endpoint per model, since each is a separate image with that model's weights baked in. Adding a second model (e.g. Wan 2.2, see Part 2 for gathering its weights) means building a second image the same way, deploying a second endpoint, and adding a second entry to this JSON object plus a corresponding entry back in `config/models.config.ts`.

After any change here: `docker compose restart api` (env vars only load at boot), then confirm with `curl -s http://localhost:3001/health/comfyui` → `{"connected":true}`.

## 1.6 If a job gets stuck

Same underlying risk as Part 2 section 7, different trigger: if the worker's websocket connection to ComfyUI drops mid-job in a way the client's `waitForCompletion` never resolves, this app's single-worker queue blocks every job behind it (confirmed root cause of a real stuck-queue incident this app hit with the native Stock Footage pipeline, not this RunPod path specifically — but the fix is identical either way):
```bash
docker compose restart api
```
Resets the in-memory queue state and resumes anything left in `queued`.

---

# Part 2 — Historical: self-hosted Pod setup

Superseded by Part 1 for LTX-2.5 — kept because **the exact weight-download commands below are still exactly what you need** when baking a new model's weights into a new Serverless image (e.g. Wan 2.2 5B/14B, which don't have a Serverless image built yet — see `config/models.config.ts`'s comment on why they're not in the model picker). Section 9's "long-term fix" below is, in fact, what Part 1 now documents as done.

## 2.1. Deploying the pod correctly

- **Template:** a plain `Runpod Pytorch` image — **2.4.0 / CUDA 12.4.1 / devel / Ubuntu 22.04**. Not the official `runpod/comfyui` template — its bootstrap script is broken (crash-loops on a missing venv, confirmed reproducible across two separate deploys).
- **GPU:** RTX 4090, Community Cloud pricing (~$0.34/hr) unless reliability matters more than cost.
- **Container disk:** at least **50GB**. The default is often ~20GB, which isn't enough once torch + ComfyUI + a custom node pack are installed — `pip` fails with "No space left on device" partway through.
- **Exposed HTTP ports:** explicitly add **8188** (ComfyUI) alongside whatever default is offered. Don't assume it carries over from a previous deploy — a retry after "Instance not available" has silently dropped it before.
- **Volume:** attach your existing network volume (holds all downloaded model weights) at mount path `/workspace`.

> **Verify before relying on it:** After deploying, open the pod's Connect tab → HTTP services and confirm port `8188` is actually listed. If it only shows `8888`, port 8188 wasn't exposed — skip to section 4 (Jupyter-proxy workaround) rather than troubleshooting blind.

---

## 2.2. Why things break — the 4 root causes

**1. Container (root) disk is fully ephemeral.** Everything under `/` — ComfyUI itself, custom nodes, Python packages — is wiped on any stop, including RunPod's automatic migration when your GPU gets reassigned to another user while stopped. Only `/workspace` (the network volume) survives. This is why ComfyUI needs reinstalling almost every session — it's not a bug, it's how the platform works.

**2. The network volume can't run code, only store files.** `/workspace` is a FUSE filesystem (`geesefs`) that doesn't support the file operations Python venvs and `git` need (setting executable permission bits fails with `Operation not permitted`). Plain `git clone` and `python3 -m venv` both fail there. Fix: install ComfyUI and all Python packages on the root disk; only model weight files (plain reads/writes, no permission bits) go on `/workspace`.

**3. The base image's torch is too old for current ComfyUI.** The template ships `torch 2.4.1+cu124`. ComfyUI's current `comfy_kitchen` extension needs a newer `torch.library.custom_op` feature and crashes on startup with an `infer_schema` error on 2.4.1. Fix: reinstall with `--upgrade` against the `cu128` index — without `--upgrade`, pip sees torch already installed and silently no-ops regardless of `--index-url`.

**4. Downloaded files can land in the wrong folder.** `hf download <repo> <path> --local-dir X` preserves the repo's internal folder structure under `X`. Comfy-Org's Wan repo nests everything under a `split_files/` prefix — so files land at `X/split_files/diffusion_models/...` instead of `X/diffusion_models/...`, and ComfyUI's model dropdowns won't see them. Always `ls -lh` the actual destination after downloading, don't assume.

---

## 2.3. One-shot setup script

Paste this whole block into a fresh pod's terminal. It installs ComfyUI, the LTX-2.5 custom node pack, and downloads anything missing for all three models — skipping what's already on `/workspace` from a previous session.

### Step 0 — auth (once per pod, needed for LTX-2.5's gated weights)
```bash
pip install -U huggingface_hub
hf auth login
# paste your HuggingFace token when prompted
```

### Step 1 — ComfyUI + torch (the correct, forced upgrade)
```bash
cd /
wget -c https://github.com/comfyanonymous/ComfyUI/archive/refs/heads/master.tar.gz
tar -xzf master.tar.gz
mv ComfyUI-master ComfyUI
cd /ComfyUI
rm -rf models
ln -s /workspace/models models
mkdir -p /workspace/models/diffusion_models /workspace/models/text_encoders \
         /workspace/models/vae /workspace/models/latent_upscale_models

pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
```

### Step 2 — LTX-2.5 custom node pack
```bash
cd /ComfyUI/custom_nodes
wget -c https://github.com/Lightricks/ComfyUI-LTXVideo/archive/refs/heads/master.tar.gz
tar -xzf master.tar.gz
mv ComfyUI-LTXVideo-master ComfyUI-LTXVideo
cd ComfyUI-LTXVideo
pip install -r requirements.txt
cd /ComfyUI
```

### Step 3 — model weights (skips anything already downloaded)
```bash
# Wan 2.2 5B
[ -f models/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors ] || hf download Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors --local-dir /workspace/models
[ -f models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors ] || hf download Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors --local-dir /workspace/models
[ -f models/vae/wan2.2_vae.safetensors ] || hf download Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/vae/wan2.2_vae.safetensors --local-dir /workspace/models

# Wan 2.2 14B (image-to-video only, needs a reference image)
[ -f models/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors ] || hf download Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors --local-dir /workspace/models
[ -f models/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors ] || hf download Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors --local-dir /workspace/models
[ -f models/vae/wan_2.1_vae.safetensors ] || hf download Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/vae/wan_2.1_vae.safetensors --local-dir /workspace/models

# LTX-2.5 (gated -- needs Step 0 done first)
[ -f models/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors ] || hf download Lightricks/LTX-2.5 diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors --local-dir /workspace/models
[ -f models/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors ] || hf download Lightricks/LTX-2.5 latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors --local-dir /workspace/models
[ -f models/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors ] || hf download Lightricks/LTX-2.5 text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors --local-dir /workspace/models
[ -f models/vae/ltx-2.5-audio-vae-bf16.safetensors ] || hf download Lightricks/LTX-2.5 vae/ltx-2.5-audio-vae-bf16.safetensors vae/ltx-2.5-video-vae-bf16.safetensors --local-dir /workspace/models

# Sanity check -- confirm nothing landed in a wrong subfolder (see root cause #4)
find /workspace/models -mindepth 3
```

> If the `find` command shows a `split_files/` folder: `mv` the files up one level into the correct `diffusion_models`/`vae`/`text_encoders` folder, then `rm -rf` the leftover `split_files` directory.

### Step 4 — start ComfyUI
```bash
pkill -f "python3 main.py" 2>/dev/null || true
sleep 2
nohup python3 main.py --listen 0.0.0.0 --port 8188 > /workspace/comfyui.log 2>&1 &
sleep 15
tail -40 /workspace/comfyui.log
ps aux | grep main.py
```
Look for `To see the GUI go to: http://0.0.0.0:8188` with no Python traceback above it, and a live PID in the process list.

---

## 2.4. If port 8188 isn't exposed

Happens when the deploy step's exposed-ports setting didn't carry through. Rather than redeploying, tunnel through Jupyter (port 8888, usually already exposed) using its `jupyter-server-proxy` extension.

```bash
pip install jupyter-server-proxy

# Find Jupyter's exact running command first -- ps aux | grep jupyter,
# then: cat /proc/<PID>/cmdline | tr '\0' ' '
# Kill it and relaunch with the IDENTICAL flags (token included), e.g.:

kill <PID>
sleep 2
cd /workspace
nohup /usr/bin/python /usr/local/bin/jupyter-lab --allow-root --no-browser --port=8888 --ip=* \
  --FileContentsManager.delete_to_trash=False \
  --ServerApp.terminado_settings='{"shell_command":["/bin/bash"]}' \
  --ServerApp.token=<same-token-as-before> \
  --ServerApp.allow_origin=* --ServerApp.preferred_dir=/workspace \
  > /workspace/jupyter.log 2>&1 &
```

> **Cosmetic gotcha:** that relaunch command often makes the *current* terminal look frozen (the quoted JSON confuses the shell's display). The process itself usually starts fine — open a **new** terminal tab/SSH session and check with `ps aux | grep jupyter` rather than fighting the stuck one.

Once Jupyter's confirmed alive (`curl -s -o /dev/null -w "%{http_code}" http://localhost:8888` → `302`), ComfyUI is reachable at:
```
https://<pod-id>-8888.proxy.runpod.net/proxy/8188/
```

Use that exact URL (with `/proxy/8188` appended) as `COMFYUI_BASE_URL` in the app's `.env`, and set `COMFYUI_AUTH_TOKEN` to Jupyter's token — our real ComfyUI client appends it as a query param on every request, since Jupyter requires it even though plain HTTP GETs can look like they succeed without it (the WebSocket connection is what actually enforces it, failing with `403` otherwise).

---

## 2.5. Speeding up model loading

`/workspace` is reliable but slow for the kind of large sequential reads a first model load does — a Wan 2.2 5B load can take 7-8 minutes straight off the network volume. Copying weights to the root disk first cuts that to seconds.

```bash
# Example for LTX-2.5 -- adjust paths per model
mkdir -p /ComfyUI/models_local/diffusion_models /ComfyUI/models_local/text_encoders \
         /ComfyUI/models_local/vae /ComfyUI/models_local/latent_upscale_models

cp -v /workspace/models/diffusion_models/<file> /ComfyUI/models_local/diffusion_models/
# ...repeat cp for each file the model needs...

# swap the symlink once the current job (if any) is finished:
pkill -f "python3 main.py"; sleep 2
cd /ComfyUI && rm models && ln -s /ComfyUI/models_local models
nohup python3 main.py --listen 0.0.0.0 --port 8188 > /workspace/comfyui.log 2>&1 &
```

> **Disk budget is tight:** root disk is only ~50GB. LTX-2.5 alone needs ~39GB locally. Wan 5B needs ~19GB more. They likely won't all fit locally at once — keep only the model you're actively testing copied locally; it still exists safely on `/workspace` either way.

---

## 2.6. Reconnecting our app

Every time the pod's URL changes (new pod ID, or switching between direct-port and Jupyter-proxy access):

1. Update `COMFYUI_BASE_URL` (and `COMFYUI_AUTH_TOKEN` if using the Jupyter proxy) in the repo's root `.env`.
2. `docker compose restart api` — env vars only load at boot.
3. Confirm: `curl -s http://localhost:3001/health/comfyui` → `{"connected":true}`.

---

## 2.7. After any pod-side ComfyUI restart

> **Easy to miss:** if a job was mid-generation on our app's side when ComfyUI got killed/restarted on the pod, its WebSocket dies silently and our single-worker queue gets stuck waiting on it — every job after it just sits `queued` forever (or until a 45-minute timeout). New jobs won't run until this clears.

**Fix:** always restart our own api container after restarting ComfyUI on the pod — its boot sequence resets the stuck worker state and resumes any queued jobs automatically.
```bash
docker compose restart api
```

---

## 2.8. Troubleshooting quick reference

| Symptom | Cause | Fix |
|---|---|---|
| `infer_schema` / `comfy_kitchen` crash on startup | torch still 2.4.1 | `pip install --upgrade torch ... --index-url .../cu128` |
| `git clone` fails: `chmod ... Operation not permitted` | FUSE volume can't set exec bits | Use the `wget` tarball method instead of `git clone` |
| `python3 -m venv` fails on `Activate.ps1` | Same FUSE limitation | Don't create venvs on `/workspace` — install directly on root disk |
| Port 8188 404s on the RunPod proxy URL | Port wasn't exposed at deploy time | Use the Jupyter-proxy workaround (section 4) |
| `[Errno 21] Is a directory: '/ComfyUI/input'` | An image-to-video model ran with no source image supplied | Use "Continue clip" (supplies the image), or pick a text-to-video model instead |
| `hf: command not found` | `huggingface_hub` not installed yet on this fresh pod | `pip install -U huggingface_hub` first |
| Model file downloaded but ComfyUI's dropdown doesn't show it | Landed under an extra `split_files/` folder | `mv` it to the correct subfolder (see root cause #4) |
| New jobs stuck in `queued` forever | Worker stuck on a job whose WebSocket died | `docker compose restart api` |
| "No space left on device" mid-`pip install` | Root disk too small (often defaults to ~20GB) | Redeploy with container disk set to 50GB+ |

---

## 2.9. The actual long-term fix — done, see Part 1

Everything above is a workaround for one root problem: the root disk is rebuilt from scratch every time the pod stops. The permanent fix was building a custom Docker image with ComfyUI, torch, and the LTX-2.5 node pack already baked in — and going a step further, using RunPod **Serverless** instead of a Pod at all, so there's no persistent instance to manage or pay for while idle. That's Part 1 at the top of this file, and it's what the app actually runs on today. Use Part 2 above only when you need this app's Pod-based weight-download commands as a reference for building a *new* Serverless image (e.g. Wan 2.2) — not for day-to-day operation.
