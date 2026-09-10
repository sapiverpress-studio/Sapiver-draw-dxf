import { compileSourceGeometry, geometryToSvg } from './geometry.js';

const EPS = 1e-6;

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function nearlyEqual(a, b, tolerance = 0.01) {
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= tolerance;
}

function featureName(feature, index) {
  const raw = String(feature?.id || '').trim();
  if (raw && !/^f\d+$/i.test(raw)) return raw;
  const base = feature?.type === 'circular_hole' ? 'Circular hole'
    : feature?.type === 'slot' ? 'Slot'
      : feature?.type === 'rectangular_cutout' ? 'Rectangular cut-out'
        : feature?.type === 'notch' ? 'Notch' : 'Cut-out';
  return `${base} ${index + 1}`;
}

function featureLocationHint(feature) {
  const hints = [];
  if (finitePositive(feature?.x_mm) && feature?.x_relative_to_feature_id) hints.push(`${Number(feature.x_mm)} mm gap from previous cut-out`);
  else if (finitePositive(feature?.x_mm) && ['left', 'right'].includes(feature?.x_from_edge)) hints.push(`${Number(feature.x_mm)} mm from ${feature.x_from_edge}`);
  if (finitePositive(feature?.y_mm) && ['top', 'bottom'].includes(feature?.y_from_edge)) hints.push(`${Number(feature.y_mm)} mm from ${feature.y_from_edge}`);
  return hints.length ? ` · proposed ${hints.join(', ')}` : '';
}

function partName(part, index) {
  return String(part?.label || part?.id || `Part ${index + 1}`).trim();
}

function pushProfileSlots(slots, part, partIndex) {
  const profile = part?.profile || {};
  const common = { partIndex, featureIndex: null, section: partName(part, partIndex), ownerType: 'profile' };
  if (profile.type === 'rectangle') {
    slots.push({ ...common, key: `p${partIndex}:profile:width`, parameter: 'width', field: 'width_dimension_id', valueField: 'width_mm', kind: 'size', label: 'Overall width' });
    slots.push({ ...common, key: `p${partIndex}:profile:height`, parameter: 'height', field: 'height_dimension_id', valueField: 'height_mm', kind: 'size', label: 'Overall height' });
  } else if (profile.type === 'circle') {
    slots.push({ ...common, key: `p${partIndex}:profile:diameter`, parameter: 'diameter', field: 'diameter_dimension_id', valueField: 'diameter_mm', kind: 'size', label: 'Overall diameter' });
  } else if (profile.type === 'quadrilateral') {
    const rightAngles = profile.right_angle_corners || [];
    const derivedTop = rightAngles.includes('bottom-left') && rightAngles.includes('bottom-right') && !profile.top_dimension_id && !finitePositive(profile.top_mm);
    for (const side of ['top', 'bottom', 'left', 'right']) {
      if (side === 'top' && derivedTop) continue;
      const shoulderLabel = profile.side_heights_to_notch_shoulders && ['left', 'right'].includes(side)
        ? `${side[0].toUpperCase()}${side.slice(1)} outer height to notch shoulder`
        : `${side[0].toUpperCase()}${side.slice(1)} length`;
      slots.push({ ...common, key:`p${partIndex}:profile:${side}`, parameter:side, field:`${side}_dimension_id`, valueField:`${side}_mm`, kind:'size', label:shoulderLabel });
    }
  } else if (profile.type === 'path') {
    for (let index=0; index<(profile.boundary_segments||[]).length; index+=1) {
      const segment=profile.boundary_segments[index];
      if (segment.kind === 'connect') continue;
      slots.push({ ...common, key:`p${partIndex}:profile:segment:${index}`, parameter:'length', field:'dimension_id', valueField:'length_mm', kind:'size', ownerType:'segment', segmentIndex:index, label:segment.label || `Perimeter segment ${index+1}` });
    }
  }
}

function pushFeatureSlots(slots, part, partIndex, feature, featureIndex) {
  const name = featureName(feature, featureIndex);
  const common = { partIndex, featureIndex, section: `${partName(part, partIndex)} · ${name}${featureLocationHint(feature)}`, ownerType: 'feature', featureType: feature.type, corner:feature.corner };
  if (['corner_notch', 'edge_notch'].includes(feature.type)) {
    slots.push({ ...common, key:`p${partIndex}:f${featureIndex}:width`, parameter:'width', field:'width_dimension_id', valueField:'width_mm', kind:'size', label:`${name} width` });
    slots.push({ ...common, key:`p${partIndex}:f${featureIndex}:depth`, parameter:'depth', field:'depth_dimension_id', valueField:'depth_mm', kind:'size', label:`${name} depth` });
    if (feature.type === 'edge_notch') slots.push({ ...common, key:`p${partIndex}:f${featureIndex}:offset`, parameter:'offset', field:'offset_dimension_id', valueField:'offset_mm', kind:'size', label:`${name} position along edge` });
    if (feature.radius_dimension_id || finitePositive(feature.radius_mm)) slots.push({ ...common, key:`p${partIndex}:f${featureIndex}:radius`, parameter:'radius', field:'radius_dimension_id', valueField:'radius_mm', kind:'size', label:`${name} internal radius` });
    return;
  }
  if (['rectangular_cutout', 'slot', 'notch', 'other'].includes(feature.type)) {
    slots.push({ ...common, key: `p${partIndex}:f${featureIndex}:width`, parameter: 'width', field: 'width_dimension_id', valueField: 'width_mm', kind: 'size', label: `${name} width` });
    slots.push({ ...common, key: `p${partIndex}:f${featureIndex}:height`, parameter: 'height', field: 'height_dimension_id', valueField: 'height_mm', kind: 'size', label: `${name} height` });
  } else if (feature.type === 'circular_hole') {
    slots.push({ ...common, key: `p${partIndex}:f${featureIndex}:diameter`, parameter: 'diameter', field: 'diameter_dimension_id', valueField: 'diameter_mm', kind: 'size', label: `${name} diameter` });
  }
  slots.push({ ...common, key: `p${partIndex}:f${featureIndex}:x`, parameter: 'x', field: 'x_dimension_id', valueField: 'x_mm', kind: 'position', axis: 'x', referenceField: 'x_reference', fromEdgeField: 'x_from_edge', label: `${name} X position` });
  slots.push({ ...common, key: `p${partIndex}:f${featureIndex}:y`, parameter: 'y', field: 'y_dimension_id', valueField: 'y_mm', kind: 'position', axis: 'y', referenceField: 'y_reference', fromEdgeField: 'y_from_edge', label: `${name} Y position` });
}

export function geometrySlots(source) {
  const slots = [];
  const parts = Array.isArray(source?.analysis?.parts) ? source.analysis.parts : [];
  parts.forEach((part, partIndex) => {
    pushProfileSlots(slots, part, partIndex);
    (part.features || []).forEach((feature, featureIndex) => pushFeatureSlots(slots, part, partIndex, feature, featureIndex));
  });
  return slots;
}

export function isPerimeterSlot(slot) {
  return ['profile', 'segment'].includes(slot?.ownerType);
}

export function slotOwner(source, slot) {
  if (!slot) return null;
  const part = source?.analysis?.parts?.[slot.partIndex];
  if (!part) return null;
  if (slot.ownerType === 'profile') return part.profile;
  if (slot.ownerType === 'segment') return part.profile?.boundary_segments?.[slot.segmentIndex] || null;
  return part.features?.[slot.featureIndex] || null;
}

export function slotDimensionId(source, slot) {
  return slotOwner(source, slot)?.[slot.field] || null;
}

export function setSlotDimensionId(source, slot, dimensionId) {
  const owner = slotOwner(source, slot);
  if (!owner) return false;
  owner[slot.field] = dimensionId || null;
  return true;
}

export function slotByKey(source, key) {
  return geometrySlots(source).find((slot) => slot.key === key) || null;
}

function compatibleRole(slot, dimension) {
  if (!dimension) return false;
  const role = String(dimension.role || 'unknown');
  if (slot.kind === 'position') return ['position', 'unknown'].includes(role);
  return ['overall', 'size', 'diameter', 'radius', 'unknown'].includes(role);
}

function applySlotSemantics(source, slot, dimension) {
  if (!dimension) return;
  dimension.label = slot.label;
  if (slot.kind === 'size') {
    dimension.reference = 'size';
    dimension.fromEdge = 'unknown';
    if (slot.parameter === 'diameter') dimension.role = 'diameter';
    else if (['profile','segment'].includes(slot.ownerType)) dimension.role = 'overall';
    else dimension.role = 'size';
    return;
  }

  dimension.role = 'position';
  const owner = slotOwner(source, slot) || {};
  const proposedReference = owner[slot.referenceField];
  const proposedEdge = owner[slot.fromEdgeField];
  if (!['centre', 'edge'].includes(dimension.reference)) {
    dimension.reference = ['centre', 'edge'].includes(proposedReference) ? proposedReference : 'unknown';
  }
  const allowed = slot.axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
  if (!allowed.includes(dimension.fromEdge)) {
    dimension.fromEdge = allowed.includes(proposedEdge) ? proposedEdge : 'unknown';
  }
}

function repairSteppedRectangleProfiles(source) {
  const dimensions = Array.isArray(source?.dimensions) ? source.dimensions : [];
  const parts = Array.isArray(source?.analysis?.parts) ? source.analysis.parts : [];
  for (const part of parts) {
    const profile = part?.profile || {};
    if (['rectangle', 'circle', 'quadrilateral'].includes(profile.type)) continue;
    if (!(part.features || []).some((feature) => ['corner_notch', 'edge_notch'].includes(feature.type))) continue;

    const overall = dimensions.filter((dimension) => dimension.role === 'overall' && finitePositive(dimension.valueMm));
    const widthCandidates = overall.filter((dimension) => /\boverall\b.*\b(width|bottom)\b|\b(width|bottom)\b.*\boverall\b/i.test(dimension.label || ''));
    const heightCandidates = overall.filter((dimension) => /\boverall\b.*\b(height|left|right)\b|\b(height|left|right)\b.*\boverall\b/i.test(dimension.label || ''));
    if (widthCandidates.length !== 1 || heightCandidates.length !== 1 || widthCandidates[0].id === heightCandidates[0].id) continue;

    profile.type = 'rectangle';
    profile.width_mm = Number(widthCandidates[0].valueMm);
    profile.height_mm = Number(heightCandidates[0].valueMm);
    profile.width_dimension_id = widthCandidates[0].id;
    profile.height_dimension_id = heightCandidates[0].id;
    profile.diameter_mm = null;
    profile.diameter_dimension_id = null;
  }
}

function oneSemanticDimension(dimensions, pattern, exclude = null) {
  const matches = dimensions.filter((dimension) => finitePositive(dimension.valueMm) && pattern.test(dimension.label || '') && !(exclude?.test(dimension.label || '')));
  return matches.length === 1 ? matches[0] : null;
}

function repairDoubleTopShoulderProfiles(source) {
  const dimensions = Array.isArray(source?.dimensions) ? source.dimensions : [];
  const parts = Array.isArray(source?.analysis?.parts) ? source.analysis.parts : [];
  for (const part of parts) {
    const profile = part?.profile || {};
    if (['rectangle', 'circle', 'quadrilateral'].includes(profile.type)) continue;
    const features = part.features || [];
    const leftNotch = features.find((feature) => feature.type === 'corner_notch' && feature.corner === 'top-left');
    const rightNotch = features.find((feature) => feature.type === 'corner_notch' && feature.corner === 'top-right');
    if (!leftNotch || !rightNotch) continue;
    const bottom = oneSemanticDimension(dimensions, /\bprofile[. ]bottom\b|\bbottom\b.*\b(width|horizontal|length)\b|\b(width|horizontal|length)\b.*\bbottom\b/i, /\b(notch|cut[ -]?out|socket|hole)\b/i);
    const left = oneSemanticDimension(dimensions, /\bleft\b.*\b(outer|height|vertical|side)\b.*\b(shoulder|ledge|notch)|\bleft\b.*\b(outer|height|vertical|side)\b/i, /\b(width|inward|horizontal|depth|rise)\b/i);
    const right = oneSemanticDimension(dimensions, /\bright\b.*\b(outer|height|vertical|side)\b.*\b(shoulder|ledge|notch)|\bright\b.*\b(outer|height|vertical|side)\b/i, /\b(width|inward|horizontal|depth|rise)\b/i);
    if (!bottom || !left || !right || new Set([bottom.id, left.id, right.id]).size !== 3) continue;
    Object.assign(profile, {
      type:'quadrilateral', top_mm:null, top_dimension_id:null,
      bottom_mm:Number(bottom.valueMm), bottom_dimension_id:bottom.id,
      left_mm:Number(left.valueMm), left_dimension_id:left.id,
      right_mm:Number(right.valueMm), right_dimension_id:right.id,
      right_angle_corners:['bottom-left','bottom-right'],
      side_heights_to_notch_shoulders:true,
    });
  }
}

function repairTwoSquareTaperedProfiles(source) {
  const dimensions = Array.isArray(source?.dimensions) ? source.dimensions : [];
  const parts = Array.isArray(source?.analysis?.parts) ? source.analysis.parts : [];
  for (const part of parts) {
    const profile = part?.profile || {};
    if (['rectangle', 'circle', 'quadrilateral'].includes(profile.type)) continue;
    const angles = profile.right_angle_corners || [];
    if (!(angles.includes('bottom-left') && angles.includes('bottom-right'))) continue;
    const bottom = oneSemanticDimension(dimensions, /\bprofile[. ]bottom\b|\bbottom\b.*\b(width|horizontal|length)\b|\b(width|horizontal|length)\b.*\bbottom\b/i);
    const left = oneSemanticDimension(dimensions, /\bleft\b.*\b(height|vertical|side|edge)\b|\b(height|vertical|side)\b.*\bleft\b/i, /\b(notch|cut[ -]?out|socket|hole)\b/i);
    const right = oneSemanticDimension(dimensions, /\bright\b.*\b(height|vertical|side|edge)\b|\b(height|vertical|side)\b.*\bright\b/i, /\b(notch|cut[ -]?out|socket|hole)\b/i);
    if (!bottom || !left || !right || new Set([bottom.id, left.id, right.id]).size !== 3) continue;
    Object.assign(profile, {
      type:'quadrilateral', top_mm:null, top_dimension_id:null,
      bottom_mm:Number(bottom.valueMm), bottom_dimension_id:bottom.id,
      left_mm:Number(left.valueMm), left_dimension_id:left.id,
      right_mm:Number(right.valueMm), right_dimension_id:right.id,
    });
  }
}

function semanticScore(slot, dimension) {
  const label = String(dimension?.label || '').toLowerCase();
  let score = 0;
  const words = {
    width:/\b(width|horizontal|length|inward)\b/, height:/\b(height|vertical)\b/, depth:/\b(depth|deep|rise|vertical)\b/,
    offset:/\b(offset|position|from)\b/, diameter:/\b(diameter|dia|ø|hole)\b/,
    top:/\btop\b/, bottom:/\bbottom\b/, left:/\bleft\b/, right:/\bright\b/,
    x:/\b(x|horizontal|left|right)\b/, y:/\b(y|vertical|bottom|top|up)\b/,
  };
  if (words[slot.parameter]?.test(label)) score += 4;
  if (['profile','segment'].includes(slot.ownerType) && /\b(overall|panel|side|edge|perimeter|shoulder|notch)\b/.test(label)) score += 2;
  if (slot.ownerType === 'feature') {
    const featureWord = slot.featureType === 'rectangular_cutout' ? /\b(socket|cut[ -]?out|opening)\b/
      : slot.featureType === 'corner_notch' ? /\b(corner|notch|cut[ -]?out)\b/
        : slot.featureType === 'edge_notch' ? /\b(edge|notch|recess)\b/ : /\b(hole|slot|cut[ -]?out)\b/;
    if (featureWord.test(label)) score += 2;
    if (slot.corner?.includes('left') && /\bleft\b/.test(label)) score += 3;
    if (slot.corner?.includes('right') && /\bright\b/.test(label)) score += 3;
    if (slot.corner?.includes('top') && /\btop\b/.test(label)) score += 1;
  }
  if (slot.kind === 'position' && dimension.fromEdge !== 'unknown') {
    const allowed = slot.axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
    if (allowed.includes(dimension.fromEdge)) score += 3;
    else score -= 6;
  }
  return score;
}

export function repairGeometryLinks(source) {
  if (!source?.analysis || !Array.isArray(source.dimensions)) return source;
  repairDoubleTopShoulderProfiles(source);
  repairTwoSquareTaperedProfiles(source);
  repairSteppedRectangleProfiles(source);
  const dimensions = source.dimensions;
  const byId = new Map(dimensions.map((d) => [d.id, d]));
  const slots = geometrySlots(source);
  const claimed = new Set();

  for (const slot of slots) {
    const owner = slotOwner(source, slot);
    if (!owner) continue;
    const proposal = Number(owner[slot.valueField]);
    const currentId = owner[slot.field];
    const current = currentId ? byId.get(currentId) : null;
    const currentMatches = current && (!finitePositive(proposal) || nearlyEqual(current.valueMm, proposal));

    if (current && currentMatches && !claimed.has(current.id)) {
      claimed.add(current.id);
      applySlotSemantics(source, slot, current);
      continue;
    }

    if (finitePositive(proposal)) {
      const candidates = dimensions.filter((d) => {
        if (claimed.has(d.id) || !finitePositive(d.valueMm) || !nearlyEqual(d.valueMm, proposal) || !compatibleRole(slot, d)) return false;
        if (slot.kind !== 'position' || d.fromEdge === 'unknown') return true;
        const allowed = slot.axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
        return allowed.includes(d.fromEdge);
      });
      if (candidates.length === 1) {
        owner[slot.field] = candidates[0].id;
        claimed.add(candidates[0].id);
        applySlotSemantics(source, slot, candidates[0]);
        continue;
      }
    }

    if (!current) {
      const ranked = dimensions
        .filter((d) => !claimed.has(d.id) && finitePositive(d.valueMm) && compatibleRole(slot, d))
        .map((d) => ({ dimension:d, score:semanticScore(slot, d) }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0]?.score >= 4 && (!ranked[1] || ranked[0].score - ranked[1].score >= 2)) {
        owner[slot.field] = ranked[0].dimension.id;
        claimed.add(ranked[0].dimension.id);
        applySlotSemantics(source, slot, ranked[0].dimension);
        continue;
      }
    }

    if (current && !claimed.has(current.id)) {
      claimed.add(current.id);
      applySlotSemantics(source, slot, current);
    } else if (!current) {
      owner[slot.field] = null;
    }
  }

  return source;
}

export function dimensionForSlot(source, slot) {
  const dimensionId = slotDimensionId(source, slot);
  return dimensionId ? source?.dimensions?.find((d) => d.id === dimensionId) || null : null;
}

export function dimensionReadyForSlot(slot, dimension) {
  if (!slot || !(dimension?.confirmed && finitePositive(dimension.valueMm))) return false;
  if (slot.kind === 'size') return dimension.reference === 'size';
  if (!['centre', 'edge'].includes(dimension.reference)) return false;
  const allowed = slot.axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
  return allowed.includes(dimension.fromEdge);
}

export function reviewStats(source) {
  const slots = geometrySlots(source);
  let confirmed = 0;
  let linked = 0;
  for (const slot of slots) {
    const d = dimensionForSlot(source, slot);
    if (d) linked += 1;
    if (dimensionReadyForSlot(slot, d)) confirmed += 1;
  }
  return { total: slots.length, linked, confirmed, missing: Math.max(0, slots.length - linked), slots };
}

export function unlinkedDimensions(source) {
  const linked = new Set(geometrySlots(source).map((slot) => slotDimensionId(source, slot)).filter(Boolean));
  return (source?.dimensions || []).filter((d) => !linked.has(d.id));
}

export function unlinkDimension(source, dimensionId) {
  for (const slot of geometrySlots(source)) {
    if (slotDimensionId(source, slot) === dimensionId) setSlotDimensionId(source, slot, null);
  }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function markerDef() {
  return '<defs><marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#344054"/></marker></defs>';
}

function text(chunks, x, y, value, opts = '') {
  const size = /(?:^|\s)font-size=/.test(opts) ? '' : 'font-size="14"';
  chunks.push(`<text x="${x}" y="${y}" font-family="system-ui,sans-serif" ${size} fill="#101828" ${opts}>${esc(value)}</text>`);
}

function line(chunks, x1, y1, x2, y2, arrows = false) {
  chunks.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#344054" stroke-width="1.4" ${arrows ? 'marker-start="url(#a)" marker-end="url(#a)"' : ''}/>`);
}

function confirmedValue(source, slot) {
  const d = dimensionForSlot(source, slot);
  return dimensionReadyForSlot(slot, d) ? Number(d.valueMm) : null;
}

function slotFor(slots, partIndex, featureIndex, parameter) {
  return slots.find((s) => s.partIndex === partIndex && s.featureIndex === featureIndex && s.parameter === parameter) || null;
}

function axisCentre(total, span, dimension) {
  if (!(finitePositive(total) && finitePositive(span) && dimension)) return null;
  const value = Number(dimension.valueMm);
  const low = ['left', 'bottom'].includes(dimension.fromEdge);
  if (dimension.reference === 'centre') return low ? value : total - value;
  if (dimension.reference === 'edge') return low ? value + span / 2 : total - value - span / 2;
  return null;
}

function drawRectanglePart(chunks, source, part, partIndex, yOffset, slots) {
  const widthSlot = slotFor(slots, partIndex, null, 'width');
  const heightSlot = slotFor(slots, partIndex, null, 'height');
  const width = confirmedValue(source, widthSlot);
  const height = confirmedValue(source, heightSlot);
  const canvasX = 150;
  const canvasY = yOffset + 60;
  const boxW = 610;
  const boxH = 260;

  text(chunks, 40, yOffset + 28, partName(part, partIndex), 'font-weight="700" font-size="16"');

  if (!(finitePositive(width) && finitePositive(height))) {
    chunks.push(`<rect x="${canvasX}" y="${canvasY}" width="${boxW}" height="${boxH}" fill="none" stroke="#98a2b3" stroke-width="2" stroke-dasharray="8 6"/>`);
    text(chunks, canvasX + boxW / 2, canvasY + boxH / 2, 'Confirm overall width and height to scale the drawing', 'text-anchor="middle" fill="#667085"');
    if (finitePositive(width)) text(chunks, canvasX + boxW / 2, canvasY + boxH + 34, `${width} mm overall width ✓`, 'text-anchor="middle"');
    if (finitePositive(height)) text(chunks, canvasX - 18, canvasY + boxH / 2, `${height} mm overall height ✓`, `text-anchor="middle" transform="rotate(-90 ${canvasX - 18} ${canvasY + boxH / 2})"`);
    return;
  }

  const scale = Math.min(boxW / width, boxH / height);
  const drawW = width * scale;
  const drawH = height * scale;
  const ox = canvasX + (boxW - drawW) / 2;
  const oy = canvasY + (boxH - drawH) / 2;
  chunks.push(`<rect x="${ox}" y="${oy}" width="${drawW}" height="${drawH}" fill="#ffffff" stroke="#101828" stroke-width="2.2"/>`);

  line(chunks, ox, oy + drawH + 28, ox + drawW, oy + drawH + 28, true);
  line(chunks, ox, oy + drawH, ox, oy + drawH + 36);
  line(chunks, ox + drawW, oy + drawH, ox + drawW, oy + drawH + 36);
  text(chunks, ox + drawW / 2, oy + drawH + 23, `${width} mm`, 'text-anchor="middle" font-weight="700"');

  line(chunks, ox - 35, oy, ox - 35, oy + drawH, true);
  line(chunks, ox - 42, oy, ox, oy);
  line(chunks, ox - 42, oy + drawH, ox, oy + drawH);
  text(chunks, ox - 42, oy + drawH / 2, `${height} mm`, `text-anchor="middle" font-weight="700" transform="rotate(-90 ${ox - 42} ${oy + drawH / 2})"`);

  const featureBounds = new Map();
  for (const [featureIndex, feature] of (part.features || []).entries()) {
    const widthS = slotFor(slots, partIndex, featureIndex, 'width');
    const heightS = slotFor(slots, partIndex, featureIndex, 'height');
    const diameterS = slotFor(slots, partIndex, featureIndex, 'diameter');
    const xS = slotFor(slots, partIndex, featureIndex, 'x');
    const yS = slotFor(slots, partIndex, featureIndex, 'y');
    const fw = confirmedValue(source, widthS) ?? confirmedValue(source, diameterS);
    const fh = confirmedValue(source, heightS) ?? confirmedValue(source, diameterS);
    const xd = xS ? dimensionForSlot(source, xS) : null;
    const yd = yS ? dimensionForSlot(source, yS) : null;
    const xReady = xS ? dimensionReadyForSlot(xS, xd) : false;
    const yReady = yS ? dimensionReadyForSlot(yS, yd) : false;
    const name = featureName(feature, featureIndex);

    if (!(finitePositive(fw) && finitePositive(fh) && xReady && yReady)) {
      const bits = [];
      if (finitePositive(fw)) bits.push(`W ${fw}`);
      if (finitePositive(fh)) bits.push(`H ${fh}`);
      if (xReady) bits.push(`X ${xd.valueMm}`);
      if (yReady) bits.push(`Y ${yd.valueMm}`);
      if (bits.length) text(chunks, canvasX, yOffset + 350 + featureIndex * 18, `${name}: ${bits.join(' · ')} mm confirmed · remaining parameters pending`, 'fill="#475467" font-size="12"');
      continue;
    }

    const previousBounds = feature.x_relative_to_feature_id ? featureBounds.get(feature.x_relative_to_feature_id) : null;
    const cxMm = previousBounds ? previousBounds.maxX + Number(xd.valueMm) + fw / 2 : axisCentre(width, fw, xd);
    const cyMm = axisCentre(height, fh, yd);
    if (!Number.isFinite(cxMm) || !Number.isFinite(cyMm)) continue;
    featureBounds.set(feature.id, { minX: cxMm - fw / 2, maxX: cxMm + fw / 2 });
    const fx = ox + (cxMm - fw / 2) * scale;
    const fy = oy + drawH - (cyMm + fh / 2) * scale;
    const fwp = fw * scale;
    const fhp = fh * scale;
    const cx = fx + fwp / 2;
    const cy = fy + fhp / 2;

    if (feature.type === 'circular_hole') {
      chunks.push(`<ellipse cx="${cx}" cy="${cy}" rx="${fwp / 2}" ry="${fhp / 2}" fill="none" stroke="#101828" stroke-width="1.8"/>`);
      line(chunks, cx - 8, cy, cx + 8, cy);
      line(chunks, cx, cy - 8, cx, cy + 8);
      text(chunks, cx, fy - 8, `${name} Ø${fw} mm`, 'text-anchor="middle" font-size="12" font-weight="700"');
    } else {
      chunks.push(`<rect x="${fx}" y="${fy}" width="${fwp}" height="${fhp}" fill="none" stroke="#101828" stroke-width="1.8"/>`);
      line(chunks, fx, fy - 14, fx + fwp, fy - 14, true);
      text(chunks, cx, fy - 19, `${name} ${fw} mm`, 'text-anchor="middle" font-size="12" font-weight="700"');
      line(chunks, fx + fwp + 14, fy, fx + fwp + 14, fy + fhp, true);
      text(chunks, fx + fwp + 22, cy, `${fh} mm`, `font-size="12" transform="rotate(-90 ${fx + fwp + 22} ${cy})" text-anchor="middle"`);
    }

    const xTargetMm = xd.reference === 'centre' ? cxMm : xd.fromEdge === 'left' ? cxMm - fw / 2 : cxMm + fw / 2;
    const xTarget = ox + xTargetMm * scale;
    const xStart = previousBounds ? ox + previousBounds.maxX * scale : xd.fromEdge === 'left' ? ox : ox + drawW;
    const xDimY = Math.min(oy + drawH + 52 + featureIndex * 15, yOffset + 380);
    line(chunks, xStart, xDimY, xTarget, xDimY, true);
    text(chunks, (xStart + xTarget) / 2, xDimY - 6, previousBounds ? `${xd.valueMm} mm gap from previous cut-out` : `${xd.valueMm} mm ${xd.reference} from ${xd.fromEdge}`, 'text-anchor="middle" font-size="11"');

    const yTargetMm = yd.reference === 'centre' ? cyMm : yd.fromEdge === 'bottom' ? cyMm - fh / 2 : cyMm + fh / 2;
    const yTarget = oy + drawH - yTargetMm * scale;
    const yStart = yd.fromEdge === 'top' ? oy : oy + drawH;
    const yDimX = ox + drawW + 58 + featureIndex * 14;
    line(chunks, yDimX, yStart, yDimX, yTarget, true);
    text(chunks, yDimX + 8, (yStart + yTarget) / 2, `${yd.valueMm} mm ${yd.reference} from ${yd.fromEdge}`, `font-size="11" transform="rotate(-90 ${yDimX + 8} ${(yStart + yTarget) / 2})" text-anchor="middle"`);
  }
}

function drawCirclePart(chunks, source, part, partIndex, yOffset, slots) {
  const diameterSlot = slotFor(slots, partIndex, null, 'diameter');
  const diameter = confirmedValue(source, diameterSlot);
  text(chunks, 40, yOffset + 28, partName(part, partIndex), 'font-weight="700" font-size="16"');
  const cx = 450;
  const cy = yOffset + 190;
  const r = 125;
  chunks.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${finitePositive(diameter) ? '#101828' : '#98a2b3'}" stroke-width="2" ${finitePositive(diameter) ? '' : 'stroke-dasharray="8 6"'}/>`);
  if (finitePositive(diameter)) {
    line(chunks, cx - r, cy, cx + r, cy, true);
    text(chunks, cx, cy - 8, `Ø${diameter} mm`, 'text-anchor="middle" font-weight="700"');
  } else {
    text(chunks, cx, cy, 'Confirm overall diameter to scale the drawing', 'text-anchor="middle" fill="#667085"');
  }
}

export function reviewDrawingSvg(source) {
  repairGeometryLinks(source);
  const parts = Array.isArray(source?.analysis?.parts) ? source.analysis.parts : [];
  if (!parts.length) return '';
  const slots = geometrySlots(source);
  const needsCompiledOutline = parts.some((part) => part?.profile?.type === 'quadrilateral' || (part.features || []).some((feature) => ['corner_notch','edge_notch'].includes(feature.type)));
  if (needsCompiledOutline && slots.length && slots.every((slot) => dimensionReadyForSlot(slot, dimensionForSlot(source, slot)))) {
    const geometry = compileSourceGeometry(source);
    if (geometry.ok) return geometryToSvg(geometry, { width:900, height:430, padding:42 });
  }
  const height = Math.max(430, parts.length * 430);
  const chunks = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 ${height}" role="img" aria-label="Confirmed digital drawing">`, markerDef(), '<rect width="100%" height="100%" fill="white"/>'];
  parts.forEach((part, partIndex) => {
    const yOffset = partIndex * 430;
    if (part?.profile?.type === 'circle') drawCirclePart(chunks, source, part, partIndex, yOffset, slots);
    else drawRectanglePart(chunks, source, part, partIndex, yOffset, slots);
  });
  chunks.push('</svg>');
  return chunks.join('');
}

export function reviewDrawingDataUrl(source) {
  const svg = reviewDrawingSvg(source);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
}
