# Build context is the REPO ROOT (see docker-compose.yml's `context: .`),
# not apps/api/ -- this is an npm workspaces monorepo, so installing
# correctly requires every workspace's package.json to be present, and this
# service also reads config/ and workflows/ via relative paths at runtime,
# not just apps/api/'s own source.
FROM node:18-slim

# better-sqlite3 is a native module. A prebuilt binary might not exist for
# this exact image/platform combination, so python3/make/g++ let npm fall
# back to compiling from source -- without them, npm ci can fail
# non-obviously. ffmpeg is used directly (video/frame-extract.ts,
# video/combine.ts, stock-video/assemble.ts) for the clip-continuation,
# clip-combining, and stock-footage-assembly features. fonts-noto-core adds
# Devanagari (and other non-Latin script) glyph coverage that the base
# image's DejaVu-only fonts lack -- without it, ffmpeg's subtitles filter
# renders Hindi captions as empty tofu boxes (confirmed live: libass/
# fontconfig automatically falls back to Noto for missing glyphs once it's
# installed, no per-language font selection needed in assemble.ts).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ffmpeg fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY . .

EXPOSE 3001

CMD ["npm", "run", "dev:api"]
