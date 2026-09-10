import assert from 'node:assert/strict';
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA, enforceAnalysisChecks, linkExplicitDimensionTargets } from '../netlify/functions/_quick-dxf-analysis.mjs';

const requiredInstructions = [
  'trace the complete visible outer perimeter',
  'follow each dimension line, extension line and arrowhead',
  'topologically closed',
  'square-corner symbols',
  'shoulder height',
  'multiple corner_notch and edge_notch',
  'sloping drawn boundary remains sloping',
  'low-confidence handwriting remains linked',
];
for (const instruction of requiredInstructions) {
  assert.ok(ANALYSIS_PROMPT.toLowerCase().includes(instruction.toLowerCase()), `missing analyser instruction: ${instruction}`);
}

const checks = ANALYSIS_SCHEMA.properties.analysis_checks;
assert.equal(checks.type, 'object');
for (const field of [
  'perimeter_traced',
  'dimension_targets_followed',
  'all_clear_figures_linked',
  'square_markers_classified',
  'perimeter_topology_closes',
  'unsupported_geometry_present',
]) {
  assert.equal(checks.properties[field].type, 'boolean');
  assert.ok(checks.required.includes(field));
}
assert.ok(ANALYSIS_SCHEMA.required.includes('analysis_checks'));

const profile = ANALYSIS_SCHEMA.properties.parts.items.properties.profile;
assert.ok(profile.required.includes('side_heights_to_notch_shoulders'));
assert.deepEqual(profile.properties.side_heights_to_notch_shoulders, { type:'boolean' });
assert.ok(profile.required.includes('boundary_segments'));

const unsafe = enforceAnalysisChecks({
  production_ready:true,
  requires_human_review:false,
  uncertainties:[],
  analysis_checks:{
    perimeter_traced:true,
    dimension_targets_followed:true,
    all_clear_figures_linked:false,
    square_markers_classified:true,
    perimeter_topology_closes:true,
    unsupported_geometry_present:false,
  },
});
assert.equal(unsafe.production_ready,false);
assert.equal(unsafe.requires_human_review,true);
assert.ok(unsafe.uncertainties.some((message)=>message.includes('not linked')));

const failedLiveExtraction={
  parts:[{id:'p1',profile:{type:'irregular',bottom_dimension_id:null,left_dimension_id:null,right_dimension_id:null},features:[
    {id:'f1',type:'corner_notch',width_dimension_id:null,depth_dimension_id:null},
  ]}],
  dimensions:[
    {id:'d1',value:1850,target:'p1.profile.bottom'},
    {id:'d2',value:600,target:'p1.profile.left shoulder height'},
    {id:'d3',value:610,target:'p1.profile.right shoulder height'},
    {id:'d4',value:14,target:'p1.features.f1.width'},
  ],
};
linkExplicitDimensionTargets(failedLiveExtraction);
const linkedPart=failedLiveExtraction.parts[0];
assert.equal(linkedPart.profile.bottom_dimension_id,'d1');
assert.equal(linkedPart.profile.left_dimension_id,'d2');
assert.equal(linkedPart.profile.right_dimension_id,'d3');
assert.equal(linkedPart.features[0].width_dimension_id,'d4');

const pathTarget={parts:[{id:'p1',profile:{type:'path',boundary_segments:[{id:'s1',kind:'horizontal',dimension_id:null,length_mm:null}]},features:[]}],dimensions:[{id:'edge',value:1800,target:'p1.profile.boundary.s1'}]};
linkExplicitDimensionTargets(pathTarget);
assert.equal(pathTarget.parts[0].profile.boundary_segments[0].dimension_id,'edge');

console.log('geometry-first analyser contract tests passed.');
