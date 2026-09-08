import { buildConfirmationPdf } from './core/confirmation-pdf.js';
import { compileSourceGeometry, geometryToSvgDataUrl } from './core/geometry.js';
import { buildDxf } from './core/dxf.js';

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
  productionBtn: $('#productionBtn'), exportChoiceBtn: $('#exportChoiceBtn'), sendBtn: $('#sendBtn'), releaseMessage: $('#releaseMessage'), dxfState: $('#dxfState'), dimensionTemplate: $('#dimensionTemplate'),
};

const API = {
  jobs: '/.netlify/functions/jobs',
  files: '/.netlify/functions/job-file',
  analyse: '/.netlify/functions/analyse-drawing',
  send: '/.netlify/functions/send-job',
};
const CACHE_KEY = 'quick-dxf-unsynced-v1';
let saveTimer = null;
let saving = false;
let backendOnline = false;

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
function isFrozen() { return state.status === 'locked' || state.status === 'sent'; }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function drawingLabel(source, index = state.sources.indexOf(source)) { return `Drawing ${String.fromCharCode(65 + Math.max(0, index))}`; }
function nowDate() { return new Date().toISOString().slice(0, 10); }
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
      dimensions: s.dimensions || [],
    })),
    confirmationPdf: state.confirmationPdf,
    signedProof: state.signedProof,
    dxfFiles: state.dxfFiles,
    outcome: state.outcome,
    customerConfirmed: Boolean(els.customerConfirmed.checked),
    includeOriginalsInProductionEmail: true,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    sentAt: state.sentAt,
    sentTo: state.sentTo,
  };
}

function cacheLocal() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(serialisableState())); } catch {}
}

function invalidateApproval({ keepSourceAnalysis = true } = {}) {
  if (isFrozen()) return false;
  state.confirmationPdf = null;
  state.signedProof = null;
  state.dxfFiles = [];
  state.outcome = null;
  state.customerConfirmed = false;
  els.customerConfirmed.checked = false;
  if (!keepSourceAnalysis) {
    state.sources.forEach((s) => { s.analysis = null; s.dimensions = []; s.analysisStatus = 'awaiting'; });
  }
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

function refreshGeometry(source) {
  if (!source) return { ok: false, errors: ['No drawing selected.'], parts: [] };
  const geometry = compileSourceGeometry(source);
  source.compiledGeometry = geometry;
  source.geometryPreviewUrl = geometry.ok ? geometryToSvgDataUrl(geometry) : '';
  return geometry;
}

function hydrateJob(job) {
  state = {
    ...initialState(),
    ...job,
    sources: Array.isArray(job.sources) ? job.sources.map((s) => ({ ...s, dimensions: Array.isArray(s.dimensions) ? s.dimensions : [] })) : [],
    confirmationPdf: job.confirmationPdf || null,
    signedProof: job.signedProof || null,
    dxfFiles: Array.isArray(job.dxfFiles) ? job.dxfFiles : [],
  };
  state.activeSourceId = state.sources[0]?.id ?? null;
  state.sources.forEach(refreshGeometry);
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
    els.saveState.textContent = 'Shared backend is not deployed yet. Current browser changes are held only as an emergency local cache.';
  }
}

async function saveJob({ immediate = false } = {}) {
  if (isFrozen() && !immediate) return false;
  if (saving) return false;
  let saved = false;
  clearTimeout(saveTimer);
  saving = true;
  els.saveState.textContent = 'Saving…';
  cacheLocal();
  try {
    const payload = serialisableState();
    const result = await apiJson(API.jobs, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    state.createdAt = result.job.createdAt;
    state.updatedAt = result.job.updatedAt;
    els.saveState.textContent = `Saved to shared storage · ${new Date(result.job.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    cacheLocal();
    saved = true;
  } catch (error) {
    backendOnline = false;
    setStorageBadge('warn', 'Shared storage: save pending');
    els.saveState.textContent = `Shared save unavailable: ${error.message}. Emergency local copy retained on this device.`;
  } finally {
    saving = false;
  }
  return saved;
}

function scheduleSave() {
  if (isFrozen()) return;
  cacheLocal();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveJob(), 700);
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
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'job-result';
    button.innerHTML = `<span><strong>${escapeHtml(job.jobRef || job.id)}</strong><small>${escapeHtml(job.customerName || 'No customer')} · ${escapeHtml(job.date || 'No date')}</small></span><em>Rev ${job.revision} · ${escapeHtml(job.status)}</em>`;
    button.addEventListener('click', () => loadJob(job.id));
    els.jobResults.appendChild(button);
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

function newJob() {
  if (state.sources.length && !confirm('Start a new job? Unsaved local changes to the current draft may be left behind.')) return;
  state = initialState();
  els.jobRef.value = '';
  els.customerName.value = '';
  els.customerEmail.value = '';
  els.staffName.value = '';
  els.jobDate.value = nowDate();
  els.customerConfirmed.checked = false;
  setEditable(true);
  cacheLocal(); render();
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
  state.sources = state.sources.map((s) => ({ ...s, dimensions: (s.dimensions || []).map((d) => ({ ...d, confirmed: false })) }));
  setEditable(true); render();
  await saveJob({ immediate: true });
  els.saveState.textContent = backendOnline ? `Revision ${state.revision} created from signed revision ${oldRevision}.` : `Revision ${state.revision} created locally; shared save is pending.`;
}

async function uploadFile(file, fileId, kind, revision = state.revision) {
  const response = await fetch(fileEndpoint({ fileId, revision }), {
    method: 'PUT',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': file.name || fileId,
      'x-file-kind': kind,
    },
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
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') || file.type.startsWith('image/')) {
      await addSourceFile(file);
    }
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

async function analyseSource(source = activeSource()) {
  if (!source || isFrozen() || !source.fileKey) return;
  source.analysisStatus = 'analysing'; source.error = null; render();
  try {
    const result = await apiJson(API.analyse, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: state.id, revision: state.revision, fileId: source.fileId, fileKey: source.fileKey, contentType: source.contentType, filename: source.name }),
    });
    const extraction = result.extraction || {};
    source.analysis = extraction;
    source.dimensions = Array.isArray(extraction.dimensions) ? extraction.dimensions.map(mapDimension) : [];
    source.analysisStatus = source.dimensions.length ? 'review' : 'needs-review';
    refreshGeometry(source);
    source.analysisModel = result.model;
    source.analysisUsage = result.usage || null;
    invalidateApproval();
    render(); await saveJob({ immediate: true });
  } catch (error) {
    source.analysisStatus = 'error'; source.error = error.message; render(); scheduleSave();
  }
}

function addCorrection() {
  if (isFrozen()) return;
  const source = activeSource(); if (!source) return;
  source.dimensions.push({ id: id(), label: 'Correction / added dimension', role: 'unknown', valueMm: null, reference: 'unknown', fromEdge: 'unknown', rawText: '', confidence: 'manual', confirmed: false });
  source.analysisStatus = 'review'; invalidateApproval(); render(); scheduleSave();
  requestAnimationFrame(() => els.dimensionList.querySelector('article:last-child input')?.focus());
}

function confirmedCount(source) { return source?.dimensions.filter((d) => d.confirmed).length ?? 0; }
function dimensionReady(d) {
  if (!(d?.confirmed && d.valueMm > 0 && d.reference && d.reference !== 'unknown')) return false;
  if (['centre', 'edge'].includes(d.reference) && !['left', 'right', 'top', 'bottom'].includes(d.fromEdge)) return false;
  return true;
}
function sourceReady(source) {
  if (!(source?.dimensions?.length > 0 && source.dimensions.every(dimensionReady))) return false;
  return refreshGeometry(source).ok;
}
function jobReady() { return state.sources.length > 0 && state.sources.every(sourceReady); }
function canApprove() { return backendOnline && jobReady() && Boolean(state.confirmationPdf?.fileKey) && Boolean(state.signedProof?.fileKey) && els.customerConfirmed.checked; }

function renderSources() {
  els.sourceStrip.innerHTML = '';
  els.sourceEmpty.hidden = state.sources.length > 0;
  els.sourceCount.textContent = `${state.sources.length} drawing${state.sources.length === 1 ? '' : 's'}`;
  state.sources.forEach((source, index) => {
    const card = document.createElement('button'); card.type = 'button'; card.className = `source-card ${source.id === state.activeSourceId ? 'active' : ''}`;
    const statusClass = source.analysisStatus === 'error' ? 'error' : ['uploading','analysing'].includes(source.analysisStatus) ? 'working' : sourceReady(source) ? 'ready' : '';
    let status = sourceReady(source) ? 'Confirmed' : source.analysisStatus === 'uploading' ? 'Uploading…' : source.analysisStatus === 'analysing' ? 'AI analysing…' : source.analysisStatus === 'error' ? 'Error' : source.analysisStatus === 'awaiting' ? 'Awaiting AI' : `${confirmedCount(source)}/${source.dimensions.length} confirmed`;
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
    els.activeSourceMeta.textContent = 'AI proposes the values; every production dimension is deliberately confirmed.';
    els.drawingPreview.hidden = true; els.drawingPlaceholder.hidden = false;
    if (els.geometryPreview) els.geometryPreview.hidden = true; if (els.geometryPlaceholder) els.geometryPlaceholder.hidden = false; if (els.geometryState) els.geometryState.textContent = 'Clean geometry will appear after confirmation.';
    els.dimensionEmpty.hidden = false; els.aiState.textContent = 'Awaiting analysis'; els.reviewProgress.textContent = '0 / 0 confirmed'; return;
  }

  const index = state.sources.indexOf(source);
  els.activeSourceTitle.textContent = `${drawingLabel(source, index)} · ${source.name}`;
  const pageInfo = source.pageCount > 1 ? ` · ${source.pageCount} PDF pages` : '';
  els.activeSourceMeta.textContent = `Check every figured value against the source${pageInfo}. Centre/edge intent is explicit for positional dimensions.`;
  if (source.previewUrl) { els.drawingPreview.src = source.previewUrl; els.drawingPreview.hidden = false; els.drawingPlaceholder.hidden = true; }
  else { els.drawingPreview.hidden = true; els.drawingPlaceholder.hidden = false; }

  const geometry = refreshGeometry(source);
  if (els.geometryPreview && els.geometryPlaceholder && els.geometryState) {
    if (geometry.ok) {
      els.geometryPreview.src = source.geometryPreviewUrl; els.geometryPreview.hidden = false; els.geometryPlaceholder.hidden = true;
      els.geometryState.textContent = `Deterministic geometry ready · ${geometry.parts.length} part${geometry.parts.length === 1 ? '' : 's'}.`;
      els.geometryState.className = 'ai-state ok';
    } else {
      els.geometryPreview.hidden = true; els.geometryPlaceholder.hidden = false;
      const first = geometry.errors?.[0];
      els.geometryState.textContent = source.dimensions.every(dimensionReady) && first ? `Geometry blocked: ${first}` : 'Confirm all production dimensions to build the clean geometry.';
      els.geometryState.className = `ai-state ${source.dimensions.every(dimensionReady) ? 'error' : ''}`;
    }
  }

  if (source.analysisStatus === 'error') els.aiState.textContent = `Analysis/upload error: ${source.error || 'unknown error'}`;
  else if (source.analysisStatus === 'uploading') els.aiState.textContent = 'Uploading to shared job…';
  else if (source.analysisStatus === 'analysing') els.aiState.textContent = 'Sol is analysing this drawing…';
  else if (source.analysisStatus === 'awaiting') els.aiState.textContent = 'Ready for AI analysis';
  else if (sourceReady(source)) els.aiState.textContent = 'All production dimensions confirmed';
  else els.aiState.textContent = 'Customer review required';
  els.aiState.className = `ai-state ${sourceReady(source) ? 'ok' : source.analysisStatus === 'error' ? 'error' : source.analysisStatus === 'review' || source.analysisStatus === 'needs-review' ? 'warn' : ''}`;
  els.reviewProgress.textContent = `${confirmedCount(source)} / ${source.dimensions.length} confirmed`;
  els.dimensionEmpty.hidden = source.dimensions.length > 0;

  source.dimensions.forEach((d) => {
    const node = els.dimensionTemplate.content.firstElementChild.cloneNode(true);
    const label = node.querySelector('.dimension-label');
    const value = node.querySelector('.dimension-value');
    const ref = node.querySelector('.dimension-ref');
    const fromEdge = node.querySelector('.dimension-from-edge');
    const confirmBtn = node.querySelector('.dimension-confirm');
    label.value = d.label || ''; value.value = d.valueMm ?? ''; ref.value = d.reference || 'unknown'; fromEdge.value = d.fromEdge || 'unknown';
    [label, value, ref, fromEdge].forEach((input) => {
      input.disabled = isFrozen();
      input.addEventListener('change', () => {
        if (isFrozen()) return;
        d.label = label.value.trim();
        const numeric = Number(value.value); d.valueMm = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
        d.reference = ref.value; d.fromEdge = fromEdge.value; d.confirmed = false;
        refreshGeometry(source);
        invalidateApproval(); renderRelease(); scheduleSave();
      });
    });
    confirmBtn.disabled = isFrozen(); confirmBtn.textContent = d.confirmed ? 'Confirmed ✓' : 'Confirm'; confirmBtn.classList.toggle('confirmed', d.confirmed);
    confirmBtn.addEventListener('click', () => {
      if (!(d.valueMm > 0)) { value.focus(); return; }
      if (d.reference === 'unknown') { ref.focus(); return; }
      if (['centre', 'edge'].includes(d.reference) && fromEdge.value === 'unknown') { fromEdge.focus(); return; }
      d.confirmed = true; refreshGeometry(source); invalidateApproval(); render(); scheduleSave();
    });
    const meta = document.createElement('small'); meta.className = 'dimension-meta';
    meta.textContent = d.confidence === 'manual' ? 'Manual dimension' : `AI read: ${d.rawText || '—'} · confidence ${d.confidence || 'unknown'}${d.role ? ` · ${d.role}` : ''}`;
    node.appendChild(meta);
    els.dimensionList.appendChild(node);
  });
}

async function createConfirmationPdf() {
  if (!jobReady() || isFrozen()) return;
  els.pdfBtn.disabled = true; els.pdfState.textContent = 'Creating confirmation PDF…';
  try {
    const pdfJob = serialisableState();
    pdfJob.sources = state.sources.map((source, index) => ({ ...pdfJob.sources[index], compiledGeometry: refreshGeometry(source) }));
    const bytes = await buildConfirmationPdf(pdfJob);
    const name = `${(els.jobRef.value.trim() || state.id).replace(/[^A-Za-z0-9_-]+/g, '-')}-rev-${state.revision}-confirmation.pdf`;
    const fileId = `confirmation-r${state.revision}-${id()}.pdf`;
    const file = new File([bytes], name, { type: 'application/pdf' });
    const result = await uploadFile(file, fileId, 'confirmation-pdf');
    state.confirmationPdf = { fileId, fileKey: result.fileKey, name, url: result.url, createdAt: new Date().toISOString() };
    state.signedProof = null; els.customerConfirmed.checked = false; state.customerConfirmed = false; state.outcome = null; state.dxfFiles = [];
    await saveJob({ immediate: true });
    render();
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
    const geometry = refreshGeometry(source);
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
    render();
  } catch (error) {
    state.status = previousStatus; state.outcome = previousOutcome; state.dxfFiles = []; setEditable(true); render();
    els.releaseMessage.textContent = `Release blocked: ${error.message}`;
  }
}

async function sendJob() {
  if (state.status !== 'locked' || !state.outcome || !state.dxfFiles.length) return;
  els.sendBtn.disabled = true; els.sendBtn.textContent = 'Sending…';
  try {
    const result = await apiJson(API.send, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: state.id, revision: state.revision, outcome: state.outcome, customerEmail: els.customerEmail.value.trim() }),
    });
    state.status = 'sent'; state.sentAt = result.sentAt; state.sentTo = result.to; setEditable(false); render();
  } catch (error) {
    els.releaseMessage.textContent = `Email failed: ${error.message}. Revision remains locked and has NOT been marked sent.`;
    els.sendBtn.disabled = false;
  } finally { els.sendBtn.textContent = 'Confirm & email'; }
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

  if (state.status === 'sent') {
    els.releaseMessage.textContent = `Sent ${state.sentAt ? new Date(state.sentAt).toLocaleString() : ''}${state.sentTo ? ` to ${state.sentTo}` : ''}. The work server is now the permanent production archive.`;
  } else if (state.status === 'locked') {
    if (!state.dxfFiles.length) els.releaseMessage.textContent = `Revision ${state.revision} is locked but has no DXF output; release is blocked.`;
    else els.releaseMessage.textContent = `Revision ${state.revision} locked. Confirm the recipient and email the release pack.`;
  } else if (!backendOnline) {
    els.releaseMessage.textContent = 'Shared storage must be online before a job can be approved or released.';
  } else if (!jobReady()) {
    els.releaseMessage.textContent = 'Every drawing, production dimension and deterministic geometry relationship must be confirmed first.';
  } else if (!state.confirmationPdf?.fileKey) {
    els.releaseMessage.textContent = 'Create the confirmation PDF, print it and have the customer sign it.';
  } else if (!state.signedProof?.fileKey) {
    els.releaseMessage.textContent = 'Photograph the signed confirmation and attach it to this revision.';
  } else if (!els.customerConfirmed.checked) {
    els.releaseMessage.textContent = 'Tick the customer confirmation after the signed sheet has been checked.';
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
els.newJobBtn.addEventListener('click', newJob);
els.newRevisionBtn.addEventListener('click', newRevision);
els.cameraInput.addEventListener('change', async (e) => { await addFiles([...e.target.files]); e.target.value = ''; });
els.fileInput.addEventListener('change', async (e) => { await addFiles([...e.target.files]); e.target.value = ''; });
els.analyseBtn.addEventListener('click', () => analyseSource());
els.addCorrectionBtn.addEventListener('click', addCorrection);
els.pdfBtn.addEventListener('click', createConfirmationPdf);
els.signedInput.addEventListener('change', async (e) => { await attachSignedProof(e.target.files?.[0]); e.target.value = ''; });
els.customerConfirmed.addEventListener('change', () => { state.customerConfirmed = els.customerConfirmed.checked; renderRelease(); scheduleSave(); });
els.productionBtn.addEventListener('click', () => lockJob('production'));
els.exportChoiceBtn.addEventListener('click', () => lockJob('export'));
els.sendBtn.addEventListener('click', sendJob);

restoreEmergencyCache();
render();
checkBackend();
