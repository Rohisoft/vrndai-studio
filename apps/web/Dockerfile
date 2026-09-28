# Build context is the REPO ROOT (see docker-compose.yml's `context: .`) --
# npm workspaces needs every workspace's package.json present to install
# correctly, even though this container only ever runs the web dev server.
FROM node:18-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev:web"]
