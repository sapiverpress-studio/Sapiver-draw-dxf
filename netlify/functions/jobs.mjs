import { assertMutable, jobKey, json, safeId, store, summary } from './_quick-dxf-store.mjs';

async function listJobs(s, query) {
  const q = String(query || '').trim().toLowerCase();
  const items = [];
  let cursor;
  do {
    const page = await s.list({ prefix: 'jobs/', cursor });
    for (const blob of page.blobs || []) {
      const job = await s.get(blob.key, { type: 'json' });
      if (!job) continue;
      const item = summary(job);
      const haystack = `${item.jobRef} ${item.customerName} ${item.date} ${item.status}`.toLowerCase();
      if (!q || haystack.includes(q)) items.push(item);
    }
    cursor = page.next_cursor || page.nextCursor || null;
  } while (cursor);
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return items.slice(0, 100);
}

export default async (request) => {
  const s = store();
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const id = url.searchParams.get('id');
    if (id) {
      const valid = safeId(id);
      if (!valid) return json({ error: 'Invalid job ID.' }, 400);
      const job = await s.get(jobKey(valid), { type: 'json' });
      return job ? json({ ok: true, job }) : json({ error: 'Job not found.' }, 404);
    }
    return json({ ok: true, jobs: await listJobs(s, url.searchParams.get('q')) });
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    let incoming;
    try { incoming = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    const id = safeId(incoming?.id);
    if (!id) return json({ error: 'Invalid job ID.' }, 400);

    const key = jobKey(id);
    const existing = await s.get(key, { type: 'json' });
    try { assertMutable(existing, incoming); } catch (error) { return json({ error: error.message }, 409); }

    const now = new Date().toISOString();
    const job = {
      ...incoming,
      id,
      revision: Math.max(1, Number(incoming.revision) || 1),
      createdAt: existing?.createdAt || incoming.createdAt || now,
      updatedAt: now,
    };
    await s.setJSON(key, job, {
      metadata: {
        updatedAt: now,
        status: job.status || 'draft',
        jobRef: String(job.jobRef || '').slice(0, 120),
      },
    });
    return json({ ok: true, job, summary: summary(job) });
  }

  return json({ error: 'Method not allowed.' }, 405);
};
