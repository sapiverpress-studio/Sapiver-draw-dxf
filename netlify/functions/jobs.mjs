import { assertRevisionTransition, jobHeadKey, jobRevisionKey, json, safeId, store, summary } from './_quick-dxf-store.mjs';

async function listJobs(s, query) {
  const q = String(query || '').trim().toLowerCase();
  const items = [];
  const page = await s.list({ prefix: 'heads/' });
  for (const blob of page.blobs || []) {
    const head = await s.get(blob.key, { type: 'json' });
    if (!head) continue;
    const item = summary(head);
    const haystack = `${item.jobRef} ${item.customerName} ${item.date} ${item.status}`.toLowerCase();
    if (!q || haystack.includes(q)) items.push(item);
  }
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
      const requestedRevision = Number(url.searchParams.get('revision'));
      if (Number.isFinite(requestedRevision) && requestedRevision > 0) {
        const job = await s.get(jobRevisionKey(valid, requestedRevision), { type: 'json' });
        return job ? json({ ok: true, job }) : json({ error: 'Job revision not found.' }, 404);
      }
      const head = await s.get(jobHeadKey(valid), { type: 'json' });
      return head ? json({ ok: true, job: head }) : json({ error: 'Job not found.' }, 404);
    }
    return json({ ok: true, jobs: await listJobs(s, url.searchParams.get('q')) });
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    let incoming;
    try { incoming = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    const id = safeId(incoming?.id);
    if (!id) return json({ error: 'Invalid job ID.' }, 400);

    const headKey = jobHeadKey(id);
    const head = await s.get(headKey, { type: 'json' });
    try { assertRevisionTransition(head, incoming); } catch (error) { return json({ error: error.message }, 409); }

    const now = new Date().toISOString();
    const revision = Math.max(1, Number(incoming.revision) || 1);
    const previousSameRevision = await s.get(jobRevisionKey(id, revision), { type: 'json' });
    const job = {
      ...incoming,
      id,
      revision,
      createdAt: head?.createdAt || incoming.createdAt || now,
      revisionCreatedAt: previousSameRevision?.revisionCreatedAt || now,
      updatedAt: now,
    };

    await s.setJSON(jobRevisionKey(id, revision), job, {
      metadata: { updatedAt: now, status: job.status || 'draft', revision: String(revision) },
    });
    await s.setJSON(headKey, job, {
      metadata: { updatedAt: now, status: job.status || 'draft', jobRef: String(job.jobRef || '').slice(0, 120) },
    });
    return json({ ok: true, job, summary: summary(job) });
  }

  return json({ error: 'Method not allowed.' }, 405);
};
