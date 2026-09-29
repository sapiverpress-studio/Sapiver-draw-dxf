const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const normalise = (value) => String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
const escapeRe = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function dimensionTarget(dimension) {
  return String(dimension?.analysisTarget ?? dimension?.target ?? '').trim();
}

function dimensionText(dimension) {
  return `${dimension?.rawText ?? dimension?.raw_text ?? ''} ${dimensionTarget(dimension)} ${dimension?.sourceLabel ?? ''} ${dimension?.label ?? ''}`.trim();
}

function partPrefixCandidates(part, partIndex) {
  return [String(part?.id ?? '').trim(), `p${partIndex + 1}`].filter(Boolean).map((value) => normalise(value));
}

function targetPartIndex(extraction, target) {
  const lower = normalise(target).replace(/ /g, '.');
  const parts = extraction?.parts ?? [];
  for (let index = 0; index < parts.length; index += 1) {
    const prefixes = partPrefixCandidates(parts[index], index);
    if (prefixes.some((prefix) => lower === prefix || lower.startsWith(`${prefix}.`))) return index;
  }
  const match = String(target ?? '').trim().match(/^p(\d+)\./i);
  return match ? Number(match[1]) - 1 : null;
}

function collectLinkedDimensionIds(extraction) {
  const ids = new Set();
  const add = (value) => { if (typeof value === 'string' && value.trim()) ids.add(value); };
  for (const part of extraction?.parts ?? []) {
    const profile = part?.profile ?? {};
    for (const [key, value] of Object.entries(profile)) {
      if (key.endsWith('_dimension_id')) add(value);
    }
    for (const segment of profile.boundary_segments ?? []) {
      for (const [key, value] of Object.entries(segment ?? {})) {
        if (key.endsWith('_dimension_id') || key === 'dimension_id') add(value);
      }
    }
    for (const radius of profile.corner_radii ?? []) add(radius?.radius_dimension_id);
    for (const feature of part?.features ?? []) {
      for (const [key, value] of Object.entries(feature ?? {})) {
        if (key.endsWith('_dimension_id')) add(value);
      }
    }
  }
  return ids;
}

function collectFeatureRadiusIds(extraction) {
  const ids = new Set();
  for (const part of extraction?.parts ?? []) {
    for (const feature of part?.features ?? []) {
      if (feature?.radius_dimension_id) ids.add(feature.radius_dimension_id);
    }
  }
  return ids;
}

function profileHasDeterministicCurve(profile) {
  if (profile?.type === 'rectangle' && (profile.corner_radii ?? []).some((item) => finitePositive(item?.radius_mm) || item?.radius_dimension_id)) return true;
  if (profile?.type !== 'path') return false;
  return (profile.boundary_segments ?? []).some((segment) => ['arc', 'quarter_arc', 'connect_arc'].includes(segment?.kind));
}

function looksLikeRadiusDimension(dimension) {
  return dimension?.role === 'radius' || /^\s*R\s*\d/i.test(String(dimension?.rawText ?? dimension?.raw_text ?? '')) || /\b(radius|radii|rad)\b/i.test(dimensionText(dimension));
}

function looksLikeProfileTarget(target) {
  return /(?:^|\.)(?:profile|perimeter|boundary|segments?|corner[_ .-]?radii)(?:\.|$)/i.test(String(target ?? ''));
}

function looksLikeExplicitProductionTarget(target) {
  return /^\s*(?:p\d+|[^.\s]+)\.(?:profile|features?)\./i.test(String(target ?? ''));
}

function approximateContourText(extraction) {
  const texts = [extraction?.summary, ...(extraction?.uncertainties ?? [])];
  for (const part of extraction?.parts ?? []) {
    texts.push(part?.source_note, part?.profile?.source_note);
    for (const feature of part?.features ?? []) texts.push(feature?.source_note);
  }
  for (const dimension of extraction?.dimensions ?? []) texts.push(dimension?.raw_text, dimension?.rawText);
  return texts.filter(Boolean).join(' · ');
}

export function analysisIntegrityIssues(extraction, { strictGeometry = false } = {}) {
  if (!extraction || typeof extraction !== 'object') return [];
  const issues = [];
  const linked = collectLinkedDimensionIds(extraction);
  const featureRadiusIds = collectFeatureRadiusIds(extraction);
  const dimensions = Array.isArray(extraction.dimensions) ? extraction.dimensions : [];
  const parts = Array.isArray(extraction.parts) ? extraction.parts : [];
  const uncertainties = Array.isArray(extraction.uncertainties) ? extraction.uncertainties : [];

  if (extraction?.analysis_checks?.unsupported_geometry_present === true || uncertainties.some((item) => /^\s*Template required:/i.test(String(item)))) {
    issues.push('Template/CAD required: the analysis contains geometry that is explicitly marked unsupported for deterministic DXF generation.');
  }

  const approximateText = approximateContourText(extraction);
  if (/\b(?:approx(?:imate|imately)?\s+(?:drafting\s+)?(?:radius|radii|curve|curves|contour|contours)|natural\s+(?:tooth\s+)?contours?\s+(?:vary|variable)|free[ -]?hand|free[ -]?form|organic\s+contour)\b/i.test(approximateText)) {
    issues.push('Template/CAD required: the source describes the outline or its radii as approximate/freeform, so the exact production boundary is not mathematically defined.');
  }

  for (const dimension of dimensions) {
    const target = dimensionTarget(dimension);
    if (!dimension?.id || !target || !looksLikeExplicitProductionTarget(target)) continue;
    if (!linked.has(dimension.id)) {
      issues.push(`Analysis structure incomplete: figured dimension ${dimension.raw_text || dimension.rawText || dimension.id} explicitly targets ${target} but is not linked to that production geometry.`);
    }
  }

  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex] ?? {};
    const profile = part.profile ?? {};
    const partDimensions = dimensions.filter((dimension) => {
      const target = dimensionTarget(dimension);
      const explicitPart = target ? targetPartIndex(extraction, target) : null;
      return explicitPart == null || explicitPart === partIndex;
    });
    const perimeterRadii = partDimensions.filter((dimension) => looksLikeRadiusDimension(dimension)
      && !featureRadiusIds.has(dimension.id)
      && (looksLikeProfileTarget(dimensionTarget(dimension)) || !dimensionTarget(dimension)));
    const explicitPerimeterRadii = perimeterRadii.filter((dimension) => looksLikeProfileTarget(dimensionTarget(dimension)));
    if ((explicitPerimeterRadii.length > 0 || perimeterRadii.length >= 2) && !profileHasDeterministicCurve(profile)) {
      issues.push(`${part.label || part.id || `Part ${partIndex + 1}`}: curved-perimeter radius figures were extracted, but no deterministic arc/path or corner-radius geometry owns them.`);
    }

    if (strictGeometry && ['polygon', 'irregular', 'unknown'].includes(profile?.type)) {
      issues.push(`${part.label || part.id || `Part ${partIndex + 1}`}: profile type ${profile.type} is not a deterministic production profile. Reanalyse it as rectangle, circle, quadrilateral or a fully constrained path, or obtain CAD/template data.`);
    }
  }

  return [...new Set(issues)];
}

export function applyAnalysisIntegrity(extraction) {
  if (!extraction || typeof extraction !== 'object') return extraction;
  const issues = analysisIntegrityIssues(extraction, { strictGeometry: false });
  if (!issues.length) return extraction;
  extraction.uncertainties = Array.isArray(extraction.uncertainties) ? extraction.uncertainties : [];
  for (const issue of issues) {
    const message = `Integrity check: ${issue}`;
    if (!extraction.uncertainties.includes(message)) extraction.uncertainties.push(message);
  }
  extraction.requires_human_review = true;
  extraction.production_ready = false;
  extraction.analysis_checks ||= {};
  if (issues.some((issue) => /^Template\/CAD required:/i.test(issue))) extraction.analysis_checks.unsupported_geometry_present = true;
  if (issues.some((issue) => /not linked|structure incomplete|radius figures were extracted/i.test(issue))) extraction.analysis_checks.all_clear_figures_linked = false;
  return extraction;
}

export function inferDimensionIntent(value) {
  const dimension = typeof value === 'object' && value !== null ? value : null;
  const text = dimension ? dimensionText(dimension) : String(value ?? '');
  const role = String(dimension?.role ?? '').toLowerCase();
  if (role === 'radius' || /^\s*R\s*\d/i.test(String(dimension?.rawText ?? dimension?.raw_text ?? text)) || /\b(radius|radii|rad)\b/i.test(text)) return 'radius';
  if (role === 'diameter' || /[Ø⌀]|\bdiam(?:eter)?\b/i.test(text)) return 'diameter';
  if (role === 'position') return 'position';
  if (/\b(?:x|y)\s*(?:position|pos)\b|\bfrom\s+(?:left|right|top|bottom)\b/i.test(text)) return 'position';
  if (/\bwidth\b/i.test(text)) return 'width';
  if (/\bheight\b/i.test(text)) return 'height';
  if (/\bdepth\b/i.test(text)) return 'depth';
  if (/\b(?:offset|position along edge)\b/i.test(text)) return 'offset';
  if (/\b(?:chord|span)\b/i.test(text)) return 'chord';
  if (/\b(?:rise|sagitta)\b/i.test(text)) return 'rise';
  if (/\b(?:overall|length|side|edge|shoulder|segment)\b/i.test(text)) return 'length';
  return 'unknown';
}

function explicitTargetMatchesSlot(source, slot, dimension) {
  const target = dimensionTarget(dimension);
  if (!target || !looksLikeExplicitProductionTarget(target)) return true;
  const part = source?.analysis?.parts?.[slot?.partIndex];
  if (!part) return false;
  const targetPart = targetPartIndex(source.analysis, target);
  if (targetPart != null && targetPart !== slot.partIndex) return false;
  const lower = normalise(target);

  if (slot.ownerType === 'feature') {
    const feature = part?.features?.[slot.featureIndex];
    const ids = [feature?.id, `f${slot.featureIndex + 1}`, String(slot.featureIndex + 1)].filter(Boolean).map((value) => escapeRe(normalise(value)));
    if (ids.length && !new RegExp(`features?\\s*(?:\\.|\\s)\\s*(?:${ids.join('|')})(?:\\.|\\s|$)`, 'i').test(lower)) return false;
  } else if (slot.ownerType === 'segment') {
    const segment = part?.profile?.boundary_segments?.[slot.segmentIndex];
    const ids = [segment?.id, `s${slot.segmentIndex + 1}`, String(slot.segmentIndex + 1)].filter(Boolean).map((value) => escapeRe(normalise(value)));
    if (ids.length && !new RegExp(`(?:segments?|boundary)\\s*(?:\\.|\\s)\\s*(?:${ids.join('|')})(?:\\.|\\s|$)`, 'i').test(lower)) return false;
  } else if (slot.ownerType === 'corner-radius') {
    const item = part?.profile?.corner_radii?.[slot.cornerRadiusIndex];
    const corner = escapeRe(normalise(item?.corner));
    if (corner && !new RegExp(`corner\\s+radii\\s*(?:\\.|\\s)\\s*${corner}`, 'i').test(lower)) return false;
  }
  return true;
}

export function dimensionAssignmentIssue(source, slot, dimension) {
  if (!slot || !dimension) return 'A production parameter and a figured dimension are both required.';
  if (!explicitTargetMatchesSlot(source, slot, dimension)) return 'This figured value explicitly targets a different production parameter.';

  const intent = inferDimensionIntent(dimension);
  const role = String(dimension.role ?? 'unknown').toLowerCase();
  const parameter = String(slot.parameter ?? '').toLowerCase();

  if (slot.kind === 'position') {
    if (['overall', 'size', 'diameter', 'radius'].includes(role)) return 'A size/radius figure cannot be assigned to a feature position.';
    if (['radius', 'diameter', 'width', 'height', 'depth', 'chord', 'rise', 'length'].includes(intent)) return 'This figure reads as a size, not a position.';
    return null;
  }

  if (role === 'position' || intent === 'position') return 'A positional figure cannot be assigned to a size parameter.';
  if (parameter === 'radius') return intent === 'diameter' ? 'A diameter figure cannot be assigned as a radius.' : (['radius', 'unknown'].includes(intent) || ['radius', 'size', 'unknown'].includes(role) ? null : 'This figure does not read as a radius.');
  if (parameter === 'diameter') return intent === 'radius' ? 'A radius figure cannot be assigned as a diameter.' : (['diameter', 'unknown'].includes(intent) || ['diameter', 'size', 'unknown'].includes(role) ? null : 'This figure does not read as a diameter.');
  if (intent === 'radius') return 'A radius figure cannot be assigned to a straight length/size parameter.';
  if (intent === 'diameter') return 'A diameter figure cannot be assigned to a non-diameter parameter.';

  if (slot.ownerType === 'feature' && role === 'overall') return 'An overall panel dimension cannot be assigned to a feature size.';
  if (intent === 'width' && !['width', 'chord', 'length'].includes(parameter)) return 'A width figure does not match this parameter.';
  if (intent === 'height' && !['height', 'rise', 'length'].includes(parameter)) return 'A height figure does not match this parameter.';
  if (intent === 'depth' && parameter !== 'depth') return 'A depth figure does not match this parameter.';
  if (intent === 'offset' && !['offset', 'x', 'y'].includes(parameter)) return 'An offset figure does not match this parameter.';
  if (intent === 'chord' && !['chord', 'length', 'width'].includes(parameter)) return 'A chord/span figure does not match this parameter.';
  if (intent === 'rise' && !['rise', 'height', 'length'].includes(parameter)) return 'A rise/sagitta figure does not match this parameter.';
  return null;
}

export function dimensionCompatibleWithSlot(source, slot, dimension) {
  return dimensionAssignmentIssue(source, slot, dimension) == null;
}

export function preserveDimensionSourceLabels(source) {
  for (const dimension of source?.dimensions ?? []) {
    if (!dimension.sourceLabel) dimension.sourceLabel = dimension.rawText || dimension.raw_text || dimension.analysisTarget || dimension.target || dimension.label || dimension.id;
  }
  return source;
}
