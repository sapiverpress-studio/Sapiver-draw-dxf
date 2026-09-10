const EPS = 1e-6;

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function point(x, y) {
  return { x: Number(x), y: Number(y) };
}

function rectanglePoints(x, y, width, height) {
  return [point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)];
}

function capsulePoints(cx, cy, width, height, segments = 18) {
  if (!(width > 0 && height > 0)) throw new Error('Slot width and height must be positive.');
  const pts = [];
  if (Math.abs(width - height) < EPS) {
    const r = width / 2;
    for (let i = 0; i < segments * 2; i += 1) {
      const a = (Math.PI * 2 * i) / (segments * 2);
      pts.push(point(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    return pts;
  }
  if (width > height) {
    const r = height / 2;
    const halfStraight = (width - height) / 2;
    const leftCx = cx - halfStraight;
    const rightCx = cx + halfStraight;
    for (let i = 0; i <= segments; i += 1) {
      const a = -Math.PI / 2 + (Math.PI * i) / segments;
      pts.push(point(rightCx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    for (let i = 0; i <= segments; i += 1) {
      const a = Math.PI / 2 + (Math.PI * i) / segments;
      pts.push(point(leftCx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
  } else {
    const r = width / 2;
    const halfStraight = (height - width) / 2;
    const bottomCy = cy - halfStraight;
    const topCy = cy + halfStraight;
    for (let i = 0; i <= segments; i += 1) {
      const a = (Math.PI * i) / segments;
      pts.push(point(cx + r * Math.cos(a), topCy + r * Math.sin(a)));
    }
    for (let i = 0; i <= segments; i += 1) {
      const a = Math.PI + (Math.PI * i) / segments;
      pts.push(point(cx + r * Math.cos(a), bottomCy + r * Math.sin(a)));
    }
  }
  return pts;
}

function resolveDimension(dimensionMap, dimensionId, label, errors, { position = false } = {}) {
  if (!dimensionId) {
    errors.push(`${label}: AI did not link a figured dimension to this geometry parameter.`);
    return null;
  }
  const d = dimensionMap.get(dimensionId);
  if (!d) {
    errors.push(`${label}: linked dimension ${dimensionId} is missing from the review list.`);
    return null;
  }
  if (!d.confirmed || !finitePositive(d.valueMm)) {
    errors.push(`${label}: dimension ${d.label || d.id} has not been confirmed with a positive value.`);
    return null;
  }
  if (position) {
    if (!['centre', 'edge'].includes(d.reference)) {
      errors.push(`${label}: position must be confirmed as CENTRE or EDGE.`);
      return null;
    }
    if (!['left', 'right', 'top', 'bottom'].includes(d.fromEdge)) {
      errors.push(`${label}: position must identify the outer edge it is measured from.`);
      return null;
    }
  }
  return d;
}

function axisCentre(total, span, d, axis, label, errors) {
  const allowedEdges = axis === 'x' ? ['left', 'right'] : ['bottom', 'top'];
  if (!allowedEdges.includes(d.fromEdge)) {
    errors.push(`${label}: ${axis.toUpperCase()} position cannot be measured from ${String(d.fromEdge).toUpperCase()}.`);
    return null;
  }
  const fromLow = axis === 'x' ? d.fromEdge === 'left' : d.fromEdge === 'bottom';
  const value = Number(d.valueMm);
  let centre;
  if (d.reference === 'centre') centre = fromLow ? value : total - value;
  else if (d.reference === 'edge') centre = fromLow ? value + span / 2 : total - value - span / 2;
  else return null;
  if (!(centre >= span / 2 - EPS && centre <= total - span / 2 + EPS)) {
    errors.push(`${label}: confirmed position places the feature outside the part boundary.`);
    return null;
  }
  return centre;
}

function entityBounds(entity) {
  if (entity.type === 'circle') {
    return { minX: entity.cx - entity.r, minY: entity.cy - entity.r, maxX: entity.cx + entity.r, maxY: entity.cy + entity.r };
  }
  const xs = entity.points.map((p) => p.x);
  const ys = entity.points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function checkInsideOuter(profile, entity, label, errors) {
  const b = entityBounds(entity);
  if (profile.type === 'rectangle') {
    if (b.minX < -EPS || b.minY < -EPS || b.maxX > profile.width + EPS || b.maxY > profile.height + EPS) {
      errors.push(`${label}: confirmed feature extends outside the rectangular outer profile.`);
    }
    return;
  }
  const cx = profile.diameter / 2;
  const cy = profile.diameter / 2;
  const r = profile.diameter / 2;
  const corners = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]];
  if (corners.some(([x, y]) => Math.hypot(x - cx, y - cy) > r + EPS)) {
    errors.push(`${label}: confirmed feature is not fully inside the circular outer profile.`);
  }
}

function compileFeature(feature, profile, dimensionMap, compiledFeatures, partLabel, errors) {
  const prefix = `${partLabel} / ${feature.id || feature.type}`;
  if (!['rectangular_cutout', 'circular_hole', 'slot'].includes(feature.type)) {
    errors.push(`${prefix}: ${feature.type} is not yet supported by the deterministic v1 geometry engine.`);
    return null;
  }

  let width = null;
  let height = null;
  let diameter = null;
  if (feature.type === 'rectangular_cutout' || feature.type === 'slot') {
    const wd = resolveDimension(dimensionMap, feature.width_dimension_id, `${prefix} width`, errors);
    const hd = resolveDimension(dimensionMap, feature.height_dimension_id, `${prefix} height`, errors);
    if (!wd || !hd) return null;
    width = Number(wd.valueMm);
    height = Number(hd.valueMm);
  } else {
    const dd = resolveDimension(dimensionMap, feature.diameter_dimension_id, `${prefix} diameter`, errors);
    if (!dd) return null;
    diameter = Number(dd.valueMm);
    width = diameter;
    height = diameter;
  }

  const xd = resolveDimension(dimensionMap, feature.x_dimension_id, `${prefix} X position`, errors, { position: true });
  const yd = resolveDimension(dimensionMap, feature.y_dimension_id, `${prefix} Y position`, errors, { position: true });
  if (!xd || !yd) return null;

  const totalWidth = profile.type === 'rectangle' ? profile.width : profile.diameter;
  const totalHeight = profile.type === 'rectangle' ? profile.height : profile.diameter;
  let cx;
  if (feature.x_relative_to_feature_id) {
    const previous = compiledFeatures.get(feature.x_relative_to_feature_id);
    if (!previous) {
      errors.push(`${prefix} X position: previous cut-out ${feature.x_relative_to_feature_id} is missing or invalid.`);
      return null;
    }
    cx = entityBounds(previous).maxX + Number(xd.valueMm) + width / 2;
  } else {
    cx = axisCentre(totalWidth, width, xd, 'x', `${prefix} X position`, errors);
  }
  const cy = axisCentre(totalHeight, height, yd, 'y', `${prefix} Y position`, errors);
  if (cx == null || cy == null) return null;

  let entity;
  if (feature.type === 'circular_hole') {
    entity = { type: 'circle', cx, cy, r: diameter / 2, role: 'cut', label: feature.id || 'Hole' };
  } else if (feature.type === 'rectangular_cutout') {
    entity = { type: 'polyline', points: rectanglePoints(cx - width / 2, cy - height / 2, width, height), closed: true, role: 'cut', label: feature.id || 'Cut-out' };
  } else {
    entity = { type: 'polyline', points: capsulePoints(cx, cy, width, height), closed: true, role: 'cut', label: feature.id || 'Slot' };
  }
  checkInsideOuter(profile, entity, prefix, errors);
  return entity;
}

function compilePart(part, dimensionMap, errors) {
  const label = part.label || part.id || 'Part';
  const profileSpec = part.profile || {};
  let profile;
  let outer;

  if (profileSpec.type === 'rectangle') {
    const wd = resolveDimension(dimensionMap, profileSpec.width_dimension_id, `${label} overall width`, errors);
    const hd = resolveDimension(dimensionMap, profileSpec.height_dimension_id, `${label} overall height`, errors);
    if (!wd || !hd) return null;
    const width = Number(wd.valueMm);
    const height = Number(hd.valueMm);
    profile = { type: 'rectangle', width, height };
    outer = { type: 'polyline', points: rectanglePoints(0, 0, width, height), closed: true, role: 'outer', label };
  } else if (profileSpec.type === 'circle') {
    const dd = resolveDimension(dimensionMap, profileSpec.diameter_dimension_id, `${label} overall diameter`, errors);
    if (!dd) return null;
    const diameter = Number(dd.valueMm);
    profile = { type: 'circle', diameter };
    outer = { type: 'circle', cx: diameter / 2, cy: diameter / 2, r: diameter / 2, role: 'outer', label };
  } else {
    errors.push(`${label}: outer profile type ${profileSpec.type || 'unknown'} is not yet supported by deterministic v1 geometry.`);
    return null;
  }

  const entities = [outer];
  const compiledFeatures = new Map();
  for (const feature of part.features || []) {
    const quantity = Math.max(1, Number(feature.quantity) || 1);
    if (quantity !== 1) {
      errors.push(`${label} / ${feature.id || feature.type}: repeated quantity ${quantity} needs individually located features before DXF release.`);
      continue;
    }
    const entity = compileFeature(feature, profile, dimensionMap, compiledFeatures, label, errors);
    if (entity) {
      entities.push(entity);
      compiledFeatures.set(feature.id, entity);
    }
  }

  const bounds = profile.type === 'rectangle'
    ? { minX: 0, minY: 0, maxX: profile.width, maxY: profile.height, width: profile.width, height: profile.height }
    : { minX: 0, minY: 0, maxX: profile.diameter, maxY: profile.diameter, width: profile.diameter, height: profile.diameter };

  return { id: part.id || label, label, profile, entities, bounds };
}

export function compileSourceGeometry(source) {
  const errors = [];
  if (!source?.analysis) return { ok: false, errors: ['No AI geometry proposal is available for this drawing.'], parts: [] };
  const dimensions = Array.isArray(source.dimensions) ? source.dimensions : [];
  const dimensionMap = new Map(dimensions.map((d) => [d.id, d]));
  const proposalParts = Array.isArray(source.analysis.parts) ? source.analysis.parts : [];
  if (!proposalParts.length) errors.push('AI did not identify any deterministic part profiles in this drawing.');

  const parts = [];
  for (const part of proposalParts) {
    const compiled = compilePart(part, dimensionMap, errors);
    if (compiled) parts.push(compiled);
  }
  return { ok: errors.length === 0 && parts.length > 0, errors, parts };
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function geometryToSvg(geometry, { width = 900, height = 600, padding = 28 } = {}) {
  if (!geometry?.parts?.length) return '';
  const cols = geometry.parts.length > 1 ? 2 : 1;
  const rows = Math.ceil(geometry.parts.length / cols);
  const cellW = width / cols;
  const cellH = height / rows;
  const chunks = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Confirmed manufacturing geometry">`, '<rect width="100%" height="100%" fill="white"/>'];

  geometry.parts.forEach((part, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x0 = col * cellW;
    const y0 = row * cellH;
    const labelH = 30;
    const availW = cellW - padding * 2;
    const availH = cellH - padding * 2 - labelH;
    const scale = Math.min(availW / part.bounds.width, availH / part.bounds.height);
    const ox = x0 + (cellW - part.bounds.width * scale) / 2;
    const oy = y0 + labelH + (availH - part.bounds.height * scale) / 2 + padding;
    chunks.push(`<text x="${x0 + padding}" y="${y0 + 22}" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#111827">${esc(part.label)}</text>`);
    chunks.push(`<g transform="translate(${ox} ${oy + part.bounds.height * scale}) scale(${scale} ${-scale})" fill="none" stroke="#111827" vector-effect="non-scaling-stroke">`);
    for (const entity of part.entities) {
      const strokeWidth = entity.role === 'outer' ? 2 / scale : 1.4 / scale;
      if (entity.type === 'circle') chunks.push(`<circle cx="${entity.cx}" cy="${entity.cy}" r="${entity.r}" stroke-width="${strokeWidth}"/>`);
      else chunks.push(`<polygon points="${entity.points.map((p) => `${p.x},${p.y}`).join(' ')}" stroke-width="${strokeWidth}"/>`);
    }
    chunks.push('</g>');
    const sizeText = part.profile.type === 'rectangle' ? `${part.profile.width} × ${part.profile.height} mm` : `Ø${part.profile.diameter} mm`;
    chunks.push(`<text x="${x0 + padding}" y="${y0 + cellH - 8}" font-family="system-ui,sans-serif" font-size="12" fill="#475467">${esc(sizeText)}</text>`);
  });
  chunks.push('</svg>');
  return chunks.join('');
}

export function geometryToSvgDataUrl(geometry, options) {
  const svg = geometryToSvg(geometry, options);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
}
