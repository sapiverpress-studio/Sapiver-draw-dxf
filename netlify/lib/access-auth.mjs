import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'quick_dxf_session';
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;

function env(name) {
  return Netlify.env.get(name) || '';
}

function configuredCode() {
  const code = String(env('QUICK_DXF_ACCESS_CODE')).trim();
  return /^\d{6}$/.test(code) ? code : null;
}

function secret() {
  return String(env('QUICK_DXF_SESSION_SECRET')).trim();
}

function equalText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function cookieValue(request) {
  const cookies = String(request.headers.get('cookie') || '').split(';');
  for (const item of cookies) {
    const [name, ...rest] = item.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return '';
}

export function authConfigured() {
  return Boolean(configuredCode() && secret().length >= 32);
}

export function isAuthenticated(request) {
  if (!authConfigured()) return false;
  const [expiresText, signature] = cookieValue(request).split('.');
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires <= Math.floor(Date.now() / 1000) || !signature) return false;
  return equalText(signature, sign(expiresText));
}

export function requireAuth(request, json) {
  if (!authConfigured()) return json({ error: 'Access protection is not configured.' }, 503);
  if (!isAuthenticated(request)) return json({ error: 'Login required.' }, 401);
  return null;
}

export function verifyCode(code) {
  const expected = configuredCode();
  return Boolean(expected && /^\d{6}$/.test(String(code || '')) && equalText(code, expected));
}

export function sessionCookie() {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return `${COOKIE_NAME}=${expires}.${sign(expires)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function attemptKey(ip) {
  const digest = createHash('sha256').update(String(ip || 'unknown')).digest('hex');
  return `auth-attempts/${digest}.json`;
}

export async function checkRateLimit(store, ip) {
  const key = attemptKey(ip);
  const value = await store.get(key, { type: 'json' });
  const now = Math.floor(Date.now() / 1000);
  if (!value || Number(value.resetAt) <= now) return { allowed: true, key, failures: 0, resetAt: now + LOCK_SECONDS };
  return { allowed: Number(value.failures) < MAX_FAILURES, key, failures: Number(value.failures) || 0, resetAt: Number(value.resetAt) };
}

export async function recordFailure(store, rate) {
  await store.setJSON(rate.key, { failures: rate.failures + 1, resetAt: rate.resetAt });
}

export async function clearFailures(store, rate) {
  await store.delete(rate.key);
}
