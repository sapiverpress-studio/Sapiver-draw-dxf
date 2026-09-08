const $ = (s) => document.querySelector(s);
const els = {
  revisionBadge: $('#revisionBadge'), jobRef: $('#jobRef'), customerName: $('#customerName'), staffName: $('#staffName'), jobDate: $('#jobDate'),
  cameraInput: $('#cameraInput'), fileInput: $('#fileInput'), sourceStrip: $('#sourceStrip'), sourceEmpty: $('#sourceEmpty'), sourceCount: $('#sourceCount'),
  activeSourceTitle: $('#activeSourceTitle'), activeSourceMeta: $('#activeSourceMeta'), drawingPreview: $('#drawingPreview'), drawingPlaceholder: $('#drawingPlaceholder'),
  aiState: $('#aiState'), dimensionList: $('#dimensionList'), dimensionEmpty: $('#dimensionEmpty'), reviewProgress: $('#reviewProgress'), addCorrectionBtn: $('#addCorrectionBtn'),
  printBtn: $('#printBtn'), signedInput: $('#signedInput'), signedState: $('#signedState'), customerConfirmed: $('#customerConfirmed'),
  productionBtn: $('#productionBtn'), exportChoiceBtn: $('#exportChoiceBtn'), releaseMessage: $('#releaseMessage'), printPack: $('#printPack'), dimensionTemplate: $('#dimensionTemplate'),
};

const state = {
  revision: 1,
  status: 'draft',
  activeSourceId: null,
  sources: [],
  signedProof: null,
  outcome: null,
};

const today = new Date();
els.jobDate.value = today.toISOString().slice(0, 10);

function id() { return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function activeSource() { return state.sources.find((s) => s.id === state.activeSourceId) ?? null; }
function isLocked() { return state.status === 'locked'; }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function drawingLabel(source, index = state.sources.indexOf(source)) { return `Drawing ${String.fromCharCode(65 + Math.max(0, index))}`; }

function invalidateApproval() {
  if (isLocked()) return false;
  state.outcome = null;
  return true;
}

function setEditable(enabled) {
  [els.jobRef, els.customerName, els.staffName, els.jobDate, els.cameraInput, els.fileInput, els.customerConfirmed, els.signedInput].forEach((el) => { el.disabled = !enabled; });
}

function mapDimension(raw, idx) {
  const ref = ['size','centre','edge'].includes(raw.reference) ? raw.reference : 'unknown';
  const value = Number(raw.value ?? raw.value_mm ?? raw.valueMm);
  return {
    id: id(),
    label: raw.target || raw.label || raw.description || `Dimension ${idx + 1}`,
    valueMm: Number.isFinite(value) ? value : null,
    reference: ref,
    fromEdge: raw.from_edge || raw.fromEdge || 'unknown',
    rawText: raw.raw_text || raw.rawText || '',
    confidence: raw.confidence || 'unknown',
    confirmed: false,
  };
}

function applyAnalysis(sourceId, payload) {
  if (isLocked()) return;
  const source = state.sources.find((s) => s.id === sourceId);
  if (!source) return;
  const extraction = payload?.extraction ?? payload ?? {};
  source.dimensions = Array.isArray(extraction.dimensions) ? extraction.dimensions.map(mapDimension) : [];
  source.analysis = extraction;
  source.analysisStatus = source.dimensions.length ? 'review' : 'needs-review';
  render();
}
window.quickDxfApplyAnalysis = applyAnalysis;

async function loadPdfJs() {
  const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs';
  return pdfjs;
}

async function addImageFile(file) {
  state.sources.push({ id: id(), name: file.name, kind: 'image', previewUrl: URL.createObjectURL(file), analysisStatus: 'awaiting', dimensions: [], analysis: null });
}

async function addPdfFile(file) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.8, 1500 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    state.sources.push({ id: id(), name: `${file.name} · page ${pageNo}`, kind: 'pdf-page', previewUrl: canvas.toDataURL('image/jpeg', .88), analysisStatus: 'awaiting', dimensions: [], analysis: null });
  }
}

async function addFiles(files) {
  if (isLocked() || !files?.length) return;
  for (const file of files) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) await addPdfFile(file);
    else if (file.type.startsWith('image/')) await addImageFile(file);
  }
  if (!state.activeSourceId && state.sources.length) state.activeSourceId = state.sources[0].id;
  invalidateApproval(); render();
}

function removeSource(sourceId) {
  if (isLocked()) return;
  const idx = state.sources.findIndex((s) => s.id === sourceId);
  if (idx < 0) return;
  const [removed] = state.sources.splice(idx, 1);
  if (removed.kind === 'image' && removed.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl);
  if (state.activeSourceId === sourceId) state.activeSourceId = state.sources[0]?.id ?? null;
  invalidateApproval(); render();
}

function addCorrection() {
  if (isLocked()) return;
  const source = activeSource(); if (!source) return;
  source.dimensions.push({ id: id(), label: 'Correction / added dimension', valueMm: null, reference: 'unknown', fromEdge: 'unknown', rawText: '', confidence: 'manual', confirmed: false });
  source.analysisStatus = 'review'; invalidateApproval(); render();
  requestAnimationFrame(() => els.dimensionList.querySelector('article:last-child input')?.focus());
}

function confirmedCount(source) { return source?.dimensions.filter((d) => d.confirmed).length ?? 0; }
function sourceReady(source) { return source.dimensions.length > 0 && source.dimensions.every((d) => d.confirmed && d.valueMm > 0 && d.reference !== 'unknown'); }
function jobReady() { return state.sources.length > 0 && state.sources.every(sourceReady); }

function renderSources() {
  els.sourceStrip.innerHTML = '';
  els.sourceEmpty.hidden = state.sources.length > 0;
  els.sourceCount.textContent = `${state.sources.length} drawing${state.sources.length === 1 ? '' : 's'}`;
  state.sources.forEach((source, index) => {
    const card = document.createElement('button'); card.type = 'button'; card.className = `source-card ${source.id === state.activeSourceId ? 'active' : ''}`;
    card.innerHTML = `<img src="${source.previewUrl}" alt=""><span><strong>${drawingLabel(source, index)}</strong><small>${escapeHtml(source.name)}</small><em class="${sourceReady(source) ? 'ready' : ''}">${sourceReady(source) ? 'Confirmed' : source.analysisStatus === 'awaiting' ? 'Awaiting AI' : `${confirmedCount(source)}/${source.dimensions.length} confirmed`}</em></span>`;
    card.addEventListener('click', () => { state.activeSourceId = source.id; render(); });
    if (!isLocked()) {
      const remove = document.createElement('span'); remove.className = 'source-remove'; remove.textContent = '×'; remove.title = 'Remove drawing';
      remove.addEventListener('click', (e) => { e.stopPropagation(); removeSource(source.id); }); card.appendChild(remove);
    }
    els.sourceStrip.appendChild(card);
  });
}

function renderDimensions() {
  const source = activeSource();
  els.dimensionList.innerHTML = '';
  els.addCorrectionBtn.disabled = !source || isLocked();
  if (!source) {
    els.activeSourceTitle.textContent = 'Select a drawing'; els.activeSourceMeta.textContent = 'AI will propose geometry and dimensions. Every production dimension must be confirmed.';
    els.drawingPreview.hidden = true; els.drawingPlaceholder.hidden = false; els.dimensionEmpty.hidden = false; els.aiState.textContent = 'Awaiting analysis'; els.reviewProgress.textContent = '0 / 0 confirmed'; return;
  }
  const index = state.sources.indexOf(source);
  els.activeSourceTitle.textContent = `${drawingLabel(source, index)} · ${source.name}`;
  els.activeSourceMeta.textContent = source.analysisStatus === 'awaiting' ? 'Awaiting AI proposal.' : 'Check each figured value against the source drawing. Centre/edge intent must be explicit for positional dimensions.';
  els.drawingPreview.src = source.previewUrl; els.drawingPreview.hidden = false; els.drawingPlaceholder.hidden = true;
  els.aiState.textContent = source.analysisStatus === 'awaiting' ? 'Awaiting AI analysis' : sourceReady(source) ? 'All production dimensions confirmed' : 'Customer review required';
  els.aiState.className = `ai-state ${sourceReady(source) ? 'ok' : source.analysisStatus === 'awaiting' ? '' : 'warn'}`;
  els.reviewProgress.textContent = `${confirmedCount(source)} / ${source.dimensions.length} confirmed`;
  els.dimensionEmpty.hidden = source.dimensions.length > 0;

  source.dimensions.forEach((d) => {
    const node = els.dimensionTemplate.content.firstElementChild.cloneNode(true);
    const label = node.querySelector('.dimension-label'), value = node.querySelector('.dimension-value'), ref = node.querySelector('.dimension-ref'), confirm = node.querySelector('.dimension-confirm');
    label.value = d.label; value.value = d.valueMm ?? ''; ref.value = d.reference;
    [label, value, ref].forEach((el) => { el.disabled = isLocked(); el.addEventListener('input', () => { if (isLocked()) return; d.label = label.value.trim(); const n = Number(value.value); d.valueMm = Number.isFinite(n) && n > 0 ? n : null; d.reference = ref.value; d.confirmed = false; invalidateApproval(); renderRelease(); }); });
    confirm.disabled = isLocked(); confirm.textContent = d.confirmed ? 'Confirmed ✓' : 'Confirm'; confirm.classList.toggle('confirmed', d.confirmed);
    confirm.addEventListener('click', () => { if (!(d.valueMm > 0)) { value.focus(); return; } if (d.reference === 'unknown') { ref.focus(); return; } d.confirmed = true; render(); });
    if (d.rawText || d.confidence !== 'unknown') {
      const meta = document.createElement('small'); meta.className = 'dimension-meta'; meta.textContent = `AI read: ${d.rawText || '—'} · confidence ${d.confidence}`; node.appendChild(meta);
    }
    els.dimensionList.appendChild(node);
  });
}

function buildPrintPack() {
  const jobRef = els.jobRef.value.trim() || 'Unreferenced job';
  const customer = els.customerName.value.trim() || 'Customer';
  const staff = els.staffName.value.trim() || '—';
  const date = els.jobDate.value || '—';
  const pageCount = Math.max(1, state.sources.length + (state.sources.length > 1 ? 1 : 0));
  let html = '';
  if (state.sources.length > 1) {
    html += `<section class="print-page approval-cover"><header><strong>Quick DXF · Customer confirmation</strong><span>Job ${escapeHtml(jobRef)} · Rev ${state.revision}</span></header><h1>Approval summary</h1><dl><div><dt>Customer</dt><dd>${escapeHtml(customer)}</dd></div><div><dt>Date</dt><dd>${escapeHtml(date)}</dd></div><div><dt>Staff</dt><dd>${escapeHtml(staff)}</dd></div><div><dt>Drawings</dt><dd>${state.sources.length}</dd></div></dl><table><thead><tr><th>Drawing</th><th>Source</th><th>Dimensions</th></tr></thead><tbody>${state.sources.map((s,i)=>`<tr><td>${drawingLabel(s,i)}</td><td>${escapeHtml(s.name)}</td><td>${s.dimensions.length} confirmed</td></tr>`).join('')}</tbody></table><p class="approval-statement">I confirm that the drawings and figured dimensions listed in this revision match the items I require to be manufactured.</p><div class="signature-grid"><div>Customer signature</div><div>Date</div><div>Staff signature</div><div>Date</div></div><footer>Revision ${state.revision} · ${pageCount} page confirmation pack</footer></section>`;
  }
  state.sources.forEach((source, i) => {
    html += `<section class="print-page drawing-sheet"><header><strong>Quick DXF · ${drawingLabel(source,i)}</strong><span>Job ${escapeHtml(jobRef)} · Rev ${state.revision}</span></header><div class="print-source"><img src="${source.previewUrl}" alt="${escapeHtml(source.name)}"></div><h2>${escapeHtml(source.name)}</h2><table><thead><tr><th>Description</th><th>Dimension</th><th>Reference</th></tr></thead><tbody>${source.dimensions.map((d)=>`<tr><td>${escapeHtml(d.label)}</td><td>${d.valueMm ?? '—'} mm</td><td>${escapeHtml(d.reference.toUpperCase())}${d.fromEdge && d.fromEdge !== 'unknown' ? ` · from ${escapeHtml(d.fromEdge)}` : ''}</td></tr>`).join('')}</tbody></table>${state.sources.length === 1 ? `<p class="approval-statement">I confirm this drawing and the figured dimensions above match the item I require to be manufactured.</p><div class="signature-grid"><div>Customer signature</div><div>Date</div><div>Staff signature</div><div>Date</div></div>` : '<p class="page-initial">Customer initials: __________________</p>'}<footer>${drawingLabel(source,i)} · Revision ${state.revision}</footer></section>`;
  });
  els.printPack.innerHTML = html;
}

function printPack() { if (!jobReady()) return; buildPrintPack(); window.print(); }

function signedAttached(file) {
  if (!file || isLocked()) return;
  if (state.signedProof?.url?.startsWith('blob:')) URL.revokeObjectURL(state.signedProof.url);
  state.signedProof = { name: file.name, url: URL.createObjectURL(file), capturedAt: new Date().toISOString() };
  render();
}

function lockJob(outcome) {
  if (!canRelease()) return;
  state.status = 'locked'; state.outcome = outcome; setEditable(false); render();
}
function canRelease() { return jobReady() && els.customerConfirmed.checked && Boolean(state.signedProof); }

function renderRelease() {
  const ready = canRelease(); els.printBtn.disabled = !jobReady() || isLocked();
  els.productionBtn.disabled = !ready || isLocked(); els.exportChoiceBtn.disabled = !ready || isLocked();
  if (isLocked()) els.releaseMessage.textContent = `Revision ${state.revision} locked · ${state.outcome === 'production' ? 'Manufacture with us' : 'Customer DXF export'}. Any change requires a new revision.`;
  else if (!jobReady()) els.releaseMessage.textContent = 'Every drawing and every production dimension must be confirmed first.';
  else if (!els.customerConfirmed.checked) els.releaseMessage.textContent = 'Customer confirmation checkbox is still required.';
  else if (!state.signedProof) els.releaseMessage.textContent = 'Photograph and attach the signed confirmation before release.';
  else els.releaseMessage.textContent = 'Signed confirmation attached. Ready to lock this revision for production/export.';
}

function render() {
  els.revisionBadge.textContent = `Revision ${state.revision} · ${isLocked() ? 'Locked' : 'Draft'}`;
  renderSources(); renderDimensions();
  els.signedState.textContent = state.signedProof ? `Signed confirmation attached · ${state.signedProof.name}` : 'No signed confirmation attached.';
  els.signedState.classList.toggle('ok', Boolean(state.signedProof));
  renderRelease();
}

function newRevision() {
  if (!isLocked()) return;
  state.revision += 1; state.status = 'draft'; state.outcome = null; state.signedProof = null; els.customerConfirmed.checked = false;
  state.sources.forEach((s) => s.dimensions.forEach((d) => { d.confirmed = false; })); setEditable(true); render();
}
window.quickDxfNewRevision = newRevision;

[els.jobRef, els.customerName, els.staffName, els.jobDate].forEach((el) => el.addEventListener('input', () => { if (!isLocked()) { invalidateApproval(); renderRelease(); } }));
els.cameraInput.addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
els.fileInput.addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
els.addCorrectionBtn.addEventListener('click', addCorrection);
els.printBtn.addEventListener('click', printPack);
els.signedInput.addEventListener('change', (e) => { signedAttached(e.target.files?.[0]); e.target.value = ''; });
els.customerConfirmed.addEventListener('change', renderRelease);
els.productionBtn.addEventListener('click', () => lockJob('production'));
els.exportChoiceBtn.addEventListener('click', () => lockJob('export'));

render();
