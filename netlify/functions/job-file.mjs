import { fileKey, jobRevisionKey, json, safeFileId, safeId, store } from './_quick-dxf-store.mjs';
import { requireAuth } from '../lib/access-auth.mjs';

const MAX_BYTES = 12_000_000;
const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
  'application/dxf', 'application/octet-stream', 'text/plain',
]);

async function assertRevisionWritable(s, jobId, revision) {
  const job = await s.get(jobRevisionKey(jobId, revision), { type: 'json' });
  if (!job) throw new Error('Save the job revision before adding files.');
  if (['locked', 'sent'].includes(job.status)) throw new Error('This signed revision is locked and its files cannot be changed.');
}

export default async (request) => {
  const denied = requireAuth(request, json);
  if (denied) return denied;
  const url = new URL(request.url);
  const jobId = safeId(url.searchParams.get('job'));
  const revision = Math.max(1, Number(url.searchParams.get('revision')) || 1);
  const fileId = safeFileId(url.searchParams.get('file'));
  if (!jobId || !fileId) return json({ error: 'Invalid file reference.' }, 400);

  const s = store();
  const key = fileKey(jobId, revision, fileId);

  if (request.method === 'GET' || request.method === 'HEAD') {
    const data = await s.get(key, { type: 'stream' });
    if (!data) return new Response('Not found.', { status: 404 });
    const meta = await s.getMetadata(key).catch(() => null);
    const headers = {
      'content-type': meta?.metadata?.contentType || 'application/octet-stream',
      'cache-control': 'private, no-store',
      'content-disposition': `inline; filename="${String(meta?.metadata?.filename || fileId).replace(/["\r\n]/g, '')}"`,
    };
    return new Response(request.method === 'HEAD' ? null : data, { headers });
  }

  if (request.method === 'POST' || request.method === 'PUT') {
    try { await assertRevisionWritable(s, jobId, revision); }
    catch (error) { return json({ error: error.message }, 409); }
    const contentType = String(request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    if (!ALLOWED.has(contentType)) return json({ error: 'Unsupported file type.' }, 415);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return json({ error: 'File is empty or exceeds 12 MB.' }, 413);
    const filename = String(request.headers.get('x-file-name') || fileId).slice(0, 180);
    const kind = String(request.headers.get('x-file-kind') || 'source').slice(0, 40);
    await s.set(key, bytes, { metadata: { contentType, filename, kind, uploadedAt: new Date().toISOString() } });
    const encoded = new URLSearchParams({ job: jobId, revision: String(revision), file: fileId });
    return json({ ok: true, fileKey: key, url: `/.netlify/functions/job-file?${encoded}` });
  }

  if (request.method === 'DELETE') {
    try { await assertRevisionWritable(s, jobId, revision); }
    catch (error) { return json({ error: error.message }, 409); }
    await s.delete(key);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed.' }, 405);
};
