import assert from 'node:assert/strict';
import { deleteDraftJob, purgeStoredJob } from '../netlify/lib/job-delete.mjs';

class MemoryStore {
  constructor(entries = {}) { this.map = new Map(Object.entries(entries)); }
  async get(key) { return this.map.has(key) ? structuredClone(this.map.get(key)) : null; }
  async setJSON(key, value) { this.map.set(key, structuredClone(value)); }
  async delete(key) { this.map.delete(key); }
  async list({ prefix } = {}) { return { blobs: [...this.map.keys()].filter((key) => !prefix || key.startsWith(prefix)).map((key) => ({ key, etag: 'x' })), directories: [] }; }
}

{
  const s = new MemoryStore({
    'heads/job123.json': { id:'job123', revision:1, status:'draft', jobRef:'D1' },
    'jobs/job123/r1.json': { id:'job123', revision:1, status:'draft', jobRef:'D1' },
    'files/job123/r1/source.jpg': 'bytes',
  });
  const result = await deleteDraftJob(s, 'job123');
  assert.equal(result.restoredJob, null);
  assert.equal(await s.get('heads/job123.json'), null);
  assert.equal(await s.get('jobs/job123/r1.json'), null);
  assert.equal(await s.get('files/job123/r1/source.jpg'), null);
}

{
  const locked = { id:'job456', revision:1, status:'locked', jobRef:'L1' };
  const s = new MemoryStore({ 'heads/job456.json': locked, 'jobs/job456/r1.json': locked });
  const result = await deleteDraftJob(s, 'job456');
  assert.equal(result.status, 409);
  assert.equal((await s.get('heads/job456.json')).status, 'locked');
}

{
  const prior = { id:'job789', revision:1, status:'locked', jobRef:'R1', updatedAt:'2026-09-09T00:00:00Z' };
  const draft = { id:'job789', revision:2, status:'draft', jobRef:'R1' };
  const s = new MemoryStore({
    'heads/job789.json': draft,
    'jobs/job789/r1.json': prior,
    'jobs/job789/r2.json': draft,
    'files/job789/r1/final.dxf': 'final',
    'files/job789/r2/new.jpg': 'draft-file',
  });
  const result = await deleteDraftJob(s, 'job789');
  assert.equal(result.restoredJob.status, 'locked');
  assert.equal((await s.get('heads/job789.json')).revision, 1);
  assert.equal(await s.get('jobs/job789/r2.json'), null);
  assert.equal(await s.get('files/job789/r2/new.jpg'), null);
assert.equal(await s.get('files/job789/r1/final.dxf'), 'final');

const complete = new MemoryStore({
  'heads/job999.json': { id:'job999', revision:2, status:'locked' },
  'jobs/job999/r1.json': { id:'job999', revision:1, status:'locked' },
  'jobs/job999/r2.json': { id:'job999', revision:2, status:'locked' },
  'files/job999/r1/old.dxf': 'old',
  'files/job999/r2/final.dxf': 'final',
});
const purged = await purgeStoredJob(complete, 'job999');
assert.equal(purged.deleted, true);
assert.equal(await complete.get('heads/job999.json'), null);
assert.equal(await complete.get('jobs/job999/r1.json'), null);
assert.equal(await complete.get('jobs/job999/r2.json'), null);
assert.equal(await complete.get('files/job999/r2/final.dxf'), null);
}

console.log('job-delete tests passed');
