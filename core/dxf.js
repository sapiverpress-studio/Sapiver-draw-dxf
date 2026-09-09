/**
 * Deterministic 2D DXF writer.
 * Coordinates are millimetres. Supported entities: closed polylines, circles and arcs.
 */
function cleanNumber(value) {
  if (!Number.isFinite(Number(value))) throw new Error('DXF coordinate is not finite');
  return Number(Number(value).toFixed(4));
}

function pair(code, value) {
  return `${code}\r\n${value}\r\n`;
}

function header(layer) {
  let dxf = '';
  dxf += pair(0, 'SECTION');
  dxf += pair(2, 'HEADER');
  dxf += pair(9, '$ACADVER');
  dxf += pair(1, 'AC1009');
  dxf += pair(9, '$INSUNITS');
  dxf += pair(70, 4);
  dxf += pair(0, 'ENDSEC');
  dxf += pair(0, 'SECTION');
  dxf += pair(2, 'TABLES');
  dxf += pair(0, 'TABLE');
  dxf += pair(2, 'LAYER');
  dxf += pair(70, 1);
  dxf += pair(0, 'LAYER');
  dxf += pair(2, layer);
  dxf += pair(70, 0);
  dxf += pair(62, 7);
  dxf += pair(6, 'CONTINUOUS');
  dxf += pair(0, 'ENDTAB');
  dxf += pair(0, 'ENDSEC');
  dxf += pair(0, 'SECTION');
  dxf += pair(2, 'ENTITIES');
  return dxf;
}

function polylineEntity(entity, layer) {
  const points = entity.points;
  if (!Array.isArray(points) || points.length < 2) throw new Error('Polyline requires at least two vertices');
  let dxf = '';
  dxf += pair(0, 'POLYLINE');
  dxf += pair(8, layer);
  dxf += pair(66, 1);
  dxf += pair(70, entity.closed === false ? 0 : 1);
  for (const p of points) {
    dxf += pair(0, 'VERTEX');
    dxf += pair(8, layer);
    dxf += pair(10, cleanNumber(p.x));
    dxf += pair(20, cleanNumber(p.y));
    dxf += pair(30, 0);
  }
  dxf += pair(0, 'SEQEND');
  dxf += pair(8, layer);
  return dxf;
}

function circleEntity(entity, layer) {
  if (!(Number(entity.r) > 0)) throw new Error('Circle radius must be positive');
  let dxf = '';
  dxf += pair(0, 'CIRCLE');
  dxf += pair(8, layer);
  dxf += pair(10, cleanNumber(entity.cx));
  dxf += pair(20, cleanNumber(entity.cy));
  dxf += pair(30, 0);
  dxf += pair(40, cleanNumber(entity.r));
  return dxf;
}

function arcEntity(entity, layer) {
  if (!(Number(entity.r) > 0)) throw new Error('Arc radius must be positive');
  let dxf = '';
  dxf += pair(0, 'ARC');
  dxf += pair(8, layer);
  dxf += pair(10, cleanNumber(entity.cx));
  dxf += pair(20, cleanNumber(entity.cy));
  dxf += pair(30, 0);
  dxf += pair(40, cleanNumber(entity.r));
  dxf += pair(50, cleanNumber(entity.startDeg));
  dxf += pair(51, cleanNumber(entity.endDeg));
  return dxf;
}

export function buildDxf(entities, { layer = 'CUT' } = {}) {
  if (!Array.isArray(entities) || entities.length === 0) throw new Error('At least one DXF entity is required');
  let dxf = header(layer);
  for (const entity of entities) {
    if (entity?.type === 'polyline') dxf += polylineEntity(entity, layer);
    else if (entity?.type === 'circle') dxf += circleEntity(entity, layer);
    else if (entity?.type === 'arc') dxf += arcEntity(entity, layer);
    else throw new Error(`Unsupported DXF entity: ${entity?.type || 'unknown'}`);
  }
  dxf += pair(0, 'ENDSEC');
  dxf += pair(0, 'EOF');
  return dxf;
}

export function buildCutDxf(polylines, { layer = 'CUT' } = {}) {
  if (!Array.isArray(polylines) || polylines.length === 0) throw new Error('At least one cut polyline is required');
  return buildDxf(polylines.map((points) => ({ type: 'polyline', points, closed: true })), { layer });
}

export function downloadTextFile(text, filename, mime = 'application/dxf') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
