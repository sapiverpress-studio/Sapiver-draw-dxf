import {
  ANALYSIS_PROMPT as LEGACY_PROMPT,
  ANALYSIS_SCHEMA as LEGACY_SCHEMA,
  enforceAnalysisChecks as legacyEnforceAnalysisChecks,
  linkExplicitDimensionTargets as legacyLinkExplicitDimensionTargets,
} from './_quick-dxf-analysis-legacy.mjs';

export const ANALYSIS_PROMPT = `${LEGACY_PROMPT}

CURVED PERIMETER RULES — apply these in addition to the existing geometry-first rules:
- Treat mathematically defined circular curves as production geometry, not as unsupported irregular shapes. Recognise R, RAD, radius leader arrows, centre marks, tangent marks, chord dimensions, rise/sagitta figures, TYP and repeated callouts such as 4 x R50.
- Do not create named one-off shape categories such as arched_panel. Represent a curved outer boundary as straight and circular-arc primitives.
- For a rectangular panel with rounded external corners, keep profile type rectangle and populate corner_radii. Link each radius to the exact figured radius dimension. A TYP or repeated radius dimension may legitimately support more than one corner.
- For an internal rectangular cut-out with explicitly figured rounded corners, keep type rectangular_cutout and link the corner radius to radius_dimension_id. Do not convert it to a slot unless both ends are genuinely semicircular.
- Treat R6 and R15 beside an internal cut-out, socket opening or patch cut-out as that feature's internal corner radius when the leader or note clearly identifies it. Never discard the radius or return a sharp-cornered feature instead.
- For a radiused corner_notch, the radius applies to its one internal concave corner. For a radiused edge_notch, it applies to both internal concave corners unless the drawing explicitly dimensions them differently.
- When a path must contain a figured 90-degree radiused transition, use kind quarter_arc. Set direction to the incoming tangent travel and turn_direction to left or right. Link only radius_dimension_id; a quarter_arc never requires a chord or rise. Use this for R6/R15 concave notch transitions rather than inventing a chord requirement.
- Halifax Glass manufacturing limits are R15 minimum for polished/CNC cut-outs and R6 minimum for unpolished cut-outs. Set cutout_finish only when the drawing explicitly states the process; otherwise use unknown. The operator must confirm the process before release.
- For a general dimensioned curved outline, use profile type path. Trace boundary_segments in order around the perimeter.
- A curved outline with shoulders, steps or recesses must include every straight shoulder and every vertical rise/drop as its own boundary segment. The arc must join the actual arc endpoints, not the outside vertical sides. For each figured straight path segment, target the exact segment id using p1.profile.segments.sN.length. Do not use descriptive pseudo-fields such as "shoulder height" when the profile is a path.
- Before returning a path, walk its boundary_segments in order and compare them with the visible outline. If the source shows a shoulder on either side of an arch, the path must contain the horizontal shoulder plus its adjoining vertical rise/drop on that side. Never omit these segments merely because the arc can be closed between the outer sides.
- Never assign an overall panel width to a shoulder, rise or drop. Never assign a radius figure to a straight segment. A shoulder/step value must be the figure whose dimension line terminates on that shoulder/step.
- Use kind arc when the arc chord/span is itself figured. direction describes chord travel (left/right/up/down), chord_dimension_id links the confirmed chord/span, bulge_side is left or right relative to chord travel, and arc_extent is minor, major or semicircle. Link either a figured radius or a figured rise/sagitta; link both when both are shown so deterministic code can check consistency.
- Use kind connect_arc when the arc closes the perimeter and its two endpoints are already fixed by the preceding confirmed segments. This supports a sloping chord between unequal shoulder heights. A connect_arc requires either a figured radius or a figured rise/sagitta. Use exactly one calculated closing segment in a path: connect or connect_arc.
- Compound circular curves are allowed as multiple arc segments, provided every radius and every required chord/span is explicitly figured or the endpoints are deterministically fixed by closure.
- Never estimate a radius, chord, tangent point or curve from image scale. If the mathematical constraints are insufficient, keep production_ready false and ask a specific confirmation question.
- Wavy, freehand, spline-like, organic or otherwise undefined freeform curves must NOT be approximated from the photograph. Set analysis_checks.unsupported_geometry_present true, set production_ready false, and add an uncertainty beginning exactly "Template required:" explaining that a full-size physical template is needed.
- A genuinely irregular outline may still be deterministic when explicit coordinate/offset points or other complete mathematical constraints define it. Do not request a template merely because the outline looks unusual.
- Elliptical or other non-circular mathematical curves are not yet deterministic in the R12 production engine. Mark them unsupported and request CAD data or a template rather than converting them into guessed circular arcs.
- Radius corners and arcs remain subject to human dimension confirmation before DXF release. Model confidence never substitutes for confirmation.`;

const clone = (value) => JSON.parse(JSON.stringify(value));
export const ANALYSIS_SCHEMA = clone(LEGACY_SCHEMA);

const profile = ANALYSIS_SCHEMA.properties.parts.items.properties.profile;
const segment = profile.properties.boundary_segments.items;
segment.properties.kind.enum = ['horizontal','vertical','arc','quarter_arc','connect','connect_arc'];
segment.properties.direction.enum = ['left','right','up','down','connect'];
Object.assign(segment.properties, {
  chord_mm: { type:['number','null'] },
  chord_dimension_id: { type:['string','null'] },
  radius_mm: { type:['number','null'] },
  radius_dimension_id: { type:['string','null'] },
  rise_mm: { type:['number','null'] },
  rise_dimension_id: { type:['string','null'] },
  bulge_side: { type:'string', enum:['left','right','none'] },
  arc_extent: { type:'string', enum:['minor','major','semicircle','none'] },
  turn_direction: { type:'string', enum:['left','right','none'] },
});
for (const field of ['chord_mm','chord_dimension_id','radius_mm','radius_dimension_id','rise_mm','rise_dimension_id','bulge_side','arc_extent','turn_direction']) {
  if (!segment.required.includes(field)) segment.required.push(field);
}
profile.properties.corner_radii = {
  type:'array',
  items:{
    type:'object', additionalProperties:false,
    properties:{
      corner:{type:'string',enum:['bottom-left','bottom-right','top-right','top-left']},
      radius_mm:{type:['number','null']},
      radius_dimension_id:{type:['string','null']},
    },
    required:['corner','radius_mm','radius_dimension_id'],
  },
};
if (!profile.required.includes('corner_radii')) profile.required.push('corner_radii');

function normalise(value){return String(value||'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');}

function boundaryLinkScore(segment, dimension){
  const segmentText=normalise(`${segment?.id||''} ${segment?.label||''}`);
  const targetText=normalise(`${dimension?.target||''}`);
  if(!targetText)return -100;
  let score=0;
  const exactTarget=String(dimension?.target||'').match(/profile\.(?:boundary|segments?)\.([^.]+)(?:\.(?:length|radius|chord|rise|sagitta))?$/i);
  if(exactTarget&&normalise(exactTarget[1])===normalise(segment?.id))score+=30;
  for(const side of ['left','right','top','bottom']){
    const inSegment=new RegExp(`\\b${side}\\b`).test(segmentText),inTarget=new RegExp(`\\b${side}\\b`).test(targetText);
    if(inSegment&&inTarget)score+=6; else if(inSegment&&new RegExp(`\\b${side==='left'?'right':side==='right'?'left':side==='top'?'bottom':'top'}\\b`).test(targetText))score-=10;
  }
  for(const word of ['shoulder','ledge','recess','step','drop','rise','side','bottom','arc']){
    const token=new RegExp(`\\b${word}\\b`);if(token.test(segmentText)&&token.test(targetText))score+=4;
  }
  if(segment?.kind==='vertical'&&/\b(vertical|height|rise|drop)\b/.test(targetText))score+=4;
  if(segment?.kind==='horizontal'&&/\b(horizontal|width|ledge|shoulder|bottom)\b/.test(targetText))score+=4;
  if(['horizontal','vertical'].includes(segment?.kind)&&/\b(radius|rad|arc)\b/.test(targetText))score-=12;
  if(dimension?.role==='radius'&&['horizontal','vertical'].includes(segment?.kind))score-=20;
  return score;
}

function repairCurvedBoundaryLinks(extraction){
  const dimensions=Array.isArray(extraction?.dimensions)?extraction.dimensions:[];
  if(!dimensions.length)return extraction;
  const overallValues=dimensions.filter((d)=>d?.role==='overall'&&Number(d.value)>0).map((d)=>Number(d.value));
  const largestOverall=overallValues.length?Math.max(...overallValues):null;
  for(const part of extraction?.parts||[]){
    if(part?.profile?.type!=='path')continue;
    const segments=part.profile.boundary_segments||[],claimed=new Set();
    for(const segment of segments){
      if(!['horizontal','vertical'].includes(segment?.kind))continue;
      const current=dimensions.find((d)=>d.id===segment.dimension_id);
      const shoulderLike=/\b(shoulder|ledge|recess|step|drop|rise)\b/i.test(segment.label||'');
      const impossible=current&&(current.role==='radius'||(shoulderLike&&largestOverall&&Number(current.value)>=largestOverall));
      const currentScore=current?boundaryLinkScore(segment,current):-100;
      if(current&&!impossible&&currentScore>=6&&!claimed.has(current.id)){claimed.add(current.id);continue;}
      segment.dimension_id=null;segment.length_mm=null;
    }
    for(const segment of segments){
      if(!['horizontal','vertical'].includes(segment?.kind)||segment.dimension_id)continue;
      const shoulderLike=/\b(shoulder|ledge|recess|step|drop|rise)\b/i.test(segment.label||'');
      const ranked=dimensions.filter((d)=>Number(d.value)>0&&!claimed.has(d.id)&&d.role!=='radius')
        .filter((d)=>!(shoulderLike&&largestOverall&&Number(d.value)>=largestOverall))
        .map((d)=>({d,score:boundaryLinkScore(segment,d)})).filter((item)=>item.score>=6)
        .sort((a,b)=>b.score-a.score);
      if(!ranked.length||(ranked[1]&&ranked[1].score===ranked[0].score))continue;
      segment.dimension_id=ranked[0].d.id;segment.length_mm=Number(ranked[0].d.value);claimed.add(ranked[0].d.id);
    }
  }
  return extraction;
}
function partForTarget(parts, lowerTarget){
  for(let index=0;index<parts.length;index++){
    const part=parts[index],names=[String(part?.id||''),`p${index+1}`].filter(Boolean);
    const prefix=names.find((name)=>lowerTarget.startsWith(`${name.toLowerCase()}.`));
    if(prefix)return {part,prefix};
  }
  return null;
}

export function linkExplicitDimensionTargets(extraction){
  legacyLinkExplicitDimensionTargets(extraction);
  if(!extraction||typeof extraction!=='object')return extraction;
  const parts=Array.isArray(extraction.parts)?extraction.parts:[],dimensions=Array.isArray(extraction.dimensions)?extraction.dimensions:[];
  for(const dimension of dimensions){
    const target=String(dimension?.target||'').trim();
    if(!target||!dimension?.id||!(Number(dimension.value)>0))continue;
    const found=partForTarget(parts,target.toLowerCase()); if(!found)continue;
    const {part,prefix}=found,remainder=target.slice(prefix.length+1);
    const segmentMatch=remainder.match(/^profile\.(?:boundary|segments?)\.([^.]+)(?:\.(radius|chord|rise|sagitta|length))?$/i);
    if(segmentMatch){
      const token=normalise(segmentMatch[1]),field=normalise(segmentMatch[2]||'length');
      const candidate=(part.profile?.boundary_segments||[]).find((item,index)=>[item?.id,`s${index+1}`,String(index+1)].map(normalise).includes(token));
      if(candidate){
        if(field==='radius'){candidate.radius_dimension_id=dimension.id;candidate.radius_mm=Number(dimension.value);}
        else if(field==='chord'){candidate.chord_dimension_id=dimension.id;candidate.chord_mm=Number(dimension.value);}
        else if(field==='rise'||field==='sagitta'){candidate.rise_dimension_id=dimension.id;candidate.rise_mm=Number(dimension.value);}
        else {candidate.dimension_id=dimension.id;candidate.length_mm=Number(dimension.value);}
      }
      continue;
    }
    const radiusMatch=remainder.match(/^profile\.corner[_ -]?radii\.([^.]+)(?:\.radius)?$/i);
    if(radiusMatch){
      const corner=normalise(radiusMatch[1]);
      const candidate=(part.profile?.corner_radii||[]).find((item)=>normalise(item.corner)===corner);
      if(candidate){candidate.radius_dimension_id=dimension.id;candidate.radius_mm=Number(dimension.value);}
    }
  }
  return extraction;
}

export function enforceAnalysisChecks(extraction){
  if(!extraction||typeof extraction!=='object')return extraction;
  repairCurvedBoundaryLinks(extraction);
  for(const part of extraction.parts||[]){
    const segments=part?.profile?.boundary_segments||[];
    const vector=(direction)=>direction==='right'?[1,0]:direction==='left'?[-1,0]:direction==='up'?[0,1]:direction==='down'?[0,-1]:null;
    for(let index=0;index<segments.length;index++){
      const segment=segments[index];
      if(segment?.kind!=='arc'||segment.chord_dimension_id||Number(segment.chord_mm)>0||!(segment.radius_dimension_id||Number(segment.radius_mm)>0))continue;
      if(!/(notch|corner|transition|ledge|recess)/i.test(String(segment.label||'')))continue;
      const previous=segments[(index-1+segments.length)%segments.length],next=segments[(index+1)%segments.length];
      const incoming=vector(previous?.direction),outgoing=vector(next?.direction);
      if(!incoming||!outgoing||incoming[0]*outgoing[0]+incoming[1]*outgoing[1]!==0)continue;
      const cross=incoming[0]*outgoing[1]-incoming[1]*outgoing[0];
      segment.kind='quarter_arc';segment.direction=previous.direction;segment.turn_direction=cross>0?'left':'right';segment.arc_extent='none';segment.bulge_side='none';
    }
  }
  const uncertainties=Array.isArray(extraction.uncertainties)?extraction.uncertainties:[];
  if(uncertainties.some((message)=>/^template required:/i.test(String(message).trim()))){
    extraction.analysis_checks ||= {};
    extraction.analysis_checks.unsupported_geometry_present=true;
    extraction.production_ready=false;
    extraction.requires_human_review=true;
  }
  return legacyEnforceAnalysisChecks(extraction);
}
