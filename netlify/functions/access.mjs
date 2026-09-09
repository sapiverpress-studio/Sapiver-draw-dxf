import { authConfigured, checkRateLimit, clearFailures, clearSessionCookie, isAuthenticated, recordFailure, sessionCookie, verifyCode } from '../lib/access-auth.mjs';
import { json, store } from './_quick-dxf-store.mjs';

function response(value, status = 200, cookie = null) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (cookie) headers['set-cookie'] = cookie;
  return new Response(JSON.stringify(value), { status, headers });
}

export default async (request, context) => {
  if (request.method === 'GET') {
    return json({ configured: authConfigured(), authenticated: isAuthenticated(request) });
  }
  if (request.method === 'DELETE') {
    return response({ ok: true, authenticated: false }, 200, clearSessionCookie());
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!authConfigured()) return json({ error: 'Access protection is not configured.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const s = store();
  const rate = await checkRateLimit(s, context?.ip);
  if (!rate.allowed) return json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
  if (!verifyCode(body?.code)) {
    await recordFailure(s, rate);
    return json({ error: 'Incorrect access code.' }, 401);
  }
  await clearFailures(s, rate);
  return response({ ok: true, authenticated: true }, 200, sessionCookie());
};
