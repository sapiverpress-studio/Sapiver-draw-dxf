import * as base from './review-model.js?base=1';
import { compileSourceGeometry, geometryToSvg } from './geometry.js';

export * from './review-model.js?base=1';

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function hasCurvePart(part) {
  const profile = part?.profile || {};
  return (profile.type === 'rectangle' && Array.isArray(profile.corner_radii) && profile.corner_radii.length > 0)
    || (profile.type === 'path' && (profile.boundary_segments || []).some((segment) => ['arc', 'quarter_arc', 'connect_arc'].includes(segment.kind)));
}

function hasRadiusedFeature(part) {
  return (part?.features || []).some((feature) => ['rectangular_cutout', 'corner_notch', 'edge_notch'].includes(feature?.type)
    && (finitePositive(feature?.radius_mm) || Boolean(feature?.radius_dimension_id)));
}

function hasCurveGeometry(source) {
  return (source?.analysis?.parts || []).some((part) => hasCurvePart(part) || hasRadiusedFeature(part));
}

function needsCompiledOutline(part) {
  return ['quadrilateral', 'path'].includes(part?.profile?.type)
    || (part?.features || []).some((feature) => ['corner_notch', 'edge_notch'].includes(feature.type));
}

function slotReady(source, slot) {
  return base.dimensionReadyForSlot(slot, base.dimensionForSlot(source, slot));
}

function pendingFeatureCount(source, slots) {
  let pending = 0;
  for (const [partIndex, part] of (source?.analysis?.parts || []).entries()) {
    for (const [featureIndex] of (part.features || []).entries()) {
      const featureSlots = slots.filter((slot) => slot.partIndex === partIndex && slot.featureIndex === featureIndex && slot.ownerType === 'feature');
      if (featureSlots.length && !featureSlots.every((slot) => slotReady(source, slot))) pending += 1;
    }
  }
  return pending;
}

function renderableSource(source, slots, { perimeterOnly = false } = {}) {
  const proposal = structuredClone(source);
  proposal.analysis.parts = (proposal.analysis?.parts || []).map((part, partIndex) => {
    const originalPart = source.analysis.parts[partIndex];
    const features = perimeterOnly ? [] : (originalPart.features || []).filter((feature, featureIndex) => {
      const featureSlots = slots.filter((slot) => slot.partIndex === partIndex && slot.featureIndex === featureIndex && slot.ownerType === 'feature');
      return featureSlots.length > 0 && featureSlots.every((slot) => slotReady(source, slot));
    });
    return { ...part, features: structuredClone(features) };
  });
  return proposal;
}

function appendPendingNote(svg, count) {
  if (!svg || !count) return svg;
  const label = `${count} feature${count === 1 ? '' : 's'} pending confirmation — confirmed perimeter shown.`;
  const note = `<text x="450" y="414" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="#667085">${label}</text>`;
  return svg.replace('</svg>', `${note}</svg>`);
}

export function reviewDrawingSvg(source) {
  if (!source?.analysis || hasCurveGeometry(source)) return base.reviewDrawingSvg(source);

  base.repairGeometryLinks(source);
  const parts = Array.isArray(source.analysis.parts) ? source.analysis.parts : [];
  if (!parts.length || !parts.some(needsCompiledOutline)) return base.reviewDrawingSvg(source);

  const slots = base.geometrySlots(source);
  const perimeterSlots = slots.filter((slot) => base.isPerimeterSlot(slot));
  const perimeterReady = perimeterSlots.length > 0 && perimeterSlots.every((slot) => slotReady(source, slot));
  if (!perimeterReady) return base.reviewDrawingSvg(source);

  const pending = pendingFeatureCount(source, slots);
  let proposal = renderableSource(source, slots);
  let geometry = compileSourceGeometry(proposal);

  // A feature can still be unrenderable for reasons outside dimension readiness
  // (for example an unfinished manufacturing choice). Never let that erase a
  // valid confirmed perimeter from the review drawing.
  if (!geometry.ok) {
    proposal = renderableSource(source, slots, { perimeterOnly: true });
    geometry = compileSourceGeometry(proposal);
  }

  if (!geometry.ok) return base.reviewDrawingSvg(source);
  return appendPendingNote(geometryToSvg(geometry, { width: 900, height: 430, padding: 42 }), pending);
}

export function reviewDrawingDataUrl(source) {
  const svg = reviewDrawingSvg(source);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
}
