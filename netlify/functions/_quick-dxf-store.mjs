import { getStore } from '@netlify/blobs';

export const JOB_STORE = 'quick-dxf-jobs';

export function store() {
  return getStore({ name: JOB_STORE, consistency: 'strong' });
}

export function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function safeId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$/.test(id) ? id : null;
}

export function safeFileId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{5,159}$/.test(id) ? id : null;
}

export function jobKey(id) {
  return `jobs/${id}.json`;
}

export function fileKey(jobId, revision, fileId) {
  return `files/${jobId}/r${Number(revision) || 1}/${fileId}`;
}

export function summary(job) {
  return {
    id: job.id,
    jobRef: job.jobRef || '',
    customerName: job.customerName || '',
    date: job.date || '',
    revision: Number(job.revision) || 1,
    status: job.status || 'draft',
    sourceCount: Array.isArray(job.sources) ? job.sources.length : 0,
    updatedAt: job.updatedAt || job.createdAt || '',
    sentAt: job.sentAt || null,
    outcome: job.outcome || null,
  };
}

export function assertMutable(existing, incoming) {
  if (!existing) return;
  const frozen = ['locked', 'sent'].includes(existing.status);
  if (!frozen) return;
  const sameRevision = Number(incoming.revision) === Number(existing.revision);
  if (sameRevision) {
    throw new Error('This revision is locked. Create a new revision before changing it.');
  }
  if (Number(incoming.revision) !== Number(existing.revision) + 1) {
    throw new Error('A locked job can only advance to the next revision.');
  }
}
