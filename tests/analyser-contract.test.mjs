import assert from 'node:assert/strict';
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA, enforceAnalysisChecks } from '../netlify/functions/_quick-dxf-analysis.mjs';

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

console.log('geometry-first analyser contract tests passed.');
