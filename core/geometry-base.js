import * as legacy from './geometry-legacy.js';
import { arcFromChord, buildCurvedPath, buildRoundedRectangle, entitySamplePoints, lineEntity, translateEntity } from './curves.js';

const EPS = 1e-6;

function point(x, y) { return { x:Number(x), y:Number(y) }; }
function finitePositive(value) { return Number.isFinite(Number(value)) && Number(value) > 0; }
function hasCurvePart(part) {
  const profile=part?.profile||{};
  return (profile.type==='rectangle' && Array.isArray(profile.corner_radii) && profile.corner_radii.length>0)
    || (profile.type==='path' && (profile.boundary_segments||[]).some((segment)=>['arc','quarter_arc','connect_arc'].includes(segment.kind)));
}
function hasRadiusedFeature(part) {
  return (part?.features||[]).some((feature)=>['rectangular_cutout','corner_notch','edge_notch'].includes(feature?.type)&&(finitePositive(feature?.radius_mm)||Boolean(feature?.radius_dimension_id)));
}
function hasRadiusedBoundaryFeature(part){return (part?.features||[]).some((feature)=>['corner_notch','edge_notch'].includes(feature?.type)&&(finitePositive(feature?.radius_mm)||Boolean(feature?.radius_dimension_id)));}
function hasCurveGeometry(source) { return (source?.analysis?.parts||[]).some((part)=>hasCurvePart(part)||hasRadiusedFeature(part)); }

function resolveDimension(dimensionMap,id,label,errors,{position=false}={}) {
  if(!id){ errors.push(`${label}: AI did not link a figured dimension to this geometry parameter.`); return null; }
  const d=dimensionMap.get(id);
  if(!d){ errors.push(`${label}: linked dimension ${id} is missing from the review list.`); return null; }
  if(!d.confirmed || !finitePositive(d.valueMm)){ errors.push(`${label}: dimension ${d.label||d.id} has not been confirmed with a positive value.`); return null; }
  if(position){
    if(!['centre','edge'].includes(d.reference)){ errors.push(`${label}: position must be confirmed as CENTRE or EDGE.`); return null; }
    if(!['left','right','top','bottom'].includes(d.fromEdge)){ errors.push(`${label}: position must identify the outer edge it is measured from.`); return null; }
  }
  return d;
}
function axisCentre(total,span,d,axis,label,errors){
  const allowed=axis==='x'?['left','right']:['bottom','top'];
  if(!allowed.includes(d.fromEdge)){ errors.push(`${label}: ${axis.toUpperCase()} position cannot be measured from ${String(d.fromEdge).toUpperCase()}.`); return null; }
  const low=axis==='x'?d.fromEdge==='left':d.fromEdge==='bottom';
  const value=Number(d.valueMm);
  const centre=d.reference==='centre' ? (low?value:total-value) : d.reference==='edge' ? (low?value+span/2:total-value-span/2) : null;
  if(centre==null || centre<span/2-EPS || centre>total-span/2+EPS){ errors.push(`${label}: confirmed position places the feature outside the part boundary.`); return null; }
  return centre;
}
function rectanglePoints(x,y,width,height){ return [point(x,y),point(x+width,y),point(x+width,y+height),point(x,y+height)]; }
function capsulePoints(cx,cy,width,height,segments=18){
  if(!(width>0&&height>0)) throw new Error('Slot width and height must be positive.');
  const pts=[];
  if(Math.abs(width-height)<EPS){ const r=width/2; for(let i=0;i<segments*2;i++){const a=Math.PI*2*i/(segments*2);pts.push(point(cx+r*Math.cos(a),cy+r*Math.sin(a)));} return pts; }
  if(width>height){
    const r=height/2,h=(width-height)/2,lx=cx-h,rx=cx+h;
    for(let i=0;i<=segments;i++){const a=-Math.PI/2+Math.PI*i/segments;pts.push(point(rx+r*Math.cos(a),cy+r*Math.sin(a)));}
    for(let i=0;i<=segments;i++){const a=Math.PI/2+Math.PI*i/segments;pts.push(point(lx+r*Math.cos(a),cy+r*Math.sin(a)));}
  } else {
    const r=width/2,h=(height-width)/2,by=cy-h,ty=cy+h;
    for(let i=0;i<=segments;i++){const a=Math.PI*i/segments;pts.push(point(cx+r*Math.cos(a),ty+r*Math.sin(a)));}
    for(let i=0;i<=segments;i++){const a=Math.PI+Math.PI*i/segments;pts.push(point(cx+r*Math.cos(a),by+r*Math.sin(a)));}
  }
  return pts;
}
function pointInPolygon(p,polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if(((a.y>p.y)!==(b.y>p.y)) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
function entitySamples(entity){
  if(entity.type==='circle') return Array.from({length:32},(_,i)=>point(entity.cx+entity.r*Math.cos(i*Math.PI/16),entity.cy+entity.r*Math.sin(i*Math.PI/16)));
  return entitySamplePoints(entity);
}
function boundsFromPoints(points){
  const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
  return {minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys)};
}
function entityBounds(entity){ return boundsFromPoints(entitySamples(entity)); }
function checkInside(points,entity,label,errors){ if(entitySamples(entity).some((p)=>!pointInPolygon(p,points))) errors.push(`${label}: confirmed feature extends outside the curved panel boundary.`); }

function confirmedNotchRadius(feature,dimensionMap,label,errors){
  const rd=resolveDimension(dimensionMap,feature.radius_dimension_id,`${label} / ${feature.id} internal radius`,errors); if(!rd)return null;
  const radius=Number(rd.valueMm),finish=String(feature.cutout_finish||'unknown').toLowerCase();
  if(!feature.cutout_finish_confirmed||!['polished','unpolished'].includes(finish)){errors.push(`${label} / ${feature.id}: confirm whether the radiused notch is polished/CNC or unpolished.`);return null;}
  const minimum=finish==='polished'?15:6;
  if(radius<minimum-EPS){errors.push(`${label} / ${feature.id}: confirmed internal radius R${radius} is below Halifax Glass's ${minimum} mm minimum for a ${finish==='polished'?'polished/CNC':'unpolished'} notch.`);return null;}
  return radius;
}

function nearestVertex(points,target,used,tolerance=0.02){
  let best=-1,distance=Infinity;
  points.forEach((p,index)=>{const d=Math.hypot(p.x-target.x,p.y-target.y);if(!used.has(index)&&d<distance){best=index;distance=d;}});
  return distance<=tolerance?best:-1;
}

function filletPolyline(points,radii,label,errors){
  const count=points.length,entry=[],exit=[];
  for(let i=0;i<count;i++){
    const v=points[i],prev=points[(i+count-1)%count],next=points[(i+1)%count],radius=Number(radii.get(i)||0);
    if(!radius){entry[i]=v;exit[i]=v;continue;}
    const lp=Math.hypot(prev.x-v.x,prev.y-v.y),ln=Math.hypot(next.x-v.x,next.y-v.y);
    if(radius>=lp-EPS||radius>=ln-EPS){errors.push(`${label}: radius R${radius} does not fit the adjacent notch legs.`);return null;}
    entry[i]=point(v.x+(prev.x-v.x)/lp*radius,v.y+(prev.y-v.y)/lp*radius);
    exit[i]=point(v.x+(next.x-v.x)/ln*radius,v.y+(next.y-v.y)/ln*radius);
  }
  const entities=[],sample=[];
  for(let i=0;i<count;i++){
    const next=(i+1)%count;
    const edgeX=points[next].x-points[i].x,edgeY=points[next].y-points[i].y;
    const remainingX=entry[next].x-exit[i].x,remainingY=entry[next].y-exit[i].y;
    if(edgeX*remainingX+edgeY*remainingY<-EPS){errors.push(`${label}: adjacent notch radii overlap the available straight edge.`);return null;}
    if(Math.hypot(exit[i].x-entry[next].x,exit[i].y-entry[next].y)>EPS){const line=lineEntity(exit[i],entry[next],{role:'outer',label});entities.push(line);sample.push(...line.points);}
    const radius=Number(radii.get(next)||0); if(!radius)continue;
    const v=points[next],centre=point(entry[next].x+exit[next].x-v.x,entry[next].y+exit[next].y-v.y);
    const candidates=['left','right'].map((bulgeSide)=>arcFromChord(entry[next],exit[next],radius,{bulgeSide,extent:'minor',role:'outer',label:`${label} R${radius}`}));
    const arc=candidates.sort((a,b)=>Math.hypot(a.cx-centre.x,a.cy-centre.y)-Math.hypot(b.cx-centre.x,b.cy-centre.y))[0];
    entities.push(arc);sample.push(...entitySamplePoints(arc));
  }
  return {entities,points:sample};
}

function compileRadiusedBoundaryPart(part,source,dimensionMap,errors){
  const label=part.label||part.id||'Part',profile=part.profile||{};
  const errorCount=errors.length;
  if(profile.type!=='rectangle'){errors.push(`${label}: radiused boundary notches on ${profile.type||'unknown'} profiles are not yet supported deterministically.`);return null;}
  const stripped=structuredClone(part);
  for(const feature of stripped.features||[])if(['corner_notch','edge_notch'].includes(feature.type)){feature.radius_mm=null;feature.radius_dimension_id=null;}
  const sharp=legacy.compileSourceGeometry({...source,analysis:{...(source.analysis||{}),parts:[stripped]}});
  if(!sharp.ok){errors.push(...sharp.errors);return null;}
  const compiled=sharp.parts[0],outer=compiled.entities.find((entity)=>entity.role==='outer'&&entity.type==='polyline');
  if(!outer){errors.push(`${label}: could not construct the sharp notch boundary before applying radii.`);return null;}
  const width=compiled.profile.width,height=compiled.profile.height,radii=new Map(),used=new Set();
  for(const feature of part.features||[]){
    if(!['corner_notch','edge_notch'].includes(feature.type)||!(feature.radius_dimension_id||finitePositive(feature.radius_mm)))continue;
    const radius=confirmedNotchRadius(feature,dimensionMap,label,errors);if(!radius)continue;
    const wd=resolveDimension(dimensionMap,feature.width_dimension_id,`${label} / ${feature.id} width`,errors),dd=resolveDimension(dimensionMap,feature.depth_dimension_id,`${label} / ${feature.id} depth`,errors);if(!wd||!dd)continue;
    const w=Number(wd.valueMm),d=Number(dd.valueMm),targets=[];
    if(feature.type==='corner_notch'){
      const target={'bottom-left':point(w,d),'bottom-right':point(width-w,d),'top-right':point(width-w,height-d),'top-left':point(w,height-d)}[feature.corner];
      if(target)targets.push(target);
    }else{
      const od=resolveDimension(dimensionMap,feature.offset_dimension_id,`${label} / ${feature.id} position`,errors);if(!od)continue;const o=Number(od.valueMm);
      if(feature.touching_edge==='bottom')targets.push(point(o,d),point(o+w,d));
      if(feature.touching_edge==='top')targets.push(point(o,height-d),point(o+w,height-d));
      if(feature.touching_edge==='left')targets.push(point(d,o),point(d,o+w));
      if(feature.touching_edge==='right')targets.push(point(width-d,o),point(width-d,o+w));
    }
    for(const target of targets){const index=nearestVertex(outer.points,target,used);if(index<0)errors.push(`${label} / ${feature.id}: could not match the confirmed notch radius to its internal corner.`);else{radii.set(index,radius);used.add(index);}}
  }
  if(errors.length>errorCount)return null;
  const rounded=filletPolyline(outer.points,radii,label,errors);if(!rounded)return null;
  compiled.entities=[...rounded.entities,...compiled.entities.filter((entity)=>entity!==outer)];
  compiled.profile={...compiled.profile,points:rounded.points};
  return compiled;
}

function compileFeature(feature,profile,dimensionMap,compiledFeatures,label,errors){
  const prefix=`${label} / ${feature.id||feature.type}`;
  if(!['rectangular_cutout','circular_hole','slot'].includes(feature.type)){ errors.push(`${prefix}: ${feature.type} is not supported on a curved deterministic profile.`); return null; }
  let width,height,diameter=null,radius=0;
  if(feature.type==='circular_hole'){
    const d=resolveDimension(dimensionMap,feature.diameter_dimension_id,`${prefix} diameter`,errors); if(!d)return null;
    diameter=Number(d.valueMm); width=diameter; height=diameter;
  } else {
    const wd=resolveDimension(dimensionMap,feature.width_dimension_id,`${prefix} width`,errors);
    const hd=resolveDimension(dimensionMap,feature.height_dimension_id,`${prefix} height`,errors); if(!wd||!hd)return null;
    width=Number(wd.valueMm); height=Number(hd.valueMm);
    if(feature.radius_dimension_id||finitePositive(feature.radius_mm)){
      const rd=resolveDimension(dimensionMap,feature.radius_dimension_id,`${prefix} internal radius`,errors); if(!rd)return null;
      radius=Number(rd.valueMm);
      const finish=String(feature.cutout_finish||'unknown').toLowerCase();
      if(!feature.cutout_finish_confirmed||!['polished','unpolished'].includes(finish)){errors.push(`${prefix}: confirm whether the radiused cut-out is polished/CNC or unpolished.`);return null;}
      const minimum=finish==='polished'?15:6;
      if(radius<minimum-EPS){errors.push(`${prefix}: confirmed internal radius R${radius} is below Halifax Glass's ${minimum} mm minimum for a ${finish==='polished'?'polished/CNC':'unpolished'} cut-out.`);return null;}
      if(radius>Math.min(width,height)/2+EPS){errors.push(`${prefix}: confirmed internal radius R${radius} cannot fit inside a ${width} x ${height} mm cut-out.`);return null;}
    }
  }
  const xd=resolveDimension(dimensionMap,feature.x_dimension_id,`${prefix} X position`,errors,{position:true});
  const yd=resolveDimension(dimensionMap,feature.y_dimension_id,`${prefix} Y position`,errors,{position:true}); if(!xd||!yd)return null;
  const b=boundsFromPoints(profile.points), totalWidth=b.maxX-b.minX,totalHeight=b.maxY-b.minY;
  let cx;
  if(feature.x_relative_to_feature_id){
    const previous=compiledFeatures.get(feature.x_relative_to_feature_id); if(!previous){errors.push(`${prefix} X position: previous cut-out ${feature.x_relative_to_feature_id} is missing or invalid.`);return null;}
    cx=entityBounds(previous).maxX+Number(xd.valueMm)+width/2;
  } else cx=axisCentre(totalWidth,width,xd,'x',`${prefix} X position`,errors);
  const cy=axisCentre(totalHeight,height,yd,'y',`${prefix} Y position`,errors); if(cx==null||cy==null)return null;
  let entities,sampleEntity;
  if(feature.type==='circular_hole'){
    sampleEntity={type:'circle',cx,cy,r:diameter/2,role:'cut',label:feature.id||'Hole'}; entities=[sampleEntity];
  } else if(feature.type==='rectangular_cutout'&&radius>0){
    try{
      const rounded=buildRoundedRectangle(width,height,{
        'bottom-left':radius,'bottom-right':radius,'top-right':radius,'top-left':radius,
      },{label:feature.id||'Cut-out',role:'cut'});
      entities=rounded.entities.map((entity)=>({...translateEntity(entity,cx-width/2,cy-height/2),featureId:feature.id}));
      sampleEntity={type:'polyline',points:rounded.points.map((p)=>point(p.x+cx-width/2,p.y+cy-height/2)),closed:true,role:'cut',label:feature.id||'Cut-out'};
    }catch(error){errors.push(`${prefix}: ${error.message}`);return null;}
  } else if(feature.type==='rectangular_cutout'){
    sampleEntity={type:'polyline',points:rectanglePoints(cx-width/2,cy-height/2,width,height),closed:true,role:'cut',label:feature.id||'Cut-out'}; entities=[sampleEntity];
  } else {
    sampleEntity={type:'polyline',points:capsulePoints(cx,cy,width,height),closed:true,role:'cut',label:feature.id||'Slot'}; entities=[sampleEntity];
  }
  checkInside(profile.points,sampleEntity,prefix,errors);
  entities=entities.map((entity)=>({...entity,featureId:feature.id||null}));
  return {entities,sampleEntity};
}

function pointSegmentDistance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;if(length2<=EPS)return Math.hypot(p.x-a.x,p.y-a.y);
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length2));return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
}
function orientation(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function segmentsIntersect(a,b,c,d){
  const o1=orientation(a,b,c),o2=orientation(a,b,d),o3=orientation(c,d,a),o4=orientation(c,d,b);
  return ((o1>EPS&&o2<-EPS)||(o1<-EPS&&o2>EPS))&&((o3>EPS&&o4<-EPS)||(o3<-EPS&&o4>EPS));
}
function segmentDistance(a,b,c,d){return segmentsIntersect(a,b,c,d)?0:Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));}
function entitySegments(entity){
  if(entity.type!=='polyline')return[];const result=[];
  for(let i=0;i<entity.points.length-1;i++)result.push([entity.points[i],entity.points[i+1]]);
  if(entity.closed!==false&&entity.points.length>2)result.push([entity.points.at(-1),entity.points[0]]);
  return result;
}
function radialEntity(entity){return ['circle','arc'].includes(entity.type);}
function entityDistance(a,b){
  if(radialEntity(a)&&radialEntity(b))return Math.max(0,Math.hypot(a.cx-b.cx,a.cy-b.cy)-a.r-b.r);
  if(radialEntity(a)&&b.type==='polyline')return Math.max(0,Math.min(...entitySegments(b).map(([p,q])=>pointSegmentDistance(point(a.cx,a.cy),p,q)))-a.r);
  if(a.type==='polyline'&&radialEntity(b))return entityDistance(b,a);
  return Math.min(...entitySegments(a).flatMap(([p,q])=>entitySegments(b).map(([r,s])=>segmentDistance(p,q,r,s))));
}
function pointEntityDistance(p,entity){
  if(radialEntity(entity))return Math.max(0,Math.hypot(p.x-entity.cx,p.y-entity.cy)-entity.r);
  return Math.min(...entitySegments(entity).map(([a,b])=>pointSegmentDistance(p,a,b)));
}
function profileCorners(part){
  if(part.profile.type==='rectangle')return [point(0,0),point(part.profile.width,0),point(part.profile.width,part.profile.height),point(0,part.profile.height)];
  if(part.profile.type==='quadrilateral')return part.profile.points||[];
  // Curved paths do not have four reliable bounding-box "corners". Treating
  // that uncertainty as a hard production-manager gate prevented otherwise
  // valid, fully confirmed drawings from rendering or exporting. Edge
  // clearance is still checked below; corner clearance is checked only where
  // the geometry provides explicit, deterministic corners.
  if(part.profile.type==='path')return (part.profile.segments||[]).some((segment)=>['arc','connect_arc'].includes(segment.kind))?[]:(part.profile.points||[]);
  return [];
}
function validateToughenedSource(source,parts,errors){
  if(!source?.toughened)return;
  const thickness=Number(source.glassThicknessMm);
  if(!(thickness>0)){errors.push('Toughened glass: enter the confirmed glass thickness before DXF release.');return;}
  const edgeMinimum=1.5*thickness,cornerMinimum=4*thickness;
  for(let partIndex=0;partIndex<parts.length;partIndex++){
    const part=parts[partIndex],proposal=source.analysis?.parts?.[partIndex],outer=part.entities.filter((entity)=>entity.role==='outer'),corners=profileCorners(part);
    for(const feature of proposal?.features||[]){
      if(!['rectangular_cutout','circular_hole','slot'].includes(feature.type))continue;
      const featureEntities=part.entities.filter((entity)=>entity.role==='cut'&&(entity.featureId===feature.id||entity.label===feature.id));
      if(!featureEntities.length){errors.push(`${part.label} / ${feature.id}: toughened clearance could not be checked because its finished boundary was not identified.`);continue;}
      const edgeDistance=Math.min(...featureEntities.flatMap((cut)=>outer.map((boundary)=>entityDistance(cut,boundary))));
      if(edgeDistance<edgeMinimum-EPS)errors.push(`${part.label} / ${feature.id}: toughened clearance to the nearest glass edge is ${edgeDistance.toFixed(2)} mm; minimum is ${edgeMinimum.toFixed(2)} mm (1.5 × ${thickness} mm).`);
      if(corners?.length){
        const cornerDistance=Math.min(...corners.flatMap((corner)=>featureEntities.map((entity)=>pointEntityDistance(corner,entity))));
        if(cornerDistance<cornerMinimum-EPS)errors.push(`${part.label} / ${feature.id}: toughened clearance to the nearest panel corner is ${cornerDistance.toFixed(2)} mm; minimum is ${cornerMinimum.toFixed(2)} mm (4 × ${thickness} mm).`);
      }
    }
  }
}
function validateFeatureFinishes(source,errors){
  if(!source?.manufacturingControlsV1)return;
  for(const part of source.analysis?.parts||[])for(const feature of part.features||[]){
    if(!['rectangular_cutout','slot','corner_notch','edge_notch'].includes(feature.type))continue;
    if(!feature.cutout_finish_confirmed||!['polished','unpolished'].includes(feature.cutout_finish))errors.push(`${part.label||part.id||'Part'} / ${feature.id}: confirm whether the cut-out is polished or unpolished.`);
  }
}

function compileCurvedPart(part,dimensionMap,errors){
  const label=part.label||part.id||'Part', spec=part.profile||{};
  let profile,outerEntities;
  if(spec.type==='rectangle'){
    const wd=resolveDimension(dimensionMap,spec.width_dimension_id,`${label} overall width`,errors);
    const hd=resolveDimension(dimensionMap,spec.height_dimension_id,`${label} overall height`,errors); if(!wd||!hd)return null;
    const width=Number(wd.valueMm),height=Number(hd.valueMm),radii={};
    for(const radiusSpec of spec.corner_radii||[]){
      const d=resolveDimension(dimensionMap,radiusSpec.radius_dimension_id,`${label} ${radiusSpec.corner} corner radius`,errors); if(!d)return null;
      radii[radiusSpec.corner]=Number(d.valueMm);
    }
    if((spec.corner_radii||[]).length&&(part.features||[]).some((f)=>['corner_notch','edge_notch'].includes(f.type))){ errors.push(`${label}: rounded outer corners combined with boundary notches are not yet supported deterministically.`); return null; }
    try{
      const rounded=buildRoundedRectangle(width,height,radii,{label});
      profile={type:'rectangle',width,height,points:rounded.points,cornerRadii:rounded.radii}; outerEntities=rounded.entities;
    }catch(error){errors.push(error.message);return null;}
  } else if(spec.type==='path'){
    const compiled=[];
    for(const segment of spec.boundary_segments||[]){
      const name=`${label} / ${segment.label||segment.id||'perimeter segment'}`;
      if(['horizontal','vertical'].includes(segment.kind)){
        const d=resolveDimension(dimensionMap,segment.dimension_id,name,errors); if(!d)return null;
        compiled.push({...segment,length:Number(d.valueMm)});
      } else if(segment.kind==='quarter_arc'){
        const radius=resolveDimension(dimensionMap,segment.radius_dimension_id,`${name} radius`,errors); if(!radius)return null;
        if(!['left','right'].includes(segment.turn_direction)){errors.push(`${name}: quarter-arc turn direction is unresolved.`);return null;}
        compiled.push({...segment,radius:Number(radius.valueMm),turnDirection:segment.turn_direction});
      } else if(segment.kind==='arc'){
        const chord=resolveDimension(dimensionMap,segment.chord_dimension_id,`${name} chord`,errors);
        const radius=segment.radius_dimension_id?resolveDimension(dimensionMap,segment.radius_dimension_id,`${name} radius`,errors):null;
        const rise=segment.rise_dimension_id?resolveDimension(dimensionMap,segment.rise_dimension_id,`${name} rise`,errors):null;
        if(!chord||(!radius&&!rise)){if(!segment.radius_dimension_id&&!segment.rise_dimension_id)errors.push(`${name}: AI did not link a figured radius or rise to this arc.`);return null;}
        compiled.push({...segment,chord:Number(chord.valueMm),radius:radius?Number(radius.valueMm):null,rise:rise?Number(rise.valueMm):null,bulgeSide:segment.bulge_side,extent:segment.arc_extent});
      } else if(segment.kind==='connect_arc'){
        const radius=segment.radius_dimension_id?resolveDimension(dimensionMap,segment.radius_dimension_id,`${name} radius`,errors):null;
        const rise=segment.rise_dimension_id?resolveDimension(dimensionMap,segment.rise_dimension_id,`${name} rise`,errors):null;
        if(!radius&&!rise){if(!segment.radius_dimension_id&&!segment.rise_dimension_id)errors.push(`${name}: AI did not link a figured radius or rise to this closing arc.`);return null;}
        compiled.push({...segment,radius:radius?Number(radius.valueMm):null,rise:rise?Number(rise.valueMm):null,bulgeSide:segment.bulge_side,extent:segment.arc_extent});
      } else if(segment.kind==='connect') compiled.push({...segment});
      else {errors.push(`${name}: unsupported perimeter segment kind ${segment.kind||'unknown'}.`);return null;}
    }
    try{
      const curved=buildCurvedPath(compiled,{label});
      profile={type:'path',points:curved.points,segments:spec.boundary_segments||[]}; outerEntities=curved.entities;
    }catch(error){errors.push(`${label}: ${error.message}`);return null;}
  } else return null;

  const entities=[...outerEntities],compiledFeatures=new Map();
  for(const feature of part.features||[]){
    if(['corner_notch','edge_notch'].includes(feature.type)) continue;
    const quantity=Math.max(1,Number(feature.quantity)||1);
    if(quantity!==1){errors.push(`${label} / ${feature.id||feature.type}: repeated quantity ${quantity} needs individually located features before DXF release.`);continue;}
    const compiled=compileFeature(feature,profile,dimensionMap,compiledFeatures,label,errors);
    if(compiled){entities.push(...compiled.entities);compiledFeatures.set(feature.id,compiled.sampleEntity);}
  }
  const b=boundsFromPoints(profile.points),bounds={...b,width:b.maxX-b.minX,height:b.maxY-b.minY};
  return {id:part.id||label,label,profile,entities,bounds};
}

export function compileSourceGeometry(source){
  if(!hasCurveGeometry(source)){
    const result=legacy.compileSourceGeometry(source),errors=[...(result.errors||[])];
    validateFeatureFinishes(source,errors);
    validateToughenedSource(source,result.parts||[],errors);
    return {...result,ok:errors.length===0&&(result.parts||[]).length>0,errors:[...new Set(errors)]};
  }
  const errors=[];
  if(!source?.analysis) return {ok:false,errors:['No AI geometry proposal is available for this drawing.'],parts:[]};
  const dimensionMap=new Map((source.dimensions||[]).map((d)=>[d.id,d])),parts=[];
  for(const part of source.analysis.parts||[]){
    if(hasRadiusedBoundaryFeature(part)){
      const compiled=compileRadiusedBoundaryPart(part,source,dimensionMap,errors);if(compiled)parts.push(compiled);
    } else if(hasCurvePart(part)||hasRadiusedFeature(part)){
      const compiled=compileCurvedPart(part,dimensionMap,errors); if(compiled)parts.push(compiled);
    } else {
      const result=legacy.compileSourceGeometry({...source,analysis:{...source.analysis,parts:[part]}});
      if(result.ok) parts.push(...result.parts); else errors.push(...result.errors);
    }
  }
  validateFeatureFinishes(source,errors);
  validateToughenedSource(source,parts,errors);
  return {ok:errors.length===0&&parts.length>0,errors:[...new Set(errors)],parts};
}

function esc(value){return String(value).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function geometryToSvg(geometry,{width=900,height=600,padding=28,entityState=null}={}){
  if(!geometry?.parts?.some((part)=>part.entities?.some((entity)=>entity.type==='arc'))) return legacy.geometryToSvg(geometry,{width,height,padding});
  if(!geometry?.parts?.length)return '';
  const cols=geometry.parts.length>1?2:1,rows=Math.ceil(geometry.parts.length/cols),cellW=width/cols,cellH=height/rows;
  const chunks=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Confirmed manufacturing geometry">`,'<rect width="100%" height="100%" fill="white"/>'];
  geometry.parts.forEach((part,index)=>{
    const x0=(index%cols)*cellW,y0=Math.floor(index/cols)*cellH,labelH=30,availW=cellW-padding*2,availH=cellH-padding*2-labelH;
    const scale=Math.min(availW/part.bounds.width,availH/part.bounds.height),ox=x0+(cellW-part.bounds.width*scale)/2,oy=y0+labelH+(availH-part.bounds.height*scale)/2+padding;
    chunks.push(`<text x="${x0+padding}" y="${y0+22}" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#111827">${esc(part.label)}</text>`);
    chunks.push(`<g transform="translate(${ox} ${oy+part.bounds.height*scale}) scale(${scale} ${-scale})" fill="none" vector-effect="non-scaling-stroke">`);
    for(const entity of part.entities){
      const sw=(entity.role==='outer'?2:1.4)/scale;
      const state=typeof entityState==='function'?entityState(entity,part):'confirmed';
      const pending=state==='pending',style=`data-state="${pending?'pending':'confirmed'}" stroke="${pending?'#98a2b3':'#00549f'}" ${pending?'stroke-dasharray="8 6"':''}`;
      if(entity.type==='circle') chunks.push(`<circle cx="${entity.cx}" cy="${entity.cy}" r="${entity.r}" stroke-width="${sw}" ${style}/>`);
      else if(entity.type==='arc') chunks.push(`<polyline points="${entitySamplePoints(entity).map((p)=>`${p.x},${p.y}`).join(' ')}" stroke-width="${sw}" ${style}/>`);
      else if(entity.closed===false) chunks.push(`<polyline points="${entity.points.map((p)=>`${p.x},${p.y}`).join(' ')}" stroke-width="${sw}" ${style}/>`);
      else chunks.push(`<polygon points="${entity.points.map((p)=>`${p.x},${p.y}`).join(' ')}" stroke-width="${sw}" ${style}/>`);
    }
    chunks.push('</g>');
    const rounded=(value)=>Math.round(Number(value)*100)/100;
    const text=part.profile.type==='rectangle'
      ?`${part.profile.width} × ${part.profile.height} mm · radius corners`
      :`Measured curved perimeter · Overall ${rounded(part.bounds.width)} × ${rounded(part.bounds.height)} mm (calculated) · ${part.profile.segments?.length||0} segments`;
    const footer=entityState?`${text} · Blue confirmed · Grey dashed awaiting confirmation`:text;
    chunks.push(`<text x="${x0+padding}" y="${y0+cellH-8}" font-family="system-ui,sans-serif" font-size="12" fill="#475467">${esc(footer)}</text>`);
  });
  chunks.push('</svg>');return chunks.join('');
}
export function geometryToSvgDataUrl(geometry,options){const svg=geometryToSvg(geometry,options);return svg?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`:'';}
