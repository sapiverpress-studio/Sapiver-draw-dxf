import assert from 'node:assert/strict';
import { compileSourceGeometry } from '../core/geometry.js';
import { buildDxf } from '../core/dxf.js';
import { repairGeometryLinks, reviewStats } from '../core/review-model.js';

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

const photographedStep = {
  dimensions:[
    {id:'ow',label:'Overall panel width along bottom edge',role:'overall',valueMm:1500,reference:'size',fromEdge:'unknown',confirmed:true},
    {id:'oh',label:'Overall panel height at left edge',role:'overall',valueMm:500,reference:'size',fromEdge:'unknown',confirmed:true},
    {id:'nw',label:'Top-right corner-notch horizontal width',role:'size',valueMm:500,reference:'size',fromEdge:'unknown',confirmed:true},
    {id:'nd',label:'Top-right corner-notch vertical depth',role:'size',valueMm:250,reference:'size',fromEdge:'unknown',confirmed:true},
    {id:'sw',label:'Socket width',role:'size',valueMm:130,reference:'size',fromEdge:'unknown',confirmed:true},
    {id:'sh',label:'Socket height',role:'size',valueMm:75,reference:'size',fromEdge:'unknown',confirmed:true},
    {id:'sx',label:'Socket X',role:'position',valueMm:100,reference:'edge',fromEdge:'left',confirmed:true},
    {id:'sy',label:'Socket Y',role:'position',valueMm:100,reference:'edge',fromEdge:'bottom',confirmed:true},
  ],
  analysis:{parts:[{id:'step',label:'Stepped panel',profile:{type:'irregular',width_mm:null,height_mm:null,width_dimension_id:null,height_dimension_id:null},features:[
    {id:'Top-right corner cut-out',type:'corner_notch',quantity:1,corner:'top-right',width_mm:500,depth_mm:250,width_dimension_id:null,depth_dimension_id:null},
    {id:'Socket cut-out 1',type:'rectangular_cutout',quantity:1,width_mm:130,height_mm:75,x_mm:100,y_mm:100,x_reference:'edge',x_from_edge:'left',y_reference:'edge',y_from_edge:'bottom',width_dimension_id:null,height_dimension_id:null,x_dimension_id:null,y_dimension_id:null},
  ]}]},
};
repairGeometryLinks(photographedStep);
assert.equal(photographedStep.analysis.parts[0].profile.type, 'rectangle', 'a figured stepped envelope must repair to a base rectangle');
assert.equal(reviewStats(photographedStep).total, 8, 'stepped panel must retain perimeter, corner cut-out and socket logic');
const photographedGeometry = compileSourceGeometry(photographedStep);
assert.equal(photographedGeometry.ok, true, photographedGeometry.errors.join('\n'));
assert.equal(photographedGeometry.parts[0].entities.length, 2, 'DXF geometry must contain one notched outline and one socket cut-out');
assert.ok(photographedGeometry.parts[0].entities[0].points.some((point) => point.x === 1000 && point.y === 250), 'top-right step must be present in the outline');

const taperedPhoto = {
  dimensions:[
    dim('bottom',1750), dim('left',550), dim('right',600), dim('notch-width',30), dim('notch-depth',30),
  ],
  analysis:{parts:[{id:'tapered-step',label:'Tapered stepped panel',profile:{
    type:'quadrilateral',top_mm:null,bottom_mm:1750,left_mm:550,right_mm:600,
    top_dimension_id:null,bottom_dimension_id:'bottom',left_dimension_id:'left',right_dimension_id:'right',
    right_angle_corners:['bottom-left','bottom-right'],
  },features:[{id:'Top-right corner cut-out',type:'corner_notch',quantity:1,corner:'top-right',width_mm:30,depth_mm:30,width_dimension_id:'notch-width',depth_dimension_id:'notch-depth'}]}]},
};
repairGeometryLinks(taperedPhoto);
assert.equal(reviewStats(taperedPhoto).total,5,'derived tapered top must not request an invented top measurement');
const taperedGeometry=compileSourceGeometry(taperedPhoto);
assert.equal(taperedGeometry.ok,true,taperedGeometry.errors.join('\n'));
assert.equal(Math.round(taperedGeometry.parts[0].profile.lengths.top*100)/100,1750.71,'top length must be derived from confirmed constraints');
assert.deepEqual(taperedGeometry.parts[0].profile.points.slice(0,4),[{x:0,y:0},{x:1750,y:0},{x:1750,y:600},{x:0,y:550}]);
const taperedDxf=buildDxf(taperedGeometry.parts[0].entities);
assert.equal((taperedDxf.match(/\r\nPOLYLINE\r\n/g)||[]).length,1,'tapered notched panel must export as one continuous DXF perimeter');
assert.match(taperedDxf,/\r\n10\r\n1750\r\n20\r\n570\r\n/,'30 mm top-right notch must lower the confirmed 600 mm right side to 570 mm');

const unlinkedPhotoAnalysis = {
  dimensions:[
    {id:'photo-bottom',label:'Overall horizontal width / bottom edge of p1',role:'overall',valueMm:1750,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'photo-left',label:'Left vertical side of p1',role:'size',valueMm:550,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'photo-right',label:'Right vertical side from bottom to top ledge of p1',role:'size',valueMm:600,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'photo-notch-width',label:'Top-right corner notch horizontal width',role:'size',valueMm:30,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'photo-notch-depth',label:'Top-right corner notch vertical depth',role:'size',valueMm:30,reference:'size',fromEdge:'unknown',confirmed:false},
  ],
  analysis:{parts:[{id:'p1',label:'p1',profile:{type:'irregular',right_angle_corners:['bottom-left','bottom-right']},features:[
    {id:'Top-right corner notch',type:'corner_notch',quantity:1,corner:'top-right',width_mm:null,depth_mm:null,width_dimension_id:null,depth_dimension_id:null},
  ]}]},
};
repairGeometryLinks(unlinkedPhotoAnalysis);
const repairedPhotoProfile=unlinkedPhotoAnalysis.analysis.parts[0].profile;
assert.equal(repairedPhotoProfile.type,'quadrilateral','two conventional bottom square marks must repair the tapered profile');
assert.equal(repairedPhotoProfile.bottom_dimension_id,'photo-bottom');
assert.equal(repairedPhotoProfile.left_dimension_id,'photo-left');
assert.equal(repairedPhotoProfile.right_dimension_id,'photo-right');
assert.equal(unlinkedPhotoAnalysis.analysis.parts[0].features[0].width_dimension_id,'photo-notch-width','obvious notch width must auto-link');
assert.equal(unlinkedPhotoAnalysis.analysis.parts[0].features[0].depth_dimension_id,'photo-notch-depth','obvious notch depth must auto-link');
assert.equal(reviewStats(unlinkedPhotoAnalysis).total,5);

const doubleShoulderPhoto = {
  dimensions:[
    {id:'ds-bottom',label:'p1.profile.bottom',role:'overall',valueMm:1850,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'ds-left',label:'p1.profile.left shoulder height',role:'size',valueMm:600,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'ds-right',label:'p1.profile.right shoulder height',role:'size',valueMm:610,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'ds-lw',label:'Top-left notch horizontal width',role:'size',valueMm:14,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'ds-ld',label:'Top-left notch vertical rise',role:'size',valueMm:20,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'ds-rw',label:'Top-right notch horizontal width',role:'size',valueMm:25,reference:'size',fromEdge:'unknown',confirmed:false},
    {id:'ds-rd',label:'Top-right notch vertical depth',role:'size',valueMm:35,reference:'size',fromEdge:'unknown',confirmed:false},
  ],
  analysis:{parts:[{id:'double-shoulder',label:'Double shoulder tapered panel',profile:{type:'irregular',right_angle_corners:[]},features:[
    {id:'Left top notch',type:'corner_notch',quantity:1,corner:'top-left',width_mm:null,depth_mm:null,width_dimension_id:null,depth_dimension_id:null},
    {id:'Right top notch',type:'corner_notch',quantity:1,corner:'top-right',width_mm:null,depth_mm:null,width_dimension_id:null,depth_dimension_id:null},
  ]}]},
};
repairGeometryLinks(doubleShoulderPhoto);
const doubleShoulderPart=doubleShoulderPhoto.analysis.parts[0];
assert.equal(doubleShoulderPart.profile.type,'quadrilateral','two upper shoulder notches must repair to deterministic tapered geometry');
assert.equal(doubleShoulderPart.profile.side_heights_to_notch_shoulders,true);
assert.equal(doubleShoulderPart.profile.bottom_dimension_id,'ds-bottom');
assert.equal(doubleShoulderPart.profile.left_dimension_id,'ds-left');
assert.equal(doubleShoulderPart.profile.right_dimension_id,'ds-right');
assert.equal(doubleShoulderPart.features[0].width_dimension_id,'ds-lw');
assert.equal(doubleShoulderPart.features[0].depth_dimension_id,'ds-ld');
assert.equal(doubleShoulderPart.features[1].width_dimension_id,'ds-rw');
assert.equal(doubleShoulderPart.features[1].depth_dimension_id,'ds-rd');
assert.equal(reviewStats(doubleShoulderPhoto).total,7,'only the seven figured production measurements should require confirmation');
for (const dimension of doubleShoulderPhoto.dimensions) dimension.confirmed=true;
const doubleShoulderGeometry=compileSourceGeometry(doubleShoulderPhoto);
assert.equal(doubleShoulderGeometry.ok,true,doubleShoulderGeometry.errors.join('\n'));
const doubleShoulderPoints=doubleShoulderGeometry.parts[0].entities[0].points;
assert.deepEqual(doubleShoulderPoints,[
  {x:0,y:0},{x:1850,y:0},{x:1850,y:610},{x:1825,y:610},
  {x:1825,y:645},{x:14,y:620},{x:14,y:600},{x:0,y:600},
]);
assert.equal((buildDxf(doubleShoulderGeometry.parts[0].entities).match(/\r\nPOLYLINE\r\n/g)||[]).length,1,'double-shoulder panel must export as one continuous DXF perimeter');

const generatedDemo={
  dimensions:[dim('bottom-1800',1800),dim('right-650',650),dim('right-notch-150',150),dim('right-notch-100',100),dim('left-notch-80',80),dim('left-notch-120',120),dim('left-600',600),
    dim('rect-w',140),dim('rect-h',80),dim('rect-x',250,'centre','left'),dim('rect-y',120,'centre','bottom'),
    dim('hole-d',30),dim('hole-x',1000,'centre','left'),dim('hole-y',200,'centre','bottom'),
    dim('slot-w',100),dim('slot-h',30),dim('slot-x',300,'centre','right'),dim('slot-y',250,'centre','bottom')],
  analysis:{parts:[{id:'demo',label:'Mixed-step tapered demonstration',profile:{type:'path',boundary_segments:[
    {id:'bottom',label:'Bottom width',kind:'horizontal',direction:'right',dimension_id:'bottom-1800'},
    {id:'right-side',label:'Right outer side',kind:'vertical',direction:'up',dimension_id:'right-650'},
    {id:'right-notch-width',label:'Right notch width',kind:'horizontal',direction:'left',dimension_id:'right-notch-150'},
    {id:'right-notch-depth',label:'Right notch depth',kind:'vertical',direction:'up',dimension_id:'right-notch-100'},
    {id:'sloping-top',label:'Calculated sloping top',kind:'connect',direction:'connect',dimension_id:null},
    {id:'left-notch-depth',label:'Left notch depth',kind:'vertical',direction:'up',dimension_id:'left-notch-80'},
    {id:'left-notch-width',label:'Left notch width',kind:'horizontal',direction:'left',dimension_id:'left-notch-120'},
    {id:'left-side',label:'Left outer side',kind:'vertical',direction:'down',dimension_id:'left-600'},
  ]},features:[
    {id:'socket',type:'rectangular_cutout',quantity:1,width_dimension_id:'rect-w',height_dimension_id:'rect-h',x_dimension_id:'rect-x',y_dimension_id:'rect-y'},
    {id:'hole',type:'circular_hole',quantity:1,diameter_dimension_id:'hole-d',x_dimension_id:'hole-x',y_dimension_id:'hole-y'},
    {id:'slot',type:'slot',quantity:1,width_dimension_id:'slot-w',height_dimension_id:'slot-h',x_dimension_id:'slot-x',y_dimension_id:'slot-y'},
  ]}]},
};
const generatedDemoGeometry=compileSourceGeometry(generatedDemo);
assert.equal(generatedDemoGeometry.ok,true,generatedDemoGeometry.errors.join('\n'));
assert.deepEqual(generatedDemoGeometry.parts[0].entities[0].points,[
  {x:0,y:0},{x:1800,y:0},{x:1800,y:650},{x:1650,y:650},{x:1650,y:750},{x:120,y:520},{x:120,y:600},{x:0,y:600},
]);
assert.equal(generatedDemoGeometry.parts[0].entities.length,4,'mixed perimeter plus rectangle, hole and slot must compile');
assert.equal((buildDxf(generatedDemoGeometry.parts[0].entities).match(/\r\nPOLYLINE\r\n/g)||[]).length,3,'DXF must contain outer path, rectangle and slot polylines');
assert.ok(Math.abs(compiled.parts[0].bounds.width-500)<0.001);
assert.ok(Math.abs(compiled.parts[0].bounds.height-300)<0.001);

const contradictory=structuredClone(irregular);
contradictory.analysis.parts[0].profile.right_angle_corners=['bottom-left','bottom-right'];
const blocked=compileSourceGeometry(contradictory);
assert.equal(blocked.ok,false);
assert.ok(blocked.errors.some((error)=>error.includes('second 90° indication conflicts')));

console.log('irregular panel and notch geometry tests passed.');
