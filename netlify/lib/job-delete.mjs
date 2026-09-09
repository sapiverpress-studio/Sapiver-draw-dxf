function jobRevisionKey(id, revision) {
  return `jobs/${id}/r${Math.max(1, Number(revision) || 1)}.json`;
}

function jobHeadKey(id) {
  return `heads/${id}.json`;
}

async function deletePrefix(store, prefix) {
  const listed = await store.list({ prefix });
  for (const blob of listed.blobs || []) await store.delete(blob.key);
}

export async function deleteDraftJob(store, id) {
  const headKey = jobHeadKey(id);
  const head = await store.get(headKey, { type: 'json' });
  if (!head) return { error: 'Job not found.', status: 404 };
  if (head.status !== 'draft') {
    return {
      error: 'Only draft jobs can be deleted. Locked and signed revisions are retained for traceability.',
      status: 409,
    };
  }

  const revision = Math.max(1, Number(head.revision) || 1);
  await store.delete(jobRevisionKey(id, revision));
  await deletePrefix(store, `files/${id}/r${revision}/`);

  if (revision > 1) {
    const previous = await store.get(jobRevisionKey(id, revision - 1), { type: 'json' });
    if (previous && ['locked', 'sent'].includes(previous.status)) {
      await store.setJSON(headKey, previous, {
        metadata: {
          updatedAt: previous.updatedAt || previous.createdAt || new Date().toISOString(),
          status: previous.status,
          jobRef: String(previous.jobRef || '').slice(0, 120),
        },
      });
      return { restoredJob: previous };
    }
  }

  await deletePrefix(store, `jobs/${id}/`);
  await deletePrefix(store, `files/${id}/`);
  await store.delete(headKey);
  return { restoredJob: null };
}
