import assert from 'node:assert/strict';
import { authConfigured, checkRateLimit, clearFailures, isAuthenticated, recordFailure, sessionCookie, verifyCode } from '../netlify/lib/access-auth.mjs';

const values = new Map([
  ['QUICK_DXF_ACCESS_CODE', '123456'],
  ['QUICK_DXF_SESSION_SECRET', 'test-secret-with-at-least-thirty-two-characters'],
]);
globalThis.Netlify = { env: { get: (name) => values.get(name) || '' } };

class MemoryStore {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key) ?? null; }
  async setJSON(key, value) { this.map.set(key, value); }
  async delete(key) { this.map.delete(key); }
}

assert.equal(authConfigured(), true);
assert.equal(verifyCode('123456'), true);
assert.equal(verifyCode('12345'), false);
assert.equal(verifyCode('123456#'), false, '# is the submit key, not part of the secret');

const cookie = sessionCookie().split(';')[0];
assert.equal(isAuthenticated(new Request('https://example.test', { headers: { cookie } })), true);
assert.equal(isAuthenticated(new Request('https://example.test', { headers: { cookie: `${cookie}x` } })), false);

const store = new MemoryStore();
let rate = await checkRateLimit(store, '192.0.2.1');
for (let i = 0; i < 5; i += 1) { await recordFailure(store, rate); rate = await checkRateLimit(store, '192.0.2.1'); }
assert.equal(rate.allowed, false);
await clearFailures(store, rate);
assert.equal((await checkRateLimit(store, '192.0.2.1')).allowed, true);

console.log('access auth tests passed');
