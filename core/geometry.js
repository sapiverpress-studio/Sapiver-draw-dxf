const EPS = 1e-6;

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function point(x, y) {
  return { x: Number(x), y: Number(y) };
}

function rectanglePoints(x, y, width, height) {
  return [point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)];
}

function capsulePoints(cx, cy, width, height, segments = 18) {
  if (!(width > 0 && height > 0)) throw new Error('Slot width and height must be positive.');
  const pts = [];
  if (Math.abs(width - height) < EPS) {
    const r = width / 2;
    for (let i = 0; i < segments * 2; i += 1) {
      const a = (Math.PI * 2 * i) / (segments * 2);
      pts.push(point(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    return pts;
  }
  if (width > height) {
    const r = height / 2;
    const halfStraight = (width - height) / 2;
    const leftCx = cx - halfStraight;
    const rightCx = cx + halfStraight;
    for (let i = 0; i <= segments; i += 1) {
      const a = -Math.PI / 2 + (Math.PI * i) / segments;
      pts.push(point(rightCx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    for (let i = 0; i <= segments; i += 1) {
      const a = Math.PI / 2 + (Math.PI * i) / segments;
      pts.push(point(leftCx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
  } else {
    const r = width / 2;
    const halfStraight = (height - width) / 2;
    const bottomCy = cy - halfStraight;
    const topCy = cy + halfStraight;
    for (let i = 0; i <= segments; i += 1) {
      const a = (Math.PI * i) / segments;
      pts.push(point(cx + r * Math.cos(a), topCy + r * Math.sin(a)));
    }
    for (let i = 0; i <= segments; i += 1) {
      const a = Math.PI + (Math.PI * i) / segments;
      pts.push(point(cx + r * Math.cos(a), bottomCy + r * Math.sin(a)));
    }
  }
  return pts;
}

function resolveDimension(dimensionMap, dimensionId, label, errors, { position = false } = {}) {
  if (!dimensionId) {
    errors.push(`${label}: AI did not link a figured dimension to this geometry parameter.`);
    return null;
  }
  const d = dimensionMap.get(dimensionId);
  if (!d) {
    errors.push(`${label}: linked dimension ${dimensionId} is missing from the review list.`);
    return null;
  }
  if (!d.confirmed || !finitePositive(d.valueMm)) {
    errors.push(`${label}: dimension ${d.label || d.id} has not been confirmed with a positive value.`);
    return null;
  }
  if (position) {
    if (!['centre', 'edge'].includes(d.reference)) {
      errors.push(`${label}: position must be confirmed as CENTRE or EDGE.`);
      return null;
    }
    if (!['left', 'right', 'top', 'bottom'].includes(d.fromEdge)) {
      errors.push(`${label}: position must identify the outer edge it is measured from.`);
      return null;
    }
  }
  return d;
}

function axisCentre(total, span, d, axis, label, errors) {
  const allowedEdges = axis === 'x' ? ['left', 'right'] : ['bottom', 'top'];
  if (!allowedEdges.includes(d.fromEdge)) {
    errors.push(`${label}: ${axis.toUpperCase()} position cannot be measured from ${String(d.fromEdge).toUpperCase()}.`);
    return null;
  }
  const fromLow = axis === 'x' ? d.fromEdge === 'left' : d.fromEdge === 'bottom';
  const value = Number(d.valueMm);
  let centre;
  if (d.reference === 'centre') centre = fromLow ? value : total - value;
  else if (d.reference === 'edge') centre = fromLow ? value + span / 2 : total - value - span / 2;
  else return null;
  if (!(centre >= span / 2 - EPS && centre <= total - span / 2 + EPS)) {
    errors.push(`${label}: confirmed position places the feature outside the part boundary.`);
    return null;
  }
  return centre;
}

function entityBounds(entity) {
  if (entity.type === 'circle') {
    return { minX: entity.cx - entity.r, minY: entity.cy - entity.r, maxX: entity.cx + entity.r, maxY: entity.cy + entity.r };
  }
  const xs = entity.points.map((p) => p.x);
  const ys = entity.points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function pointInPolygon(p, polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if(((a.y>p.y)!==(b.y>p.y)) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}

function checkInsideOuter(profile, entity, label, errors) {
  const b = entityBounds(entity);
  if (profile.type === 'rectangle') {
    if (b.minX < -EPS || b.minY < -EPS || b.maxX > profile.width + EPS || b.maxY > profile.height + EPS) {
      errors.push(`${label}: confirmed feature extends outside the rectangular outer profile.`);
    }
    return;
  }
  if (['quadrilateral','path'].includes(profile.type)) {
    const samples=entity.type==='circle'
      ? Array.from({length:16},(_,i)=>point(entity.cx+entity.r*Math.cos(i*Math.PI/8),entity.cy+entity.r*Math.sin(i*Math.PI/8)))
      : entity.points;
    if(samples.some((p)=>!pointInPolygon(p,profile.points))) errors.push(`${label}: confirmed feature extends outside the out-of-square panel boundary.`);
    return;
  }
  const cx = profile.diameter / 2;
  const cy = profile.diameter / 2;
  const r = profile.diameter / 2;
  const corners = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]];
  if (corners.some(([x, y]) => Math.hypot(x - cx, y - cy) > r + EPS)) {
    errors.push(`${label}: confirmed feature is not fully inside the circular outer profile.`);
  }
}

const CORNER_INDEX = { 'bottom-left':0, 'bottom-right':1, 'top-right':2, 'top-left':3 };
const EDGE_INDEX = { bottom:0, right:1, top:2, left:3 };

function circleIntersections(a, ra, b, rb) {
  const dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy);
  if (!(d > EPS) || d > ra+rb+EPS || d < Math.abs(ra-rb)-EPS) return [];
  const along=(ra*ra-rb*rb+d*d)/(2*d), h=Math.sqrt(Math.max(0,ra*ra-along*along));
  const x=a.x+along*dx/d, y=a.y+along*dy/d;
  return [point(x-h*dy/d,y+h*dx/d), point(x+h*dy/d,y-h*dx/d)];
}

function solveQuadrilateral(lengths, rightAngles, label, errors) {
  const edges=[lengths.bottom,lengths.right,lengths.top,lengths.left];
  const c=CORNER_INDEX[rightAngles[0]];
  if (!Number.isInteger(c)) { errors.push(`${label}: select at least one indicated 90° corner.`); return null; }
  const vertices=Array(4); const next=(c+1)%4, prev=(c+3)%4, opposite=(c+2)%4;
  vertices[c]=point(0,0); vertices[next]=point(edges[c],0); vertices[prev]=point(0,edges[prev]);
  const candidates=circleIntersections(vertices[next],edges[next],vertices[prev],edges[opposite]);
  const chosen=candidates.find((p)=>p.x>EPS&&p.y>EPS) || candidates[0];
  if (!chosen) { errors.push(`${label}: the four side lengths cannot form a panel with the selected 90° corner.`); return null; }
  vertices[opposite]=chosen;
  for (const corner of rightAngles.slice(1)) {
    const i=CORNER_INDEX[corner]; if (!Number.isInteger(i)) continue;
    const v=vertices[i], vp=vertices[(i+3)%4], vn=vertices[(i+1)%4];
    const dot=(vp.x-v.x)*(vn.x-v.x)+(vp.y-v.y)*(vn.y-v.y);
    const scale=Math.hypot(vp.x-v.x,vp.y-v.y)*Math.hypot(vn.x-v.x,vn.y-v.y);
    if (Math.abs(dot) > Math.max(0.5,scale*0.001)) errors.push(`${label}: the second 90° indication conflicts with the confirmed side lengths.`);
  }
  const angle=Math.atan2(vertices[1].y-vertices[0].y,vertices[1].x-vertices[0].x),ca=Math.cos(-angle),sa=Math.sin(-angle);
  let normalised=vertices.map((p)=>point(p.x*ca-p.y*sa,p.x*sa+p.y*ca));
  const area=normalised.reduce((sum,p,i)=>sum+p.x*normalised[(i+1)%4].y-normalised[(i+1)%4].x*p.y,0)/2;
  if(area<0) normalised=normalised.map((p)=>point(p.x,-p.y));
  const minX=Math.min(...normalised.map(p=>p.x)), minY=Math.min(...normalised.map(p=>p.y));
  return normalised.map(p=>point(p.x-minX,p.y-minY));
}

function solveTwoSquareBottomPanel(lengths, label, errors) {
  if (![lengths.bottom, lengths.left, lengths.right].every(finitePositive)) {
    errors.push(`${label}: bottom, left and right lengths are required when both bottom corners are 90°.`);
    return null;
  }
  return [point(0, 0), point(lengths.bottom, 0), point(lengths.bottom, lengths.right), point(0, lengths.left)];
}

function polygonCentroid(points) { return point(points.reduce((s,p)=>s+p.x,0)/points.length,points.reduce((s,p)=>s+p.y,0)/points.length); }

function buildNotchedBoundary(basePoints, notches, dimensionMap, label, errors) {
  const cornerCuts=new Map(), edgeCuts=new Map();
  for (const feature of notches) {
    if (feature.radius_dimension_id || finitePositive(feature.radius_mm)) {
      const radius=resolveDimension(dimensionMap,feature.radius_dimension_id,`${label} / ${feature.id} internal radius`,errors);
      if (radius) errors.push(`${label} / ${feature.id}: radiused boundary notches are not yet supported; DXF blocked to prevent replacement with a sharp corner.`);
      continue;
    }
    const width=resolveDimension(dimensionMap,feature.width_dimension_id,`${label} / ${feature.id} width`,errors);
    const depth=resolveDimension(dimensionMap,feature.depth_dimension_id,`${label} / ${feature.id} depth`,errors);
    if (!width||!depth) continue;
    if (feature.type==='corner_notch') {
      const index=CORNER_INDEX[feature.corner];
      if (!Number.isInteger(index)||cornerCuts.has(index)) errors.push(`${label} / ${feature.id}: corner is missing or already has a cut-out.`);
      else cornerCuts.set(index,{width:Number(width.valueMm),depth:Number(depth.valueMm),id:feature.id});
    } else {
      const offset=resolveDimension(dimensionMap,feature.offset_dimension_id,`${label} / ${feature.id} position`,errors);
      const index=EDGE_INDEX[feature.touching_edge];
      if (!offset||!Number.isInteger(index)) { if (!Number.isInteger(index)) errors.push(`${label} / ${feature.id}: select a panel edge.`); continue; }
      if (!edgeCuts.has(index)) edgeCuts.set(index,[]);
      edgeCuts.get(index).push({offset:Number(offset.valueMm),width:Number(width.valueMm),depth:Number(depth.valueMm),id:feature.id});
    }
  }
  const centre=polygonCentroid(basePoints), result=[];
  for (let i=0;i<4;i+=1) {
    const a=basePoints[i], b=basePoints[(i+1)%4], dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
    const startCorner=cornerCuts.get(i), endCorner=cornerCuts.get((i+1)%4);
    const cornerDistance=(cut,vertexIndex,isStart)=>{
      if(!cut)return 0; const horizontal=i===0||i===2; return horizontal?cut.width:cut.depth;
    };
    const startInset=cornerDistance(startCorner,i,true), endInset=cornerDistance(endCorner,(i+1)%4,false);
    if(startInset+endInset>=len-EPS){errors.push(`${label}: corner cut-outs consume the whole ${Object.keys(EDGE_INDEX)[i]} edge.`);continue;}
    const start=point(a.x+ux*startInset,a.y+uy*startInset); if(i===0) result.push(start); else result.push(start);
    const cuts=(edgeCuts.get(i)||[]).map(c=>{
      const canonicalReverse=i===2||i===3; const along=canonicalReverse?len-c.offset-c.width:c.offset; return {...c,along};
    }).sort((x,y)=>x.along-y.along);
    let cursor=startInset;
    for(const cut of cuts){
      if(cut.along<cursor-EPS||cut.along+cut.width>len-endInset+EPS){errors.push(`${label} / ${cut.id}: notch overlaps a corner cut-out, another notch, or the end of the edge.`);continue;}
      const p1=point(a.x+ux*cut.along,a.y+uy*cut.along),p2=point(a.x+ux*(cut.along+cut.width),a.y+uy*(cut.along+cut.width));
      let nx=-uy,ny=ux; if((centre.x-p1.x)*nx+(centre.y-p1.y)*ny<0){nx=-nx;ny=-ny;}
      result.push(p1,point(p1.x+nx*cut.depth,p1.y+ny*cut.depth),point(p2.x+nx*cut.depth,p2.y+ny*cut.depth),p2); cursor=cut.along+cut.width;
    }
    const end=point(b.x-ux*endInset,b.y-uy*endInset); result.push(end);
    if(endCorner){
      const nextEdge=(i+1)%4, horizontalNext=nextEdge===0||nextEdge===2;
      const nextDistance=horizontalNext?endCorner.width:endCorner.depth;
      const nb=basePoints[(i+2)%4], ndx=nb.x-b.x,ndy=nb.y-b.y,nlen=Math.hypot(ndx,ndy);
      const nextPoint=point(b.x+ndx/nlen*nextDistance,b.y+ndy/nlen*nextDistance);
      result.push(point(end.x+nextPoint.x-b.x,end.y+nextPoint.y-b.y));
    }
  }
  return result;
}

function compileFeature(feature, profile, dimensionMap, compiledFeatures, partLabel, errors) {
  const prefix = `${partLabel} / ${feature.id || feature.type}`;
  if (!['rectangular_cutout', 'circular_hole', 'slot'].includes(feature.type)) {
    errors.push(`${prefix}: ${feature.type} is not yet supported by the deterministic v1 geometry engine.`);
    return null;
  }

  let width = null;
  let height = null;
  let diameter = null;
  if (feature.type === 'rectangular_cutout' || feature.type === 'slot') {
    const wd = resolveDimension(dimensionMap, feature.width_dimension_id, `${prefix} width`, errors);
    const hd = resolveDimension(dimensionMap, feature.height_dimension_id, `${prefix} height`, errors);
    if (!wd || !hd) return null;
    width = Number(wd.valueMm);
    height = Number(hd.valueMm);
  } else {
    const dd = resolveDimension(dimensionMap, feature.diameter_dimension_id, `${prefix} diameter`, errors);
    if (!dd) return null;
    diameter = Number(dd.valueMm);
    width = diameter;
    height = diameter;
  }

  const xd = resolveDimension(dimensionMap, feature.x_dimension_id, `${prefix} X position`, errors, { position: true });
  const yd = resolveDimension(dimensionMap, feature.y_dimension_id, `${prefix} Y position`, errors, { position: true });
  if (!xd || !yd) return null;

  const profileBounds=['quadrilateral','path'].includes(profile.type)?{width:Math.max(...profile.points.map(p=>p.x))-Math.min(...profile.points.map(p=>p.x)),height:Math.max(...profile.points.map(p=>p.y))-Math.min(...profile.points.map(p=>p.y))}:null;
  const totalWidth = profile.type === 'rectangle' ? profile.width : ['quadrilateral','path'].includes(profile.type) ? profileBounds.width : profile.diameter;
  const totalHeight = profile.type === 'rectangle' ? profile.height : ['quadrilateral','path'].includes(profile.type) ? profileBounds.height : profile.diameter;
  let cx;
  if (feature.x_relative_to_feature_id) {
    const previous = compiledFeatures.get(feature.x_relative_to_feature_id);
    if (!previous) {
      errors.push(`${prefix} X position: previous cut-out ${feature.x_relative_to_feature_id} is missing or invalid.`);
      return null;
    }
    cx = entityBounds(previous).maxX + Number(xd.valueMm) + width / 2;
  } else {
    cx = axisCentre(totalWidth, width, xd, 'x', `${prefix} X position`, errors);
  }
  const cy = axisCentre(totalHeight, height, yd, 'y', `${prefix} Y position`, errors);
  if (cx == null || cy == null) return null;

  let entity;
  if (feature.type === 'circular_hole') {
    entity = { type: 'circle', cx, cy, r: diameter / 2, role: 'cut', label: feature.id || 'Hole' };
  } else if (feature.type === 'rectangular_cutout') {
    entity = { type: 'polyline', points: rectanglePoints(cx - width / 2, cy - height / 2, width, height), closed: true, role: 'cut', label: feature.id || 'Cut-out' };
  } else {
    entity = { type: 'polyline', points: capsulePoints(cx, cy, width, height), closed: true, role: 'cut', label: feature.id || 'Slot' };
  }
  checkInsideOuter(profile, entity, prefix, errors);
  return entity;
}

function compilePart(part, dimensionMap, errors) {
  const label = part.label || part.id || 'Part';
  const profileSpec = part.profile || {};
  let profile;
  let outer;

  if (profileSpec.type === 'rectangle') {
    const wd = resolveDimension(dimensionMap, profileSpec.width_dimension_id, `${label} overall width`, errors);
    const hd = resolveDimension(dimensionMap, profileSpec.height_dimension_id, `${label} overall height`, errors);
    if (!wd || !hd) return null;
    const width = Number(wd.valueMm);
    const height = Number(hd.valueMm);
    profile = { type: 'rectangle', width, height };
    outer = { type: 'polyline', points: rectanglePoints(0, 0, width, height), closed: true, role: 'outer', label };
  } else if (profileSpec.type === 'quadrilateral') {
    const resolved={};
    const rightAngles=profileSpec.right_angle_corners||[];
    const derivedTop=rightAngles.includes('bottom-left')&&rightAngles.includes('bottom-right')&&!profileSpec.top_dimension_id&&!finitePositive(profileSpec.top_mm);
    const requiredSides=derivedTop?['bottom','left','right']:['top','bottom','left','right'];
    for(const side of requiredSides) resolved[side]=resolveDimension(dimensionMap,profileSpec[`${side}_dimension_id`],`${label} ${side} length`,errors);
    if(Object.values(resolved).some((d)=>!d)) return null;
    const lengths=Object.fromEntries(Object.entries(resolved).map(([k,d])=>[k,Number(d.valueMm)]));
    let shoulderBoundary=null;
    if (derivedTop && profileSpec.side_heights_to_notch_shoulders) {
      const leftNotch=(part.features||[]).find((feature)=>feature.type==='corner_notch'&&feature.corner==='top-left');
      const rightNotch=(part.features||[]).find((feature)=>feature.type==='corner_notch'&&feature.corner==='top-right');
      if (!leftNotch || !rightNotch) {
        errors.push(`${label}: both upper corner notches are required when side heights finish at notch shoulders.`);
        return null;
      }
      const lw=resolveDimension(dimensionMap,leftNotch.width_dimension_id,`${label} / ${leftNotch.id} width`,errors);
      const ld=resolveDimension(dimensionMap,leftNotch.depth_dimension_id,`${label} / ${leftNotch.id} depth`,errors);
      const rw=resolveDimension(dimensionMap,rightNotch.width_dimension_id,`${label} / ${rightNotch.id} width`,errors);
      const rd=resolveDimension(dimensionMap,rightNotch.depth_dimension_id,`${label} / ${rightNotch.id} depth`,errors);
      if (!lw||!ld||!rw||!rd) return null;
      const leftWidth=Number(lw.valueMm),leftDepth=Number(ld.valueMm),rightWidth=Number(rw.valueMm),rightDepth=Number(rd.valueMm);
      if (leftWidth+rightWidth>=lengths.bottom-EPS) {
        errors.push(`${label}: upper corner cut-outs consume the whole panel width.`);
        return null;
      }
      const leftTop=lengths.left+leftDepth,rightTop=lengths.right+rightDepth;
      lengths.top=Math.hypot(lengths.bottom-leftWidth-rightWidth,rightTop-leftTop);
      shoulderBoundary=[
        point(0,0), point(lengths.bottom,0), point(lengths.bottom,lengths.right),
        point(lengths.bottom-rightWidth,lengths.right), point(lengths.bottom-rightWidth,rightTop),
        point(leftWidth,leftTop), point(leftWidth,lengths.left), point(0,lengths.left),
      ];
    } else if(derivedTop) lengths.top=Math.hypot(lengths.bottom,lengths.right-lengths.left);
    const points=shoulderBoundary || (derivedTop?solveTwoSquareBottomPanel(lengths,label,errors):solveQuadrilateral(lengths,rightAngles,label,errors)); if(!points)return null;
    profile={type:'quadrilateral',points,lengths,rightAngleCorners:rightAngles,derivedTop};
    outer={type:'polyline',points,closed:true,role:'outer',label};
  } else if (profileSpec.type === 'path') {
    const pathErrorCount=errors.length;
    const segments=profileSpec.boundary_segments||[];
    const connectIndexes=segments.map((segment,index)=>segment.kind==='connect'?index:-1).filter((index)=>index>=0);
    if (segments.length<3 || connectIndexes.length!==1) {
      errors.push(`${label}: a measured perimeter path requires at least three segments and exactly one calculated closing segment.`);
      return null;
    }
    const vectors=[];
    for (const segment of segments) {
      if (segment.kind==='connect') { vectors.push(null); continue; }
      const resolved=resolveDimension(dimensionMap,segment.dimension_id,`${label} / ${segment.label||segment.id||'perimeter segment'}`,errors);
      if (!resolved) { vectors.push(null); continue; }
      const length=Number(resolved.valueMm);
      const directions={right:[length,0],left:[-length,0],up:[0,length],down:[0,-length]};
      const vector=directions[segment.direction];
      if (!vector || (segment.kind==='horizontal'&&!['left','right'].includes(segment.direction)) || (segment.kind==='vertical'&&!['up','down'].includes(segment.direction))) {
        errors.push(`${label} / ${segment.label||segment.id}: invalid perimeter direction.`);
        vectors.push(null);
      } else vectors.push(vector);
    }
    if (errors.length>pathErrorCount) return null;
    const known=vectors.filter(Boolean).reduce((sum,vector)=>[sum[0]+vector[0],sum[1]+vector[1]],[0,0]);
    vectors[connectIndexes[0]]=[-known[0],-known[1]];
    if (Math.hypot(...vectors[connectIndexes[0]])<EPS) {
      errors.push(`${label}: calculated closing perimeter segment has zero length.`);
      return null;
    }
    const raw=[point(0,0)];
    let cursor=point(0,0);
    for (let index=0; index<vectors.length; index+=1) {
      cursor=point(cursor.x+vectors[index][0],cursor.y+vectors[index][1]);
      if (index<vectors.length-1) raw.push(cursor);
    }
    const minX=Math.min(...raw.map((p)=>p.x)),minY=Math.min(...raw.map((p)=>p.y));
    const points=raw.map((p)=>point(p.x-minX,p.y-minY));
    profile={type:'path',points,segments};
    outer={type:'polyline',points,closed:true,role:'outer',label};
  } else if (profileSpec.type === 'circle') {
    const dd = resolveDimension(dimensionMap, profileSpec.diameter_dimension_id, `${label} overall diameter`, errors);
    if (!dd) return null;
    const diameter = Number(dd.valueMm);
    profile = { type: 'circle', diameter };
    outer = { type: 'circle', cx: diameter / 2, cy: diameter / 2, r: diameter / 2, role: 'outer', label };
  } else {
    errors.push(`${label}: outer profile type ${profileSpec.type || 'unknown'} is not yet supported by deterministic v1 geometry.`);
    return null;
  }

  const boundaryFeatures=profileSpec.type==='path' ? [] : profileSpec.side_heights_to_notch_shoulders
    ? (part.features||[]).filter((feature)=>feature.type==='edge_notch')
    : (part.features||[]).filter((feature)=>['corner_notch','edge_notch'].includes(feature.type));
  if(boundaryFeatures.length && outer.type==='polyline') outer.points=buildNotchedBoundary(outer.points,boundaryFeatures,dimensionMap,label,errors);
  const entities = [outer];
  const compiledFeatures = new Map();
  for (const feature of part.features || []) {
    if (['corner_notch','edge_notch'].includes(feature.type)) continue;
    const quantity = Math.max(1, Number(feature.quantity) || 1);
    if (quantity !== 1) {
      errors.push(`${label} / ${feature.id || feature.type}: repeated quantity ${quantity} needs individually located features before DXF release.`);
      continue;
    }
    const entity = compileFeature(feature, profile, dimensionMap, compiledFeatures, label, errors);
    if (entity) {
      entities.push(entity);
      compiledFeatures.set(feature.id, entity);
    }
  }

  const ob=entityBounds(outer);
  const bounds={...ob,width:ob.maxX-ob.minX,height:ob.maxY-ob.minY};

  return { id: part.id || label, label, profile, entities, bounds };
}

export function compileSourceGeometry(source) {
  const errors = [];
  if (!source?.analysis) return { ok: false, errors: ['No AI geometry proposal is available for this drawing.'], parts: [] };
  const dimensions = Array.isArray(source.dimensions) ? source.dimensions : [];
  const dimensionMap = new Map(dimensions.map((d) => [d.id, d]));
  const proposalParts = Array.isArray(source.analysis.parts) ? source.analysis.parts : [];
  if (!proposalParts.length) errors.push('AI did not identify any deterministic part profiles in this drawing.');

  const parts = [];
  for (const part of proposalParts) {
    const compiled = compilePart(part, dimensionMap, errors);
    if (compiled) parts.push(compiled);
  }
  return { ok: errors.length === 0 && parts.length > 0, errors, parts };
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function geometryToSvg(geometry, { width = 900, height = 600, padding = 28 } = {}) {
  if (!geometry?.parts?.length) return '';
  const cols = geometry.parts.length > 1 ? 2 : 1;
  const rows = Math.ceil(geometry.parts.length / cols);
  const cellW = width / cols;
  const cellH = height / rows;
  const chunks = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Confirmed manufacturing geometry">`, '<rect width="100%" height="100%" fill="white"/>'];

  geometry.parts.forEach((part, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x0 = col * cellW;
    const y0 = row * cellH;
    const labelH = 30;
    const availW = cellW - padding * 2;
    const availH = cellH - padding * 2 - labelH;
    const scale = Math.min(availW / part.bounds.width, availH / part.bounds.height);
    const ox = x0 + (cellW - part.bounds.width * scale) / 2;
    const oy = y0 + labelH + (availH - part.bounds.height * scale) / 2 + padding;
    chunks.push(`<text x="${x0 + padding}" y="${y0 + 22}" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#111827">${esc(part.label)}</text>`);
    chunks.push(`<g transform="translate(${ox} ${oy + part.bounds.height * scale}) scale(${scale} ${-scale})" fill="none" stroke="#111827" vector-effect="non-scaling-stroke">`);
    for (const entity of part.entities) {
      const strokeWidth = entity.role === 'outer' ? 2 / scale : 1.4 / scale;
      if (entity.type === 'circle') chunks.push(`<circle cx="${entity.cx}" cy="${entity.cy}" r="${entity.r}" stroke-width="${strokeWidth}"/>`);
      else chunks.push(`<polygon points="${entity.points.map((p) => `${p.x},${p.y}`).join(' ')}" stroke-width="${strokeWidth}"/>`);
    }
    if (part.profile.type === 'quadrilateral') {
      const names=['bottom-left','bottom-right','top-right','top-left'];
      for(const corner of part.profile.rightAngleCorners||[]){
        const i=names.indexOf(corner); if(i<0)continue;
        const p=part.profile.points[i],prev=part.profile.points[(i+3)%4],next=part.profile.points[(i+1)%4],mark=12/scale;
        const pv=Math.hypot(prev.x-p.x,prev.y-p.y),nv=Math.hypot(next.x-p.x,next.y-p.y);
        const a=point(p.x+(prev.x-p.x)/pv*mark,p.y+(prev.y-p.y)/pv*mark),c=point(p.x+(next.x-p.x)/nv*mark,p.y+(next.y-p.y)/nv*mark),b=point(a.x+c.x-p.x,a.y+c.y-p.y);
        chunks.push(`<polyline points="${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y}" stroke-width="${1.4/scale}"/>`);
      }
    }
    chunks.push('</g>');
    const sizeText = part.profile.type === 'rectangle' ? `${part.profile.width} × ${part.profile.height} mm`
      : part.profile.type === 'quadrilateral' ? `Top ${part.profile.lengths.top} · Bottom ${part.profile.lengths.bottom} · Left ${part.profile.lengths.left} · Right ${part.profile.lengths.right} mm`
        : part.profile.type === 'path' ? `Measured perimeter · ${part.profile.segments.length} segments`
          : `Ø${part.profile.diameter} mm`;
    chunks.push(`<text x="${x0 + padding}" y="${y0 + cellH - 8}" font-family="system-ui,sans-serif" font-size="12" fill="#475467">${esc(sizeText)}</text>`);
  });
  chunks.push('</svg>');
  return chunks.join('');
}

export function geometryToSvgDataUrl(geometry, options) {
  const svg = geometryToSvg(geometry, options);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
}
