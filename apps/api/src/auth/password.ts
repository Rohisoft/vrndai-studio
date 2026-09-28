import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

// node:crypto's scrypt instead of bcrypt -- keeps this dependency-free, same
// as the rest of this app's no-axios/no-bcrypt-if-the-standard-library-
// already-does-it approach. scryptSync is deliberately synchronous: this
// only ever runs at login (one request) or at boot (seeding one user), not
// in a hot path, so blocking the event loop briefly is a non-issue here.
export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  // timingSafeEqual requires equal-length buffers -- a length mismatch
  // means the hash is simply wrong (not equal), not an error worth
  // surfacing differently, so this guard has to come first.
  if (candidate.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(candidate, expected);
}
