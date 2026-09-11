import assert from 'node:assert/strict';
import { arcFromChord, buildCurvedPath, buildRoundedRectangle } from '../core/curves.js';
import { compileSourceGeometry, geometryToSvg } from '../core/geometry.js';
import * as legacyGeometry from '../core/geometry-legacy.js';
import { buildDxf } from '../core/dxf.js';
import {
  geometrySlots,
  isPerimeterSlot,
  reviewDrawingSvg,
  reviewStats,
} from '../core/review-model.js';
import * as legacyReview from '../core/review-model-legacy.js';
import {
  ANALYSIS_PROMPT,
  ANALYSIS_SCHEMA,
  enforceAnalysisChecks,
  linkExplicitDimensionTargets,
} from '../netlify/functions/_quick-dxf-analysis.mjs';

const close = (actual, expected, tolerance = 1e-5, message = '') => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, got ${actual}`);
};
const dim = (id, valueMm, reference = 'size', fromEdge = 'unknown', role = 'size') => ({
  id, label: id, role, valueMm, reference, fromEdge, confirmed: true, confidence: 'high', rawText: String(valueMm),
});

// Core circular-arc construction: a 1200 mm chord at R600 is a true semicircle.
const semi = arcFromChord({ x: 0, y: 0 }, { x: 1200, y: 0 }, 600, { bulgeSide: 'left', extent: 'semicircle' });
assert.equal(semi.type, 'arc');
close(semi.r, 600);
close(semi.cx, 600);
close(Math.abs(semi.cy), 0);
assert.ok(semi.previewPoints.some((p) => p.y > 599.9), 'semicircle preview must rise 600 mm above the chord');

// General path: two sides + bottom + calculated closing semicircular arc.
const path = buildCurvedPath([
  { id: 'right', kind: 'vertical', direction: 'down', length: 600 },
  { id: 'bottom', kind: 'horizontal', direction: 'left', length: 1200 },
  { id: 'left', kind: 'vertical', direction: 'up', length: 600 },
  { id: 'top', kind: 'connect_arc', direction: 'connect', radius: 600, bulgeSide: 'left', extent: 'semicircle' },
]);
assert.equal(path.entities.filter((entity) => entity.type === 'arc').length, 1);
const pathXs = path.points.map((p) => p.x);
const pathYs = path.points.map((p) => p.y);
close(Math.max(...pathXs) - Math.min(...pathXs), 1200);
close(Math.max(...pathYs) - Math.min(...pathYs), 1200);

// A perimeter may contain multiple independently solved circular arcs.
const compoundPath = buildCurvedPath([
  { id: 'bottom', kind: 'horizontal', direction: 'right', length: 400 },
  { id: 'right', kind: 'arc', direction: 'up', chord: 200, radius: 150, bulgeSide: 'left', extent: 'minor' },
  { id: 'top', kind: 'horizontal', direction: 'left', length: 400 },
  { id: 'left', kind: 'connect_arc', direction: 'connect', radius: 150, bulgeSide: 'left', extent: 'minor' },
]);
assert.equal(compoundPath.entities.filter((entity) => entity.type === 'arc').length, 2);
assert.equal((buildDxf(compoundPath.entities).match(/\r\nARC\r\n/g) || []).length, 2);

// Shallow circular arches are solved from the confirmed chord and radius, not image scale.
const shallow = arcFromChord({ x: 0, y: 0 }, { x: 1200, y: 0 }, 800, { bulgeSide: 'left', extent: 'minor' });
const expectedRise = 800 - Math.sqrt(800 ** 2 - 600 ** 2);
const shallowRise = Math.max(...shallow.previewPoints.map((p) => p.y));
close(shallowRise, expectedRise, 0.2, 'shallow arch rise');
const minor = arcFromChord({ x: 0, y: 0 }, { x: 100, y: 0 }, 75, { bulgeSide: 'left', extent: 'minor' });
const major = arcFromChord({ x: 0, y: 0 }, { x: 100, y: 0 }, 75, { bulgeSide: 'left', extent: 'major' });
assert.ok(Math.abs(minor.travelSweepDeg) < 180, 'minor arc sweep must be below 180 degrees');
assert.ok(Math.abs(major.travelSweepDeg) > 180, 'major arc sweep must be above 180 degrees');
assert.ok(minor.previewPoints[Math.floor(minor.previewPoints.length / 2)].y > 0, 'minor arc must bulge to the confirmed side');
assert.ok(major.previewPoints[Math.floor(major.previewPoints.length / 2)].y > 0, 'major arc must bulge to the confirmed side');
assert.throws(
  () => arcFromChord({ x: 0, y: 0 }, { x: 1200, y: 0 }, 500, { bulgeSide: 'left' }),
  /longer than the diameter/i,
  'an impossible radius must block production geometry',
);

// Independent external corner radii use exact quarter-circle ARC entities.
const rounded = buildRoundedRectangle(1000, 500, {
  'bottom-left': 50,
  'bottom-right': 75,
  'top-right': 100,
  'top-left': 25,
});
assert.equal(rounded.entities.filter((entity) => entity.type === 'arc').length, 4);
assert.equal(rounded.entities.filter((entity) => entity.type === 'polyline').length, 4);
assert.throws(
  () => buildRoundedRectangle(100, 100, { 'top-left': 60, 'top-right': 60 }),
  /overlap/i,
  'overlapping corner radii must be rejected',
);

// Full manufacturing integration: dimension-confirmed arch plus an internal circular hole.
const archSource = {
  analysis: {
    parts: [{
      id: 'arch', label: 'Arch panel',
      profile: {
        type: 'path', confidence: 'high',
        boundary_segments: [
          { id: 's1', label: 'Right side', kind: 'vertical', direction: 'down', length_mm: 600, dimension_id: 'right', chord_mm: null, chord_dimension_id: null, radius_mm: null, radius_dimension_id: null, bulge_side: 'none', arc_extent: 'none' },
          { id: 's2', label: 'Bottom', kind: 'horizontal', direction: 'left', length_mm: 1200, dimension_id: 'bottom', chord_mm: null, chord_dimension_id: null, radius_mm: null, radius_dimension_id: null, bulge_side: 'none', arc_extent: 'none' },
          { id: 's3', label: 'Left side', kind: 'vertical', direction: 'up', length_mm: 600, dimension_id: 'left', chord_mm: null, chord_dimension_id: null, radius_mm: null, radius_dimension_id: null, bulge_side: 'none', arc_extent: 'none' },
          { id: 's4', label: 'Top arch', kind: 'connect_arc', direction: 'connect', length_mm: null, dimension_id: null, chord_mm: null, chord_dimension_id: null, radius_mm: 600, radius_dimension_id: 'radius', bulge_side: 'left', arc_extent: 'semicircle' },
        ],
        width_mm: null, height_mm: null, diameter_mm: null,
        width_dimension_id: null, height_dimension_id: null, diameter_dimension_id: null,
        top_mm: null, bottom_mm: null, left_mm: null, right_mm: null,
        top_dimension_id: null, bottom_dimension_id: null, left_dimension_id: null, right_dimension_id: null,
        right_angle_corners: [], side_heights_to_notch_shoulders: false, corner_radii: [],
      },
      features: [{
        id: 'hole', type: 'circular_hole', quantity: 1,
        width_mm: null, height_mm: null, diameter_mm: 50, radius_mm: null,
        x_mm: 500, x_reference: 'centre', x_from_edge: 'left',
        y_mm: 300, y_reference: 'centre', y_from_edge: 'bottom', touching_edge: 'none',
        width_dimension_id: null, height_dimension_id: null, diameter_dimension_id: 'dia', radius_dimension_id: null,
        x_dimension_id: 'x', y_dimension_id: 'y', confidence: 'high', source_note: null,
        corner: 'none', depth_mm: null, offset_mm: null, depth_dimension_id: null, offset_dimension_id: null,
      }],
      dimension_ids: ['right', 'bottom', 'left', 'radius', 'dia', 'x', 'y'],
    }],
  },
  dimensions: [
    dim('right', 600, 'size', 'unknown', 'overall'),
    dim('bottom', 1200, 'size', 'unknown', 'overall'),
    dim('left', 600, 'size', 'unknown', 'overall'),
    dim('radius', 600, 'size', 'unknown', 'radius'),
    dim('dia', 50, 'size', 'unknown', 'diameter'),
    dim('x', 500, 'centre', 'left', 'position'),
    dim('y', 300, 'centre', 'bottom', 'position'),
  ],
};
const archGeometry = compileSourceGeometry(structuredClone(archSource));
assert.equal(archGeometry.ok, true, archGeometry.errors.join('\n'));
assert.equal(archGeometry.parts.length, 1);
assert.equal(archGeometry.parts[0].entities.filter((entity) => entity.type === 'arc').length, 1);
assert.equal(archGeometry.parts[0].entities.filter((entity) => entity.type === 'circle').length, 1);
close(archGeometry.parts[0].bounds.width, 1200, 1e-4);
close(archGeometry.parts[0].bounds.height, 1200, 1e-4);
const archDxf = buildDxf(archGeometry.parts[0].entities);
assert.match(archDxf, /\r\nARC\r\n/);
assert.match(archDxf, /\r\nCIRCLE\r\n/);
const archSvg = geometryToSvg(archGeometry);
assert.match(archSvg, /polyline/);
assert.doesNotMatch(archSvg, /NaN|undefined/);

// Review layer: radii and arc constraints are first-class perimeter confirmations.
const archSlots = geometrySlots(structuredClone(archSource));
assert.equal(archSlots.filter(isPerimeterSlot).length, 4);
assert.ok(archSlots.some((slot) => slot.parameter === 'radius' && slot.ownerType === 'segment'));
const archStats = reviewStats(structuredClone(archSource));
assert.equal(archStats.total, 7);
assert.equal(archStats.confirmed, 7);
const reviewSvg = reviewDrawingSvg(structuredClone(archSource));
assert.match(reviewSvg, /Measured curved perimeter/);
assert.doesNotMatch(reviewSvg, /NaN|undefined/);

const roundedSource = {
  analysis: { parts: [{
    id: 'rounded', label: 'Rounded panel',
    profile: {
      type: 'rectangle', width_mm: 1000, height_mm: 500, diameter_mm: null,
      width_dimension_id: 'w', height_dimension_id: 'h', diameter_dimension_id: null, confidence: 'high',
      top_mm: null, bottom_mm: null, left_mm: null, right_mm: null,
      top_dimension_id: null, bottom_dimension_id: null, left_dimension_id: null, right_dimension_id: null,
      right_angle_corners: [], side_heights_to_notch_shoulders: false, boundary_segments: [],
      corner_radii: [
        { corner: 'bottom-left', radius_mm: 50, radius_dimension_id: 'r1' },
        { corner: 'bottom-right', radius_mm: 75, radius_dimension_id: 'r2' },
        { corner: 'top-right', radius_mm: 100, radius_dimension_id: 'r3' },
        { corner: 'top-left', radius_mm: 25, radius_dimension_id: 'r4' },
      ],
    },
    features: [], dimension_ids: ['w', 'h', 'r1', 'r2', 'r3', 'r4'],
  }] },
  dimensions: [dim('w', 1000, 'size', 'unknown', 'overall'), dim('h', 500, 'size', 'unknown', 'overall'), dim('r1', 50, 'size', 'unknown', 'radius'), dim('r2', 75, 'size', 'unknown', 'radius'), dim('r3', 100, 'size', 'unknown', 'radius'), dim('r4', 25, 'size', 'unknown', 'radius')],
};
const roundedSlots = geometrySlots(structuredClone(roundedSource));
assert.equal(roundedSlots.length, 6);
assert.equal(roundedSlots.filter((slot) => slot.ownerType === 'corner-radius').length, 4);
const roundedGeometry = compileSourceGeometry(structuredClone(roundedSource));
assert.equal(roundedGeometry.ok, true, roundedGeometry.errors.join('\n'));
assert.equal(roundedGeometry.parts[0].entities.filter((entity) => entity.type === 'arc').length, 4);
assert.equal((buildDxf(roundedGeometry.parts[0].entities).match(/\r\nARC\r\n/g) || []).length, 4);

// A conventional "4 x R50" callout may link all four corners to one dimension.
const repeatedRadiusSource = structuredClone(roundedSource);
for (const radius of repeatedRadiusSource.analysis.parts[0].profile.corner_radii) {
  radius.radius_mm = 50;
  radius.radius_dimension_id = 'r1';
}
repeatedRadiusSource.analysis.parts[0].dimension_ids = ['w', 'h', 'r1'];
repeatedRadiusSource.dimensions = repeatedRadiusSource.dimensions.filter((item) => ['w', 'h', 'r1'].includes(item.id));
const repeatedRadiusGeometry = compileSourceGeometry(repeatedRadiusSource);
assert.equal(repeatedRadiusGeometry.ok, true, repeatedRadiusGeometry.errors.join('\n'));
assert.equal(repeatedRadiusGeometry.parts[0].entities.filter((entity) => entity.type === 'arc').length, 4);

const unconfirmedRadiusSource = structuredClone(archSource);
unconfirmedRadiusSource.dimensions.find((item) => item.id === 'radius').confirmed = false;
const unconfirmedRadiusGeometry = compileSourceGeometry(unconfirmedRadiusSource);
assert.equal(unconfirmedRadiusGeometry.ok, false);
assert.match(unconfirmedRadiusGeometry.errors.join('\n'), /confirm.*radius|radius.*confirm/i);

const mismatchedArcSource = structuredClone(archSource);
mismatchedArcSource.dimensions.find((item) => item.id === 'radius').valueMm = 500;
const mismatchedArcGeometry = compileSourceGeometry(mismatchedArcSource);
assert.equal(mismatchedArcGeometry.ok, false);
assert.match(mismatchedArcGeometry.errors.join('\n'), /longer than the diameter/i);

// Reject a feature whose confirmed extent crosses a curved perimeter.
const crossingHoleSource = structuredClone(archSource);
const crossingHole = crossingHoleSource.analysis.parts[0].features[0];
crossingHole.diameter_mm = 200;
crossingHole.x_mm = 100;
crossingHole.y_mm = 1100;
crossingHoleSource.dimensions.find((item) => item.id === 'dia').valueMm = 200;
crossingHoleSource.dimensions.find((item) => item.id === 'x').valueMm = 100;
crossingHoleSource.dimensions.find((item) => item.id === 'y').valueMm = 1100;
const crossingHoleGeometry = compileSourceGeometry(crossingHoleSource);
assert.equal(crossingHoleGeometry.ok, false);
assert.match(crossingHoleGeometry.errors.join('\n'), /outside|cross/i);

// Old working geometry stays on the exact legacy route when no curve primitives are present.
const legacySource = {
  analysis: { parts: [{ id: 'plain', label: 'Plain panel', profile: { type: 'rectangle', width_mm: 1000, height_mm: 500, width_dimension_id: 'w', height_dimension_id: 'h', diameter_mm: null, diameter_dimension_id: null, confidence: 'high' }, features: [], dimension_ids: ['w', 'h'] }] },
  dimensions: [dim('w', 1000, 'size', 'unknown', 'overall'), dim('h', 500, 'size', 'unknown', 'overall')],
};
assert.deepEqual(compileSourceGeometry(structuredClone(legacySource)), legacyGeometry.compileSourceGeometry(structuredClone(legacySource)), 'non-curve geometry facade must preserve exact legacy behaviour');
assert.deepEqual(geometrySlots(structuredClone(legacySource)), legacyReview.geometrySlots(structuredClone(legacySource)), 'non-curve review facade must preserve exact legacy slot behaviour');

const ellipseSource = structuredClone(legacySource);
ellipseSource.analysis.parts[0].profile.type = 'ellipse';
const ellipseGeometry = compileSourceGeometry(ellipseSource);
assert.equal(ellipseGeometry.ok, false, 'unsupported ellipse geometry must not reach production');

// Analyzer contract includes explicit radius/chord primitives and template fallback for undefined freeform curves.
assert.match(ANALYSIS_PROMPT, /Template required:/i);
assert.match(ANALYSIS_PROMPT, /connect_arc/i);
assert.match(ANALYSIS_PROMPT, /wavy, freehand, spline-like, organic/i);
const profileSchema = ANALYSIS_SCHEMA.properties.parts.items.properties.profile;
assert.ok(profileSchema.required.includes('corner_radii'));
const segmentSchema = profileSchema.properties.boundary_segments.items;
for (const field of ['chord_mm', 'chord_dimension_id', 'radius_mm', 'radius_dimension_id', 'bulge_side', 'arc_extent']) assert.ok(segmentSchema.required.includes(field), `boundary segment must require ${field}`);
assert.ok(segmentSchema.properties.kind.enum.includes('arc'));
assert.ok(segmentSchema.properties.kind.enum.includes('connect_arc'));

const linkedExtraction = {
  parts: [{
    id: 'p1',
    profile: {
      type: 'path',
      boundary_segments: [{ id: 's1', kind: 'arc', chord_mm: null, chord_dimension_id: null, radius_mm: null, radius_dimension_id: null }],
      corner_radii: [{ corner: 'top-left', radius_mm: null, radius_dimension_id: null }],
    },
    features: [],
  }],
  dimensions: [
    { id: 'c', value: 1200, target: 'p1.profile.boundary.s1.chord' },
    { id: 'r', value: 800, target: 'p1.profile.boundary.s1.radius' },
    { id: 'cr', value: 50, target: 'p1.profile.corner_radii.top-left.radius' },
  ],
};
linkExplicitDimensionTargets(linkedExtraction);
assert.equal(linkedExtraction.parts[0].profile.boundary_segments[0].chord_dimension_id, 'c');
assert.equal(linkedExtraction.parts[0].profile.boundary_segments[0].radius_dimension_id, 'r');
assert.equal(linkedExtraction.parts[0].profile.corner_radii[0].radius_dimension_id, 'cr');

const template = enforceAnalysisChecks({
  production_ready: true,
  requires_human_review: false,
  uncertainties: ['Template required: freehand wavy perimeter cannot be reproduced from the shown dimensions.'],
  analysis_checks: {
    perimeter_traced: true,
    dimension_targets_followed: true,
    all_clear_figures_linked: true,
    square_markers_classified: true,
    perimeter_topology_closes: true,
    unsupported_geometry_present: false,
  },
});
assert.equal(template.production_ready, false);
assert.equal(template.requires_human_review, true);
assert.equal(template.analysis_checks.unsupported_geometry_present, true);

console.log('curves and radii deterministic tests passed');
