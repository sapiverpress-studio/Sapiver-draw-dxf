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
    dim('chain-w', 60), dim('chain-h', 40), dim('chain-x', 40, 'edge', 'left'), dim('chain-y', 80, 'edge', 'bottom'),
  ],
  analysis: {
    parts: [{
      id: 'panel', label: 'Panel',
      profile: { type: 'rectangle', width_dimension_id: 'outer-w', height_dimension_id: 'outer-h', diameter_dimension_id: null },
      features: [
        { id: 'cutout', type: 'rectangular_cutout', quantity: 1, width_dimension_id: 'cut-w', height_dimension_id: 'cut-h', diameter_dimension_id: null, radius_dimension_id: null, x_dimension_id: 'cut-x', y_dimension_id: 'cut-y' },
        { id: 'hole', type: 'circular_hole', quantity: 1, width_dimension_id: null, height_dimension_id: null, diameter_dimension_id: 'hole-d', radius_dimension_id: null, x_dimension_id: 'hole-x', y_dimension_id: 'hole-y' },
        { id: 'slot', type: 'slot', quantity: 1, width_dimension_id: 'slot-w', height_dimension_id: 'slot-h', diameter_dimension_id: null, radius_dimension_id: null, x_dimension_id: 'slot-x', y_dimension_id: 'slot-y' },
        { id: 'chained', type: 'rectangular_cutout', quantity: 1, x_relative_to_feature_id: 'cutout', width_dimension_id: 'chain-w', height_dimension_id: 'chain-h', diameter_dimension_id: null, radius_dimension_id: null, x_dimension_id: 'chain-x', y_dimension_id: 'chain-y' },
      ],
    }],
  },
};

const geometry = compileSourceGeometry(source);
assert.equal(geometry.ok, true, geometry.errors.join('\n'));
assert.equal(geometry.parts.length, 1);
assert.equal(geometry.parts[0].entities.length, 5);

const cutout = geometry.parts[0].entities[1];
assert.equal(cutout.points[0].x, 100, 'edge reference from left must locate the near cutout edge');
assert.equal(cutout.points[0].y, 50, 'centre Y 75 with 50 mm height must give bottom edge 50');

const slot = geometry.parts[0].entities[3];
const xs = slot.points.map((p) => p.x);
const ys = slot.points.map((p) => p.y);
assert.ok(Math.abs(Math.max(...xs) - 1080) < 0.001, 'right-edge reference must locate slot near edge at 120 mm from right');
assert.ok(Math.abs(Math.max(...ys) - 560) < 0.001, 'top-edge reference must locate slot near edge at 40 mm from top');

const chained = geometry.parts[0].entities[4];
assert.equal(chained.points[0].x, 240, 'chained gap must run from the previous cut-out right edge to the new cut-out left edge');

const dxf = buildDxf(geometry.parts[0].entities);
assert.match(dxf, /\r\nCIRCLE\r\n/, 'circular hole must use a DXF CIRCLE entity');
assert.match(dxf, /\r\nPOLYLINE\r\n/, 'outer profile and cutouts must use R12 polylines');
assert.match(dxf, /\r\nVERTEX\r\n/, 'R12 polylines must contain legacy VERTEX entities');
assert.doesNotMatch(dxf, /LWPOLYLINE|AcDb/, 'R12 output must not contain AutoCAD 2000 entity records');
assert.match(dxf, /\r\nAC1009\r\n/, 'DXF must use the GstarCAD-tested AutoCAD R12 version');
assert.match(dxf, /\r\n4\r\n/, 'DXF units must be millimetres');
assert.ok(!/(^|[^\r])\n/.test(dxf), 'DXF must use Windows CRLF line endings');

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

const toughened = structuredClone(source);
toughened.manufacturingControlsV1 = true;
toughened.toughened = true;
toughened.glassThicknessMm = 10;
for (const feature of toughened.analysis.parts[0].features) {
  if (['rectangular_cutout','slot'].includes(feature.type)) {
    feature.cutout_finish = 'unpolished';
    feature.cutout_finish_confirmed = true;
  }
}
const safeToughened = compileSourceGeometry(toughened);
assert.equal(safeToughened.ok, true, safeToughened.errors.join('\n'));

const missingFinish = structuredClone(toughened);
missingFinish.analysis.parts[0].features[0].cutout_finish_confirmed = false;
const blockedMissingFinish = compileSourceGeometry(missingFinish);
assert.equal(blockedMissingFinish.ok, false);
assert.match(blockedMissingFinish.errors.join('\n'), /confirm whether the cut-out is polished or unpolished/i);

const edgeUnsafe = structuredClone(toughened);
edgeUnsafe.dimensions.find((d) => d.id === 'cut-x').valueMm = 10;
const blockedEdgeClearance = compileSourceGeometry(edgeUnsafe);
assert.equal(blockedEdgeClearance.ok, false);
assert.match(blockedEdgeClearance.errors.join('\n'), /10\.00 mm; minimum is 15\.00 mm \(1\.5 × 10 mm\)/i);

const cornerUnsafe = structuredClone(toughened);
cornerUnsafe.dimensions.find((d) => d.id === 'cut-x').valueMm = 30;
cornerUnsafe.dimensions.find((d) => d.id === 'cut-y').valueMm = 45;
const blockedCornerClearance = compileSourceGeometry(cornerUnsafe);
assert.equal(blockedCornerClearance.ok, false);
assert.match(blockedCornerClearance.errors.join('\n'), /clearance to the nearest panel corner.*minimum is 40\.00 mm \(4 × 10 mm\)/i);

const missingThickness = structuredClone(toughened);
missingThickness.glassThicknessMm = null;
const blockedMissingThickness = compileSourceGeometry(missingThickness);
assert.equal(blockedMissingThickness.ok, false);
assert.match(blockedMissingThickness.errors.join('\n'), /enter the confirmed glass thickness/i);

console.log('Quick DXF deterministic geometry tests passed.');
