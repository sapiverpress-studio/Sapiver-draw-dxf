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

const positionOwnershipSource={
  analysis:{parts:[{id:'p1',label:'Stepped panel',profile:{type:'path',boundary_segments:[]},features:[
    {id:'f1',type:'rectangular_cutout',width_mm:100,height_mm:50,width_dimension_id:'w1',height_dimension_id:'h1',x_mm:100,y_mm:100,x_dimension_id:'x1',y_dimension_id:'y1',x_reference:'edge',x_from_edge:'left',y_reference:'edge',y_from_edge:'bottom'},
    {id:'f2',type:'circular_hole',diameter_mm:28,diameter_dimension_id:'dia',x_mm:220,x_dimension_id:'hx',y_mm:300,y_dimension_id:'slot-y',x_reference:'centre',x_from_edge:'left',y_reference:'edge',y_from_edge:'bottom'},
    {id:'f3',type:'slot',width_mm:120,height_mm:32,width_dimension_id:'sw',height_dimension_id:'sh',x_mm:260,x_dimension_id:'sx',y_mm:300,y_dimension_id:'slot-y',x_reference:'edge',x_from_edge:'right',y_reference:'edge',y_from_edge:'bottom'},
  ]}]},
  dimensions:[
    {id:'slot-y',label:'p1.features.f3.y',valueMm:300,role:'position',reference:'edge',fromEdge:'bottom',confirmed:false},
  ],
};
repairGeometryLinks(positionOwnershipSource);
assert.equal(positionOwnershipSource.analysis.parts[0].features[1].y_dimension_id,null,'a slot position must not be assigned to the preceding hole');
assert.equal(positionOwnershipSource.analysis.parts[0].features[1].y_mm,null,'the borrowed hole position must remain explicitly unresolved');
assert.equal(positionOwnershipSource.analysis.parts[0].features[2].y_dimension_id,'slot-y');
repairGeometryLinks(positionOwnershipSource);
assert.equal(positionOwnershipSource.analysis.parts[0].features[1].y_dimension_id,null,'feature ownership must survive later UI rerenders');
assert.equal(positionOwnershipSource.dimensions[0].analysisTarget,'p1.features.f3.y');

const savedArchSource={
  analysis:{parts:[{id:'p1',label:'Arch top panel',profile:{type:'path',boundary_segments:[
    {id:'s1',label:'Left side',kind:'vertical',dimension_id:'left',length_mm:400},
    {id:'s2',label:'Bottom',kind:'horizontal',dimension_id:'bottom',length_mm:1200},
    {id:'s3',label:'Right side',kind:'vertical',dimension_id:'right',length_mm:400},
    {id:'s4',label:'R600 arched top',kind:'connect_arc',radius_dimension_id:null,radius_mm:null,rise_dimension_id:null,rise_mm:null},
  ]},features:[]}]},
  dimensions:[
    {id:'left',label:'Left side',valueMm:400,role:'overall',reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'bottom',label:'Bottom',valueMm:1200,role:'overall',reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'right',label:'Right side',valueMm:400,role:'overall',reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'radius',label:'R600 arched top closing radius',rawText:'R600',valueMm:600,role:'radius',reference:'size',fromEdge:'unknown',confirmed:false},
  ],
};
repairGeometryLinks(savedArchSource);
assert.equal(savedArchSource.analysis.parts[0].profile.boundary_segments[3].radius_dimension_id,'radius','saved analyses must repair a uniquely named radius without re-analysis');

const typicalRadiusSource={
  analysis:{parts:[{id:'p1',label:'Rounded panel',profile:{type:'rectangle',width_mm:900,height_mm:500,width_dimension_id:'rw',height_dimension_id:'rh',corner_radii:[]},features:[]}]},
  dimensions:[
    {id:'rw',label:'Overall width',valueMm:900,role:'overall',reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'rh',label:'Overall height',valueMm:500,role:'overall',reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'rr',label:'p1.profile corner radius R100 TYP',rawText:'R100 TYP',valueMm:100,role:'radius',reference:'size',fromEdge:'unknown',confirmed:false},
  ],
};
repairGeometryLinks(typicalRadiusSource);
assert.deepEqual(typicalRadiusSource.analysis.parts[0].profile.corner_radii.map((item)=>item.corner),['bottom-left','bottom-right','top-right','top-left']);
assert.ok(typicalRadiusSource.analysis.parts[0].profile.corner_radii.every((item)=>item.radius_dimension_id==='rr'),'a typical radius must populate all four rectangle corners');

const straightPathSource={
  analysis:{parts:[{id:'p1',label:'Stepped outline',profile:{type:'path',boundary_segments:[
    {id:'s1',label:'Bottom edge',kind:'horizontal',direction:'right',dimension_id:'pw',length_mm:1000},
    {id:'s2',label:'Right side',kind:'vertical',direction:'up',dimension_id:'ph',length_mm:500},
    {id:'s3',label:'Top edge',kind:'horizontal',direction:'left',dimension_id:'pw',length_mm:1000},
    {id:'s4',label:'Left closing side',kind:'connect',direction:'connect'},
  ]},features:[]}]},
  dimensions:[
    {id:'pw',label:'Overall width',valueMm:1000,role:'overall',reference:'size',fromEdge:'unknown',confirmed:true},
    {id:'ph',label:'Overall height',valueMm:500,role:'overall',reference:'size',fromEdge:'unknown',confirmed:true},
  ],
};
repairGeometryLinks(straightPathSource);
const straightGeometry=compileSourceGeometry(straightPathSource);
assert.equal(straightGeometry.ok,true,straightGeometry.errors?.join('\n'));
const straightSvg=reviewDrawingSvg(straightPathSource);
assert.doesNotMatch(straightSvg,/Confirm overall width and height|awaiting confirmation/i,'a confirmed straight path must render its measured outline');
assert.match(straightSvg,/<path|<polyline|<polygon/);

const incompleteFeatureSource=structuredClone(straightPathSource);
incompleteFeatureSource.dimensions.forEach((dimension)=>{ dimension.confirmed=false; });
incompleteFeatureSource.analysis.parts[0].features=[{
  id:'hole-without-y',type:'circular_hole',quantity:1,diameter_mm:40,diameter_dimension_id:'dia',
  x_mm:200,x_dimension_id:'hx',x_reference:'centre',x_from_edge:'left',
  y_mm:null,y_dimension_id:null,y_reference:'unknown',y_from_edge:'unknown',
}];
incompleteFeatureSource.dimensions.push(
  {id:'dia',label:'Hole diameter',valueMm:40,role:'diameter',reference:'size',fromEdge:'unknown',confirmed:false},
  {id:'hx',label:'Hole X',valueMm:200,role:'position',reference:'centre',fromEdge:'left',confirmed:false},
);
repairGeometryLinks(incompleteFeatureSource);
const incompleteFeatureSvg=reviewDrawingSvg(incompleteFeatureSource);
assert.doesNotMatch(incompleteFeatureSvg,/Confirm overall width and height|awaiting confirmation/i,'an incomplete feature must not suppress a drawable outer path');
assert.match(incompleteFeatureSvg,/<path|<polyline|<polygon/);

const semicircleDeductionSource={
  analysis:{parts:[{id:'p1',label:'Panel with semicircular edge cut-out',profile:{type:'path',boundary_segments:[
    {id:'bottom-right',label:'Bottom-right shoulder',kind:'horizontal',direction:'left',length_mm:600,dimension_id:'br'},
    {id:'recess',label:'Semicircular recess',kind:'arc',direction:'left',radius_mm:300,radius_dimension_id:'rad',rise_mm:300,rise_dimension_id:'rise',chord_mm:null,chord_dimension_id:null,bulge_side:'right',arc_extent:'semicircle'},
    {id:'bottom-left',label:'Bottom-left shoulder',kind:'horizontal',direction:'left',length_mm:600,dimension_id:'bl'},
    {id:'left',label:'Left side',kind:'vertical',direction:'up',length_mm:800,dimension_id:'side'},
    {id:'top',label:'Top',kind:'horizontal',direction:'right',length_mm:1800,dimension_id:'top'},
    {id:'right',label:'Right closing side',kind:'connect',direction:'down'},
  ]},features:[]}]},
  dimensions:[
    {id:'br',valueMm:600,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'rad',valueMm:300,role:'radius',reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'rise',valueMm:300,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'bl',valueMm:600,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'side',valueMm:800,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'top',valueMm:1800,reference:'size',fromEdge:'unknown',confirmed:false},
  ],
};
materialiseDerivedDimensions(semicircleDeductionSource);
const chordSlot=geometrySlots(semicircleDeductionSource).find((slot)=>slot.parameter==='chord');
const chordDimension=dimensionForSlot(semicircleDeductionSource,chordSlot);
assert.equal(chordDimension.valueMm,600,'a semicircular chord must be deduced as twice its radius');
assert.equal(chordDimension.confidence,'derived');
assert.doesNotMatch(reviewDrawingSvg(semicircleDeductionSource),/aria-label="Curved drawing awaiting confirmation"/i,'a deduced semicircular chord must allow the outer profile to render progressively');

console.log('review-model tests passed');
// Full demo-v5 suite rerun after null-slot guard.
