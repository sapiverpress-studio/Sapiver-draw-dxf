import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileSourceGeometry } from '../core/geometry.js';
import { buildDxf } from '../core/dxf.js';

const dim = (id, valueMm, reference = 'size', fromEdge = 'unknown') => ({ id, label:id, role:reference === 'size' ? 'size' : 'position', valueMm, reference, fromEdge, confirmed:true });
const feature = (id, type, values = {}) => ({ id, type, quantity:1, ...values });
const source = (profile, dimensions, features = []) => ({ dimensions, analysis:{parts:[{id:'p1',label:'Internet reference panel',profile,features}]}});
const rectangle = (w = 1000, h = 600) => ({type:'rectangle',width_dimension_id:'w',height_dimension_id:'h',width_mm:w,height_mm:h});

const cases = [
  {name:'01 plain rectangular panel',source:'One Day Glass shape catalogue',expected:'supported',data:source(rectangle(),[dim('w',1000),dim('h',600)])},
  {name:'02 rectangular internal socket cut-out',source:'G.James processing diagram',expected:'supported',data:source(rectangle(),[dim('w',1000),dim('h',600),dim('fw',130),dim('fh',75),dim('fx',200,'edge','left'),dim('fy',100,'edge','bottom')],[feature('socket','rectangular_cutout',{width_dimension_id:'fw',height_dimension_id:'fh',x_dimension_id:'fx',y_dimension_id:'fy'})])},
  {name:'03 two circular handle holes',source:'QIC glass preparation drawing',expected:'supported',data:source(rectangle(500,300),[dim('w',500),dim('h',300),dim('d1',17),dim('x1',47.5,'centre','left'),dim('y1',35,'centre','bottom'),dim('d2',17),dim('x2',102.5,'centre','left'),dim('y2',35,'centre','bottom')],[feature('hole-1','circular_hole',{diameter_dimension_id:'d1',x_dimension_id:'x1',y_dimension_id:'y1'}),feature('hole-2','circular_hole',{diameter_dimension_id:'d2',x_dimension_id:'x2',y_dimension_id:'y2'})])},
  {name:'04 capsule slot cut-out',source:'CRL Z-series fabrication template',expected:'supported',data:source(rectangle(400,300),[dim('w',400),dim('h',300),dim('sw',54),dim('sh',14),dim('sx',100,'centre','left'),dim('sy',100,'centre','bottom')],[feature('slot','slot',{width_dimension_id:'sw',height_dimension_id:'sh',x_dimension_id:'sx',y_dimension_id:'sy'})])},
  {name:'05 square top-right corner cut-out',source:'Order Glass notch guide',expected:'supported',data:source(rectangle(),[dim('w',1000),dim('h',600),dim('nw',120),dim('nd',80)],[feature('corner','corner_notch',{corner:'top-right',width_dimension_id:'nw',depth_dimension_id:'nd'})])},
  {name:'06 rectangular side-edge notch',source:'Haynes Glass notch detail',expected:'supported',data:source(rectangle(),[dim('w',1000),dim('h',600),dim('no',200),dim('nw',64),dim('nd',44)],[feature('edge-notch','edge_notch',{touching_edge:'right',offset_dimension_id:'no',width_dimension_id:'nw',depth_dimension_id:'nd'})])},
  {name:'07 L-shaped panel',source:'Glasstops UK L-shape guide',expected:'supported',data:source(rectangle(1200,700),[dim('w',1200),dim('h',700),dim('nw',400),dim('nd',250)],[feature('L-return','corner_notch',{corner:'top-right',width_dimension_id:'nw',depth_dimension_id:'nd'})])},
  {name:'08 tapered panel with two square marks and corner cut-out',source:'Halifax supplied convention plus Interglas slope examples',expected:'supported',data:source({type:'quadrilateral',top_mm:null,bottom_mm:1750,left_mm:550,right_mm:600,top_dimension_id:null,bottom_dimension_id:'b',left_dimension_id:'l',right_dimension_id:'r',right_angle_corners:['bottom-left','bottom-right']},[dim('b',1750),dim('l',550),dim('r',600),dim('nw',30),dim('nd',30)],[feature('corner','corner_notch',{corner:'top-right',width_dimension_id:'nw',depth_dimension_id:'nd'})])},
  {name:'09 single-slope quadrilateral with one square corner',source:'Interglas trapezoid diagram',expected:'supported',data:source({type:'quadrilateral',top_dimension_id:'t',bottom_dimension_id:'b',left_dimension_id:'l',right_dimension_id:'r',right_angle_corners:['bottom-left']},[dim('t',900),dim('b',1000),dim('l',500),dim('r',Math.hypot(100,500))])},
  {name:'10 slanted parallelogram without a figured angle',source:'One Day Glass shape catalogue',expected:'blocked',data:source({type:'quadrilateral',top_dimension_id:'t',bottom_dimension_id:'b',left_dimension_id:'l',right_dimension_id:'r',right_angle_corners:[]},[dim('t',1000),dim('b',1000),dim('l',500),dim('r',500)])},
  {name:'11 clipped-corner pentagon',source:'Interglas chamfered-corner diagram',expected:'blocked',data:source({type:'polygon'},[dim('w',1000),dim('h',600)])},
  {name:'12 double-angle six-sided panel',source:'Glasstops UK double-angle guide',expected:'blocked',data:source({type:'irregular'},[dim('w',1200),dim('h',700)])},
  {name:'13 radiused rectangular edge notch',source:'Haynes Glass notch detail',expected:'blocked',data:source(rectangle(),[dim('w',1000),dim('h',600),dim('no',200),dim('nw',64),dim('nd',44),dim('nr',10)],[feature('radiused-notch','edge_notch',{touching_edge:'right',offset_dimension_id:'no',width_dimension_id:'nw',depth_dimension_id:'nd',radius_dimension_id:'nr',radius_mm:10})])},
  {name:'14 radiused patch-fitting cut-out plus hole',source:'Dormakaba PT20 preparation drawing',expected:'blocked',data:source(rectangle(),[dim('w',1000),dim('h',600),dim('rw',161),dim('rh',73),dim('rx',0,'edge','left'),dim('ry',0,'edge','bottom')],[feature('radiused-patch','other',{width_dimension_id:'rw',height_dimension_id:'rh',x_dimension_id:'rx',y_dimension_id:'ry'})])},
  {name:'15 half-circle profile with notch',source:'One Day Glass shape catalogue',expected:'blocked',data:source({type:'irregular'},[dim('w',1000),dim('h',500),dim('nw',100),dim('nd',60)],[feature('edge-notch','edge_notch',{touching_edge:'bottom',offset_dimension_id:'no',width_dimension_id:'nw',depth_dimension_id:'nd'})])},
];

const results = [];
for (const test of cases) {
  const geometry = compileSourceGeometry(test.data);
  const actual = geometry.ok ? 'supported' : 'blocked';
  assert.equal(actual, test.expected, `${test.name}: ${geometry.errors.join(' | ')}`);
  if (geometry.ok) {
    const dxf = buildDxf(geometry.parts.flatMap((part) => part.entities));
    assert.match(dxf, /SECTION/, `${test.name}: DXF output missing`);
  } else {
    assert.ok(geometry.errors.length, `${test.name}: blocked geometry needs an explicit reason`);
  }
  const issue = geometry.ok && test.risk ? test.risk : null;
  results.push({name:test.name,reference:test.source,result:actual,reason:geometry.errors[0] || 'DXF generated',issue});
}

const prompt = fs.readFileSync(new URL('../netlify/functions/_quick-dxf-analysis.mjs', import.meta.url), 'utf8');
assert.match(prompt,/small square[\s\S]*explicit 90-degree indication/i,'AI prompt must recognise square right-angle marks');
assert.match(prompt,/bottom length, left height and right height[\s\S]*both bottom corners/i,'AI prompt must recognise constrained tapered panels without a written top length');

console.log(JSON.stringify({total:results.length,supported:results.filter((r)=>r.result==='supported').length,blocked:results.filter((r)=>r.result==='blocked').length,issues:results.filter((r)=>r.issue).length,results},null,2));
