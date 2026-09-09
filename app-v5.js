import { buildConfirmationPdf } from './core/confirmation-pdf.js';
import { compileSourceGeometry } from './core/geometry.js';
import { buildDxf } from './core/dxf.js';
import { saveZip, zipFromRefs } from './core/zip.js';
import {
  geometrySlots,
  slotByKey,
  slotDimensionId,
  setSlotDimensionId,
  dimensionForSlot,
  dimensionReadyForSlot,
  repairGeometryLinks,
  reviewStats,
  unlinkedDimensions,
  unlinkDimension,
  reviewDrawingDataUrl,
} from './core/review-model.js';

const $ = (s) => document.querySelector(s);
const els = {
  storageBadge: $('#storageBadge'), revisionBadge: $('#revisionBadge'),
  newJobBtn: $('#newJobBtn'), newRevisionBtn: $('#newRevisionBtn'), saveJobBtn: $('#saveJobBtn'), saveState: $('#saveState'),
  jobRef: $('#jobRef'), customerName: $('#customerName'), customerEmail: $('#customerEmail'), staffName: $('#staffName'), jobDate: $('#jobDate'),
  jobSearch: $('#jobSearch'), refreshJobsBtn: $('#refreshJobsBtn'), jobResults: $('#jobResults'),
  cameraInput: $('#cameraInput'), fileInput: $('#fileInput'), sourceStrip: $('#sourceStrip'), sourceEmpty: $('#sourceEmpty'), sourceCount: $('#sourceCount'),
  activeSourceTitle: $('#activeSourceTitle'), activeSourceMeta: $('#activeSourceMeta'), drawingPreview: $('#drawingPreview'), drawingPlaceholder: $('#drawingPlaceholder'),
  geometryPreview: $('#geometryPreview'), geometryPlaceholder: $('#geometryPlaceholder'), geometryState: $('#geometryState'),
  aiState: $('#aiState'), analyseBtn: $('#analyseBtn'), dimensionList: $('#dimensionList'), dimensionEmpty: $('#dimensionEmpty'), reviewProgress: $('#reviewProgress'), addCorrectionBtn: $('#addCorrectionBtn'),
  pdfBtn: $('#pdfBtn'), pdfState: $('#pdfState'), signedInput: $('#signedInput'), signedState: $('#signedState'), customerConfirmed: $('#customerConfirmed'),
  productionBtn: $('#productionBtn'), exportChoiceBtn: $('#exportChoiceBtn'), sendBtn: $('#sendBtn'), releaseMessage: $('#releaseMessage'), dxfState: $('#dxfState'), releaseDownloads: $('#releaseDownloads'),
};

const API = {
  jobs: '/.netlify/functions/jobs',
  files: '/.netlify/functions/job-file',
  analyse: '/.netlify/functions/analyse-drawing',
};
const CACHE_KEY = 'quick-dxf-unsynced-v1';
let saveTimer = null;
let saving = false;
let backendOnline = false;
const activeAnalysisPolls = new Set();

const initialState = () => ({
  id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  revision: 1,
  status: 'draft',
  activeSourceId: null,
  sources: [],
  confirmationPdf: null,
  signedProof: null,
  dxfFiles: [],
  outcome: null,
  customerConfirmed: false,
  createdAt: null,
  updatedAt: null,
  sentAt: null,
  sentTo: null,
});
let state = initialState();

function id() { return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function activeSource() { return state.sources.find((s) => s.id === state.activeSourceId) ?? null; }
function isFrozen() { return ['locked', 'sent'].includes(state.status); }
function nowDate() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c])); }
function drawingLabel(source, index = state.sources.indexOf(source)) { return `Drawing ${String.fromCharCode(65 + Math.max(0, index))}`; }
function extensionFor(file) {
  const fromName = String(file.name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName === 'jpeg' ? 'jpg' : fromName;
  if (file.type === 'image/jpeg') return 'jpg';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'application/pdf') return 'pdf';
  return 'bin';
}
function fileEndpoint({ revision = state.revision, fileId, jobId = state.id } = {}) {
  return `${API.files}?${new URLSearchParams({ job: jobId, revision: String(revision), file: fileId })}`;
}

function setStorageBadge(mode, text) {
  els.storageBadge.textContent = text;
  els.storageBadge.className = `badge ${mode === 'ok' ? '' : mode === 'warn' ? 'warn' : mode === 'error' ? 'error' : 'neutral'}`;
}

function cleanOldManualBlanks(source) {
  if (!source?.dimensions) return source;
  const removed = new Set(source.dimensions.filter((d) => d.confidence === 'manual' && !(Number(d.valueMm) > 0) && !d.confirmed).map((d) => d.id));
  if (!removed.size) return source;
  for (const dimensionId of removed) unlinkDimension(source, dimensionId);
  source.dimensions = source.dimensions.filter((d) => !removed.has(d.id));
  return source;
}

function normaliseSource(source) {
  const next = { ...source, dimensions: Array.isArray(source?.dimensions) ? source.dimensions.map((d) => ({ ...d })) : [] };
  cleanOldManualBlanks(next);
  repairGeometryLinks(next);
  return next;
}

function serialisableState() {
  return {
    id: state.id,
    jobRef: els.jobRef.value.trim(),
    customerName: els.customerName.value.trim(),
    customerEmail: els.customerEmail.value.trim(),
    staffName: els.staffName.value.trim(),
    date: els.jobDate.value,
    revision: state.revision,
    status: state.status,
    sources: state.sources.map((s) => ({
      id: s.id, name: s.name, kind: s.kind, contentType: s.contentType,
      fileId: s.fileId, fileKey: s.fileKey, sourceRevision: s.sourceRevision,
      previewFileId: s.previewFileId || null, previewFileKey: s.previewFileKey || null, previewUrl: s.previewUrl || null,
      pageCount: s.pageCount || null,
      analysisStatus: s.analysisStatus, analysis: s.analysis || null,
      analysisResponseId: s.analysisResponseId || null, analysisStartedAt: s.analysisStartedAt || null,
      analysisModel: s.analysisModel || null, analysisUsage: s.analysisUsage || null,
      dimensions: s.dimensions || [],
    })),
    confirmationPdf: state.confirmationPdf,
    signedProof: state.signedProof,
    dxfFiles: state.dxfFiles,
    outcome: state.outcome,
    customerConfirmed: Boolean(els.customerConfirmed.checked),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    sentAt: state.sentAt,
    sentTo: state.sentTo,
  };
}

function cacheLocal() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(serialisableState())); } catch {}
}

function invalidateApproval() {
  if (isFrozen()) return false;
  state.confirmationPdf = null;
  state.signedProof = null;
  state.dxfFiles = [];
  state.outcome = null;
  state.customerConfirmed = false;
  els.customerConfirmed.checked = false;
  return true;
}

function mapDimension(raw, idx) {
  const role = raw.role || 'unknown';
  let reference = ['size', 'centre', 'edge'].includes(raw.reference) ? raw.reference : 'unknown';
  if (reference === 'unknown' && ['overall', 'size', 'diameter', 'radius'].includes(role)) reference = 'size';
  const value = Number(raw.value ?? raw.value_mm ?? raw.valueMm);
  return {
    id: raw.id || id(),
    label: raw.target || raw.label || raw.description || `${role === 'overall' ? 'Overall' : 'Dimension'} ${idx + 1}`,
    role,
    valueMm: Number.isFinite(value) && value > 0 ? value : null,
    reference,
    fromEdge: ['left','right','top','bottom'].includes(raw.from_edge || raw.fromEdge) ? (raw.from_edge || raw.fromEdge) : 'unknown',
    rawText: raw.raw_text || raw.rawText || '',
    confidence: raw.confidence || 'unknown',
    confirmed: false,
  };
}

function productionGeometry(source) {
  repairGeometryLinks(source);
  return compileSourceGeometry(source);
}

function sourceReady(source) {
  if (!source?.analysis) return false;
  repairGeometryLinks(source);
  const stats = reviewStats(source);
  if (!stats.total || stats.confirmed !== stats.total) return false;
  return productionGeometry(source).ok;
}
function jobReady() { return state.sources.length > 0 && state.sources.every(sourceReady); }
function canApprove() { return backendOnline && jobReady() && Boolean(state.confirmationPdf?.fileKey) && Boolean(state.signedProof?.fileKey) && els.customerConfirmed.checked; }

function hydrateJob(job) {
  state = {
    ...initialState(),
    ...job,
    sources: Array.isArray(job.sources) ? job.sources.map(normaliseSource) : [],
    confirmationPdf: job.confirmationPdf || null,
    signedProof: job.signedProof || null,
    dxfFiles: Array.isArray(job.dxfFiles) ? job.dxfFiles : [],
  };
  state.activeSourceId = state.sources[0]?.id ?? null;
  els.jobRef.value = job.jobRef || '';
  els.customerName.value = job.customerName || '';
  els.customerEmail.value = job.customerEmail || '';
  els.staffName.value = job.staffName || '';
  els.jobDate.value = job.date || nowDate();
  els.customerConfirmed.checked = Boolean(job.customerConfirmed);
  state.customerConfirmed = Boolean(job.customerConfirmed);
  setEditable(!isFrozen());
  cacheLocal();
  render();
  queueMicrotask(() => resumePendingAnalyses());
}

function setEditable(enabled) {
  [els.jobRef, els.customerName, els.customerEmail, els.staffName, els.jobDate, els.cameraInput, els.fileInput, els.customerConfirmed, els.signedInput].forEach((el) => { el.disabled = !enabled; });
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body?.error || `${response.status} ${response.statusText}`);
  backendOnline = true;
  setStorageBadge('ok', 'Shared storage: online');
  return body;
}

async function checkBackend() {
  try {
    await apiJson(`${API.jobs}?q=__quick_dxf_healthcheck__`);
    await refreshJobs();
  } catch (error) {
    backendOnline = false;
    setStorageBadge('warn', 'Shared storage: not active');
    els.saveState.textContent = 'Shared backend is unavailable. Current browser changes are held only as an emergency local cache.';
  }
}

async function saveJob({ immediate = false } = {}) {
  if (isFrozen() && !immediate) return false;
  if (saving) return false;
  clearTimeout(saveTimer);
  saving = true;
  els.saveState.textContent = 'Saving…';
  cacheLocal();
  try {
    const result = await apiJson(API.jobs, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(serialisableState()),
    });
    state.createdAt = result.job.createdAt;
    state.updatedAt = result.job.updatedAt;
    els.saveState.textContent = `Saved to shared storage · ${new Date(result.job.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    cacheLocal();
    return true;
  } catch (error) {
    backendOnline = false;
    setStorageBadge('warn', 'Shared storage: save pending');
    els.saveState.textContent = `Shared save unavailable: ${error.message}. Emergency local copy retained.`;
    return false;
  } finally {
    saving = false;
  }
}

function scheduleSave() {
  if (isFrozen()) return;
  cacheLocal();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveJob(), 650);
}

async function refreshJobs() {
  if (!backendOnline) return;
  const q = els.jobSearch.value.trim();
  try {
    const result = await apiJson(`${API.jobs}?${new URLSearchParams({ q })}`);
    renderJobResults(result.jobs || []);
  } catch (error) {
    els.jobResults.innerHTML = `<div class="small muted">Could not load shared jobs: ${escapeHtml(error.message)}</div>`;
  }
}

function renderJobResults(jobs) {
  els.jobResults.innerHTML = '';
  for (const job of jobs.slice(0, 30)) {
    const row = document.createElement('div');
    row.className = 'job-result';
    const load = document.createElement('button');
    load.type = 'button'; load.className = 'job-result-load';
    load.innerHTML = `<span><strong>${escapeHtml(job.jobRef || job.id)}</strong><small>${escapeHtml(job.customerName || 'No customer')} · ${escapeHtml(job.date || 'No date')}</small></span><em>Rev ${job.revision} · ${escapeHtml(job.status)}</em>`;
    load.addEventListener('click', () => loadJob(job.id));
    row.appendChild(load);
    if (job.status === 'draft') {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'job-delete'; del.textContent = 'Delete';
      del.setAttribute('aria-label', `Delete draft ${job.jobRef || job.id}`);
      del.addEventListener('click', () => deleteDraftJob(job));
      row.appendChild(del);
    }
    els.jobResults.appendChild(row);
  }
  if (!jobs.length) els.jobResults.innerHTML = '<div class="small muted">No matching shared jobs.</div>';
}

async function loadJob(jobId) {
  try {
    els.saveState.textContent = 'Loading shared job…';
    const result = await apiJson(`${API.jobs}?${new URLSearchParams({ id: jobId })}`);
    hydrateJob(result.job);
    els.saveState.textContent = `Loaded shared job · revision ${state.revision}`;
  } catch (error) {
    els.saveState.textContent = `Could not load job: ${error.message}`;
  }
}

async function deleteDraftJob(job) {
  if (job.status !== 'draft') return;
  const name = job.jobRef || job.id;
  if (!confirm(`Delete draft ${name}? Signed/locked revisions are never deleted.`)) return;
  try {
    const result = await apiJson(`${API.jobs}?${new URLSearchParams({ id: job.id })}`, { method: 'DELETE' });
    if (state.id === job.id && state.status === 'draft') {
      if (result.restoredJob) hydrateJob(result.restoredJob);
      else newJob(true);
    }
    els.saveState.textContent = result.restoredJob ? 'Draft revision deleted; previous signed revision restored.' : 'Draft deleted.';
    await refreshJobs();
  } catch (error) {
    els.saveState.textContent = `Draft could not be deleted: ${error.message}`;
  }
}

function newJob(force = false) {
  if (!force && state.sources.length && !confirm('Start a new job? The current draft remains saved unless you delete it from Saved jobs.')) return;
  state = initialState();
  els.jobRef.value = '';
  els.customerName.value = '';
  els.customerEmail.value = '';
  els.staffName.value = '';
  els.jobDate.value = nowDate();
  els.customerConfirmed.checked = false;
  setEditable(true);
  cacheLocal();
  render();
  els.jobRef.focus();
}

async function newRevision() {
  if (!isFrozen()) return;
  const oldRevision = state.revision;
  state.revision += 1;
  state.status = 'draft';
  state.outcome = null;
  state.confirmationPdf = null;
  state.signedProof = null;
  state.dxfFiles = [];
  state.sentAt = null;
  state.sentTo = null;
  state.customerConfirmed = false;
  els.customerConfirmed.checked = false;
  state.sources = state.sources.map((s) => normaliseSource({ ...s, analysisResponseId: null, analysisStartedAt: null, dimensions: (s.dimensions || []).map((d) => ({ ...d, confirmed: false })) }));
  setEditable(true); render();
  await saveJob({ immediate: true });
  els.saveState.textContent = `Revision ${state.revision} created from locked revision ${oldRevision}.`;
}

async function uploadFile(file, fileId, kind, revision = state.revision) {
  const response = await fetch(fileEndpoint({ fileId, revision }), {
    method: 'PUT',
    headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': file.name || fileId, 'x-file-kind': kind },
    body: file,
  });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body?.error || `File upload failed (${response.status})`);
  backendOnline = true;
  setStorageBadge('ok', 'Shared storage: online');
  return body;
}

async function pdfPreview(file) {
  const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs';
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.8, 1500 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .9));
  return { blob, pageCount: pdf.numPages };
}

async function addSourceFile(file) {
  const sourceId = id();
  const ext = extensionFor(file);
  const fileId = `${sourceId}.${ext}`;
  const source = {
    id: sourceId, name: file.name, kind: file.type === 'application/pdf' || ext === 'pdf' ? 'pdf' : 'image', contentType: file.type || 'application/octet-stream',
    fileId, fileKey: null, sourceRevision: state.revision, previewFileId: null, previewFileKey: null,
    previewUrl: sourceId, pageCount: null, analysisStatus: 'uploading', dimensions: [], analysis: null,
    analysisResponseId: null, analysisStartedAt: null, analysisModel: null, analysisUsage: null,
  };
  if (file.type.startsWith('image/')) source.previewUrl = URL.createObjectURL(file);
  state.sources.push(source);
  if (!state.activeSourceId) state.activeSourceId = source.id;
  invalidateApproval(); render();

  try {
    await saveJob({ immediate: true });
    const uploaded = await uploadFile(file, fileId, 'source');
    source.fileKey = uploaded.fileKey;
    if (source.kind === 'image') {
      if (source.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(source.previewUrl);
      source.previewUrl = uploaded.url;
    } else {
      const preview = await pdfPreview(file);
      source.pageCount = preview.pageCount;
      const previewId = `${sourceId}-preview.jpg`;
      const previewFile = new File([preview.blob], `${file.name}-preview.jpg`, { type: 'image/jpeg' });
      const previewUploaded = await uploadFile(previewFile, previewId, 'preview');
      source.previewFileId = previewId;
      source.previewFileKey = previewUploaded.fileKey;
      source.previewUrl = previewUploaded.url;
    }
    source.analysisStatus = 'awaiting';
    await saveJob({ immediate: true });
    render();
    await analyseSource(source);
  } catch (error) {
    source.analysisStatus = 'error';
    source.error = error.message;
    render(); scheduleSave();
  }
}

async function addFiles(files) {
  if (isFrozen() || !files?.length) return;
  for (const file of files) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') || file.type.startsWith('image/')) await addSourceFile(file);
  }
}

async function removeSource(sourceId) {
  if (isFrozen()) return;
  const idx = state.sources.findIndex((s) => s.id === sourceId);
  if (idx < 0) return;
  const [removed] = state.sources.splice(idx, 1);
  if (removed.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl);
  if (state.activeSourceId === sourceId) state.activeSourceId = state.sources[0]?.id ?? null;
  invalidateApproval(); render(); scheduleSave();
}

function applyAnalysisResult(source, result) {
  const extraction = result.extraction || {};
  source.analysis = extraction;
  source.dimensions = Array.isArray(extraction.dimensions) ? extraction.dimensions.map(mapDimension) : [];
  source.analysisStatus = source.dimensions.length ? 'review' : 'needs-review';
  source.analysisResponseId = null;
  source.analysisStartedAt = null;
  source.analysisModel = result.model;
  source.analysisUsage = result.usage || null;
  source.error = null;
  repairGeometryLinks(source);
  invalidateApproval();
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function pollAnalysis(source) {
  const responseId = source?.analysisResponseId;
  if (!responseId || activeAnalysisPolls.has(responseId) || isFrozen()) return;
  activeAnalysisPolls.add(responseId);
  let transientFailures = 0;
  try {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (isFrozen() || source.analysisResponseId !== responseId || !state.sources.some((item) => item.id === source.id)) return;
      await wait(attempt === 0 ? 750 : 2000);
      let result;
      try {
        result = await apiJson(API.analyse, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'poll', responseId }),
        });
        transientFailures = 0;
      } catch (error) {
        transientFailures += 1;
        if (transientFailures < 4) continue;
        throw error;
      }
      if (source.analysisResponseId !== responseId) return;
      if (result.pending) {
        source.analysisStatus = 'analysing';
        if (activeSource()?.id === source.id) render();
        continue;
      }
      applyAnalysisResult(source, result);
      render();
      await saveJob({ immediate: true });
      return;
    }
    throw new Error('AI analysis is still running after 6 minutes. Start the analysis again.');
  } catch (error) {
    if (source.analysisResponseId === responseId) {
      source.analysisStatus = 'error'; source.error = error.message; source.analysisResponseId = null; source.analysisStartedAt = null;
      render(); scheduleSave();
    }
  } finally {
    activeAnalysisPolls.delete(responseId);
  }
}

function resumePendingAnalyses() {
  if (isFrozen()) return;
  for (const source of state.sources) if (source.analysisStatus === 'analysing' && source.analysisResponseId) pollAnalysis(source);
}

async function analyseSource(source = activeSource()) {
  if (!source || isFrozen() || !source.fileKey) return;
  source.analysisStatus = 'analysing'; source.error = null; source.analysis = null; source.dimensions = [];
  source.analysisResponseId = null; source.analysisStartedAt = new Date().toISOString();
  invalidateApproval(); render();
  try {
    const result = await apiJson(API.analyse, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: state.id, revision: state.revision, fileId: source.fileId, fileKey: source.fileKey, contentType: source.contentType, filename: source.name }),
    });
    if (result.pending) {
      if (!result.responseId) throw new Error('AI analysis started without a response ID.');
      source.analysisResponseId = result.responseId; source.analysisModel = result.model; source.analysisStatus = 'analysing';
      render(); await saveJob({ immediate: true }); await pollAnalysis(source); return;
    }
    applyAnalysisResult(source, result); render(); await saveJob({ immediate: true });
  } catch (error) {
    source.analysisStatus = 'error'; source.error = error.message; source.analysisResponseId = null; source.analysisStartedAt = null;
    render(); scheduleSave();
  }
}

function ensureDimensionDialog() {
  let dialog = $('#dimensionDialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'dimensionDialog';
  dialog.className = 'dimension-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="dimension-dialog-card">
      <div class="dialog-head"><div><p class="eyebrow">Dimension</p><h2 id="dimensionDialogTitle">Add dimension</h2></div><button class="dialog-x" value="cancel" aria-label="Cancel">×</button></div>
      <label>Use for<select id="dimensionTarget"></select></label>
      <label id="dimensionDescriptionWrap">Description<input id="dimensionDescription" type="text"></label>
      <label>Measurement (mm)<input id="dimensionValue" type="number" min="0" step="0.01" inputmode="decimal"></label>
      <div id="dimensionPositionFields">
        <label>Measured to<select id="dimensionReference"><option value="centre">Centre</option><option value="edge">Edge</option></select></label>
        <label>Measured from<select id="dimensionFromEdge"></select></label>
      </div>
      <div class="dialog-actions"><button class="button quiet" value="cancel">Cancel</button><button id="dimensionAddBtn" class="button primary" type="button">Add dimension</button></div>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

function fillEdgeOptions(select, axis, selected = 'unknown') {
  select.innerHTML = '';
  const values = axis === 'x' ? [['unknown','Choose left or right'],['left','From left'],['right','From right']] : [['unknown','Choose top or bottom'],['bottom','From bottom'],['top','From top']];
  for (const [value, label] of values) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option);
  }
  select.value = values.some(([v]) => v === selected) ? selected : 'unknown';
}

function openDimensionDialog({ slotKey = null, existingDimension = null } = {}) {
  const source = activeSource();
  if (!source || isFrozen()) return;
  repairGeometryLinks(source);
  const dialog = ensureDimensionDialog();
  const target = $('#dimensionTarget');
  const description = $('#dimensionDescription');
  const value = $('#dimensionValue');
  const positionFields = $('#dimensionPositionFields');
  const reference = $('#dimensionReference');
  const fromEdge = $('#dimensionFromEdge');
  const addBtn = $('#dimensionAddBtn');
  const title = $('#dimensionDialogTitle');

  const slots = geometrySlots(source);
  target.innerHTML = '';
  const additional = document.createElement('option'); additional.value = 'additional'; additional.textContent = 'Additional reference dimension (does not affect DXF)'; target.appendChild(additional);
  for (const slot of slots) {
    const current = dimensionForSlot(source, slot);
    if (!slotKey && !existingDimension && current) continue;
    const option = document.createElement('option'); option.value = slot.key; option.textContent = current ? `${slot.label} (replace current link)` : slot.label; target.appendChild(option);
  }
  if (slotKey && [...target.options].some((o) => o.value === slotKey)) target.value = slotKey;
  else if (existingDimension) {
    const currentSlot = slots.find((s) => slotDimensionId(source, s) === existingDimension.id);
    if (currentSlot && [...target.options].some((o) => o.value === currentSlot.key)) target.value = currentSlot.key;
    else target.value = [...target.options].find((o) => o.value !== 'additional')?.value || 'additional';
  } else target.value = [...target.options].find((o) => o.value !== 'additional')?.value || 'additional';

  title.textContent = existingDimension ? 'Assign / correct dimension' : 'Add dimension';
  description.value = existingDimension?.label || '';
  value.value = existingDimension?.valueMm ?? '';

  function syncTarget() {
    const slot = target.value === 'additional' ? null : slotByKey(source, target.value);
    if (slot) description.value = slot.label;
    positionFields.hidden = !slot || slot.kind !== 'position';
    if (slot?.kind === 'position') {
      reference.value = ['centre','edge'].includes(existingDimension?.reference) ? existingDimension.reference : 'centre';
      fillEdgeOptions(fromEdge, slot.axis, existingDimension?.fromEdge || 'unknown');
    }
  }
  target.onchange = syncTarget;
  syncTarget();

  addBtn.onclick = () => {
    const numeric = Number(value.value);
    if (!(numeric > 0)) { value.focus(); return; }
    const slot = target.value === 'additional' ? null : slotByKey(source, target.value);
    if (slot?.kind === 'position' && fromEdge.value === 'unknown') { fromEdge.focus(); return; }
    let d = existingDimension;
    if (!d) {
      d = { id: `manual-${id()}`, label: '', role: 'unknown', valueMm: null, reference: 'unknown', fromEdge: 'unknown', rawText: '', confidence: 'manual', confirmed: false };
      source.dimensions.push(d);
    }
    d.label = slot?.label || description.value.trim() || 'Additional dimension';
    d.valueMm = numeric;
    d.confirmed = false;
    d.confidence = d.confidence || 'manual';
    if (slot) {
      setSlotDimensionId(source, slot, d.id);
      if (slot.kind === 'size') { d.reference = 'size'; d.fromEdge = 'unknown'; }
      else { d.role = 'position'; d.reference = reference.value; d.fromEdge = fromEdge.value; }
    } else {
      d.reference = 'size'; d.fromEdge = 'unknown'; d.role = 'unknown';
    }
    repairGeometryLinks(source);
    invalidateApproval(); dialog.close(); render(); scheduleSave();
  };
  dialog.showModal();
}

function removeManualDimension(source, dimension) {
  if (isFrozen() || dimension.confidence !== 'manual') return;
  unlinkDimension(source, dimension.id);
  source.dimensions = source.dimensions.filter((d) => d.id !== dimension.id);
  invalidateApproval(); render(); scheduleSave();
}

function makeSlotCard(source, slot) {
  const d = dimensionForSlot(source, slot);
  const card = document.createElement('article');
  card.className = `dimension-row feature-dimension ${d?.confirmed ? 'is-confirmed' : ''}`;
  if (!d) {
    card.classList.add('missing-dimension');
    card.innerHTML = `<div class="dimension-title-row"><strong>${escapeHtml(slot.label)}</strong><span class="parameter-pill ${slot.kind}">${slot.kind === 'size' ? 'Size' : 'Position'}</span></div><p class="small muted">No figured value is currently linked to this required geometry parameter.</p>`;
    const add = document.createElement('button'); add.type = 'button'; add.className = 'button quiet full'; add.textContent = 'Add value'; add.disabled = isFrozen(); add.addEventListener('click', () => openDimensionDialog({ slotKey: slot.key }));
    card.appendChild(add);
    return card;
  }

  const titleRow = document.createElement('div'); titleRow.className = 'dimension-title-row';
  titleRow.innerHTML = `<strong>${escapeHtml(slot.label)}</strong><span class="parameter-pill ${slot.kind}">${slot.kind === 'size' ? 'Size' : 'Position'}</span>`;
  card.appendChild(titleRow);

  const valueWrap = document.createElement('div'); valueWrap.className = 'dimension-value-wrap feature-value';
  const value = document.createElement('input'); value.className = 'dimension-value'; value.type = 'number'; value.min = '0'; value.step = '0.01'; value.inputMode = 'decimal'; value.value = d.valueMm ?? ''; value.disabled = isFrozen();
  const unit = document.createElement('span'); unit.textContent = 'mm'; valueWrap.append(value, unit); card.appendChild(valueWrap);

  let ref = null;
  let fromEdge = null;
  if (slot.kind === 'position') {
    const controls = document.createElement('div'); controls.className = 'position-controls';
    ref = document.createElement('select'); ref.className = 'dimension-ref'; ref.innerHTML = '<option value="unknown">Choose centre or edge</option><option value="centre">Centre</option><option value="edge">Edge</option>'; ref.value = d.reference || 'unknown'; ref.disabled = isFrozen();
    fromEdge = document.createElement('select'); fromEdge.className = 'dimension-from-edge'; fillEdgeOptions(fromEdge, slot.axis, d.fromEdge || 'unknown'); fromEdge.disabled = isFrozen();
    controls.append(ref, fromEdge); card.appendChild(controls);
  }

  const actions = document.createElement('div'); actions.className = 'dimension-card-actions';
  const confirmBtn = document.createElement('button'); confirmBtn.type = 'button'; confirmBtn.className = `dimension-confirm button ${d.confirmed ? 'confirmed' : ''}`; confirmBtn.textContent = d.confirmed ? 'Confirmed ✓' : 'Confirm'; confirmBtn.disabled = isFrozen(); actions.appendChild(confirmBtn);
  if (d.confidence === 'manual') {
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button quiet dimension-remove'; remove.textContent = 'Remove'; remove.disabled = isFrozen(); remove.addEventListener('click', () => removeManualDimension(source, d)); actions.appendChild(remove);
  }
  card.appendChild(actions);

  const meta = document.createElement('small'); meta.className = 'dimension-meta';
  meta.textContent = d.confidence === 'manual' ? 'Manually added' : `AI read: ${d.rawText || d.valueMm || '—'} · confidence ${d.confidence || 'unknown'}`;
  card.appendChild(meta);

  function updateFromInputs() {
    if (isFrozen()) return;
    const numeric = Number(value.value); d.valueMm = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    if (slot.kind === 'size') { d.reference = 'size'; d.fromEdge = 'unknown'; }
    else { d.reference = ref.value; d.fromEdge = fromEdge.value; }
    d.confirmed = false;
    repairGeometryLinks(source); invalidateApproval(); renderRelease(); scheduleSave(); renderDigitalDrawing(source);
    confirmBtn.textContent = 'Confirm'; confirmBtn.classList.remove('confirmed'); card.classList.remove('is-confirmed');
  }
  value.addEventListener('change', updateFromInputs);
  ref?.addEventListener('change', updateFromInputs);
  fromEdge?.addEventListener('change', updateFromInputs);

  confirmBtn.addEventListener('click', () => {
    const numeric = Number(value.value);
    if (!(numeric > 0)) { value.focus(); return; }
    d.valueMm = numeric;
    if (slot.kind === 'size') { d.reference = 'size'; d.fromEdge = 'unknown'; }
    else {
      if (!['centre','edge'].includes(ref.value)) { ref.focus(); return; }
      if (fromEdge.value === 'unknown') { fromEdge.focus(); return; }
      d.reference = ref.value; d.fromEdge = fromEdge.value;
    }
    d.confirmed = true; repairGeometryLinks(source); invalidateApproval(); render(); scheduleSave();
  });
  return card;
}

function renderDigitalDrawing(source) {
  if (!els.geometryPreview || !els.geometryPlaceholder || !els.geometryState) return;
  if (!source?.analysis) {
    els.geometryPreview.hidden = true; els.geometryPlaceholder.hidden = false; els.geometryState.textContent = 'Clean geometry will appear as dimensions are confirmed.'; els.geometryState.className = 'ai-state geometry-state'; return;
  }
  repairGeometryLinks(source);
  const url = reviewDrawingDataUrl(source);
  if (url) { els.geometryPreview.src = url; els.geometryPreview.hidden = false; els.geometryPlaceholder.hidden = true; }
  else { els.geometryPreview.hidden = true; els.geometryPlaceholder.hidden = false; }
  const stats = reviewStats(source);
  const geometry = stats.total && stats.confirmed === stats.total ? productionGeometry(source) : { ok: false, errors: [] };
  if (geometry.ok) {
    els.geometryState.textContent = `Deterministic geometry ready · ${geometry.parts.length} part${geometry.parts.length === 1 ? '' : 's'}. Confirmed measurements are shown on the digital drawing.`;
    els.geometryState.className = 'ai-state geometry-state ok';
  } else if (stats.confirmed === stats.total && stats.total) {
    els.geometryState.textContent = `Geometry blocked: ${geometry.errors?.[0] || 'A required geometry relationship is unresolved.'}`;
    els.geometryState.className = 'ai-state geometry-state error';
  } else {
    els.geometryState.textContent = `Digital drawing updating · ${stats.confirmed}/${stats.total} production parameters confirmed.`;
    els.geometryState.className = 'ai-state geometry-state';
  }
}

function renderSources() {
  els.sourceStrip.innerHTML = '';
  els.sourceEmpty.hidden = state.sources.length > 0;
  els.sourceCount.textContent = `${state.sources.length} drawing${state.sources.length === 1 ? '' : 's'}`;
  state.sources.forEach((source, index) => {
    repairGeometryLinks(source);
    const stats = reviewStats(source);
    const card = document.createElement('button'); card.type = 'button'; card.className = `source-card ${source.id === state.activeSourceId ? 'active' : ''}`;
    const statusClass = source.analysisStatus === 'error' ? 'error' : ['uploading','analysing'].includes(source.analysisStatus) ? 'working' : sourceReady(source) ? 'ready' : '';
    let status = sourceReady(source) ? 'Confirmed' : source.analysisStatus === 'uploading' ? 'Uploading…' : source.analysisStatus === 'analysing' ? 'AI analysing…' : source.analysisStatus === 'error' ? 'Error' : source.analysisStatus === 'awaiting' ? 'Awaiting AI' : `${stats.confirmed}/${stats.total} production confirmed`;
    card.innerHTML = `${source.previewUrl ? `<img src="${escapeHtml(source.previewUrl)}" alt="">` : '<span class="source-preview-placeholder">PDF</span>'}<span><strong>${drawingLabel(source, index)}</strong><small>${escapeHtml(source.name)}</small><em class="${statusClass}">${status}</em></span>`;
    card.addEventListener('click', () => { state.activeSourceId = source.id; render(); });
    if (!isFrozen()) {
      const remove = document.createElement('span'); remove.className = 'source-remove'; remove.textContent = '×'; remove.title = 'Remove drawing';
      remove.addEventListener('click', (e) => { e.stopPropagation(); removeSource(source.id); }); card.appendChild(remove);
    }
    els.sourceStrip.appendChild(card);
  });
}

function renderDimensions() {
  const source = activeSource();
  els.dimensionList.innerHTML = '';
  els.addCorrectionBtn.disabled = !source || isFrozen();
  els.analyseBtn.disabled = !source || isFrozen() || !source.fileKey || ['uploading','analysing'].includes(source.analysisStatus);

  if (!source) {
    els.activeSourceTitle.textContent = 'Select a drawing';
    els.activeSourceMeta.textContent = 'AI proposes the geometry; each production parameter is confirmed against the source.';
    els.drawingPreview.hidden = true; els.drawingPlaceholder.hidden = false;
    renderDigitalDrawing(null);
    els.dimensionEmpty.hidden = false; els.aiState.textContent = 'Awaiting analysis'; els.reviewProgress.textContent = '0 / 0 confirmed'; return;
  }

  repairGeometryLinks(source);
  const index = state.sources.indexOf(source);
  const stats = reviewStats(source);
  els.activeSourceTitle.textContent = `${drawingLabel(source, index)} · ${source.name}`;
  const pageInfo = source.pageCount > 1 ? ` · ${source.pageCount} PDF pages` : '';
  els.activeSourceMeta.textContent = `Confirm each production parameter against the source${pageInfo}. Size measurements never need an edge selector; positions explicitly use centre/edge and an outer reference edge.`;
  if (source.previewUrl) { els.drawingPreview.src = source.previewUrl; els.drawingPreview.hidden = false; els.drawingPlaceholder.hidden = true; }
  else { els.drawingPreview.hidden = true; els.drawingPlaceholder.hidden = false; }
  renderDigitalDrawing(source);

  if (source.analysisStatus === 'error') els.aiState.textContent = `Analysis/upload error: ${source.error || 'unknown error'}`;
  else if (source.analysisStatus === 'uploading') els.aiState.textContent = 'Uploading to shared job…';
  else if (source.analysisStatus === 'analysing') els.aiState.textContent = 'Sol is analysing this drawing in the background…';
  else if (source.analysisStatus === 'awaiting') els.aiState.textContent = 'Ready for AI analysis';
  else if (sourceReady(source)) els.aiState.textContent = 'All production parameters confirmed';
  else els.aiState.textContent = 'Customer review required';
  els.aiState.className = `ai-state ${sourceReady(source) ? 'ok' : source.analysisStatus === 'error' ? 'error' : ['review','needs-review'].includes(source.analysisStatus) ? 'warn' : ''}`;
  els.reviewProgress.textContent = `${stats.confirmed} / ${stats.total} confirmed`;
  els.dimensionEmpty.hidden = stats.total > 0 || source.dimensions.length > 0;

  const grouped = new Map();
  for (const slot of stats.slots) {
    if (!grouped.has(slot.section)) grouped.set(slot.section, []);
    grouped.get(slot.section).push(slot);
  }
  for (const [section, slots] of grouped) {
    const group = document.createElement('section'); group.className = 'feature-group';
    const heading = document.createElement('div'); heading.className = 'feature-group-head'; heading.innerHTML = `<strong>${escapeHtml(section)}</strong><span>${slots.filter((slot) => dimensionReadyForSlot(slot, dimensionForSlot(source, slot))).length}/${slots.length}</span>`; group.appendChild(heading);
    for (const slot of slots) group.appendChild(makeSlotCard(source, slot));
    els.dimensionList.appendChild(group);
  }

  const extras = unlinkedDimensions(source).filter((d) => !(d.confidence === 'manual' && !(Number(d.valueMm) > 0)));
  if (extras.length) {
    const extraGroup = document.createElement('section'); extraGroup.className = 'feature-group auxiliary-group';
    const heading = document.createElement('div'); heading.className = 'feature-group-head'; heading.innerHTML = `<strong>Other reads</strong><span>Do not block DXF</span>`; extraGroup.appendChild(heading);
    for (const d of extras) {
      const row = document.createElement('div'); row.className = 'unlinked-read';
      row.innerHTML = `<span><strong>${escapeHtml(d.label || 'Unlinked dimension')}</strong><small>${escapeHtml(d.rawText || `${d.valueMm ?? '—'} mm`)} · ${escapeHtml(d.confidence || 'unknown')} confidence</small></span>`;
      const actions = document.createElement('div'); actions.className = 'unlinked-actions';
      const assign = document.createElement('button'); assign.type = 'button'; assign.className = 'button quiet'; assign.textContent = 'Assign'; assign.disabled = isFrozen(); assign.addEventListener('click', () => openDimensionDialog({ existingDimension: d })); actions.appendChild(assign);
      if (d.confidence === 'manual') { const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button quiet'; remove.textContent = 'Remove'; remove.disabled = isFrozen(); remove.addEventListener('click', () => removeManualDimension(source, d)); actions.appendChild(remove); }
      row.appendChild(actions); extraGroup.appendChild(row);
    }
    els.dimensionList.appendChild(extraGroup);
  }
}

async function createConfirmationPdf() {
  if (!jobReady() || isFrozen()) return;
  els.pdfBtn.disabled = true; els.pdfState.textContent = 'Creating confirmation PDF…';
  try {
    const pdfJob = serialisableState();
    pdfJob.sources = state.sources.map((source, index) => ({ ...pdfJob.sources[index], compiledGeometry: productionGeometry(source) }));
    const bytes = await buildConfirmationPdf(pdfJob);
    const name = `${(els.jobRef.value.trim() || state.id).replace(/[^A-Za-z0-9_-]+/g, '-')}-rev-${state.revision}-confirmation.pdf`;
    const fileId = `confirmation-r${state.revision}-${id()}.pdf`;
    const file = new File([bytes], name, { type: 'application/pdf' });
    const result = await uploadFile(file, fileId, 'confirmation-pdf');
    state.confirmationPdf = { fileId, fileKey: result.fileKey, name, url: result.url, createdAt: new Date().toISOString() };
    state.signedProof = null; els.customerConfirmed.checked = false; state.customerConfirmed = false; state.outcome = null; state.dxfFiles = [];
    await saveJob({ immediate: true }); render();
    const localUrl = URL.createObjectURL(file); window.open(localUrl, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(localUrl), 120000);
  } catch (error) {
    els.pdfState.textContent = `Could not create/save PDF: ${error.message}`; els.pdfState.className = 'signed-state error';
  } finally { renderRelease(); }
}

async function attachSignedProof(file) {
  if (!file || isFrozen() || !state.confirmationPdf?.fileKey) return;
  els.signedState.textContent = 'Saving signed confirmation…';
  try {
    const ext = extensionFor(file);
    const fileId = `signed-r${state.revision}-${id()}.${ext}`;
    const result = await uploadFile(file, fileId, 'signed-confirmation');
    state.signedProof = { fileId, fileKey: result.fileKey, name: file.name || `signed-confirmation.${ext}`, url: result.url, capturedAt: new Date().toISOString() };
    await saveJob({ immediate: true }); render();
  } catch (error) {
    els.signedState.textContent = `Signed photo could not be saved: ${error.message}`; els.signedState.className = 'signed-state error';
  }
}

async function generateDxfFiles() {
  const generated = [];
  for (let sourceIndex = 0; sourceIndex < state.sources.length; sourceIndex += 1) {
    const source = state.sources[sourceIndex];
    const geometry = productionGeometry(source);
    if (!geometry.ok) throw new Error(`${drawingLabel(source, sourceIndex)} cannot generate DXF: ${geometry.errors[0] || 'geometry unresolved'}`);
    for (let partIndex = 0; partIndex < geometry.parts.length; partIndex += 1) {
      const part = geometry.parts[partIndex];
      const dxf = buildDxf(part.entities);
      const safeJob = (els.jobRef.value.trim() || state.id).replace(/[^A-Za-z0-9_-]+/g, '-');
      const safePart = String(part.label || `part-${partIndex + 1}`).replace(/[^A-Za-z0-9_-]+/g, '-');
      const name = `${safeJob}-r${state.revision}-${String.fromCharCode(65 + sourceIndex)}-${safePart}.dxf`;
      const fileId = `dxf-r${state.revision}-${source.id}-${partIndex + 1}.dxf`;
      const file = new File([dxf], name, { type: 'application/dxf' });
      const uploaded = await uploadFile(file, fileId, 'dxf');
      generated.push({ fileId, fileKey: uploaded.fileKey, name, url: uploaded.url, sourceId: source.id, partId: part.id, createdAt: new Date().toISOString() });
    }
  }
  state.dxfFiles = generated;
  return generated;
}

async function lockJob(outcome) {
  if (!canApprove() || isFrozen()) return;
  const previousStatus = state.status;
  const previousOutcome = state.outcome;
  els.releaseMessage.textContent = 'Generating deterministic DXF file(s)…';
  try {
    await generateDxfFiles();
    state.status = 'locked'; state.outcome = outcome; state.customerConfirmed = true;
    setEditable(false); render();
    const saved = await saveJob({ immediate: true });
    if (!saved) throw new Error('The locked revision could not be saved to shared storage.');
    cacheLocal(); render();
  } catch (error) {
    state.status = previousStatus; state.outcome = previousOutcome; state.dxfFiles = []; setEditable(true); render();
    els.releaseMessage.textContent = `Release blocked: ${error.message}`;
  }
}

function renderRelease() {
  state.customerConfirmed = Boolean(els.customerConfirmed.checked);
  const frozen = isFrozen();
  els.pdfBtn.disabled = !jobReady() || frozen || !backendOnline;
  els.productionBtn.disabled = !canApprove() || frozen;
  els.exportChoiceBtn.disabled = !canApprove() || frozen;
  els.newRevisionBtn.hidden = !frozen;
  els.sendBtn.hidden = state.status !== 'locked';
  els.sendBtn.disabled = state.status !== 'locked' || !state.dxfFiles.length;

  if (els.dxfState) {
    els.dxfState.textContent = state.dxfFiles.length ? `${state.dxfFiles.length} deterministic DXF file${state.dxfFiles.length === 1 ? '' : 's'} prepared.` : 'DXF files are generated only when the signed revision is released.';
    els.dxfState.className = `signed-state ${state.dxfFiles.length ? 'ok' : ''}`;
  }

  if (els.releaseDownloads) {
    els.releaseDownloads.innerHTML = '';
    const refs = state.status === 'locked'
      ? [...state.dxfFiles, state.confirmationPdf, state.outcome === 'production' ? state.signedProof : null].filter(Boolean)
      : [];
    if (state.dxfFiles.length) {
      const zipButton = document.createElement('button');
      zipButton.type = 'button';
      zipButton.className = 'button primary full';
      zipButton.textContent = `Download DXF ZIP · ${state.dxfFiles.length} drawing${state.dxfFiles.length === 1 ? '' : 's'}`;
      zipButton.addEventListener('click', async () => {
        zipButton.disabled = true;
        zipButton.textContent = 'Preparing DXF ZIP…';
        try {
          const bytes = await zipFromRefs(state.dxfFiles);
          const safeJob = (els.jobRef.value.trim() || state.id).replace(/[^A-Za-z0-9_-]+/g, '-');
          saveZip(bytes, `${safeJob}-r${state.revision}-DXF.zip`);
          els.releaseMessage.textContent = 'DXF ZIP downloaded. Extract it in Android Files, then open the DXF in your CAD app.';
          els.releaseMessage.classList.remove('error');
        } catch (error) {
          els.releaseMessage.textContent = `DXF ZIP failed: ${error.message}`;
          els.releaseMessage.classList.add('error');
        } finally {
          zipButton.disabled = false;
          zipButton.textContent = `Download DXF ZIP · ${state.dxfFiles.length} drawing${state.dxfFiles.length === 1 ? '' : 's'}`;
        }
      });
      els.releaseDownloads.appendChild(zipButton);
    }
    for (const ref of refs.filter((item) => !/\.dxf$/i.test(item.name))) {
      const link = document.createElement('a');
      link.className = 'button quiet full';
      link.href = ref.url;
      link.download = ref.name;
      const kind = /\.dxf$/i.test(ref.name) ? 'DXF' : /\.pdf$/i.test(ref.name) ? 'confirmation PDF' : 'signed confirmation';
      link.textContent = `Download ${kind} · ${ref.name}`;
      els.releaseDownloads.appendChild(link);
    }
    els.releaseDownloads.hidden = refs.length === 0;
  }

  if (state.status === 'locked') {
    els.releaseMessage.textContent = state.dxfFiles.length ? `Revision ${state.revision} locked. Use Share job pack to send or save the approved files.` : `Revision ${state.revision} is locked but has no DXF output.`;
  } else if (!backendOnline) {
    els.releaseMessage.textContent = 'Shared storage must be online before approval or release.';
  } else if (!jobReady()) {
    els.releaseMessage.textContent = 'Confirm every required production parameter and resolve the deterministic geometry first.';
  } else if (!state.confirmationPdf?.fileKey) {
    els.releaseMessage.textContent = 'Create the confirmation PDF, print it and have the customer sign it.';
  } else if (!state.signedProof?.fileKey) {
    els.releaseMessage.textContent = 'Photograph the signed confirmation and attach it to this revision.';
  } else if (!els.customerConfirmed.checked) {
    els.releaseMessage.textContent = 'Tick the customer confirmation after checking the signed sheet.';
  } else {
    els.releaseMessage.textContent = 'Signed confirmation is stored. Ready to generate DXF files and lock this revision.';
  }
}

function render() {
  const statusText = state.status === 'sent' ? 'Sent' : state.status === 'locked' ? 'Locked' : 'Draft';
  els.revisionBadge.textContent = `Revision ${state.revision} · ${statusText}`;
  els.revisionBadge.className = `badge ${state.status === 'draft' ? '' : 'neutral'}`;
  renderSources(); renderDimensions();
  els.pdfState.textContent = state.confirmationPdf ? `Confirmation PDF saved · ${state.confirmationPdf.name}` : 'No confirmation PDF created for this revision.';
  els.pdfState.className = `signed-state ${state.confirmationPdf ? 'ok' : ''}`;
  els.signedState.textContent = state.signedProof ? `Signed confirmation saved · ${state.signedProof.name}` : 'No signed confirmation attached.';
  els.signedState.className = `signed-state ${state.signedProof ? 'ok' : ''}`;
  setEditable(!isFrozen()); renderRelease();
}

function restoreEmergencyCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached?.id && cached?.status === 'draft') hydrateJob(cached);
    else els.jobDate.value = nowDate();
  } catch { els.jobDate.value = nowDate(); }
}

[els.jobRef, els.customerName, els.customerEmail, els.staffName, els.jobDate].forEach((el) => el.addEventListener('input', () => {
  if (isFrozen()) return;
  invalidateApproval(); renderRelease(); scheduleSave();
}));
els.jobSearch.addEventListener('input', () => { clearTimeout(els.jobSearch._timer); els.jobSearch._timer = setTimeout(refreshJobs, 350); });
els.refreshJobsBtn.addEventListener('click', refreshJobs);
els.saveJobBtn.addEventListener('click', () => saveJob({ immediate: true }));
els.newJobBtn.addEventListener('click', () => newJob(false));
els.newRevisionBtn.addEventListener('click', newRevision);
els.cameraInput.addEventListener('change', async (e) => { await addFiles([...e.target.files]); e.target.value = ''; });
els.fileInput.addEventListener('change', async (e) => { await addFiles([...e.target.files]); e.target.value = ''; });
els.analyseBtn.addEventListener('click', () => analyseSource());
els.addCorrectionBtn.addEventListener('click', () => openDimensionDialog());
els.pdfBtn.addEventListener('click', createConfirmationPdf);
els.signedInput.addEventListener('change', async (e) => { await attachSignedProof(e.target.files?.[0]); e.target.value = ''; });
els.customerConfirmed.addEventListener('change', () => { state.customerConfirmed = els.customerConfirmed.checked; renderRelease(); scheduleSave(); });
els.productionBtn.addEventListener('click', () => lockJob('production'));
els.exportChoiceBtn.addEventListener('click', () => lockJob('export'));

restoreEmergencyCache();
render();
checkBackend();
