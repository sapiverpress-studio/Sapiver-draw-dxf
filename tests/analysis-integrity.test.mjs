import assert from 'node:assert/strict';
import {
  analysisIntegrityIssues,
  applyAnalysisIntegrity,
  dimensionAssignmentIssue,
} from '../core/analysis-integrity.js';
import { compileSourceGeometry } from '../core/geometry.js';
import {
  geometrySlots,
  setSlotDimensionId,
  slotDimensionId,
} from '../core/review-model.js';

const checks = () => ({
  perimeter_traced: true,
  dimension_targets_followed: true,
  all_clear_figures_linked: true,
  square_markers_classified: true,
  perimeter_topology_closes: true,
  unsupported_geometry_present: false,
});

const profileBase = (overrides = {}) => ({
  type: 'rectangle',
  width_mm: 11.4,
  height_mm: 20.9,
  diameter_mm: null,
  width_dimension_id: 'w',
  height_dimension_id: 'h',
  diameter_dimension_id: null,
  confidence: 'high',
  top_mm: null,
  bottom_mm: null,
  left_mm: null,
  right_mm: null,
  top_dimension_id: null,
  bottom_dimension_id: null,
  left_dimension_id: null,
  right_dimension_id: null,
  right_angle_corners: [],
  side_heights_to_notch_shoulders: false,
  boundary_segments: [],
  corner_radii: [],
  ...overrides,
});

const malformedCurvedExtraction = {
  units: 'mm',
  drawing_label: 'Compound curved outline',
  production_ready: true,
  requires_human_review: true,
  analysis_checks: checks(),
  summary: 'Compound outline requiring review.',
  uncertainties: [],
  dimensions: [
    { id: 'w', raw_text: '11.4', value: 11.4, role: 'overall', reference: 'size', target: 'p1.profile.width', from_edge: 'unknown', confidence: 'high' },
    { id: 'h', raw_text: '20.9', value: 20.9, role: 'overall', reference: 'size', target: 'p1.profile.height', from_edge: 'unknown', confidence: 'high' },
    { id: 'r1', raw_text: 'R3.5', value: 3.5, role: 'radius', reference: 'size', target: null, from_edge: 'unknown', confidence: 'medium' },
    { id: 'r2', raw_text: 'R6.0', value: 6, role: 'radius', reference: 'size', target: null, from_edge: 'unknown', confidence: 'medium' },
  ],
  parts: [{
    id: 'p1',
    label: 'Curved profile',
    profile: profileBase(),
    features: [],
    dimension_ids: ['w', 'h', 'r1', 'r2'],
  }],
};

const malformedIssues = analysisIntegrityIssues(structuredClone(malformedCurvedExtraction));
assert.ok(malformedIssues.some((issue) => /curved-perimeter radius figures/i.test(issue)), 'multiple unowned perimeter radii must block a supposedly straight profile');

const approximate = structuredClone(malformedCurvedExtraction);
approximate.summary = 'Approximate drafting radii; natural tooth contours vary.';
applyAnalysisIntegrity(approximate);
assert.equal(approximate.production_ready, false, 'approximate/freeform contour notes must clear production readiness');
assert.equal(approximate.analysis_checks.unsupported_geometry_present, true, 'approximate/freeform contour notes must mark unsupported geometry');
assert.ok(approximate.uncertainties.some((item) => /Template\/CAD required/i.test(item)), 'approximate/freeform contours must request deterministic source data');

const validRounded = structuredClone(malformedCurvedExtraction);
validRounded.dimensions = validRounded.dimensions.slice(0, 2).concat([
  { id: 'r', raw_text: 'R3.5 TYP', value: 3.5, role: 'radius', reference: 'size', target: 'p1.profile.corner_radii.bottom-left.radius', from_edge: 'unknown', confidence: 'high' },
]);
validRounded.parts[0].dimension_ids = ['w', 'h', 'r'];
validRounded.parts[0].profile.corner_radii = [
  { corner: 'bottom-left', radius_mm: 3.5, radius_dimension_id: 'r' },
  { corner: 'bottom-right', radius_mm: 3.5, radius_dimension_id: 'r' },
  { corner: 'top-right', radius_mm: 3.5, radius_dimension_id: 'r' },
  { corner: 'top-left', radius_mm: 3.5, radius_dimension_id: 'r' },
];
assert.deepEqual(analysisIntegrityIssues(validRounded), [], 'a radius owned by deterministic rounded-corner geometry must remain valid');

const explicitMissing = structuredClone(validRounded);
explicitMissing.dimensions.push({ id: 'fwidth', raw_text: '4.2', value: 4.2, role: 'size', reference: 'size', target: 'p1.features.f1.width', from_edge: 'unknown', confidence: 'high' });
explicitMissing.parts[0].features.push({
  id: 'f1', type: 'rectangular_cutout', quantity: 1,
  width_mm: 4.2, height_mm: 3, diameter_mm: null, radius_mm: null, cutout_finish: 'unknown',
  x_mm: 2, x_reference: 'edge', x_from_edge: 'left', y_mm: 2, y_reference: 'edge', y_from_edge: 'bottom', touching_edge: 'none',
  width_dimension_id: null, height_dimension_id: null, diameter_dimension_id: null, radius_dimension_id: null, x_dimension_id: null, y_dimension_id: null,
  confidence: 'high', source_note: null, corner: 'none', depth_mm: null, offset_mm: null, depth_dimension_id: null, offset_dimension_id: null,
});
assert.ok(analysisIntegrityIssues(explicitMissing).some((issue) => /explicitly targets .*features\.f1\.width.*not linked/i.test(issue)), 'explicitly targeted production dimensions must not survive as unlinked reads');

const assignmentSource = {
  analysis: {
    parts: [{
      id: 'p1', label: 'Panel', profile: profileBase({ width_mm: 100, height_mm: 80 }),
      features: [{
        id: 'f1', type: 'rectangular_cutout', quantity: 1,
        width_mm: 20, height_mm: 10, diameter_mm: null, radius_mm: null, cutout_finish: 'unknown',
        x_mm: 30, x_reference: 'edge', x_from_edge: 'left', y_mm: 20, y_reference: 'edge', y_from_edge: 'bottom', touching_edge: 'none',
        width_dimension_id: null, height_dimension_id: null, diameter_dimension_id: null, radius_dimension_id: null, x_dimension_id: null, y_dimension_id: null,
        confidence: 'high', source_note: null, corner: 'none', depth_mm: null, offset_mm: null, depth_dimension_id: null, offset_dimension_id: null,
      }],
    }],
  },
  dimensions: [{ id: 'r6', label: 'R6.0 mm approx.', rawText: 'R6.0 mm approx.', role: 'radius', valueMm: 6, reference: 'size', fromEdge: 'unknown', confidence: 'medium', confirmed: false }],
};
const cutoutWidthSlot = geometrySlots(assignmentSource).find((slot) => slot.ownerType === 'feature' && slot.parameter === 'width');
assert.ok(cutoutWidthSlot, 'fixture must expose a cut-out width slot');
assert.match(dimensionAssignmentIssue(assignmentSource, cutoutWidthSlot, assignmentSource.dimensions[0]) || '', /radius figure/i, 'radius reads must be semantically incompatible with straight cut-out width');
assert.equal(setSlotDimensionId(assignmentSource, cutoutWidthSlot, 'r6'), false, 'unsafe manual assignment must be rejected by the review model');
assert.equal(slotDimensionId(assignmentSource, cutoutWidthSlot), null, 'rejected assignment must not alter production geometry ownership');

const compilableButMalformed = {
  analysis: structuredClone(malformedCurvedExtraction),
  dimensions: malformedCurvedExtraction.dimensions.map((dimension) => ({
    id: dimension.id,
    label: dimension.target || dimension.raw_text,
    analysisTarget: dimension.target,
    rawText: dimension.raw_text,
    role: dimension.role,
    valueMm: dimension.value,
    reference: 'size',
    fromEdge: 'unknown',
    confidence: dimension.confidence,
    confirmed: true,
  })),
};
const blockedGeometry = compileSourceGeometry(compilableButMalformed);
assert.equal(blockedGeometry.ok, false, 'deterministic DXF compilation must fail before unsafe malformed analysis can reach release');
assert.ok(blockedGeometry.errors.some((error) => /Analysis integrity:/i.test(error)), 'blocked geometry must explain that analysis integrity caused the release failure');

console.log('Repo-wide analysis integrity regressions passed.');
