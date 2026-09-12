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
- Halifax Glass manufacturing limits are R15 minimum for polished/CNC cut-outs and R6 minimum for unpolished cut-outs. Set cutout_finish only when the drawing explicitly states the process; otherwise use unknown. The operator must confirm the process before release.
- For a general dimensioned curved outline, use profile type path. Trace boundary_segments in order around the perimeter.
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
segment.properties.kind.enum = ['horizontal','vertical','arc','connect','connect_arc'];
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
});
for (const field of ['chord_mm','chord_dimension_id','radius_mm','radius_dimension_id','rise_mm','rise_dimension_id','bulge_side','arc_extent']) {
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
  const uncertainties=Array.isArray(extraction.uncertainties)?extraction.uncertainties:[];
  if(uncertainties.some((message)=>/^template required:/i.test(String(message).trim()))){
    extraction.analysis_checks ||= {};
    extraction.analysis_checks.unsupported_geometry_present=true;
    extraction.production_ready=false;
    extraction.requires_human_review=true;
  }
  return legacyEnforceAnalysisChecks(extraction);
}
