import * as legacy from './geometry-legacy.js';
import { buildCurvedPath, buildRoundedRectangle, entitySamplePoints } from './curves.js';

const EPS = 1e-6;

function point(x, y) { return { x:Number(x), y:Number(y) }; }
function finitePositive(value) { return Number.isFinite(Number(value)) && Number(value) > 0; }
function hasCurvePart(part) {
  const profile=part?.profile||{};
  return (profile.type==='rectangle' && Array.isArray(profile.corner_radii) && profile.corner_radii.length>0)
    || (profile.type==='path' && (profile.boundary_segments||[]).some((segment)=>['arc','connect_arc'].includes(segment.kind)));
}
function hasCurveGeometry(source) { return (source?.analysis?.parts||[]).some(hasCurvePart); }

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

function compileFeature(feature,profile,dimensionMap,compiledFeatures,label,errors){
  const prefix=`${label} / ${feature.id||feature.type}`;
  if(!['rectangular_cutout','circular_hole','slot'].includes(feature.type)){ errors.push(`${prefix}: ${feature.type} is not supported on a curved deterministic profile.`); return null; }
  let width,height,diameter=null;
  if(feature.type==='circular_hole'){
    const d=resolveDimension(dimensionMap,feature.diameter_dimension_id,`${prefix} diameter`,errors); if(!d)return null;
    diameter=Number(d.valueMm); width=diameter; height=diameter;
  } else {
    const wd=resolveDimension(dimensionMap,feature.width_dimension_id,`${prefix} width`,errors);
    const hd=resolveDimension(dimensionMap,feature.height_dimension_id,`${prefix} height`,errors); if(!wd||!hd)return null;
    width=Number(wd.valueMm); height=Number(hd.valueMm);
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
  let entity;
  if(feature.type==='circular_hole') entity={type:'circle',cx,cy,r:diameter/2,role:'cut',label:feature.id||'Hole'};
  else if(feature.type==='rectangular_cutout') entity={type:'polyline',points:rectanglePoints(cx-width/2,cy-height/2,width,height),closed:true,role:'cut',label:feature.id||'Cut-out'};
  else entity={type:'polyline',points:capsulePoints(cx,cy,width,height),closed:true,role:'cut',label:feature.id||'Slot'};
  checkInside(profile.points,entity,prefix,errors);
  return entity;
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
    if((part.features||[]).some((f)=>['corner_notch','edge_notch'].includes(f.type))){ errors.push(`${label}: rounded outer corners combined with boundary notches are not yet supported deterministically.`); return null; }
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
      } else if(segment.kind==='arc'){
        const chord=resolveDimension(dimensionMap,segment.chord_dimension_id,`${name} chord`,errors);
        const radius=resolveDimension(dimensionMap,segment.radius_dimension_id,`${name} radius`,errors); if(!chord||!radius)return null;
        compiled.push({...segment,chord:Number(chord.valueMm),radius:Number(radius.valueMm),bulgeSide:segment.bulge_side,extent:segment.arc_extent});
      } else if(segment.kind==='connect_arc'){
        const radius=resolveDimension(dimensionMap,segment.radius_dimension_id,`${name} radius`,errors); if(!radius)return null;
        compiled.push({...segment,radius:Number(radius.valueMm),bulgeSide:segment.bulge_side,extent:segment.arc_extent});
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
    const entity=compileFeature(feature,profile,dimensionMap,compiledFeatures,label,errors);
    if(entity){entities.push(entity);compiledFeatures.set(feature.id,entity);}
  }
  const b=boundsFromPoints(profile.points),bounds={...b,width:b.maxX-b.minX,height:b.maxY-b.minY};
  return {id:part.id||label,label,profile,entities,bounds};
}

export function compileSourceGeometry(source){
  if(!hasCurveGeometry(source)) return legacy.compileSourceGeometry(source);
  const errors=[];
  if(!source?.analysis) return {ok:false,errors:['No AI geometry proposal is available for this drawing.'],parts:[]};
  const dimensionMap=new Map((source.dimensions||[]).map((d)=>[d.id,d])),parts=[];
  for(const part of source.analysis.parts||[]){
    if(hasCurvePart(part)){
      const compiled=compileCurvedPart(part,dimensionMap,errors); if(compiled)parts.push(compiled);
    } else {
      const result=legacy.compileSourceGeometry({...source,analysis:{...source.analysis,parts:[part]}});
      if(result.ok) parts.push(...result.parts); else errors.push(...result.errors);
    }
  }
  return {ok:errors.length===0&&parts.length>0,errors:[...new Set(errors)],parts};
}

function esc(value){return String(value).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function geometryToSvg(geometry,{width=900,height=600,padding=28}={}){
  if(!geometry?.parts?.some((part)=>part.entities?.some((entity)=>entity.type==='arc'))) return legacy.geometryToSvg(geometry,{width,height,padding});
  if(!geometry?.parts?.length)return '';
  const cols=geometry.parts.length>1?2:1,rows=Math.ceil(geometry.parts.length/cols),cellW=width/cols,cellH=height/rows;
  const chunks=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Confirmed manufacturing geometry">`,'<rect width="100%" height="100%" fill="white"/>'];
  geometry.parts.forEach((part,index)=>{
    const x0=(index%cols)*cellW,y0=Math.floor(index/cols)*cellH,labelH=30,availW=cellW-padding*2,availH=cellH-padding*2-labelH;
    const scale=Math.min(availW/part.bounds.width,availH/part.bounds.height),ox=x0+(cellW-part.bounds.width*scale)/2,oy=y0+labelH+(availH-part.bounds.height*scale)/2+padding;
    chunks.push(`<text x="${x0+padding}" y="${y0+22}" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#111827">${esc(part.label)}</text>`);
    chunks.push(`<g transform="translate(${ox} ${oy+part.bounds.height*scale}) scale(${scale} ${-scale})" fill="none" stroke="#111827" vector-effect="non-scaling-stroke">`);
    for(const entity of part.entities){
      const sw=(entity.role==='outer'?2:1.4)/scale;
      if(entity.type==='circle') chunks.push(`<circle cx="${entity.cx}" cy="${entity.cy}" r="${entity.r}" stroke-width="${sw}"/>`);
      else if(entity.type==='arc') chunks.push(`<polyline points="${entitySamplePoints(entity).map((p)=>`${p.x},${p.y}`).join(' ')}" stroke-width="${sw}"/>`);
      else if(entity.closed===false) chunks.push(`<polyline points="${entity.points.map((p)=>`${p.x},${p.y}`).join(' ')}" stroke-width="${sw}"/>`);
      else chunks.push(`<polygon points="${entity.points.map((p)=>`${p.x},${p.y}`).join(' ')}" stroke-width="${sw}"/>`);
    }
    chunks.push('</g>');
    const text=part.profile.type==='rectangle'?`${part.profile.width} × ${part.profile.height} mm · radius corners`:`Measured curved perimeter · ${part.profile.segments?.length||0} segments`;
    chunks.push(`<text x="${x0+padding}" y="${y0+cellH-8}" font-family="system-ui,sans-serif" font-size="12" fill="#475467">${esc(text)}</text>`);
  });
  chunks.push('</svg>');return chunks.join('');
}
export function geometryToSvgDataUrl(geometry,options){const svg=geometryToSvg(geometry,options);return svg?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`:'';}
