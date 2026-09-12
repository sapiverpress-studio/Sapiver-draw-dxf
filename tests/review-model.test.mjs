import assert from 'node:assert/strict';
import { compileSourceGeometry } from '../core/geometry.js';
import { dimensionForSlot, geometrySlots, isPerimeterSlot, materialiseDerivedDimensions, repairGeometryLinks, reviewDrawingSvg, reviewStats } from '../core/review-model.js';

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
      }, {
        id: 'f2', type: 'rectangular_cutout', quantity: 1,
        width_mm: 100, height_mm: 60, x_mm: 50, x_reference: 'edge', x_from_edge: 'left', x_relative_to_feature_id: 'f1',
        y_mm: 100, y_reference: 'edge', y_from_edge: 'bottom', width_dimension_id: 'd7', height_dimension_id: 'd8', x_dimension_id: 'd9', y_dimension_id: 'd10',
      }], dimension_ids: ['d1','d2','d3','d4','d5','d6','d7','d8','d9','d10'],
    }],
  },
  dimensions: [
    { id:'d1', label:'overall width', role:'overall', valueMm:1500, reference:'size', fromEdge:'unknown', confirmed:false },
    { id:'d2', label:'overall height', role:'overall', valueMm:500, reference:'size', fromEdge:'unknown', confirmed:false },
    { id:'d3', label:'f1 width', role:'unknown', valueMm:130, reference:'edge', fromEdge:'left', confirmed:false },
    { id:'d4', label:'f1 height', role:'size', valueMm:75, reference:'size', fromEdge:'bottom', confirmed:false },
    { id:'d5', label:'f1 x', role:'position', valueMm:200, reference:'edge', fromEdge:'left', confirmed:false },
    { id:'d6', label:'f1 y', role:'position', valueMm:100, reference:'edge', fromEdge:'bottom', confirmed:false },
    { id:'d7', label:'f2 width', role:'size', valueMm:100, reference:'size', fromEdge:'unknown', confirmed:false },
    { id:'d8', label:'f2 height', role:'size', valueMm:60, reference:'size', fromEdge:'unknown', confirmed:false },
    { id:'d9', label:'f2 gap', role:'position', valueMm:50, reference:'edge', fromEdge:'left', confirmed:false, relativeToFeatureId:'f1' },
    { id:'d10', label:'f2 y', role:'position', valueMm:100, reference:'edge', fromEdge:'bottom', confirmed:false },
  ],
};

repairGeometryLinks(source);
const slots = geometrySlots(source);
assert.equal(slots.length, 10);
assert.equal(dimensionForSlot(source, slots.find((s) => s.parameter === 'width' && s.featureIndex === 0)).reference, 'size');
assert.equal(dimensionForSlot(source, slots.find((s) => s.parameter === 'height' && s.featureIndex === 0)).fromEdge, 'unknown');
assert.deepEqual(reviewStats(source), { total: 10, linked: 10, confirmed: 0, missing: 0, slots });

source.dimensions.find((d) => d.id === 'd1').confirmed = true;
source.dimensions.find((d) => d.id === 'd2').confirmed = true;
let svg = reviewDrawingSvg(source);
assert.match(svg, /1500 mm/);
assert.match(svg, /500 mm/);
assert.doesNotMatch(svg, /Rectangular cut-out 1 130 mm/);
assert.equal(reviewStats(source).confirmed, 2);

for (const d of source.dimensions) d.confirmed = true;
svg = reviewDrawingSvg(source);
assert.match(svg, /Rectangular cut-out 1 130 mm/);
assert.match(svg, /200 mm edge from left/);
assert.match(svg, /100 mm edge from bottom/);
assert.match(svg, /50 mm gap from previous cut-out/);
assert.equal(reviewStats(source).confirmed, 10);
assert.doesNotMatch(svg, /font-size="14"[^>]*font-size=/, 'SVG text elements must not contain duplicate font-size attributes');
const geometry = compileSourceGeometry(source);
assert.equal(geometry.ok, true, geometry.errors?.join('\n'));
assert.equal(geometry.parts.length, 1);

source.dimensions.push({ id:'manual-blank', label:'Correction / added dimension', role:'unknown', valueMm:null, reference:'unknown', fromEdge:'unknown', confirmed:false, confidence:'manual' });
assert.equal(reviewStats(source).total, 10, 'unlinked manual reads must not expand required production confirmation');

assert.equal(isPerimeterSlot({ ownerType: 'profile' }), true);
assert.equal(isPerimeterSlot({ ownerType: 'segment' }), true, 'measured path segments must remain visible in the perimeter stage');
assert.equal(isPerimeterSlot({ ownerType: 'feature' }), false);

const derivedSlotSource={
  analysis:{parts:[{
    id:'derived-panel',label:'Derived panel',
    profile:{type:'rectangle',width_mm:1000,height_mm:500,width_dimension_id:'w',height_dimension_id:'h'},
    features:[{
      id:'capsule',type:'slot',quantity:1,width_mm:120,height_mm:null,radius_mm:20,
      width_dimension_id:'sw',height_dimension_id:null,x_mm:300,x_reference:'centre',x_from_edge:'left',
      y_mm:null,y_reference:'unknown',y_from_edge:'unknown',x_dimension_id:'sx',y_dimension_id:null,
    }],
  }]},
  dimensions:[
    {id:'w',valueMm:1000,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'h',valueMm:500,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'sw',valueMm:120,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'sx',valueMm:300,reference:'centre',fromEdge:'left',confirmed:false},
  ],
};
materialiseDerivedDimensions(derivedSlotSource);
assert.equal(derivedSlotSource.analysis.parts[0].features[0].height_mm,40,'slot height must be deduced as twice its semicircular end radius');
const derivedHeightSlot=geometrySlots(derivedSlotSource).find((slot)=>slot.featureIndex===0&&slot.parameter==='height');
const derivedHeight=dimensionForSlot(derivedSlotSource,derivedHeightSlot);
assert.equal(derivedHeight.valueMm,40);
assert.equal(derivedHeight.confidence,'derived');
assert.equal(derivedHeight.confirmed,false,'calculated manufacturing values still require human confirmation');
assert.equal(reviewStats(derivedSlotSource).missing,1,'the genuinely absent Y position must remain the only requested value');

console.log('review-model tests passed');
// Full demo-v5 suite rerun after null-slot guard.
