export const ANALYSIS_PROMPT = `You are analysing a photographed or scanned 2D fabrication drawing for a Quick DXF trade-counter/site workflow.
The operator and customer will verify every production dimension before any DXF is generated.

MANDATORY ANALYSIS ORDER — do not start by listing numbers:
1. Locate each separate physical part or detail view.
2. Trace the complete visible outer perimeter of each part, segment by segment, including slopes, steps, corner removals and edge recesses.
3. Classify the base profile and every boundary or internal feature.
4. Locate conventional square-corner symbols and record the exact corners they mark. A small box touching two boundary lines is a 90-degree marker, not a cut-out.
5. Follow each dimension line, extension line and arrowhead to identify the exact two endpoints it measures.
6. Extract its written value only after its target is identified, then link its dimension id directly to that profile side, notch, cut-out, hole or position.
7. Check that every figured production measurement has been linked wherever its target is visually clear.
8. Check that the proposed perimeter is topologically closed and consistent with the figured constraints. This is a topology check, never permission to invent a missing length from image scale.
9. Complete analysis_checks honestly. If a check fails, explain the specific issue in uncertainties and set production_ready false.

GENERAL RULES:
- Read only dimensions explicitly written or unambiguously indicated. Never invent a production dimension from visual scale.
- Extract every legible fabrication dimension even when other dimensions are unclear.
- Give every extracted figured dimension a stable short id such as d1, d2, d3.
- Group dimensions and features into separate parts/details whenever the source contains more than one physical item.
- For each outer-profile size and every feature size/position, link the geometry parameter to the exact figured dimension id that supports it. If no figured dimension supports it, set that dimension-id field to null rather than inferring from scale.
- Do not leave a figured outer side, notch size, cut-out size or feature position as an unlinked read merely because the perimeter is stepped, tapered or unfamiliar. If its dimension-line endpoints clearly identify the target, link it and lower confidence only when the handwriting is uncertain.
- Distinguish overall/size dimensions from positional dimensions.
- For cut-outs or holes, identify whether each position dimension terminates at the feature centre/centreline or at an edge. If unclear, use unknown.
- If a position is measured from an outer edge, identify left/right/top/bottom when clear.
- A centre mark, CL symbol, crossed-centre symbol or dimension line terminating at a feature centre supports centre reference.
- A dimension line terminating at a drawn feature boundary supports edge reference.
- A vertical figured dimension beside an outer side normally measures the visible vertical segment between its arrowheads. If that segment ends at a notch shoulder, it is the shoulder height, not the unseen full-envelope height.
- A horizontal figure across the bottom boundary normally describes the bottom span; words such as “overall” are helpful but are not required when the arrowheads clearly terminate at the two bottom corners.
- Dashed boxes may be reference/clearance areas. Do not silently treat them as physical cut boundaries.
- production_ready must be false whenever any required dimension, position, feature type or reference is uncertain.
- Use millimetres only when supported by the drawing/context. Do not silently convert unknown units.
- Focus on simple flat 2D geometry: outer profiles, holes, slots, notches, rectangular cut-outs and simple arcs/radii.
- Use profile type quadrilateral only when all four side lengths are figured and at least one corner is explicitly marked 90 degrees. Record the named 90-degree corners.
- A small square, an L-shaped square marker, or a box drawn inside a corner is an explicit 90-degree indication. Also recognise ordinary workshop drawing convention: when a straight bottom is clearly drawn horizontal and its adjoining outer sides are clearly intended vertical, treat those bottom corners as 90° unless a slope, angle, conflicting dimension or visibly non-orthogonal construction contradicts that interpretation. Hand-drawn line wobble alone is not a reason to reject the intended square corner. Record inferred conventional corners with medium confidence and ask for confirmation, but still build and link the proposed geometry.
- A tapered four-sided panel may omit the top length when the bottom length, left height and right height are figured and both bottom corners are marked 90°. In that exact case use quadrilateral, link bottom/left/right, leave top_mm and top_dimension_id null, and record bottom-left plus bottom-right in right_angle_corners. The deterministic engine will calculate the sloping top from those confirmed constraints.
- When a tapered panel has rectangular notches at both top corners and the figured left/right vertical sides end at the lower notch shoulders, use quadrilateral with those actual shoulder heights in left/right, set side_heights_to_notch_shoulders true, leave the top unfigured, and create top-left and top-right corner_notch features. Link the obvious bottom and shoulder dimensions directly; do not leave them as unassigned reads. A low-confidence handwritten notch figure must still be linked so the operator can correct it during confirmation.
- Use corner_notch for a rectangular cut removed from a named panel corner. Use edge_notch for a rectangular recess into a named edge, with its offset measured from the left for top/bottom edges or from the bottom for left/right edges.
- A corner notch has two independently figured legs. Map the figure parallel to the adjacent horizontal direction to width and the figure parallel to the adjacent vertical direction to depth. Determine top-left/top-right/bottom-left/bottom-right from the traced perimeter, not from reading order.
- Support multiple corner_notch and edge_notch features on the same panel. Do not merge opposite notches into one feature and do not discard the base panel dimensions.
- A stepped or L-shaped outline caused only by a rectangular corner removal is not an irregular profile. Model the uncut maximum envelope as a rectangle using explicitly figured overall width and height, then model the removed corner as corner_notch. For example, a 1500 overall bottom, 500 overall left height, 1000 remaining top, 500 notch width and 250 notch depth is a 1500 x 500 rectangle with a 500 x 250 top-right corner_notch. Do not infer missing closure dimensions unless the figured measurements explicitly support them.
- Keep an internal socket opening as rectangular_cutout even when the outer profile also contains a corner_notch or edge_notch. Link all profile, notch and internal cut-out parameters to their exact dimension ids.
- Preserve ambiguous handwritten values in raw_text and lower confidence rather than guessing.
- Write each genuine ambiguity as a short direct question in uncertainties, naming the affected measurement. For example: “Does 600 mm mean the full right-hand height, or the height to the notch ledge?” Do not create generic uncertainty messages for measurements whose dimension lines and targets are clear.
- Model confidence is advisory only. Human confirmation is mandatory for every production dimension.

FINAL SELF-CHECK BEFORE RETURNING JSON:
- Every visually clear outer-profile figure is linked to a profile parameter.
- Every visually clear notch/cut-out/hole size is linked to its feature.
- Every visually clear feature-position figure is linked with centre-or-edge and the correct originating outer edge.
- Square symbols are represented in right_angle_corners and are not features.
- A sloping drawn boundary remains sloping; do not replace it with a horizontal line.
- Low-confidence handwriting remains linked to the most clearly indicated target and is presented for correction.
- analysis_checks.all_clear_figures_linked is false if any clear production figure would otherwise appear only as an unlinked read.
- If a dimension target names a geometry path such as p1.profile.bottom, p1.profile.left shoulder height, or p1.features.f1.width, the matching *_dimension_id field MUST contain that dimension's id. Never return a named geometry target while leaving its matching geometry link null.

Important geometry-linking rule: numeric geometry values are proposals only. The final deterministic DXF engine will ignore those numeric values and use the human-confirmed dimension referenced by each *_dimension_id field.`;

const nullableDimensionId = { type: ['string', 'null'] };

const dimension = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' },
    raw_text: { type: 'string' },
    value: { type: ['number', 'null'] },
    role: { type: 'string', enum: ['overall', 'size', 'position', 'diameter', 'radius', 'unknown'] },
    reference: { type: 'string', enum: ['centre', 'edge', 'size', 'unknown'] },
    target: { type: ['string', 'null'] },
    from_edge: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'unknown'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['id', 'raw_text', 'value', 'role', 'reference', 'target', 'from_edge', 'confidence'],
};

const feature = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['rectangular_cutout', 'circular_hole', 'slot', 'notch', 'corner_notch', 'edge_notch', 'arc', 'other'] },
    quantity: { type: 'integer', minimum: 1 },
    width_mm: { type: ['number', 'null'] },
    height_mm: { type: ['number', 'null'] },
    diameter_mm: { type: ['number', 'null'] },
    radius_mm: { type: ['number', 'null'] },
    x_mm: { type: ['number', 'null'] },
    x_reference: { type: 'string', enum: ['centre', 'edge', 'unknown'] },
    x_from_edge: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'unknown'] },
    y_mm: { type: ['number', 'null'] },
    y_reference: { type: 'string', enum: ['centre', 'edge', 'unknown'] },
    y_from_edge: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'unknown'] },
    touching_edge: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'none', 'unknown'] },
    width_dimension_id: nullableDimensionId,
    height_dimension_id: nullableDimensionId,
    diameter_dimension_id: nullableDimensionId,
    radius_dimension_id: nullableDimensionId,
    x_dimension_id: nullableDimensionId,
    y_dimension_id: nullableDimensionId,
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    source_note: { type: ['string', 'null'] },
    corner: { type: 'string', enum: ['bottom-left','bottom-right','top-right','top-left','none'] },
    depth_mm: { type: ['number','null'] },
    offset_mm: { type: ['number','null'] },
    depth_dimension_id: nullableDimensionId,
    offset_dimension_id: nullableDimensionId,
  },
  required: [
    'id', 'type', 'quantity', 'width_mm', 'height_mm', 'diameter_mm', 'radius_mm',
    'x_mm', 'x_reference', 'x_from_edge', 'y_mm', 'y_reference', 'y_from_edge', 'touching_edge',
    'width_dimension_id', 'height_dimension_id', 'diameter_dimension_id', 'radius_dimension_id', 'x_dimension_id', 'y_dimension_id',
    'confidence', 'source_note', 'corner', 'depth_mm', 'offset_mm', 'depth_dimension_id', 'offset_dimension_id',
  ],
};

const part = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    profile: {
      type: 'object', additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['rectangle', 'circle', 'quadrilateral', 'polygon', 'irregular', 'unknown'] },
        width_mm: { type: ['number', 'null'] },
        height_mm: { type: ['number', 'null'] },
        diameter_mm: { type: ['number', 'null'] },
        width_dimension_id: nullableDimensionId,
        height_dimension_id: nullableDimensionId,
        diameter_dimension_id: nullableDimensionId,
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        top_mm: { type: ['number','null'] }, bottom_mm: { type: ['number','null'] }, left_mm: { type: ['number','null'] }, right_mm: { type: ['number','null'] },
        top_dimension_id: nullableDimensionId, bottom_dimension_id: nullableDimensionId, left_dimension_id: nullableDimensionId, right_dimension_id: nullableDimensionId,
        right_angle_corners: { type:'array', items:{ type:'string', enum:['bottom-left','bottom-right','top-right','top-left'] } },
        side_heights_to_notch_shoulders: { type:'boolean' },
      },
      required: [
        'type', 'width_mm', 'height_mm', 'diameter_mm',
        'width_dimension_id', 'height_dimension_id', 'diameter_dimension_id', 'confidence',
        'top_mm','bottom_mm','left_mm','right_mm','top_dimension_id','bottom_dimension_id','left_dimension_id','right_dimension_id','right_angle_corners','side_heights_to_notch_shoulders',
      ],
    },
    features: { type: 'array', items: feature },
    dimension_ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'label', 'profile', 'features', 'dimension_ids'],
};

export const ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    units: { type: 'string', enum: ['mm', 'inch', 'unknown'] },
    drawing_label: { type: ['string', 'null'] },
    parts: { type: 'array', items: part },
    dimensions: { type: 'array', items: dimension },
    uncertainties: { type: 'array', items: { type: 'string' } },
    requires_human_review: { type: 'boolean' },
    production_ready: { type: 'boolean' },
    analysis_checks: {
      type: 'object', additionalProperties: false,
      properties: {
        perimeter_traced: { type: 'boolean' },
        dimension_targets_followed: { type: 'boolean' },
        all_clear_figures_linked: { type: 'boolean' },
        square_markers_classified: { type: 'boolean' },
        perimeter_topology_closes: { type: 'boolean' },
        unsupported_geometry_present: { type: 'boolean' },
      },
      required: ['perimeter_traced','dimension_targets_followed','all_clear_figures_linked','square_markers_classified','perimeter_topology_closes','unsupported_geometry_present'],
    },
    summary: { type: 'string' },
  },
  required: ['units', 'drawing_label', 'parts', 'dimensions', 'uncertainties', 'requires_human_review', 'production_ready', 'analysis_checks', 'summary'],
};

function normaliseTargetToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function profileTargetField(token) {
  if (/\bbottom\b/.test(token)) return 'bottom';
  if (/\btop\b/.test(token)) return 'top';
  if (/\bleft\b/.test(token) && /\b(shoulder|height|side|edge|length)\b/.test(token)) return 'left';
  if (/\bright\b/.test(token) && /\b(shoulder|height|side|edge|length)\b/.test(token)) return 'right';
  if (/\b(width|overall width)\b/.test(token)) return 'width';
  if (/\b(height|overall height)\b/.test(token)) return 'height';
  if (/\b(diameter|dia)\b/.test(token)) return 'diameter';
  return null;
}

function featureTargetField(token) {
  if (/\b(diameter|dia)\b/.test(token)) return 'diameter';
  if (/\b(radius|rad)\b/.test(token)) return 'radius';
  if (/\b(depth|deep|rise)\b/.test(token)) return 'depth';
  if (/\b(offset)\b/.test(token)) return 'offset';
  if (/\b(x|horizontal position)\b/.test(token)) return 'x';
  if (/\b(y|vertical position)\b/.test(token)) return 'y';
  if (/\b(width|horizontal|inward)\b/.test(token)) return 'width';
  if (/\b(height|vertical)\b/.test(token)) return 'height';
  return null;
}

export function linkExplicitDimensionTargets(extraction) {
  if (!extraction || typeof extraction !== 'object') return extraction;
  const parts = Array.isArray(extraction.parts) ? extraction.parts : [];
  const dimensions = Array.isArray(extraction.dimensions) ? extraction.dimensions : [];
  for (const dimension of dimensions) {
    const target = String(dimension?.target || '').trim();
    if (!target || !dimension?.id || !(Number(dimension.value) > 0)) continue;
    const lower = target.toLowerCase();
    for (let partIndex=0; partIndex<parts.length; partIndex+=1) {
      const part=parts[partIndex], partNames=[String(part?.id||''),`p${partIndex+1}`].filter(Boolean).map((name)=>name.toLowerCase());
      const prefix=partNames.find((name)=>lower.startsWith(`${name}.`));
      if (!prefix) continue;
      const remainder=target.slice(prefix.length+1);
      if (/^profile\./i.test(remainder)) {
        const field=profileTargetField(normaliseTargetToken(remainder.replace(/^profile\./i,'')));
        if (field && part.profile) {
          part.profile[`${field}_dimension_id`]=dimension.id;
          part.profile[`${field}_mm`]=Number(dimension.value);
        }
        break;
      }
      const featureMatch=remainder.match(/^features?\.([^.]*)\.(.+)$/i);
      if (!featureMatch) break;
      const featureToken=normaliseTargetToken(featureMatch[1]);
      const feature=(part.features||[]).find((candidate,index)=>{
        const names=[candidate?.id,`f${index+1}`,String(index+1)].map(normaliseTargetToken);
        return names.includes(featureToken);
      });
      const field=featureTargetField(normaliseTargetToken(featureMatch[2]));
      if (feature && field) {
        feature[`${field}_dimension_id`]=dimension.id;
        feature[`${field}_mm`]=Number(dimension.value);
      }
      break;
    }
  }
  return extraction;
}

export function enforceAnalysisChecks(extraction) {
  if (!extraction || typeof extraction !== 'object') return extraction;
  const checks = extraction.analysis_checks || {};
  const failures = [
    ['perimeter_traced', 'The complete outer perimeter could not be traced.'],
    ['dimension_targets_followed', 'One or more dimension-line targets could not be followed.'],
    ['all_clear_figures_linked', 'One or more clearly targeted production figures were not linked to geometry.'],
    ['square_markers_classified', 'One or more possible square-corner markers could not be classified.'],
    ['perimeter_topology_closes', 'The proposed perimeter does not form a verified closed boundary.'],
  ].filter(([field]) => checks[field] !== true).map(([, message]) => message);
  if (checks.unsupported_geometry_present === true) failures.push('The drawing contains geometry outside the deterministic DXF engine’s supported set.');
  if (!failures.length) return extraction;
  const existing = Array.isArray(extraction.uncertainties) ? extraction.uncertainties : [];
  extraction.uncertainties = [...new Set([...existing, ...failures])];
  extraction.production_ready = false;
  extraction.requires_human_review = true;
  return extraction;
}
