import assert from 'node:assert/strict';
import { compileSourceGeometry } from '../core/geometry.js';
import { buildDxf } from '../core/dxf.js';

const dim = (id, valueMm, reference = 'size', fromEdge = 'unknown') => ({
  id, label: id, valueMm, reference, fromEdge, confirmed: true,
});

const source = {
  dimensions: [
    dim('outer-w', 1200), dim('outer-h', 600),
    dim('cut-w', 100), dim('cut-h', 50),
    dim('cut-x', 100, 'edge', 'left'), dim('cut-y', 75, 'centre', 'bottom'),
    dim('hole-d', 20), dim('hole-x', 300, 'centre', 'left'), dim('hole-y', 200, 'centre', 'bottom'),
    dim('slot-w', 80), dim('slot-h', 20), dim('slot-x', 120, 'edge', 'right'), dim('slot-y', 40, 'edge', 'top'),
  ],
  analysis: {
    parts: [{
      id: 'panel', label: 'Panel',
      profile: { type: 'rectangle', width_dimension_id: 'outer-w', height_dimension_id: 'outer-h', diameter_dimension_id: null },
      features: [
        { id: 'cutout', type: 'rectangular_cutout', quantity: 1, width_dimension_id: 'cut-w', height_dimension_id: 'cut-h', diameter_dimension_id: null, radius_dimension_id: null, x_dimension_id: 'cut-x', y_dimension_id: 'cut-y' },
        { id: 'hole', type: 'circular_hole', quantity: 1, width_dimension_id: null, height_dimension_id: null, diameter_dimension_id: 'hole-d', radius_dimension_id: null, x_dimension_id: 'hole-x', y_dimension_id: 'hole-y' },
        { id: 'slot', type: 'slot', quantity: 1, width_dimension_id: 'slot-w', height_dimension_id: 'slot-h', diameter_dimension_id: null, radius_dimension_id: null, x_dimension_id: 'slot-x', y_dimension_id: 'slot-y' },
      ],
    }],
  },
};

const geometry = compileSourceGeometry(source);
assert.equal(geometry.ok, true, geometry.errors.join('\n'));
assert.equal(geometry.parts.length, 1);
assert.equal(geometry.parts[0].entities.length, 4);

const cutout = geometry.parts[0].entities[1];
assert.equal(cutout.points[0].x, 100, 'edge reference from left must locate the near cutout edge');
assert.equal(cutout.points[0].y, 50, 'centre Y 75 with 50 mm height must give bottom edge 50');

const slot = geometry.parts[0].entities[3];
const xs = slot.points.map((p) => p.x);
const ys = slot.points.map((p) => p.y);
assert.ok(Math.abs(Math.max(...xs) - 1080) < 0.001, 'right-edge reference must locate slot near edge at 120 mm from right');
assert.ok(Math.abs(Math.max(...ys) - 560) < 0.001, 'top-edge reference must locate slot near edge at 40 mm from top');

const dxf = buildDxf(geometry.parts[0].entities);
assert.match(dxf, /\nCIRCLE\n/, 'circular hole must use a DXF CIRCLE entity');
assert.match(dxf, /\nLWPOLYLINE\n/, 'outer profile and cutouts must use polylines');
assert.match(dxf, /\n4\n/, 'DXF units must be millimetres');

const unsafe = structuredClone(source);
unsafe.dimensions.find((d) => d.id === 'hole-x').fromEdge = 'unknown';
const blocked = compileSourceGeometry(unsafe);
assert.equal(blocked.ok, false);
assert.ok(blocked.errors.some((e) => e.includes('outer edge')));

const unsupported = structuredClone(source);
unsupported.analysis.parts[0].features.push({ id: 'notch', type: 'notch', quantity: 1 });
const blockedUnsupported = compileSourceGeometry(unsupported);
assert.equal(blockedUnsupported.ok, false);
assert.ok(blockedUnsupported.errors.some((e) => e.includes('not yet supported')));

console.log('Quick DXF deterministic geometry tests passed.');
