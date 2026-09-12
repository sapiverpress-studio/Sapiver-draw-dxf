import * as legacy from './review-model-legacy.js';
import { compileSourceGeometry, geometryToSvg } from './geometry.js';

function finitePositive(value){return Number.isFinite(Number(value))&&Number(value)>0;}
function nearlyEqual(a,b,tolerance=0.01){return Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<=tolerance;}
function partName(part,index){return String(part?.label||part?.id||`Part ${index+1}`).trim();}
function hasCurvePart(part){
  const profile=part?.profile||{};
  return (profile.type==='rectangle'&&Array.isArray(profile.corner_radii)&&profile.corner_radii.length>0)
    || (profile.type==='path'&&(profile.boundary_segments||[]).some((segment)=>['arc','quarter_arc','connect_arc'].includes(segment.kind)));
}
function hasRadiusedFeature(part){return (part?.features||[]).some((feature)=>['rectangular_cutout','corner_notch','edge_notch'].includes(feature?.type)&&(finitePositive(feature?.radius_mm)||Boolean(feature?.radius_dimension_id)));}
function hasCurveGeometry(source){return (source?.analysis?.parts||[]).some((part)=>hasCurvePart(part)||hasRadiusedFeature(part));}

function curveProfileSlots(part,partIndex){
  const slots=[],profile=part?.profile||{},common={partIndex,featureIndex:null,section:partName(part,partIndex),ownerType:'profile'};
  if(profile.type==='rectangle'){
    slots.push({...common,key:`p${partIndex}:profile:width`,parameter:'width',field:'width_dimension_id',valueField:'width_mm',kind:'size',label:'Overall width'});
    slots.push({...common,key:`p${partIndex}:profile:height`,parameter:'height',field:'height_dimension_id',valueField:'height_mm',kind:'size',label:'Overall height'});
    for(let index=0;index<(profile.corner_radii||[]).length;index++){
      const radius=profile.corner_radii[index],name=String(radius.corner||'corner').replace('-', ' ');
      slots.push({partIndex,featureIndex:null,section:partName(part,partIndex),ownerType:'corner-radius',cornerRadiusIndex:index,key:`p${partIndex}:profile:corner-radius:${index}`,parameter:'radius',field:'radius_dimension_id',valueField:'radius_mm',kind:'size',label:`${name[0]?.toUpperCase()||''}${name.slice(1)} radius`});
    }
  } else if(profile.type==='path'){
    for(let index=0;index<(profile.boundary_segments||[]).length;index++){
      const segment=profile.boundary_segments[index],base={partIndex,featureIndex:null,section:partName(part,partIndex),ownerType:'segment',segmentIndex:index};
      if(segment.kind==='connect') continue;
      if(segment.kind==='quarter_arc'){
        slots.push({...base,key:`p${partIndex}:profile:segment:${index}:radius`,parameter:'radius',field:'radius_dimension_id',valueField:'radius_mm',kind:'size',label:`${segment.label||`Perimeter transition ${index+1}`} radius`});
      } else if(segment.kind==='connect_arc'){
        if(segment.radius_dimension_id||finitePositive(segment.radius_mm)||!segment.rise_dimension_id&&!finitePositive(segment.rise_mm)) slots.push({...base,key:`p${partIndex}:profile:segment:${index}:radius`,parameter:'radius',field:'radius_dimension_id',valueField:'radius_mm',kind:'size',label:`${segment.label||`Perimeter arc ${index+1}`} radius`});
        if(segment.rise_dimension_id||finitePositive(segment.rise_mm)) slots.push({...base,key:`p${partIndex}:profile:segment:${index}:rise`,parameter:'rise',field:'rise_dimension_id',valueField:'rise_mm',kind:'size',label:`${segment.label||`Perimeter arc ${index+1}`} rise`});
      } else if(segment.kind==='arc'){
        slots.push({...base,key:`p${partIndex}:profile:segment:${index}:chord`,parameter:'chord',field:'chord_dimension_id',valueField:'chord_mm',kind:'size',label:`${segment.label||`Perimeter arc ${index+1}`} chord`});
        if(segment.radius_dimension_id||finitePositive(segment.radius_mm)||!segment.rise_dimension_id&&!finitePositive(segment.rise_mm)) slots.push({...base,key:`p${partIndex}:profile:segment:${index}:radius`,parameter:'radius',field:'radius_dimension_id',valueField:'radius_mm',kind:'size',label:`${segment.label||`Perimeter arc ${index+1}`} radius`});
        if(segment.rise_dimension_id||finitePositive(segment.rise_mm)) slots.push({...base,key:`p${partIndex}:profile:segment:${index}:rise`,parameter:'rise',field:'rise_dimension_id',valueField:'rise_mm',kind:'size',label:`${segment.label||`Perimeter arc ${index+1}`} rise`});
      } else {
        slots.push({...base,key:`p${partIndex}:profile:segment:${index}`,parameter:'length',field:'dimension_id',valueField:'length_mm',kind:'size',label:segment.label||`Perimeter segment ${index+1}`});
      }
    }
  }
  return slots;
}
function legacyFeatureSlots(source,part,partIndex){
  const isolated={...source,analysis:{...(source.analysis||{}),parts:[{...part,profile:{type:'unknown'},features:part.features||[]}]}};
  return legacy.geometrySlots(isolated).filter((slot)=>slot.ownerType==='feature').map((slot)=>({...slot,partIndex}));
}

export function geometrySlots(source){
  if(!hasCurveGeometry(source)) return legacy.geometrySlots(source);
  const slots=[];
  (source?.analysis?.parts||[]).forEach((part,partIndex)=>{
    if(hasCurvePart(part)) slots.push(...curveProfileSlots(part,partIndex),...legacyFeatureSlots(source,part,partIndex));
    else {
      const isolated={...source,analysis:{...(source.analysis||{}),parts:[part]}};
      slots.push(...legacy.geometrySlots(isolated).map((slot)=>({...slot,partIndex})));
    }
  });
  return slots;
}
export function isPerimeterSlot(slot){return ['profile','segment','corner-radius'].includes(slot?.ownerType);}
export function slotOwner(source,slot){
  if(!hasCurveGeometry(source)) return legacy.slotOwner(source,slot);
  if(!slot)return null; const part=source?.analysis?.parts?.[slot.partIndex]; if(!part)return null;
  if(slot.ownerType==='profile')return part.profile;
  if(slot.ownerType==='segment')return part.profile?.boundary_segments?.[slot.segmentIndex]||null;
  if(slot.ownerType==='corner-radius')return part.profile?.corner_radii?.[slot.cornerRadiusIndex]||null;
  return part.features?.[slot.featureIndex]||null;
}
export function slotDimensionId(source,slot){if(!hasCurveGeometry(source))return legacy.slotDimensionId(source,slot);return slotOwner(source,slot)?.[slot.field]||null;}
export function setSlotDimensionId(source,slot,dimensionId){if(!hasCurveGeometry(source))return legacy.setSlotDimensionId(source,slot,dimensionId);const owner=slotOwner(source,slot);if(!owner)return false;owner[slot.field]=dimensionId||null;return true;}
export function slotByKey(source,key){if(!hasCurveGeometry(source))return legacy.slotByKey(source,key);return geometrySlots(source).find((slot)=>slot.key===key)||null;}

function applySizeSemantics(slot,dimension){
  if(!dimension)return;
  dimension.label=slot.label; dimension.reference='size'; dimension.fromEdge='unknown';
  dimension.role=slot.parameter==='radius'?'radius':slot.parameter==='diameter'?'diameter':['profile','segment','corner-radius'].includes(slot.ownerType)?'overall':'size';
}
function repairCurveSlot(source,slot,dimensions){
  const owner=slotOwner(source,slot); if(!owner)return;
  const byId=new Map(dimensions.map((d)=>[d.id,d]));
  let dimension=owner[slot.field]?byId.get(owner[slot.field]):null;
  if(!dimension&&finitePositive(owner[slot.valueField])){
    const candidates=dimensions.filter((d)=>finitePositive(d.valueMm)&&nearlyEqual(d.valueMm,owner[slot.valueField]));
    if(candidates.length===1){dimension=candidates[0];owner[slot.field]=dimension.id;}
  }
  if(dimension)applySizeSemantics(slot,dimension);
}
export function repairGeometryLinks(source){
  if(!hasCurveGeometry(source))return legacy.repairGeometryLinks(source);
  const parts=source?.analysis?.parts||[],dimensions=source?.dimensions||[];
  parts.forEach((part)=>{
    if(hasCurvePart(part)){
      const isolated={...source,analysis:{...(source.analysis||{}),parts:[{...part,profile:{type:'unknown'},features:part.features||[]}]}};
      legacy.repairGeometryLinks(isolated);
    } else {
      const isolated={...source,analysis:{...(source.analysis||{}),parts:[part]}}; legacy.repairGeometryLinks(isolated);
    }
  });
  for(const slot of geometrySlots(source)) if(slot.ownerType!=='feature') repairCurveSlot(source,slot,dimensions);
  return source;
}
function deriveFeatureValues(source){
  for(const part of source?.analysis?.parts||[])for(const feature of part.features||[]){
    const radius=Number(feature.radius_mm),width=Number(feature.width_mm),height=Number(feature.height_mm);
    if(feature.type==='circular_hole'&&!(Number(feature.diameter_mm)>0)&&radius>0)feature.diameter_mm=radius*2;
    if(feature.type!=='slot'||!(radius>0))continue;
    const minor=radius*2;
    if(!(height>0)&&width>minor)feature.height_mm=minor;
    else if(!(width>0)&&height>minor)feature.width_mm=minor;
  }
}
export function materialiseDerivedDimensions(source){
  if(!source?.analysis)return source;
  source.dimensions ||= [];
  deriveFeatureValues(source);
  repairGeometryLinks(source);
  for(const slot of geometrySlots(source)){
    if(dimensionForSlot(source,slot))continue;
    const owner=slotOwner(source,slot),value=Number(owner?.[slot.valueField]);
    if(!(value>0))continue;
    const reference=slot.kind==='position'?owner?.[slot.referenceField]:'size';
    const fromEdge=slot.kind==='position'?owner?.[slot.fromEdgeField]:'unknown';
    const allowed=slot.axis==='x'?['left','right']:['top','bottom'];
    if(slot.kind==='position'&&(!['centre','edge'].includes(reference)||!allowed.includes(fromEdge)))continue;
    const dimension={
      id:`derived:${slot.key}`,label:slot.label,valueMm:value,
      role:slot.kind==='position'?'position':slot.parameter==='radius'?'radius':slot.parameter==='diameter'?'diameter':'size',
      reference,fromEdge,rawText:'Calculated from analysed geometry',confidence:'derived',confirmed:false,
    };
    source.dimensions.push(dimension);setSlotDimensionId(source,slot,dimension.id);
  }
  repairGeometryLinks(source);return source;
}
export function dimensionForSlot(source,slot){if(!hasCurveGeometry(source))return legacy.dimensionForSlot(source,slot);const id=slotDimensionId(source,slot);return id?(source?.dimensions||[]).find((d)=>d.id===id)||null:null;}
export function dimensionReadyForSlot(slot,dimension){
  if(!slot||!(dimension?.confirmed&&finitePositive(dimension.valueMm)))return false;
  if(slot.kind==='size')return dimension.reference==='size';
  if(!['centre','edge'].includes(dimension.reference))return false;
  const allowed=slot.axis==='x'?['left','right']:['top','bottom'];return allowed.includes(dimension.fromEdge);
}
export function reviewStats(source){
  if(!hasCurveGeometry(source))return legacy.reviewStats(source);
  const slots=geometrySlots(source);let linked=0,confirmed=0;
  for(const slot of slots){const d=dimensionForSlot(source,slot);if(d)linked++;if(dimensionReadyForSlot(slot,d))confirmed++;}
  return {total:slots.length,linked,confirmed,missing:Math.max(0,slots.length-linked),slots};
}
export function unlinkedDimensions(source){if(!hasCurveGeometry(source))return legacy.unlinkedDimensions(source);const linked=new Set(geometrySlots(source).map((slot)=>slotDimensionId(source,slot)).filter(Boolean));return (source?.dimensions||[]).filter((d)=>!linked.has(d.id));}
export function unlinkDimension(source,dimensionId){if(!hasCurveGeometry(source))return legacy.unlinkDimension(source,dimensionId);for(const slot of geometrySlots(source))if(slotDimensionId(source,slot)===dimensionId)setSlotDimensionId(source,slot,null);}

function pendingCurveSvg(source){
  const part=(source?.analysis?.parts||[]).find(hasCurvePart),label=partName(part||{},0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 430" role="img" aria-label="Curved drawing awaiting confirmation"><rect width="100%" height="100%" fill="white"/><text x="40" y="42" font-family="system-ui,sans-serif" font-size="17" font-weight="700" fill="#101828">${String(label).replace(/[&<>]/g,'')}</text><path d="M180 300 L180 155 Q450 40 720 155 L720 300 Z" fill="none" stroke="#98a2b3" stroke-width="2" stroke-dasharray="8 6"/><text x="450" y="350" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" fill="#667085">Confirm the perimeter dimensions and radii to render the measured curve.</text></svg>`;
}
export function reviewDrawingSvg(source){
  if(!hasCurveGeometry(source))return legacy.reviewDrawingSvg(source);
  repairGeometryLinks(source);const slots=geometrySlots(source);
  if(slots.length&&slots.every((slot)=>dimensionReadyForSlot(slot,dimensionForSlot(source,slot)))){
    const geometry=compileSourceGeometry(source);if(geometry.ok)return geometryToSvg(geometry,{width:900,height:430,padding:42});
  }
  return pendingCurveSvg(source);
}
export function reviewDrawingDataUrl(source){if(!hasCurveGeometry(source))return legacy.reviewDrawingDataUrl(source);const svg=reviewDrawingSvg(source);return svg?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`:'';}
