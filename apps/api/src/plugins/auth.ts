import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';

const COOKIE_NAME = 'auth_token';
const COOKIE_VALUE = 'authenticated';
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Paths reachable with no password, even when APP_PASSWORD is set --
// health checks need to work for monitoring/debugging regardless of auth,
// and login/status are how the client establishes a session in the first
// place (a chicken-and-egg problem if they were gated too).
const PUBLIC_PATHS = new Set(['/health', '/health/comfyui', '/api/auth/login', '/api/auth/status']);

function loadOrCreateAuthSecret(dataDir: string): string {
  const secretPath = path.join(dataDir, '.auth-secret');
  try {
    return fs.readFileSync(secretPath, 'utf-8').trim();
  } catch {
    const secret = randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretPath, secret, 'utf-8');
    return secret;
  }
}

export async function registerAuth(app: FastifyInstance, env: Env): Promise<void> {
  const secret = loadOrCreateAuthSecret(env.DATA_DIR);

  await app.register(cookie, { secret });

  app.addHook('onRequest', async (request, reply) => {
    if (!env.APP_PASSWORD || PUBLIC_PATHS.has(request.url.split('?')[0])) {
      return;
    }

    const raw = request.cookies[COOKIE_NAME];
    const unsigned = raw ? request.unsignCookie(raw) : null;

    if (!unsigned?.valid || unsigned.value !== COOKIE_VALUE) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Login required.' });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { password?: string } | undefined;

    if (!env.APP_PASSWORD || body?.password !== env.APP_PASSWORD) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Incorrect password.' });
      return;
    }

    reply.setCookie(COOKIE_NAME, COOKIE_VALUE, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return { authenticated: true };
  });

  app.get('/api/auth/status', async (request) => {
    if (!env.APP_PASSWORD) {
      return { passwordRequired: false, authenticated: true };
    }

    const raw = request.cookies[COOKIE_NAME];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    return { passwordRequired: true, authenticated: unsigned?.valid === true && unsigned.value === COOKIE_VALUE };
  });
}
