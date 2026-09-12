export const OBSERVATION_MODEL = 'gpt-5.6-sol';

export const OBSERVATION_PROMPT = `Inspect this fabrication drawing as a transcription task only.

Do not construct the final panel geometry and do not decide which production schema field a number belongs to.

Record every visible item independently:
- every written dimension, including units, R/radius, diameter, TYP and quantities;
- the two endpoints or targets of each dimension line or leader, described in plain language;
- every visible perimeter segment, including straight, curved, stepped and notched portions;
- every internal hole, slot or cut-out as a separate feature;
- every boundary notch as a separate feature;
- every conventional 90-degree square marker;
- every process note such as polished, unpolished or toughened.

Give each observation a stable ID. Use normalised image coordinates from 0 to 1000 for approximate locations. Coordinates are evidence-location aids only and must never be used to infer manufacturing measurements. If handwriting is unclear, preserve the uncertain reading and lower confidence instead of silently dropping it.`;

const confidence = { type: 'string', enum: ['high', 'medium', 'low'] };
const point = {
  type: 'object', additionalProperties: false,
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
};

export const OBSERVATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    units: { type: 'string', enum: ['mm', 'inch', 'unknown'] },
    dimensions: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' }, raw_text: { type: 'string' }, value: { type: ['number', 'null'] },
          role_hint: { type: 'string', enum: ['overall', 'size', 'position', 'diameter', 'radius', 'quantity', 'unknown'] },
          line_start: point, line_end: point, target_description: { type: 'string' }, confidence,
        },
        required: ['id', 'raw_text', 'value', 'role_hint', 'line_start', 'line_end', 'target_description', 'confidence'],
      },
    },
    perimeter_segments: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' }, kind: { type: 'string', enum: ['straight', 'arc', 'unclear'] },
          start: point, end: point, description: { type: 'string' }, confidence,
        },
        required: ['id', 'kind', 'start', 'end', 'description', 'confidence'],
      },
    },
    features: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' }, type_hint: { type: 'string', enum: ['hole', 'slot', 'internal_cutout', 'boundary_notch', 'unknown'] },
          centre: point, description: { type: 'string' }, confidence,
        },
        required: ['id', 'type_hint', 'centre', 'description', 'confidence'],
      },
    },
    right_angle_markers: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, location: point, confidence }, required: ['id', 'location', 'confidence'] } },
    notes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, text: { type: 'string' }, location: point, confidence }, required: ['id', 'text', 'location', 'confidence'] } },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
  required: ['units', 'dimensions', 'perimeter_segments', 'features', 'right_angle_markers', 'notes', 'uncertainties'],
};

export function geometryPrompt(observations) {
  return `Now construct the final Quick DXF geometry from the observation register below and the original drawing.

Observation register:\n${JSON.stringify(observations)}

Reconcile before answering:
1. Match every visible feature to exactly one feature object.
2. Match each figured dimension to the feature or perimeter element reached by its line/leader endpoints.
3. Do not reuse a position dimension for a different feature unless the source explicitly says TYP/shared.
4. Distinguish outer-profile arcs from internal radii.
5. For every boundary notch, separately account for its position, width/inward extent, depth and radius when shown.
6. List any observation that cannot be linked in uncertainties and set production_ready false.

Return only the required final structured geometry.`;
}
