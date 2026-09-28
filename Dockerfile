# Single-service production image for Render: builds the React frontend
# and runs the API in one container, with the API serving the built SPA
# directly (see apps/api/src/app.ts's webDistDir handling) -- no separate
# static site or rewrite-proxy, so SSE (job progress, Assistant streaming)
# behaves identically to local dev. Build context is the REPO ROOT (npm
# workspaces needs every workspace's package.json present to install).
FROM node:18-slim

# ffmpeg is used directly (video/frame-extract.ts, video/combine.ts,
# stock-video/assemble.ts) for clip-continuation, clip-combining, and
# stock-footage-assembly. fonts-noto-core adds Devanagari (and other non-
# Latin script) glyph coverage the base image's DejaVu-only fonts lack --
# without it, ffmpeg's subtitles filter renders Hindi captions as empty
# tofu boxes (confirmed live: libass/fontconfig automatically falls back to
# Noto for missing glyphs once it's installed).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY . .

RUN npm run build --workspace=apps/web

EXPOSE 3001

CMD ["npm", "run", "start", "--workspace=apps/api"]
