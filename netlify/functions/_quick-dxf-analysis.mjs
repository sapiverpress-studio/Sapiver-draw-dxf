export const ANALYSIS_PROMPT = `You are analysing a simple 2D fabrication drawing for a Quick DXF trade-counter/site workflow.
The operator and customer will verify every production dimension before any DXF is generated.

Rules:
- Read only dimensions explicitly written or unambiguously indicated. Never invent a production dimension from visual scale.
- Extract every legible fabrication dimension even when other dimensions are unclear.
- Distinguish overall/size dimensions from positional dimensions.
- For cut-outs or holes, identify whether each position dimension terminates at the feature centre/centreline or at an edge. If unclear, use unknown.
- If a position is measured from an outer edge, identify left/right/top/bottom when clear.
- A centre mark, CL symbol, crossed-centre symbol or dimension line terminating at a feature centre supports centre reference.
- A dimension line terminating at a drawn feature boundary supports edge reference.
- Dashed boxes may be reference/clearance areas. Do not silently treat them as physical cut boundaries.
- A source may contain several separate parts/details. Group dimensions and features by part whenever possible.
- production_ready must be false whenever any required dimension, position, feature type or reference is uncertain.
- Use millimetres only when supported by the drawing/context. Do not silently convert unknown units.
- Focus on simple flat 2D geometry: outer profiles, holes, slots, notches, rectangular cut-outs and simple arcs/radii.
- Preserve ambiguous handwritten values in raw_text and lower confidence rather than guessing.
- Model confidence is advisory only. Human confirmation is mandatory for every production dimension.`;

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
    type: { type: 'string', enum: ['rectangular_cutout', 'circular_hole', 'slot', 'notch', 'arc', 'other'] },
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
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    source_note: { type: ['string', 'null'] },
  },
  required: ['id', 'type', 'quantity', 'width_mm', 'height_mm', 'diameter_mm', 'radius_mm', 'x_mm', 'x_reference', 'x_from_edge', 'y_mm', 'y_reference', 'y_from_edge', 'confidence', 'source_note'],
};

const part = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    profile: {
      type: 'object', additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['rectangle', 'circle', 'polygon', 'irregular', 'unknown'] },
        width_mm: { type: ['number', 'null'] },
        height_mm: { type: ['number', 'null'] },
        diameter_mm: { type: ['number', 'null'] },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
      required: ['type', 'width_mm', 'height_mm', 'diameter_mm', 'confidence'],
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
