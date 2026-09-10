export const ANALYSIS_PROMPT = `You are analysing a simple 2D fabrication drawing for a Quick DXF trade-counter/site workflow.
The operator and customer will verify every production dimension before any DXF is generated.

Rules:
- Read only dimensions explicitly written or unambiguously indicated. Never invent a production dimension from visual scale.
- Extract every legible fabrication dimension even when other dimensions are unclear.
- Give every extracted figured dimension a stable short id such as d1, d2, d3.
- Group dimensions and features into separate parts/details whenever the source contains more than one physical item.
- For each outer-profile size and every feature size/position, link the geometry parameter to the exact figured dimension id that supports it. If no figured dimension supports it, set that dimension-id field to null rather than inferring from scale.
- Distinguish overall/size dimensions from positional dimensions.
- For cut-outs or holes, identify whether each position dimension terminates at the feature centre/centreline or at an edge. If unclear, use unknown.
- If a position is measured from an outer edge, identify left/right/top/bottom when clear.
- A centre mark, CL symbol, crossed-centre symbol or dimension line terminating at a feature centre supports centre reference.
- A dimension line terminating at a drawn feature boundary supports edge reference.
- Dashed boxes may be reference/clearance areas. Do not silently treat them as physical cut boundaries.
- production_ready must be false whenever any required dimension, position, feature type or reference is uncertain.
- Use millimetres only when supported by the drawing/context. Do not silently convert unknown units.
- Focus on simple flat 2D geometry: outer profiles, holes, slots, notches, rectangular cut-outs and simple arcs/radii.
- Use profile type quadrilateral only when all four side lengths are figured and at least one corner is explicitly marked 90 degrees. Record the named 90-degree corners.
- Use corner_notch for a rectangular cut removed from a named panel corner. Use edge_notch for a rectangular recess into a named edge, with its offset measured from the left for top/bottom edges or from the bottom for left/right edges.
- Preserve ambiguous handwritten values in raw_text and lower confidence rather than guessing.
- Model confidence is advisory only. Human confirmation is mandatory for every production dimension.

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
      },
      required: [
        'type', 'width_mm', 'height_mm', 'diameter_mm',
        'width_dimension_id', 'height_dimension_id', 'diameter_dimension_id', 'confidence',
        'top_mm','bottom_mm','left_mm','right_mm','top_dimension_id','bottom_dimension_id','left_dimension_id','right_dimension_id','right_angle_corners',
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
    summary: { type: 'string' },
  },
  required: ['units', 'drawing_label', 'parts', 'dimensions', 'uncertainties', 'requires_human_review', 'production_ready', 'summary'],
};
