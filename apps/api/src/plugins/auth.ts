import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import type { Env } from '../config/env.js';
import { verifyLogin } from '../auth/users.js';

const COOKIE_NAME = 'auth_token';
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Paths reachable with no login, always -- health checks need to work for
// monitoring/debugging regardless of auth, and login/status are how the
// client establishes a session in the first place (a chicken-and-egg
// problem if they were gated too).
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

// A real super-admin account (seeded in MongoDB, see auth/users.ts)
// replaces the old single-shared-secret APP_PASSWORD -- the app is now
// always behind a login (no more "APP_PASSWORD unset = open access" mode,
// since a user account always exists once seeded). The signed cookie's
// value is the logged-in username itself; auth only ever checks the
// signature on each request, no DB round-trip per request, same
// performance characteristic as the old static "authenticated" string.
export async function registerAuth(app: FastifyInstance, env: Env, db: Db): Promise<void> {
  const secret = loadOrCreateAuthSecret(env.DATA_DIR);

  await app.register(cookie, { secret });

  app.addHook('onRequest', async (request, reply) => {
    if (PUBLIC_PATHS.has(request.url.split('?')[0])) {
      return;
    }

    const raw = request.cookies[COOKIE_NAME];
    const unsigned = raw ? request.unsignCookie(raw) : null;

    if (!unsigned?.valid || !unsigned.value) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Login required.' });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { username?: string; password?: string } | undefined;

    if (!body?.username || !body.password || !(await verifyLogin(db, body.username, body.password))) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Incorrect username or password.' });
      return;
    }

    reply.setCookie(COOKIE_NAME, body.username, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return { authenticated: true, username: body.username };
  });

  app.get('/api/auth/status', async (request) => {
    const raw = request.cookies[COOKIE_NAME];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    const authenticated = unsigned?.valid === true && Boolean(unsigned.value);
    return {
      passwordRequired: true,
      authenticated,
      username: authenticated ? (unsigned!.value as string) : null,
    };
  });
}
