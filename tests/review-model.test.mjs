import assert from 'node:assert/strict';
import { compileSourceGeometry } from '../core/geometry.js';
import { dimensionForSlot, geometrySlots, repairGeometryLinks, reviewDrawingSvg, reviewStats } from '../core/review-model.js';

const source = {
  analysis: {
    parts: [{
      id: 'panel', label: 'Panel',
      profile: { type: 'rectangle', width_mm: 1500, height_mm: 500, diameter_mm: null, width_dimension_id: 'd1', height_dimension_id: 'd2', diameter_dimension_id: null, confidence: 'high' },
      features: [{
        id: 'f1', type: 'rectangular_cutout', quantity: 1,
        width_mm: 130, height_mm: 75, diameter_mm: null, radius_mm: null,
        x_mm: 200, x_reference: 'edge', x_from_edge: 'left',
        y_mm: 100, y_reference: 'edge', y_from_edge: 'bottom', touching_edge: 'none',
        width_dimension_id: 'd3', height_dimension_id: 'd4', diameter_dimension_id: null, radius_dimension_id: null,
        x_dimension_id: 'd5', y_dimension_id: 'd6', confidence: 'high', source_note: null,
      }], dimension_ids: ['d1','d2','d3','d4','d5','d6'],
    }],
  },
  dimensions: [
    { id:'d1', label:'overall width', role:'overall', valueMm:1500, reference:'size', fromEdge:'unknown', confirmed:false },
    { id:'d2', label:'overall height', role:'overall', valueMm:500, reference:'size', fromEdge:'unknown', confirmed:false },
    { id:'d3', label:'f1 width', role:'unknown', valueMm:130, reference:'edge', fromEdge:'left', confirmed:false },
    { id:'d4', label:'f1 height', role:'size', valueMm:75, reference:'size', fromEdge:'bottom', confirmed:false },
    { id:'d5', label:'f1 x', role:'position', valueMm:200, reference:'edge', fromEdge:'left', confirmed:false },
    { id:'d6', label:'f1 y', role:'position', valueMm:100, reference:'edge', fromEdge:'bottom', confirmed:false },
  ],
};

repairGeometryLinks(source);
const slots = geometrySlots(source);
assert.equal(slots.length, 6);
assert.equal(dimensionForSlot(source, slots.find((s) => s.parameter === 'width' && s.featureIndex === 0)).reference, 'size');
assert.equal(dimensionForSlot(source, slots.find((s) => s.parameter === 'height' && s.featureIndex === 0)).fromEdge, 'unknown');
assert.deepEqual(reviewStats(source), { total: 6, linked: 6, confirmed: 0, missing: 0, slots });

source.dimensions.find((d) => d.id === 'd1').confirmed = true;
source.dimensions.find((d) => d.id === 'd2').confirmed = true;
let svg = reviewDrawingSvg(source);
assert.match(svg, /1500 mm/);
assert.match(svg, /500 mm/);
assert.doesNotMatch(svg, /F1 130 mm/);
assert.equal(reviewStats(source).confirmed, 2);

for (const d of source.dimensions) d.confirmed = true;
svg = reviewDrawingSvg(source);
assert.match(svg, /F1 130 mm/);
assert.match(svg, /200 mm edge from left/);
assert.match(svg, /100 mm edge from bottom/);
assert.equal(reviewStats(source).confirmed, 6);
const geometry = compileSourceGeometry(source);
assert.equal(geometry.ok, true, geometry.errors?.join('\n'));
assert.equal(geometry.parts.length, 1);

source.dimensions.push({ id:'manual-blank', label:'Correction / added dimension', role:'unknown', valueMm:null, reference:'unknown', fromEdge:'unknown', confirmed:false, confidence:'manual' });
assert.equal(reviewStats(source).total, 6, 'unlinked manual reads must not expand required production confirmation');

console.log('review-model tests passed');
// Full demo-v5 suite rerun after null-slot guard.
