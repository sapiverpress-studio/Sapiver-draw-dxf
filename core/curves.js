const EPS = 1e-7;

function point(x, y) {
  return { x: Number(x), y: Number(y) };
}

function normaliseDeg(value) {
  let result = Number(value) % 360;
  if (result < 0) result += 360;
  return result;
}

function sideOfChord(start, end, sample) {
  return Math.sign((end.x - start.x) * (sample.y - start.y) - (end.y - start.y) * (sample.x - start.x));
}

function arcPoint(cx, cy, r, degrees) {
  const radians = degrees * Math.PI / 180;
  return point(cx + r * Math.cos(radians), cy + r * Math.sin(radians));
}

function sampleSweep(cx, cy, r, startDeg, sweepDeg, segments = 32) {
  const count = Math.max(6, Math.ceil(Math.abs(sweepDeg) / 7.5), segments);
  return Array.from({ length: count + 1 }, (_, index) => arcPoint(cx, cy, r, startDeg + sweepDeg * index / count));
}

export function radiusFromChordRise(chord, rise, { extent = 'minor' } = {}) {
  chord = Number(chord);
  rise = Number(rise);
  if (!(chord > EPS)) throw new Error('Arc chord must be positive.');
  if (!(rise > EPS)) throw new Error('Arc rise must be positive.');
  const radius = chord * chord / (8 * rise) + rise / 2;
  if (extent === 'minor' && rise > chord / 2 + EPS) {
    throw new Error('A minor arc rise cannot exceed half its chord; confirm whether this is a major arc.');
  }
  if (extent === 'major' && rise < chord / 2 - EPS) {
    throw new Error('A major arc rise must exceed half its chord; confirm whether this is a minor arc.');
  }
  if (extent === 'semicircle' && Math.abs(rise - chord / 2) > 1e-5) {
    throw new Error('A semicircular arc rise must equal half its chord.');
  }
  return radius;
}

function chooseArcCandidate(start, end, radius, bulgeSide, extent) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (!(chord > EPS)) throw new Error('Arc chord has zero length.');
  if (!(radius > 0)) throw new Error('Arc radius must be positive.');
  if (chord > radius * 2 + 1e-6) throw new Error(`Arc chord ${chord.toFixed(4)} mm is longer than the diameter ${Number(radius * 2).toFixed(4)} mm.`);

  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const h = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  const nx = -dy / chord;
  const ny = dx / chord;
  const centres = h <= EPS
    ? [point(mx, my)]
    : [point(mx + nx * h, my + ny * h), point(mx - nx * h, my - ny * h)];
  const requestedSide = bulgeSide === 'right' ? -1 : 1;
  const requestedExtent = extent || (Math.abs(chord - 2 * radius) <= 1e-5 ? 'semicircle' : 'minor');
  const candidates = [];

  for (const centre of centres) {
    const a0 = normaliseDeg(Math.atan2(start.y - centre.y, start.x - centre.x) * 180 / Math.PI);
    const a1 = normaliseDeg(Math.atan2(end.y - centre.y, end.x - centre.x) * 180 / Math.PI);
    let ccw = normaliseDeg(a1 - a0);
    if (ccw < EPS) ccw = 360;
    const sweeps = [ccw, ccw - 360];
    for (const sweep of sweeps) {
      const absSweep = Math.abs(sweep);
      const midpoint = arcPoint(centre.x, centre.y, radius, a0 + sweep / 2);
      const side = sideOfChord(start, end, midpoint);
      const sideOk = side === 0 || side === requestedSide;
      const extentOk = requestedExtent === 'major'
        ? absSweep > 180 + 1e-5
        : requestedExtent === 'semicircle'
          ? Math.abs(absSweep - 180) <= 1e-4
          : absSweep <= 180 + 1e-5;
      if (sideOk && extentOk) candidates.push({ centre, a0, a1, sweep, absSweep });
    }
  }

  if (!candidates.length) throw new Error(`Could not construct the requested ${requestedExtent} arc bulging ${bulgeSide || 'left'}.`);
  candidates.sort((a, b) => requestedExtent === 'major' ? b.absSweep - a.absSweep : a.absSweep - b.absSweep);
  return candidates[0];
}

export function arcFromChord(start, end, radius, {
  bulgeSide = 'left',
  extent = 'minor',
  role = 'outer',
  label = 'Arc',
  previewSegments = 32,
} = {}) {
  const chosen = chooseArcCandidate(start, end, Number(radius), bulgeSide, extent);
  const previewPoints = sampleSweep(chosen.centre.x, chosen.centre.y, Number(radius), chosen.a0, chosen.sweep, previewSegments);
  const dxfStartDeg = chosen.sweep >= 0 ? chosen.a0 : chosen.a1;
  const dxfEndDeg = chosen.sweep >= 0 ? chosen.a1 : chosen.a0;
  return {
    type: 'arc',
    cx: chosen.centre.x,
    cy: chosen.centre.y,
    r: Number(radius),
    startDeg: normaliseDeg(dxfStartDeg),
    endDeg: normaliseDeg(dxfEndDeg),
    travelStartDeg: chosen.a0,
    travelSweepDeg: chosen.sweep,
    previewPoints,
    role,
    label,
  };
}

export function lineEntity(start, end, { role = 'outer', label = 'Line' } = {}) {
  return { type: 'polyline', points: [point(start.x, start.y), point(end.x, end.y)], closed: false, role, label };
}

export function translateEntity(entity, dx, dy) {
  if (entity.type === 'circle' || entity.type === 'arc') {
    return {
      ...entity,
      cx: entity.cx + dx,
      cy: entity.cy + dy,
      previewPoints: entity.previewPoints?.map((p) => point(p.x + dx, p.y + dy)),
    };
  }
  return { ...entity, points: entity.points.map((p) => point(p.x + dx, p.y + dy)) };
}

function appendBoundaryPoints(target, entity) {
  const source = entity.type === 'arc' ? entity.previewPoints : entity.points;
  for (const p of source || []) {
    const last = target[target.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > EPS) target.push(point(p.x, p.y));
  }
}

export function buildCurvedPath(compiledSegments, { label = 'Measured perimeter' } = {}) {
  if (!Array.isArray(compiledSegments) || compiledSegments.length < 3) throw new Error(`${label}: at least three perimeter segments are required.`);
  const closingIndexes = compiledSegments.map((segment, index) => ['connect', 'connect_arc'].includes(segment.kind) ? index : -1).filter((index) => index >= 0);
  if (closingIndexes.length !== 1) throw new Error(`${label}: exactly one connect or connect_arc segment is required.`);

  const vectors = compiledSegments.map((segment) => {
    if (['connect', 'connect_arc'].includes(segment.kind)) return null;
    const span = segment.kind === 'arc' ? Number(segment.chord) : Number(segment.length);
    if (!(span > 0)) throw new Error(`${label} / ${segment.label || segment.id}: segment span must be positive.`);
    const direction = segment.direction;
    if (direction === 'right') return [span, 0];
    if (direction === 'left') return [-span, 0];
    if (direction === 'up') return [0, span];
    if (direction === 'down') return [0, -span];
    throw new Error(`${label} / ${segment.label || segment.id}: invalid segment direction.`);
  });
  const known = vectors.filter(Boolean).reduce((sum, vector) => [sum[0] + vector[0], sum[1] + vector[1]], [0, 0]);
  vectors[closingIndexes[0]] = [-known[0], -known[1]];
  if (Math.hypot(...vectors[closingIndexes[0]]) < EPS) throw new Error(`${label}: calculated closing perimeter segment has zero length.`);

  const entities = [];
  const boundaryPoints = [];
  let cursor = point(0, 0);
  for (let index = 0; index < compiledSegments.length; index += 1) {
    const segment = compiledSegments[index];
    const vector = vectors[index];
    const end = point(cursor.x + vector[0], cursor.y + vector[1]);
    let entity;
    if (segment.kind === 'arc' || segment.kind === 'connect_arc') {
      const chord = Math.hypot(end.x - cursor.x, end.y - cursor.y);
      const radius = Number(segment.radius) > 0
        ? Number(segment.radius)
        : radiusFromChordRise(chord, Number(segment.rise), { extent: segment.extent || 'minor' });
      if (Number(segment.radius) > 0 && Number(segment.rise) > 0) {
        const radiusFromRise = radiusFromChordRise(chord, Number(segment.rise), { extent: segment.extent || 'minor' });
        if (Math.abs(radius - radiusFromRise) > 0.05) throw new Error(`${label} / ${segment.label || segment.id}: confirmed radius and rise do not describe the same circular arc.`);
      }
      entity = arcFromChord(cursor, end, radius, {
        bulgeSide: segment.bulgeSide || 'left',
        extent: segment.extent || 'minor',
        role: 'outer',
        label: segment.label || segment.id || 'Arc',
      });
    } else {
      entity = lineEntity(cursor, end, { role: 'outer', label: segment.label || segment.id || 'Boundary line' });
    }
    appendBoundaryPoints(boundaryPoints, entity);
    entities.push(entity);
    cursor = end;
  }
  if (Math.hypot(cursor.x, cursor.y) > 1e-5) throw new Error(`${label}: perimeter did not close after applying the calculated closing segment.`);
  if (boundaryPoints.length > 1 && Math.hypot(boundaryPoints[0].x - boundaryPoints.at(-1).x, boundaryPoints[0].y - boundaryPoints.at(-1).y) <= EPS) boundaryPoints.pop();

  const minX = Math.min(...boundaryPoints.map((p) => p.x));
  const minY = Math.min(...boundaryPoints.map((p) => p.y));
  const translatedEntities = entities.map((entity) => translateEntity(entity, -minX, -minY));
  const points = boundaryPoints.map((p) => point(p.x - minX, p.y - minY));
  return { entities: translatedEntities, points };
}

function arcQuarter(cx, cy, r, startDeg, endDeg, label) {
  const sweep = endDeg - startDeg;
  return {
    type: 'arc', cx, cy, r, startDeg: normaliseDeg(startDeg), endDeg: normaliseDeg(endDeg),
    travelStartDeg: startDeg, travelSweepDeg: sweep,
    previewPoints: sampleSweep(cx, cy, r, startDeg, sweep, 12), role: 'outer', label,
  };
}

export function buildRoundedRectangle(width, height, radii = {}, { label = 'Panel', role = 'outer' } = {}) {
  width = Number(width);
  height = Number(height);
  if (!(width > 0 && height > 0)) throw new Error(`${label}: width and height must be positive.`);
  const r = {
    'bottom-left': Number(radii['bottom-left'] || 0),
    'bottom-right': Number(radii['bottom-right'] || 0),
    'top-right': Number(radii['top-right'] || 0),
    'top-left': Number(radii['top-left'] || 0),
  };
  for (const [corner, value] of Object.entries(r)) if (!(value >= 0)) throw new Error(`${label}: ${corner} radius must not be negative.`);
  if (r['bottom-left'] + r['bottom-right'] > width + EPS || r['top-left'] + r['top-right'] > width + EPS || r['bottom-left'] + r['top-left'] > height + EPS || r['bottom-right'] + r['top-right'] > height + EPS) {
    throw new Error(`${label}: confirmed corner radii overlap the available panel width or height.`);
  }

  const entities = [];
  const points = [];
  const addLine = (a, b, name) => {
    if (Math.hypot(b.x - a.x, b.y - a.y) <= EPS) return;
    const entity = lineEntity(a, b, { role, label: name });
    entities.push({ ...entity, role });
    appendBoundaryPoints(points, entity);
  };
  const addArc = (entity) => {
    if (!(entity.r > EPS)) return;
    entities.push({ ...entity, role });
    appendBoundaryPoints(points, entity);
  };

  const bl = r['bottom-left'], br = r['bottom-right'], tr = r['top-right'], tl = r['top-left'];
  addLine(point(bl, 0), point(width - br, 0), 'Bottom edge');
  if (br > EPS) addArc(arcQuarter(width - br, br, br, -90, 0, 'Bottom-right radius'));
  addLine(point(width, br), point(width, height - tr), 'Right edge');
  if (tr > EPS) addArc(arcQuarter(width - tr, height - tr, tr, 0, 90, 'Top-right radius'));
  addLine(point(width - tr, height), point(tl, height), 'Top edge');
  if (tl > EPS) addArc(arcQuarter(tl, height - tl, tl, 90, 180, 'Top-left radius'));
  addLine(point(0, height - tl), point(0, bl), 'Left edge');
  if (bl > EPS) addArc(arcQuarter(bl, bl, bl, 180, 270, 'Bottom-left radius'));

  if (!points.length) throw new Error(`${label}: rounded rectangle boundary is empty.`);
  const last = points.at(-1);
  if (Math.hypot(points[0].x - last.x, points[0].y - last.y) <= EPS) points.pop();
  return { entities, points, radii: r };
}

export function entitySamplePoints(entity) {
  if (entity.type === 'circle') {
    return Array.from({ length: 48 }, (_, i) => point(entity.cx + entity.r * Math.cos(i * Math.PI / 24), entity.cy + entity.r * Math.sin(i * Math.PI / 24)));
  }
  if (entity.type === 'arc') return entity.previewPoints || sampleSweep(entity.cx, entity.cy, entity.r, entity.travelStartDeg ?? entity.startDeg, entity.travelSweepDeg ?? normaliseDeg(entity.endDeg - entity.startDeg), 24);
  return entity.points || [];
}
