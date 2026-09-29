import assert from 'node:assert/strict';
import { compileSourceGeometry } from '../core/geometry.js';
import { geometrySlots, repairGeometryLinks, reviewDrawingSvg, reviewStats, setSlotDimensionId, unlinkedDimensions } from '../core/review-model.js';
import { isReviewOnlyDimension, parseReviewOnlyTarget, recordReviewOnlyDimension, reviewOnlyDimensionFor, reviewOnlyTargetOptions } from '../core/review-references.js';

const source = {
  analysis: {
    parts: [{
      id: 'tooth', label: 'Tooth-shaped part',
      profile: { type: 'unknown', width_dimension_id: null, height_dimension_id: null },
      features: [],
    }],
  },
  dimensions: [
    { id: 'w', label: '11.4 mm', rawText: '11.4 mm', role: 'overall', valueMm: 11.4, reference: 'size', fromEdge: 'unknown', confidence: 'high', confirmed: false },
    { id: 'h', label: '20.9 mm', rawText: '20.9 mm', role: 'overall', valueMm: 20.9, reference: 'size', fromEdge: 'unknown', confidence: 'high', confirmed: false },
    { id: 'r', label: 'R3.5 mm approx.', rawText: 'R3.5 mm approx.', role: 'radius', valueMm: 3.5, reference: 'size', fromEdge: 'unknown', confidence: 'high', confirmed: false },
  ],
};

const slots = geometrySlots(source);
assert.equal(slots.length, 0, 'unknown outlines must not gain production geometry slots');
assert.deepEqual(reviewOnlyTargetOptions(source, slots).map((option) => option.target || 'named-reference'), [
  'named-reference', 'overall-width', 'overall-height',
]);
assert.deepEqual(parseReviewOnlyTarget('review:overall-width:p0'), { target: 'overall-width', partIndex: 0 });

const ordinarySource = {
  analysis: { parts: [{ id:'panel', profile:{ type:'rectangle', width_mm:500, height_mm:300, width_dimension_id:null, height_dimension_id:null }, features:[] }] },
  dimensions: [],
};
assert.deepEqual(reviewOnlyTargetOptions(ordinarySource, geometrySlots(ordinarySource)).map((option) => option.target || 'named-reference'), ['named-reference'], 'ordinary supported profiles must not gain review-only overall-size targets');

recordReviewOnlyDimension(source.dimensions[0], { target: 'overall-width', partIndex: 0, label: 'Overall width', valueMm: 11.4 });
recordReviewOnlyDimension(source.dimensions[1], { target: 'overall-height', partIndex: 0, label: 'Overall height', valueMm: 20.9 });
recordReviewOnlyDimension(source.dimensions[2], { target: 'named-reference', label: 'Upper-left crown radius', valueMm: 3.5 });
source.dimensions.forEach((dimension) => { dimension.confirmed = true; });

repairGeometryLinks(source);
assert.ok(source.dimensions.every(isReviewOnlyDimension));
assert.equal(unlinkedDimensions(source).length, 0, 'saved review readings must leave the Other reads queue');
assert.equal(reviewStats(source).total, 0, 'review-only measurements must not become production requirements');
assert.equal(reviewOnlyDimensionFor(source, 'overall-width', 0).valueMm, 11.4);
assert.match(reviewDrawingSvg(source), /11\.4 mm overall width · review only/);
assert.match(reviewDrawingSvg(source), /20\.9 mm overall height · review only/);
assert.match(reviewDrawingSvg(source), /Measurements here do not define DXF geometry/);
assert.equal(compileSourceGeometry(source).ok, false, 'review-only readings must not make an unknown outline exportable');

const linkedReference = { id:'ref', label:'Overall width', valueMm:500, reviewOnly:true, reviewTarget:'overall-width', reviewPartIndex:0, role:'unknown', reference:'size', confirmed:true };
ordinarySource.dimensions.push(linkedReference);
repairGeometryLinks(ordinarySource);
const ordinaryWidth = geometrySlots(ordinarySource).find((slot) => slot.parameter === 'width');
assert.equal(setSlotDimensionId(ordinarySource, ordinaryWidth, linkedReference.id), false, 'review-only readings must not link into supported production slots');
assert.equal(ordinarySource.analysis.parts[0].profile.width_dimension_id, null);

console.log('Unsupported-outline review measurements passed.');
