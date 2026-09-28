import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configurable so the same config works both for plain `npm run dev`
// (api reachable at localhost) and inside Docker Compose, where the api
// container is only reachable by its service name, not 127.0.0.1.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Set directly here rather than via a --host CLI flag: npm's nested
    // "npm run dev:web" -> "npm run dev --workspace=apps/web" script chain
    // doesn't forward extra CLI args through to the underlying vite process,
    // so a flag passed at the Docker CMD level silently never arrives --
    // confirmed by testing actual reachability from outside the container,
    // not just that the container "started". Setting it in config sidesteps
    // that forwarding entirely.
    host: '0.0.0.0',
    // Bind-mounted source under Docker Desktop doesn't always deliver native
    // filesystem change events reliably, so fall back to polling for HMR.
    watch: { usePolling: true },
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: true },
      '/health': { target: apiProxyTarget, changeOrigin: true },
    },
  },
});
