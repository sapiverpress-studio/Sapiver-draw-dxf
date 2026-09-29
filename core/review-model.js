import * as base from './review-model-base.js';
import {
  dimensionAssignmentIssue,
  preserveDimensionSourceLabels,
} from './analysis-integrity.js';

export * from './review-model-base.js';

function dimensionById(source, dimensionId) {
  return (source?.dimensions || []).find((dimension) => dimension.id === dimensionId) || null;
}

function rejectUnsafeLinks(source) {
  preserveDimensionSourceLabels(source);
  for (const slot of base.geometrySlots(source)) {
    const dimensionId = base.slotDimensionId(source, slot);
    if (!dimensionId) continue;
    const dimension = dimensionById(source, dimensionId);
    if (!dimension) continue;
    const issue = dimensionAssignmentIssue(source, slot, dimension);
    if (!issue) {
      delete dimension.assignmentError;
      continue;
    }
    base.setSlotDimensionId(source, slot, null);
    dimension.assignmentError = issue;
    if (dimension.sourceLabel) dimension.label = dimension.sourceLabel;
  }
  return source;
}

export function repairGeometryLinks(source) {
  preserveDimensionSourceLabels(source);
  base.repairGeometryLinks(source);
  return rejectUnsafeLinks(source);
}

export function setSlotDimensionId(source, slot, dimensionId) {
  preserveDimensionSourceLabels(source);
  if (!dimensionId) return base.setSlotDimensionId(source, slot, null);
  const dimension = dimensionById(source, dimensionId);
  if (!dimension) return false;
  const issue = dimensionAssignmentIssue(source, slot, dimension);
  if (issue) {
    dimension.assignmentError = issue;
    if (dimension.sourceLabel) dimension.label = dimension.sourceLabel;
    return false;
  }
  delete dimension.assignmentError;
  return base.setSlotDimensionId(source, slot, dimensionId);
}

export function materialiseDerivedDimensions(source) {
  preserveDimensionSourceLabels(source);
  base.materialiseDerivedDimensions(source);
  return repairGeometryLinks(source);
}

export function reviewStats(source) {
  repairGeometryLinks(source);
  return base.reviewStats(source);
}

export function unlinkedDimensions(source) {
  repairGeometryLinks(source);
  return base.unlinkedDimensions(source).map((dimension) => {
    if (dimension.sourceLabel) dimension.label = dimension.sourceLabel;
    return dimension;
  });
}

export function reviewDrawingSvg(source) {
  repairGeometryLinks(source);
  const proposal = structuredClone(source);
  proposal.dimensions = (proposal.dimensions || []).filter((dimension) => !dimension.assignmentError);
  return base.reviewDrawingSvg(proposal);
}

export function reviewDrawingDataUrl(source) {
  const svg = reviewDrawingSvg(source);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
}
