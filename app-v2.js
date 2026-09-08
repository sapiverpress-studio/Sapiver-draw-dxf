import { buildCutDxf, downloadTextFile } from "./core/dxf.js";

const els = {
  fileInput: document.querySelector("#fileInput"),
  addDimensionBtn: document.querySelector("#addDimensionBtn"),
  traceBtn: document.querySelector("#traceBtn"),
  finishTraceBtn: document.querySelector("#finishTraceBtn"),
  undoBtn: document.querySelector("#undoBtn"),
  canvas: document.querySelector("#drawingCanvas"),
  emptyState: document.querySelector("#emptyState"),
  modeStatus: document.querySelector("#modeStatus"),
  scaleStatus: document.querySelector("#scaleStatus"),
  shapeStatus: document.querySelector("#shapeStatus"),
  dimensionHeading: document.querySelector("#dimensionHeading"),
  dimensionCount: document.querySelector("#dimensionCount"),
  dimensionEditor: document.querySelector("#dimensionEditor"),
  dimensionLabel: document.querySelector("#dimensionLabel"),
  dimensionValue: document.querySelector("#dimensionValue"),
  dimensionReference: document.querySelector("#dimensionReference"),
  referenceHelp: document.querySelector("#referenceHelp"),
  pixelLength: document.querySelector("#pixelLength"),
  scaleCheck: document.querySelector("#scaleCheck"),
  confirmDimensionBtn: document.querySelector("#confirmDimensionBtn"),
  useScaleBtn: document.querySelector("#useScaleBtn"),
  ignoreDimensionBtn: document.querySelector("#ignoreDimensionBtn"),
  prevDimensionBtn: document.querySelector("#prevDimensionBtn"),
  nextDimensionBtn: document.querySelector("#nextDimensionBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  exportMessage: document.querySelector("#exportMessage"),
};

const ctx = els.canvas.getContext("2d");
const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d");

const state = {
  loaded: false,
  filename: "drawing",
  mode: "idle",
  pendingDimensionPoints: [],
  dimensions: [],
  activeDimensionIndex: -1,
  scaleDimensionId: null,
  currentTrace: [],
  cutShapes: [],
};

const referenceCopy = {
  unset: "Choose how this figured dimension locates the feature before confirming it.",
  size: "Size / overall: the value defines a width, height, diameter or other size, not a cut-out position.",
  centre: "Centre of cut-out: the dimension locates the cut-out centreline (often shown with a centre/CL symbol).",
  edge: "Edge of cut-out: the dimension runs to the actual cut-out edge. The marked endpoint on the drawing defines which edge.",
};

function uuid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function activeDimension() {
  return state.dimensions[state.activeDimensionIndex] ?? null;
}

function scaleDimension() {
  return state.dimensions.find((d) => d.id === state.scaleDimensionId) ?? null;
}

function mmPerPixel() {
  const d = scaleDimension();
  if (!d || d.status !== "confirmed" || !(d.valueMm > 0)) return null;
  const px = distance(d.a, d.b);
  return px > 0 ? d.valueMm / px : null;
}

function setMode(mode) {
  state.mode = mode;
  if (mode !== "dimension") state.pendingDimensionPoints = [];
  if (mode !== "trace") state.currentTrace = [];
  els.modeStatus.textContent = `Mode: ${mode}`;
  els.finishTraceBtn.disabled = mode !== "trace" || state.currentTrace.length < 3;
  updateUndoState();
  render();
}

function updateUndoState() {
  els.undoBtn.disabled = !(
    (state.mode === "trace" && state.currentTrace.length) ||
    (state.mode === "dimension" && state.pendingDimensionPoints.length)
  );
}

function setLoadedUi() {
  els.emptyState.classList.toggle("hidden", state.loaded);
  els.addDimensionBtn.disabled = !state.loaded;
  els.traceBtn.disabled = !state.loaded;
}

function fitSourceToCanvas(sourceWidth, sourceHeight) {
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  els.canvas.width = width;
  els.canvas.height = height;
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  return { width, height };
}

async function loadImage(file) {
  const bitmap = await createImageBitmap(file);
  const size = fitSourceToCanvas(bitmap.width, bitmap.height);
  sourceCtx.clearRect(0, 0, size.width, size.height);
  sourceCtx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
}

async function loadPdf(file) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1800 / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale });

  els.canvas.width = Math.round(viewport.width);
  els.canvas.height = Math.round(viewport.height);
  sourceCanvas.width = els.canvas.width;
  sourceCanvas.height = els.canvas.height;
  await page.render({ canvasContext: sourceCtx, viewport }).promise;
}

async function handleFile(file) {
  if (!file) return;
  Object.assign(state, {
    loaded: false,
    filename: file.name.replace(/\.[^.]+$/, "") || "drawing",
    mode: "idle",
    pendingDimensionPoints: [],
    dimensions: [],
    activeDimensionIndex: -1,
    scaleDimensionId: null,
    currentTrace: [],
    cutShapes: [],
  });
  setLoadedUi();
  updateReview();
  updateExportState();

  try {
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      await loadPdf(file);
    } else if (file.type.startsWith("image/")) {
      await loadImage(file);
    } else {
      throw new Error("Unsupported file type");
    }
    state.loaded = true;
    setLoadedUi();
    setMode("idle");
    updateReview();
    updateExportState();
  } catch (error) {
    console.error(error);
    alert(`Could not open this drawing: ${error.message}`);
  }
}

function canvasPoint(event) {
  const rect = els.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (els.canvas.width / rect.width),
    y: (event.clientY - rect.top) * (els.canvas.height / rect.height),
  };
}

function addDimensionPoint(point) {
  state.pendingDimensionPoints.push(point);
  if (state.pendingDimensionPoints.length !== 2) {
    updateUndoState();
    render();
    return;
  }

  const [a, b] = state.pendingDimensionPoints;
  state.dimensions.push({
    id: uuid(),
    a,
    b,
    label: `Dimension ${state.dimensions.length + 1}`,
    valueMm: null,
    reference: "unset",
    status: "pending",
  });
  state.activeDimensionIndex = state.dimensions.length - 1;
  state.pendingDimensionPoints = [];
  setMode("idle");
  updateReview();
  queueMicrotask(() => els.dimensionValue.focus());
}

function addTracePoint(point) {
  state.currentTrace.push(point);
  els.finishTraceBtn.disabled = state.currentTrace.length < 3;
  updateUndoState();
  render();
}

function finishTrace() {
  if (state.currentTrace.length < 3) return;
  state.cutShapes.push({ id: uuid(), points: [...state.currentTrace] });
  state.currentTrace = [];
  setMode("idle");
  updateExportState();
}

function undoPoint() {
  if (state.mode === "trace" && state.currentTrace.length) {
    state.currentTrace.pop();
    els.finishTraceBtn.disabled = state.currentTrace.length < 3;
  } else if (state.mode === "dimension" && state.pendingDimensionPoints.length) {
    state.pendingDimensionPoints.pop();
  }
  updateUndoState();
  render();
}

function updateDimensionFromInputs() {
  const d = activeDimension();
  if (!d) return;
  d.label = els.dimensionLabel.value.trim() || `Dimension ${state.activeDimensionIndex + 1}`;
  const value = Number(els.dimensionValue.value);
  d.valueMm = Number.isFinite(value) && value > 0 ? value : null;
  d.reference = els.dimensionReference.value || "unset";
  updateReview({ preserveInputs: true });
  updateExportState();
  render();
}

function dimensionIsReady(d) {
  return Boolean(d && d.valueMm > 0 && d.reference && d.reference !== "unset");
}

function confirmDimension() {
  const d = activeDimension();
  if (!d) return;
  updateDimensionFromInputs();
  if (!(d.valueMm > 0)) {
    els.dimensionValue.focus();
    return;
  }
  if (d.reference === "unset") {
    els.dimensionReference.focus();
    els.referenceHelp.classList.add("needs-attention");
    return;
  }
  d.status = "confirmed";
  els.referenceHelp.classList.remove("needs-attention");
  updateReview();
  updateExportState();
  render();
}

function ignoreDimension() {
  const d = activeDimension();
  if (!d) return;
  d.status = "ignored";
  if (state.scaleDimensionId === d.id) state.scaleDimensionId = null;
  updateReview();
  updateExportState();
  render();
}

function useAsScale() {
  const d = activeDimension();
  if (!d) return;
  updateDimensionFromInputs();
  if (!(d.valueMm > 0)) {
    els.dimensionValue.focus();
    return;
  }
  if (d.reference === "unset") {
    els.dimensionReference.focus();
    els.referenceHelp.classList.add("needs-attention");
    return;
  }
  d.status = "confirmed";
  state.scaleDimensionId = d.id;
  updateReview();
  updateExportState();
  render();
}

function goDimension(delta) {
  if (!state.dimensions.length) return;
  state.activeDimensionIndex = Math.min(
    state.dimensions.length - 1,
    Math.max(0, state.activeDimensionIndex + delta),
  );
  updateReview();
  render();
}

function referenceLabel(reference) {
  if (reference === "centre") return "CENTRE";
  if (reference === "edge") return "EDGE";
  if (reference === "size") return "SIZE";
  return "?";
}

function updateReview({ preserveInputs = false } = {}) {
  const d = activeDimension();
  const count = state.dimensions.length;
  els.dimensionCount.textContent = count ? `${state.activeDimensionIndex + 1} / ${count}` : "0 / 0";

  const disabled = !d;
  els.dimensionEditor.classList.toggle("disabled", disabled);
  els.dimensionEditor.setAttribute("aria-disabled", String(disabled));
  for (const el of [
    els.dimensionLabel,
    els.dimensionValue,
    els.dimensionReference,
    els.confirmDimensionBtn,
    els.useScaleBtn,
    els.ignoreDimensionBtn,
    els.prevDimensionBtn,
    els.nextDimensionBtn,
  ]) {
    el.disabled = disabled;
  }

  if (!d) {
    els.dimensionHeading.textContent = "No dimensions yet";
    if (!preserveInputs) {
      els.dimensionLabel.value = "";
      els.dimensionValue.value = "";
      els.dimensionReference.value = "unset";
    }
    els.referenceHelp.textContent = referenceCopy.unset;
    els.pixelLength.textContent = "—";
    els.scaleCheck.textContent = "—";
    return;
  }

  els.dimensionHeading.textContent =
    d.status === "ignored" ? "Ignored dimension" :
    d.status === "confirmed" ? "Confirmed dimension" :
    "Needs confirmation";

  if (!preserveInputs) {
    els.dimensionLabel.value = d.label ?? "";
    els.dimensionValue.value = d.valueMm ?? "";
    els.dimensionReference.value = d.reference ?? "unset";
  }

  els.referenceHelp.textContent = referenceCopy[d.reference ?? "unset"];
  els.referenceHelp.classList.toggle("needs-attention", d.status !== "ignored" && d.reference === "unset");

  const px = distance(d.a, d.b);
  els.pixelLength.textContent = `${px.toFixed(1)} px`;

  const scale = mmPerPixel();
  if (scale && d.id !== state.scaleDimensionId) {
    const scaledMm = px * scale;
    if (d.valueMm) {
      const deltaPct = Math.abs((scaledMm - d.valueMm) / d.valueMm) * 100;
      els.scaleCheck.textContent = `${scaledMm.toFixed(1)} mm · ${deltaPct.toFixed(1)}% difference`;
    } else {
      els.scaleCheck.textContent = `${scaledMm.toFixed(1)} mm`;
    }
  } else if (d.id === state.scaleDimensionId) {
    els.scaleCheck.textContent = "Scale reference";
  } else {
    els.scaleCheck.textContent = "Set a scale reference";
  }

  els.confirmDimensionBtn.disabled = d.status === "ignored";
  els.useScaleBtn.disabled = d.status === "ignored";
  els.prevDimensionBtn.disabled = state.activeDimensionIndex <= 0;
  els.nextDimensionBtn.disabled = state.activeDimensionIndex >= count - 1;
}

function updateExportState() {
  const scale = mmPerPixel();
  const unresolved = state.dimensions.filter((d) => d.status !== "ignored" && !dimensionIsReady(d));
  const canExport = Boolean(scale && state.cutShapes.length && unresolved.length === 0);
  els.exportBtn.disabled = !canExport;
  els.shapeStatus.textContent = `Cut shapes: ${state.cutShapes.length}`;

  if (scale) {
    els.scaleStatus.textContent = `Scale: ${(1 / scale).toFixed(3)} px/mm`;
  } else {
    els.scaleStatus.textContent = "Scale: not set";
  }

  if (unresolved.length) {
    els.exportMessage.textContent = `${unresolved.length} dimension${unresolved.length === 1 ? "" : "s"} still need a value and measurement reference (size, centre or edge).`;
  } else if (!scale) {
    els.exportMessage.textContent = "Choose a confirmed dimension and press Use as scale.";
  } else if (!state.cutShapes.length) {
    els.exportMessage.textContent = "Trace at least one closed cut shape.";
  } else {
    els.exportMessage.textContent = "Ready to export. Check the traced geometry before production use.";
  }
}

function exportDxf() {
  const scale = mmPerPixel();
  if (!scale || !state.cutShapes.length) return;

  const unresolved = state.dimensions.filter((d) => d.status !== "ignored" && !dimensionIsReady(d));
  if (unresolved.length) return;

  const heightPx = els.canvas.height;
  const polylines = state.cutShapes.map((shape) => shape.points.map((point) => ({
    x: point.x * scale,
    y: (heightPx - point.y) * scale,
  })));

  const dxf = buildCutDxf(polylines);
  downloadTextFile(dxf, `${state.filename}-CUT.dxf`);
}

function drawHandle(point, fill = "#2563eb", radius = 5) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
}

function drawTargetMarker(point, reference, colour, a, b) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 2.5;

  if (reference === "centre") {
    const r = 9;
    ctx.beginPath();
    ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(point.x - r - 5, point.y);
    ctx.lineTo(point.x + r + 5, point.y);
    ctx.moveTo(point.x, point.y - r - 5);
    ctx.lineTo(point.x, point.y + r + 5);
    ctx.stroke();
  } else if (reference === "edge") {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    ctx.beginPath();
    ctx.moveTo(point.x - nx * 9, point.y - ny * 9);
    ctx.lineTo(point.x + nx * 9, point.y + ny * 9);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDimension(d, index, active) {
  const ignored = d.status === "ignored";
  const colour = ignored ? "#98a2b3" : active ? "#d92d20" : d.status === "confirmed" ? "#067647" : "#2563eb";
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = active ? 4 : 2.5;
  ctx.setLineDash(ignored ? [7, 6] : []);
  ctx.beginPath();
  ctx.moveTo(d.a.x, d.a.y);
  ctx.lineTo(d.b.x, d.b.y);
  ctx.stroke();
  drawHandle(d.a, colour, active ? 5.5 : 4.5);
  drawHandle(d.b, colour, active ? 5.5 : 4.5);
  drawTargetMarker(d.b, d.reference, colour, d.a, d.b);

  const mid = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
  const value = d.valueMm ? `${d.valueMm} mm` : "?";
  const label = `${index + 1}: ${value} · ${referenceLabel(d.reference)}`;
  ctx.font = "700 14px system-ui";
  const metrics = ctx.measureText(label);
  const pad = 6;
  ctx.fillStyle = "rgba(255,255,255,.94)";
  ctx.fillRect(mid.x - metrics.width / 2 - pad, mid.y - 24, metrics.width + pad * 2, 22);
  ctx.fillStyle = colour;
  ctx.fillText(label, mid.x - metrics.width / 2, mid.y - 8);
  ctx.restore();
}

function drawShape(points, closed, colour = "#7f1d1d") {
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = "rgba(127,29,29,.10)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  if (closed) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();
  for (const p of points) drawHandle(p, colour, 4.5);
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  if (!state.loaded) return;
  ctx.drawImage(sourceCanvas, 0, 0);

  state.cutShapes.forEach((shape) => drawShape(shape.points, true));
  if (state.currentTrace.length) drawShape(state.currentTrace, false, "#b42318");

  state.dimensions.forEach((d, index) => {
    drawDimension(d, index, index === state.activeDimensionIndex);
  });

  for (const point of state.pendingDimensionPoints) drawHandle(point, "#2563eb", 6);
}

els.fileInput.addEventListener("change", (event) => handleFile(event.target.files?.[0]));
els.addDimensionBtn.addEventListener("click", () => setMode("dimension"));
els.traceBtn.addEventListener("click", () => setMode("trace"));
els.finishTraceBtn.addEventListener("click", finishTrace);
els.undoBtn.addEventListener("click", undoPoint);
els.dimensionLabel.addEventListener("input", updateDimensionFromInputs);
els.dimensionValue.addEventListener("input", updateDimensionFromInputs);
els.dimensionReference.addEventListener("change", updateDimensionFromInputs);
els.confirmDimensionBtn.addEventListener("click", confirmDimension);
els.useScaleBtn.addEventListener("click", useAsScale);
els.ignoreDimensionBtn.addEventListener("click", ignoreDimension);
els.prevDimensionBtn.addEventListener("click", () => goDimension(-1));
els.nextDimensionBtn.addEventListener("click", () => goDimension(1));
els.exportBtn.addEventListener("click", exportDxf);

els.canvas.addEventListener("pointerdown", (event) => {
  if (!state.loaded) return;
  const point = canvasPoint(event);
  if (state.mode === "dimension") addDimensionPoint(point);
  if (state.mode === "trace") addTracePoint(point);
});

setLoadedUi();
updateReview();
updateExportState();
render();
