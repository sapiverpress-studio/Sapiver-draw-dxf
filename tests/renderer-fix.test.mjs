import assert from 'node:assert/strict';
import * as base from '../core/review-model.js';
import { reviewDrawingSvg, reviewStats } from '../core/review-model-fixed.js';

const source = {
  analysis: { parts: [{
    id: 'p1', label: 'Stepped outline',
    profile: { type: 'path', boundary_segments: [
      { id:'s1', label:'Bottom edge', kind:'horizontal', direction:'right', dimension_id:'pw', length_mm:1000 },
      { id:'s2', label:'Right side', kind:'vertical', direction:'up', dimension_id:'ph', length_mm:500 },
      { id:'s3', label:'Top edge', kind:'horizontal', direction:'left', dimension_id:'pw', length_mm:1000 },
      { id:'s4', label:'Left closing side', kind:'connect', direction:'connect' },
    ]},
    features: [{
      id:'hole', type:'circular_hole', quantity:1,
      diameter_mm:28, diameter_dimension_id:'dia',
      x_mm:220, x_dimension_id:'hx', x_reference:'centre', x_from_edge:'left',
      y_mm:null, y_dimension_id:null, y_reference:'centre', y_from_edge:'bottom',
    }],
  }]},
  dimensions: [
    { id:'pw', label:'Overall width', valueMm:1000, role:'overall', reference:'size', fromEdge:'unknown', confirmed:true },
    { id:'ph', label:'Overall height', valueMm:500, role:'overall', reference:'size', fromEdge:'unknown', confirmed:true },
    { id:'dia', label:'Hole diameter', valueMm:28, role:'diameter', reference:'size', fromEdge:'unknown', confirmed:true },
    { id:'hx', label:'Hole X', valueMm:220, role:'position', reference:'centre', fromEdge:'left', confirmed:true },
  ],
};

base.repairGeometryLinks(source);
assert.equal(reviewStats(source).missing, 1, 'only the genuinely absent Y position should remain unresolved');

const baseSvg = base.reviewDrawingSvg(structuredClone(source));
assert.doesNotMatch(baseSvg, /Confirm overall width and height to scale the drawing/, 'the main renderer must draw the known perimeter while a feature remains incomplete');
assert.match(baseSvg, /<path|<polyline|<polygon/, 'the main renderer must contain measured perimeter geometry');

const fixedSvg = reviewDrawingSvg(source);
assert.doesNotMatch(fixedSvg, /Confirm overall width and height to scale the drawing/, 'a valid path perimeter must not fall back to the rectangle placeholder');
assert.match(fixedSvg, /<path|<polyline|<polygon/, 'the measured perimeter must still render while a feature is incomplete');
assert.match(fixedSvg, /1 feature pending confirmation/, 'the preview must state that an incomplete feature has been omitted');
assert.doesNotMatch(fixedSvg, /undefined|NaN/, 'renderer output must remain valid SVG');

console.log('renderer-fix tests passed');
