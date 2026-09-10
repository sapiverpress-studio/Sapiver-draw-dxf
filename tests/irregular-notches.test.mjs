import assert from 'node:assert/strict';
import { compileSourceGeometry } from '../core/geometry.js';
import { buildDxf } from '../core/dxf.js';

const dim = (id, valueMm, reference='size', fromEdge='unknown') => ({ id, label:id, valueMm, reference, fromEdge, confirmed:true });

const rectangle = {
  dimensions:[dim('w',500),dim('h',300),dim('cw',50),dim('cd',40),dim('no',150,'edge','left'),dim('nw',60),dim('nd',30)],
  analysis:{parts:[{id:'panel',label:'Notched panel',profile:{type:'rectangle',width_dimension_id:'w',height_dimension_id:'h'},features:[
    {id:'corner',type:'corner_notch',quantity:1,corner:'bottom-left',width_dimension_id:'cw',depth_dimension_id:'cd'},
    {id:'notch',type:'edge_notch',quantity:1,touching_edge:'bottom',offset_dimension_id:'no',width_dimension_id:'nw',depth_dimension_id:'nd'},
  ]}]},
};

const notched = compileSourceGeometry(rectangle);
assert.equal(notched.ok,true,notched.errors.join('\n'));
assert.equal(notched.parts[0].entities.length,1,'edge removals must be incorporated into one continuous outer perimeter');
const points=notched.parts[0].entities[0].points;
for(const expected of [[0,40],[50,40],[50,0],[150,0],[150,30],[210,30],[210,0]]) {
  assert.ok(points.some((p)=>Math.abs(p.x-expected[0])<0.001&&Math.abs(p.y-expected[1])<0.001),`missing perimeter point ${expected}`);
}
const dxf=buildDxf(notched.parts[0].entities);
assert.equal((dxf.match(/\r\nPOLYLINE\r\n/g)||[]).length,1,'notched panel DXF must contain one outer polyline');

const right=Math.hypot(20,300);
const irregular={
  dimensions:[dim('top',480),dim('bottom',500),dim('left',300),dim('right',right)],
  analysis:{parts:[{id:'quad',label:'Out-of-square panel',profile:{type:'quadrilateral',top_dimension_id:'top',bottom_dimension_id:'bottom',left_dimension_id:'left',right_dimension_id:'right',right_angle_corners:['bottom-left','top-left']},features:[]}]},
};
const compiled=compileSourceGeometry(irregular);
assert.equal(compiled.ok,true,compiled.errors.join('\n'));
assert.equal(compiled.parts[0].profile.type,'quadrilateral');
assert.ok(Math.abs(compiled.parts[0].bounds.width-500)<0.001);
assert.ok(Math.abs(compiled.parts[0].bounds.height-300)<0.001);

const contradictory=structuredClone(irregular);
contradictory.analysis.parts[0].profile.right_angle_corners=['bottom-left','bottom-right'];
const blocked=compileSourceGeometry(contradictory);
assert.equal(blocked.ok,false);
assert.ok(blocked.errors.some((error)=>error.includes('second 90° indication conflicts')));

console.log('irregular panel and notch geometry tests passed.');
