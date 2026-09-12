import assert from 'node:assert/strict';
import { arcFromChord, buildCurvedPath, buildRoundedRectangle, quarterArcFromTangent, radiusFromChordRise } from '../core/curves.js';
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
close(radiusFromChordRise(1200, expectedRise), 800, 1e-5, 'radius solved from confirmed chord and rise');
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
assert.throws(() => radiusFromChordRise(1200, 700, { extent: 'minor' }), /minor arc rise/i);

// A closing arc can join shoulders at different heights because its endpoints
// are fixed by the preceding confirmed straight segments.
const diagonalClosingArc = buildCurvedPath([
  { id: 'right', kind: 'vertical', direction: 'down', length: 600 },
  { id: 'bottom', kind: 'horizontal', direction: 'left', length: 1200 },
  { id: 'left', kind: 'vertical', direction: 'up', length: 800 },
  { id: 'top', kind: 'connect_arc', direction: 'connect', radius: 1000, bulgeSide: 'left', extent: 'minor' },
]);
assert.equal(diagonalClosingArc.entities.filter((entity) => entity.type === 'arc').length, 1);

const twoNotchFillets = buildCurvedPath([
  { id:'lower',kind:'horizontal',direction:'right',length:100 },
  { id:'first-r15',kind:'quarter_arc',direction:'right',turnDirection:'left',radius:15 },
  { id:'side',kind:'vertical',direction:'up',length:70 },
  { id:'second-r15',kind:'quarter_arc',direction:'up',turnDirection:'left',radius:15 },
  { id:'upper',kind:'horizontal',direction:'left',length:100 },
  { id:'close',kind:'connect',direction:'connect' },
]);
assert.equal(twoNotchFillets.entities.filter((entity)=>entity.type==='arc').length,2,'two radius-only notch transitions must create two exact arcs');
for(const entity of twoNotchFillets.entities.filter((entity)=>entity.type==='arc')) assert.equal(entity.r,15);
assert.doesNotThrow(()=>quarterArcFromTangent({x:0,y:0},6,'right','left'));

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

const toughenedArchSource=structuredClone(archSource);
toughenedArchSource.toughened=true;
toughenedArchSource.glassThicknessMm=10;
// The curved perimeter itself must not create a manual-manager gate. Feature
// clearance behaviour is covered separately by the toughened safety tests.
toughenedArchSource.analysis.parts[0].features=[];
toughenedArchSource.analysis.parts[0].dimension_ids=['right','bottom','left','radius'];
toughenedArchSource.dimensions=toughenedArchSource.dimensions.filter((item)=>['right','bottom','left','radius'].includes(item.id));
const toughenedArchGeometry=compileSourceGeometry(toughenedArchSource);
assert.equal(toughenedArchGeometry.ok,true,toughenedArchGeometry.errors.join('\n'));
assert.doesNotMatch(toughenedArchGeometry.errors.join('\n'),/production-manager/i);

const riseArchSource = structuredClone(archSource);
const riseArc = riseArchSource.analysis.parts[0].profile.boundary_segments.find((segment) => segment.kind === 'connect_arc');
riseArc.radius_mm = null;
riseArc.radius_dimension_id = null;
riseArc.rise_mm = 600;
riseArc.rise_dimension_id = 'rise';
riseArchSource.analysis.parts[0].dimension_ids = riseArchSource.analysis.parts[0].dimension_ids.map((id) => id === 'radius' ? 'rise' : id);
riseArchSource.dimensions = riseArchSource.dimensions.filter((item) => item.id !== 'radius');
riseArchSource.dimensions.push(dim('rise', 600, 'size', 'unknown', 'rise'));
const riseArchGeometry = compileSourceGeometry(riseArchSource);
assert.equal(riseArchGeometry.ok, true, riseArchGeometry.errors.join('\n'));
assert.equal(riseArchGeometry.parts[0].entities.filter((entity) => entity.type === 'arc').length, 1);
close(riseArchGeometry.parts[0].entities.find((entity) => entity.type === 'arc').r, 600);
assert.ok(geometrySlots(riseArchSource).some((slot) => slot.parameter === 'rise'));

const inconsistentRiseSource = structuredClone(riseArchSource);
const inconsistentArc = inconsistentRiseSource.analysis.parts[0].profile.boundary_segments.find((segment) => segment.kind === 'connect_arc');
inconsistentArc.radius_mm = 800;
inconsistentArc.radius_dimension_id = 'radius';
inconsistentRiseSource.dimensions.push(dim('radius', 800, 'size', 'unknown', 'radius'));
const inconsistentRiseGeometry = compileSourceGeometry(inconsistentRiseSource);
assert.equal(inconsistentRiseGeometry.ok, false);
assert.match(inconsistentRiseGeometry.errors.join('\n'), /radius and rise do not describe the same circular arc/i);

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

// Internal rounded rectangular cut-outs use genuine ARC entities in previews,
// confirmation geometry and R12 DXF output rather than faceted approximations.
const internalRadiusSource = structuredClone(roundedSource);
internalRadiusSource.analysis.parts[0].profile.corner_radii = [];
internalRadiusSource.analysis.parts[0].dimension_ids = ['w','h'];
internalRadiusSource.dimensions = internalRadiusSource.dimensions.filter((item)=>['w','h'].includes(item.id));
internalRadiusSource.analysis.parts[0].features = [{
  id: 'socket', type: 'rectangular_cutout', quantity: 1,
  width_mm: 140, height_mm: 80, diameter_mm: null, radius_mm: 15,
  cutout_finish: 'polished', cutout_finish_confirmed: true,
  x_mm: 250, x_reference: 'centre', x_from_edge: 'left',
  y_mm: 180, y_reference: 'centre', y_from_edge: 'bottom', touching_edge: 'none',
  width_dimension_id: 'cw', height_dimension_id: 'ch', diameter_dimension_id: null, radius_dimension_id: 'cr',
  x_dimension_id: 'cx', y_dimension_id: 'cy', confidence: 'high', source_note: 'R15 corners',
  corner: 'none', depth_mm: null, offset_mm: null, depth_dimension_id: null, offset_dimension_id: null,
}];
internalRadiusSource.analysis.parts[0].dimension_ids = ['w','h','cw','ch','cr','cx','cy'];
internalRadiusSource.dimensions.push(
  dim('cw',140), dim('ch',80), dim('cr',15,'size','unknown','radius'),
  dim('cx',250,'centre','left','position'), dim('cy',180,'centre','bottom','position'),
);
const internalRadiusGeometry = compileSourceGeometry(structuredClone(internalRadiusSource));
assert.equal(internalRadiusGeometry.ok,true,internalRadiusGeometry.errors.join('\n'));
assert.equal(internalRadiusGeometry.parts[0].entities.filter((entity)=>entity.role==='cut'&&entity.type==='arc').length,4);
assert.equal(internalRadiusGeometry.parts[0].entities.filter((entity)=>entity.role==='cut'&&entity.type==='polyline').length,4);
assert.equal((buildDxf(internalRadiusGeometry.parts[0].entities).match(/\r\nARC\r\n/g)||[]).length,4);
assert.ok(geometrySlots(structuredClone(internalRadiusSource)).some((slot)=>slot.ownerType==='feature'&&slot.parameter==='radius'));
assert.match(reviewDrawingSvg(structuredClone(internalRadiusSource)),/polyline/);

const minimumUnpolishedRadiusSource = structuredClone(internalRadiusSource);
minimumUnpolishedRadiusSource.dimensions.find((item)=>item.id==='cr').valueMm=6;
minimumUnpolishedRadiusSource.analysis.parts[0].features[0].cutout_finish='unpolished';
const minimumUnpolishedRadiusGeometry = compileSourceGeometry(minimumUnpolishedRadiusSource);
assert.equal(minimumUnpolishedRadiusGeometry.ok,true,minimumUnpolishedRadiusGeometry.errors.join('\n'));

const belowMinimumRadiusSource = structuredClone(internalRadiusSource);
belowMinimumRadiusSource.dimensions.find((item)=>item.id==='cr').valueMm=5;
belowMinimumRadiusSource.analysis.parts[0].features[0].cutout_finish='unpolished';
const belowMinimumRadiusGeometry = compileSourceGeometry(belowMinimumRadiusSource);
assert.equal(belowMinimumRadiusGeometry.ok,false);
assert.match(belowMinimumRadiusGeometry.errors.join('\n'),/below Halifax Glass's 6 mm minimum/i);

const polishedBelowMinimumSource = structuredClone(internalRadiusSource);
polishedBelowMinimumSource.dimensions.find((item)=>item.id==='cr').valueMm=14;
const polishedBelowMinimumGeometry = compileSourceGeometry(polishedBelowMinimumSource);
assert.equal(polishedBelowMinimumGeometry.ok,false);
assert.match(polishedBelowMinimumGeometry.errors.join('\n'),/15 mm minimum for a polished\/CNC cut-out/i);

const unconfirmedFinishSource = structuredClone(internalRadiusSource);
unconfirmedFinishSource.analysis.parts[0].features[0].cutout_finish_confirmed=false;
const unconfirmedFinishGeometry = compileSourceGeometry(unconfirmedFinishSource);
assert.equal(unconfirmedFinishGeometry.ok,false);
assert.match(unconfirmedFinishGeometry.errors.join('\n'),/confirm whether.*polished\/CNC or unpolished/i);

const impossibleInternalRadiusSource = structuredClone(internalRadiusSource);
impossibleInternalRadiusSource.dimensions.find((item)=>item.id==='cr').valueMm=45;
const impossibleInternalRadiusGeometry = compileSourceGeometry(impossibleInternalRadiusSource);
assert.equal(impossibleInternalRadiusGeometry.ok,false);
assert.match(impossibleInternalRadiusGeometry.errors.join('\n'),/cannot fit/i);

// An edge notch keeps sharp mouth transitions but receives two exact internal
// quarter-circle radii at its depth corners.
const radiusedEdgeNotchSource = structuredClone(internalRadiusSource);
radiusedEdgeNotchSource.analysis.parts[0].features=[{
  id:'top-notch',type:'edge_notch',quantity:1,touching_edge:'top',corner:'none',
  width_mm:100,depth_mm:50,offset_mm:300,radius_mm:15,cutout_finish:'polished',cutout_finish_confirmed:true,
  width_dimension_id:'nw',depth_dimension_id:'nd',offset_dimension_id:'no',radius_dimension_id:'nr',
  height_mm:null,diameter_mm:null,x_mm:null,y_mm:null,x_reference:'unknown',x_from_edge:'unknown',y_reference:'unknown',y_from_edge:'unknown',
  x_dimension_id:null,y_dimension_id:null,diameter_dimension_id:null,confidence:'high',source_note:'R15 internal corners',
}];
radiusedEdgeNotchSource.analysis.parts[0].dimension_ids=['w','h','nw','nd','no','nr'];
radiusedEdgeNotchSource.dimensions=radiusedEdgeNotchSource.dimensions.filter((item)=>['w','h'].includes(item.id));
radiusedEdgeNotchSource.dimensions.push(dim('nw',100),dim('nd',50),dim('no',300),dim('nr',15,'size','unknown','radius'));
const radiusedEdgeNotchGeometry=compileSourceGeometry(radiusedEdgeNotchSource);
assert.equal(radiusedEdgeNotchGeometry.ok,true,radiusedEdgeNotchGeometry.errors.join('\n'));
assert.equal(radiusedEdgeNotchGeometry.parts[0].entities.filter((entity)=>entity.role==='outer'&&entity.type==='arc').length,2);
assert.equal((buildDxf(radiusedEdgeNotchGeometry.parts[0].entities).match(/\r\nARC\r\n/g)||[]).length,2);

const radiusedCornerNotchSource=structuredClone(radiusedEdgeNotchSource);
radiusedCornerNotchSource.analysis.parts[0].features[0]={...radiusedCornerNotchSource.analysis.parts[0].features[0],id:'corner-notch',type:'corner_notch',corner:'top-right',touching_edge:'none',offset_mm:null,offset_dimension_id:null};
radiusedCornerNotchSource.analysis.parts[0].dimension_ids=['w','h','nw','nd','nr'];
const radiusedCornerNotchGeometry=compileSourceGeometry(radiusedCornerNotchSource);
assert.equal(radiusedCornerNotchGeometry.ok,true,radiusedCornerNotchGeometry.errors.join('\n'));
assert.equal(radiusedCornerNotchGeometry.parts[0].entities.filter((entity)=>entity.role==='outer'&&entity.type==='arc').length,1);

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
for (const field of ['chord_mm', 'chord_dimension_id', 'radius_mm', 'radius_dimension_id', 'rise_mm', 'rise_dimension_id', 'bulge_side', 'arc_extent', 'turn_direction']) assert.ok(segmentSchema.required.includes(field), `boundary segment must require ${field}`);
assert.ok(segmentSchema.properties.kind.enum.includes('arc'));
assert.ok(segmentSchema.properties.kind.enum.includes('quarter_arc'));
assert.ok(segmentSchema.properties.kind.enum.includes('connect_arc'));

const linkedExtraction = {
  parts: [{
    id: 'p1',
    profile: {
      type: 'path',
      boundary_segments: [{ id: 's1', kind: 'arc', chord_mm: null, chord_dimension_id: null, radius_mm: null, radius_dimension_id: null, rise_mm: null, rise_dimension_id: null }],
      corner_radii: [{ corner: 'top-left', radius_mm: null, radius_dimension_id: null }],
    },
    features: [],
  }],
  dimensions: [
    { id: 'c', value: 1200, target: 'p1.profile.boundary.s1.chord' },
    { id: 'r', value: 800, target: 'p1.profile.boundary.s1.radius' },
    { id: 'rise', value: 270.85, target: 'p1.profile.boundary.s1.sagitta' },
    { id: 'cr', value: 50, target: 'p1.profile.corner_radii.top-left.radius' },
  ],
};
linkExplicitDimensionTargets(linkedExtraction);
assert.equal(linkedExtraction.parts[0].profile.boundary_segments[0].chord_dimension_id, 'c');
assert.equal(linkedExtraction.parts[0].profile.boundary_segments[0].radius_dimension_id, 'r');
assert.equal(linkedExtraction.parts[0].profile.boundary_segments[0].rise_dimension_id, 'rise');
assert.equal(linkedExtraction.parts[0].profile.corner_radii[0].radius_dimension_id, 'cr');

const duplicatedFalseChordExtraction = {
  production_ready:true, requires_human_review:false, uncertainties:[],
  analysis_checks:{perimeter_traced:true,dimension_targets_followed:true,all_clear_figures_linked:true,square_markers_classified:true,perimeter_topology_closes:true,unsupported_geometry_present:false},
  dimensions:[],
  parts:[{id:'p1',profile:{type:'path',corner_radii:[],boundary_segments:[
    {id:'ledge-1',kind:'horizontal',direction:'right',dimension_id:'l1'},
    {id:'r6',label:'R6 concave notch transition',kind:'arc',direction:'right',chord_mm:null,chord_dimension_id:null,radius_mm:6,radius_dimension_id:'r6d',rise_mm:null,rise_dimension_id:null,bulge_side:'left',arc_extent:'minor',turn_direction:'none'},
    {id:'drop',kind:'vertical',direction:'up',dimension_id:'drop'},
    {id:'r15',label:'R15 concave transition into ledge',kind:'arc',direction:'up',chord_mm:null,chord_dimension_id:null,radius_mm:15,radius_dimension_id:'r15d',rise_mm:null,rise_dimension_id:null,bulge_side:'left',arc_extent:'minor',turn_direction:'none'},
    {id:'ledge-2',kind:'horizontal',direction:'left',dimension_id:'l2'},
    {id:'close',kind:'connect',direction:'connect'},
  ]},features:[],dimension_ids:[]}],
};
enforceAnalysisChecks(duplicatedFalseChordExtraction);
const repairedTransitions=duplicatedFalseChordExtraction.parts[0].profile.boundary_segments.filter((segment)=>segment.id==='r6'||segment.id==='r15');
assert.deepEqual(repairedTransitions.map((segment)=>segment.kind),['quarter_arc','quarter_arc'],'both radius-only notch transitions must be repaired');
const repairedSource={analysis:duplicatedFalseChordExtraction,dimensions:[dim('l1',100),dim('r6d',6),dim('drop',70),dim('r15d',15),dim('l2',100)]};
const repairedSlots=geometrySlots(repairedSource);
assert.equal(repairedSlots.filter((slot)=>slot.parameter==='chord').length,0,'repaired notch transitions must never ask the operator for chord values');
assert.equal(repairedSlots.filter((slot)=>slot.parameter==='radius').length,2,'each repaired notch transition keeps its own radius confirmation');
const repairedGeometry=compileSourceGeometry(repairedSource);
assert.equal(repairedGeometry.ok,true,repairedGeometry.errors?.join('\n'));
assert.equal(repairedGeometry.parts[0].entities.filter((entity)=>entity.type==='arc').length,2,'both repaired transitions must reach deterministic DXF geometry');

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
