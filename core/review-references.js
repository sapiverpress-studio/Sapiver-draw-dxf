const SUPPORTED_PROFILE_TYPES = new Set(['rectangle', 'circle', 'quadrilateral', 'path']);

export function isReviewOnlyDimension(dimension) {
  return dimension?.reviewOnly === true;
}

export function reviewOnlyTargetOptions(source, slots = []) {
  const options = [{
    value: 'review:named-reference',
    label: 'Named review reference — does not define DXF geometry',
  }];
  const parts = Array.isArray(source?.analysis?.parts) ? source.analysis.parts : [];
  for (const [partIndex, part] of parts.entries()) {
    const profile = part?.profile || {};
    const profileSlots = slots.filter((slot) => slot.partIndex === partIndex && ['profile', 'segment'].includes(slot.ownerType));
    const hasUsableOutlineTargets = profileSlots.length > 0;
    const unsupported = !SUPPORTED_PROFILE_TYPES.has(profile.type)
      || (profile.type === 'path' && !(profile.boundary_segments || []).length);
    if (!unsupported || hasUsableOutlineTargets) continue;
    const name = String(part?.label || part?.id || `Part ${partIndex + 1}`).trim();
    options.push({
      value: `review:overall-width:p${partIndex}`,
      label: `${name} overall width — review only, no DXF`,
      target: 'overall-width',
      partIndex,
    }, {
      value: `review:overall-height:p${partIndex}`,
      label: `${name} overall height — review only, no DXF`,
      target: 'overall-height',
      partIndex,
    });
  }
  return options;
}

export function parseReviewOnlyTarget(value) {
  const match = String(value || '').match(/^review:(named-reference|overall-width|overall-height)(?::p(\d+))?$/);
  if (!match) return null;
  return { target: match[1], partIndex: match[2] === undefined ? null : Number(match[2]) };
}

export function recordReviewOnlyDimension(dimension, { target, partIndex = null, label, valueMm }) {
  if (!dimension || !['named-reference', 'overall-width', 'overall-height'].includes(target)) return false;
  dimension.label = String(label || '').trim() || (target === 'named-reference' ? 'Review reference' : target === 'overall-width' ? 'Overall width' : 'Overall height');
  dimension.valueMm = Number(valueMm);
  dimension.role = 'unknown';
  dimension.reference = 'size';
  dimension.fromEdge = 'unknown';
  dimension.reviewOnly = true;
  dimension.reviewTarget = target;
  dimension.reviewPartIndex = Number.isInteger(partIndex) ? partIndex : null;
  dimension.confirmed = false;
  return true;
}

export function reviewOnlyDimensionFor(source, target, partIndex) {
  return (source?.dimensions || []).find((dimension) => isReviewOnlyDimension(dimension)
    && dimension.reviewTarget === target
    && (dimension.reviewPartIndex ?? null) === (Number.isInteger(partIndex) ? partIndex : null)) || null;
}
