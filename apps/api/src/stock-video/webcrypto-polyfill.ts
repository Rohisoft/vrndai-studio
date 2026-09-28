import { webcrypto } from 'node:crypto';

// msedge-tts v2's compiled output calls the browser Web Crypto global
// (crypto.subtle.digest / crypto.getRandomValues) directly instead of
// requiring Node's 'crypto' module. That global is present when Node loads
// a CJS module via require(), but NOT when reached through Node's
// CJS-in-ESM interop -- i.e. `import ... from 'msedge-tts'` from our own
// ESM code (apps/api's package.json has "type":"module"). Confirmed live:
// identical code throws "crypto is not defined" under `import` and works
// fine under `require()`, both on the same Node 18.20.8. Import this module
// (for its side effect only) before anything that touches msedge-tts.
if (!globalThis.crypto) {
  (globalThis as { crypto?: unknown }).crypto = webcrypto;
}
