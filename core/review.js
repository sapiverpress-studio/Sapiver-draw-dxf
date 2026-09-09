const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function findPart(source, partId) {
  return (source?.analysis?.parts || []).find((part) => part.id === partId) || null;
}

function findFeature(part, featureId) {
  return (part?.features || []).find((feature) => feature.id === featureId) || null;
}

function addRequirement(out, { part, feature = null, field, label, kind, axis = null }) {
  const owner = feature || part.profile;
  out.push({
    key: `${part.id}:${feature ? feature.id : 'profile'}:${field}`,
    partId: part.id,
    partLabel: part.label || part.id || 'Part',
    featureId: feature?.id || null,
    featureLabel: feature ? (feature.source_note || feature.id || feature.type) : null,
    featureType: feature?.type || null,
    field,
    label,
    kind,
    axis,
    dimensionId: owner?.[field] || null,
  });
}

export function geometryRequirements(source) {
  const out = [];
  for (const part of source?.analysis?.parts || []) {
    const profile = part.profile || {};
    if (profile.type === 'rectangle') {
      addRequirement(out, { part, field: 'width_dimension_id', label: 'Overall width', kind: 'size', axis: 'x' });
      addRequirement(out, { part, field: 'height_dimension_id', label: 'Overall height', kind: 'size', axis: 'y' });
    } else if (profile.type === 'circle') {
      addRequirement(out, { part, field: 'diameter_dimension_id', label: 'Overall diameter', kind: 'size' });
    }

    for (const feature of part.features || []) {
      if (feature.type === 'rectangular_cutout' || feature.type === 'slot') {
        addRequirement(out, { part, feature, field: 'width_dimension_id', label: 'Width', kind: 'size', axis: 'x' });
        addRequirement(out, { part, feature, field: 'height_dimension_id', label: 'Height', kind: 'size', axis: 'y' });
      } else if (feature.type === 'circular_hole') {
        addRequirement(out, { part, feature, field: 'diameter_dimension_id', label: 'Diameter', kind: 'size' });
      } else {
        continue;
      }
      addRequirement(out, { part, feature, field: 'x_dimension_id', label: 'X position', kind: 'position', axis: 'x' });
      addRequirement(out, { part, feature, field: 'y_dimension_id', label: 'Y position', kind: 'position', axis: 'y' });
    }
  }
  return out;
}

export function setRequirementDimensionId(source, requirement, dimensionId) {
  const part = findPart(source, requirement.partId);
  if (!part) return false;
  const owner = requirement.featureId ? findFeature(part, requirement.featureId) : part.profile;
  if (!owner) return false;
  owner[requirement.field] = dimensionId || null;
  requirement.dimensionId = dimensionId || null;
  return true;
}

export function dimensionForRequirement(source, requirement) {
  if (!requirement?.dimensionId) return null;
  return (source?.dimensions || []).find((dimension) => dimension.id === requirement.dimensionId) || null;
}

export function applyRequirementSemantics(source) {
  for (const requirement of geometryRequirements(source)) {
    const dimension = dimensionForRequirement(source, requirement);
    if (!dimension) continue;
    dimension.semanticKey = requirement.key;
    dimension.semanticLabel = `${requirement.featureId ? `${requirement.featureId} ` : ''}${requirement.label}`;
    if (requirement.kind === 'size') {
      dimension.reference = 'size';
      dimension.fromEdge = 'unknown';
      if (!['overall', 'size', 'diameter', 'radius'].includes(dimension.role)) dimension.role = 'size';
    } else {
      dimension.role = 'position';
      if (!['centre', 'edge'].includes(dimension.reference)) dimension.reference = 'unknown';
      const allowed = requirement.axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
      if (!allowed.includes(dimension.fromEdge)) dimension.fromEdge = 'unknown';
    }
  }
  return source;
}

export function requiredReviewItems(source) {
  const requirements = geometryRequirements(source);
  const extras = (source?.dimensions || [])
    .filter((dimension) => dimension.manualExtra)
    .map((dimension) => ({ key: `extra:${dimension.id}`, kind: 'extra', label: dimension.label || 'Additional dimension', dimensionId: dimension.id }));
  return [...requirements, ...extras];
}

export function reviewProgress(source) {
  const items = requiredReviewItems(source);
  let confirmed = 0;
  for (const item of items) {
    const d = item.kind === 'extra'
      ? (source?.dimensions || []).find((dimension) => dimension.id === item.dimensionId)
      : dimensionForRequirement(source, item);
    if (d?.confirmed) confirmed += 1;
  }
  return { confirmed, total: items.length };
}

export function reviewReady(source) {
  const items = requiredReviewItems(source);
  if (!items.length) return false;
  return items.every((item) => {
    const d = item.kind === 'extra'
      ? (source?.dimensions || []).find((dimension) => dimension.id === item.dimensionId)
      : dimensionForRequirement(source, item);
    if (!(d?.confirmed && Number(d.valueMm) > 0)) return false;
    if (item.kind === 'position') {
      if (!['centre', 'edge'].includes(d.reference)) return false;
      const allowed = item.axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
      if (!allowed.includes(d.fromEdge)) return false;
    }
    if (item.kind === 'extra') {
      if (!d.reference || d.reference === 'unknown') return false;
      if (['centre', 'edge'].includes(d.reference) && !['left', 'right', 'top', 'bottom'].includes(d.fromEdge)) return false;
    }
    return true;
  });
}

function dimMap(source) {
  return new Map((source?.dimensions || []).map((d) => [d.id, d]));
}

function confirmed(map, id) {
  const d = id ? map.get(id) : null;
  return d?.confirmed && Number(d.valueMm) > 0 ? d : null;
}

function centreFromPosition(total, span, d, axis) {
  if (!d) return null;
  const lowEdge = axis === 'x' ? 'left' : 'bottom';
  const highEdge = axis === 'x' ? 'right' : 'top';
  if (![lowEdge, highEdge].includes(d.fromEdge)) return null;
  const fromLow = d.fromEdge === lowEdge;
  const value = Number(d.valueMm);
  if (d.reference === 'centre') return fromLow ? value : total - value;
  if (d.reference === 'edge') return fromLow ? value + span / 2 : total - value - span / 2;
  return null;
}

function line(chunks, x1, y1, x2, y2, cls = 'dim') {
  chunks.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`);
}

function text(chunks, x, y, value, anchor = 'middle', cls = 'label') {
  chunks.push(`<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(value)}</text>`);
}

function horizontalDimension(chunks, x1, x2, y, value, offset = 0) {
  const yy = y + offset;
  line(chunks, x1, yy, x2, yy);
  line(chunks, x1, yy - 5, x1, yy + 5);
  line(chunks, x2, yy - 5, x2, yy + 5);
  text(chunks, (x1 + x2) / 2, yy - 7, `${value} mm`);
}

function verticalDimension(chunks, y1, y2, x, value, offset = 0) {
  const xx = x + offset;
  line(chunks, xx, y1, xx, y2);
  line(chunks, xx - 5, y1, xx + 5, y1);
  line(chunks, xx - 5, y2, xx + 5, y2);
  chunks.push(`<text x="${xx - 8}" y="${(y1 + y2) / 2}" text-anchor="middle" class="label" transform="rotate(-90 ${xx - 8} ${(y1 + y2) / 2})">${esc(`${value} mm`)}</text>`);
}

export function progressiveReviewSvg(source, { width = 900, height = 620 } = {}) {
  const parts = source?.analysis?.parts || [];
  if (!parts.length) return '';
  const map = dimMap(source);
  const part = parts[0];
  const profile = part.profile || {};
  const outerW = confirmed(map, profile.width_dimension_id);
  const outerH = confirmed(map, profile.height_dimension_id);
  const outerD = confirmed(map, profile.diameter_dimension_id);
  const confirmedDims = requiredReviewItems(source)
    .map((item) => ({ item, d: item.kind === 'extra' ? map.get(item.dimensionId) : dimensionForRequirement(source, item) }))
    .filter(({ d }) => d?.confirmed && Number(d.valueMm) > 0);

  const chunks = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Confirmed drawing measurements">`,
    '<style>.shape{fill:none;stroke:#111827;stroke-width:2}.feature{fill:none;stroke:#111827;stroke-width:1.6}.dim{stroke:#475467;stroke-width:1}.label{font:14px system-ui,sans-serif;fill:#111827}.small{font:12px system-ui,sans-serif;fill:#475467}.title{font:700 17px system-ui,sans-serif;fill:#111827}.pending{font:13px system-ui,sans-serif;fill:#667085}</style>',
    '<rect width="100%" height="100%" fill="white"/>'];
  text(chunks, 28, 30, part.label || part.id || 'Confirmed drawing', 'start', 'title');

  const drawX = 150, drawY = 90, drawW = 600, drawH = 360;
  let scale = 1;
  let profileW = null, profileH = null;
  if (profile.type === 'rectangle' && outerW && outerH) {
    profileW = Number(outerW.valueMm); profileH = Number(outerH.valueMm);
    scale = Math.min(drawW / profileW, drawH / profileH);
    const w = profileW * scale, h = profileH * scale;
    const ox = drawX + (drawW - w) / 2, oy = drawY + (drawH - h) / 2;
    chunks.push(`<rect x="${ox}" y="${oy}" width="${w}" height="${h}" class="shape"/>`);
    horizontalDimension(chunks, ox, ox + w, oy + h, outerW.valueMm, 32);
    verticalDimension(chunks, oy, oy + h, ox, outerH.valueMm, -32);

    for (const feature of part.features || []) {
      const fwD = confirmed(map, feature.width_dimension_id);
      const fhD = confirmed(map, feature.height_dimension_id);
      const fdD = confirmed(map, feature.diameter_dimension_id);
      const xD = confirmed(map, feature.x_dimension_id);
      const yD = confirmed(map, feature.y_dimension_id);
      const fw = fdD ? Number(fdD.valueMm) : fwD ? Number(fwD.valueMm) : null;
      const fh = fdD ? Number(fdD.valueMm) : fhD ? Number(fhD.valueMm) : null;
      if (!(fw > 0 && fh > 0 && xD && yD)) continue;
      const cx = centreFromPosition(profileW, fw, xD, 'x');
      const cyFromBottom = centreFromPosition(profileH, fh, yD, 'y');
      if (cx == null || cyFromBottom == null) continue;
      const fx = ox + (cx - fw / 2) * scale;
      const fy = oy + (profileH - (cyFromBottom + fh / 2)) * scale;
      const sw = fw * scale, sh = fh * scale;
      if (feature.type === 'circular_hole') chunks.push(`<ellipse cx="${fx + sw / 2}" cy="${fy + sh / 2}" rx="${sw / 2}" ry="${sh / 2}" class="feature"/>`);
      else chunks.push(`<rect x="${fx}" y="${fy}" width="${sw}" height="${sh}" class="feature"/>`);
      if (fwD || fdD) horizontalDimension(chunks, fx, fx + sw, fy, (fwD || fdD).valueMm, -18);
      if (fhD && !fdD) verticalDimension(chunks, fy, fy + sh, fx + sw, fhD.valueMm, 18);
      const xAnchor = xD.reference === 'centre' ? fx + sw / 2 : (xD.fromEdge === 'left' ? fx : fx + sw);
      const xOuter = xD.fromEdge === 'left' ? ox : ox + w;
      horizontalDimension(chunks, Math.min(xOuter, xAnchor), Math.max(xOuter, xAnchor), oy + h, xD.valueMm, 58);
      const yAnchor = yD.reference === 'centre' ? fy + sh / 2 : (yD.fromEdge === 'top' ? fy : fy + sh);
      const yOuter = yD.fromEdge === 'top' ? oy : oy + h;
      verticalDimension(chunks, Math.min(yOuter, yAnchor), Math.max(yOuter, yAnchor), ox + w, yD.valueMm, 58);
      text(chunks, fx + sw / 2, fy + sh / 2 + 5, feature.id || 'Feature', 'middle', 'small');
    }
  } else if (profile.type === 'circle' && outerD) {
    const d = Number(outerD.valueMm); scale = Math.min(drawW, drawH) / d;
    const r = d * scale / 2, cx = drawX + drawW / 2, cy = drawY + drawH / 2;
    chunks.push(`<circle cx="${cx}" cy="${cy}" r="${r}" class="shape"/>`);
    horizontalDimension(chunks, cx - r, cx + r, cy + r, `Ø${outerD.valueMm}`, 32);
  } else {
    text(chunks, width / 2, 245, 'Confirm the overall size to start the digital drawing', 'middle', 'pending');
  }

  text(chunks, 30, 505, 'Confirmed measurements', 'start', 'title');
  if (!confirmedDims.length) text(chunks, 30, 532, 'None confirmed yet.', 'start', 'pending');
  confirmedDims.slice(0, 10).forEach(({ item, d }, index) => {
    const ref = item.kind === 'position' ? ` · ${d.reference} from ${d.fromEdge}` : '';
    text(chunks, 30 + (index >= 5 ? 430 : 0), 532 + (index % 5) * 18, `${item.featureId ? `${item.featureId} ` : ''}${item.label}: ${d.valueMm} mm${ref}`, 'start', 'small');
  });
  chunks.push('</svg>');
  return chunks.join('');
}

export function progressiveReviewSvgDataUrl(source, options) {
  const svg = progressiveReviewSvg(source, options);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
}
