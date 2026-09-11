import assert from 'node:assert/strict';
import {
  confirmationArcPoints,
  confirmationPartSizeText,
  drawCompiledGeometry,
} from '../core/confirmation-pdf.js';

const arc = {
  type: 'arc', cx: 600, cy: 600, r: 600,
  startDeg: 0, endDeg: 180,
  travelStartDeg: 0, travelSweepDeg: 180,
  role: 'outer',
};
const points = confirmationArcPoints(arc);
assert.ok(points.length >= 33);
assert.ok(points.some((point) => point.y > 1199), 'confirmation preview must include the top of the arch');

const part = {
  label: 'Curved-top panel',
  bounds: { width: 1200, height: 1200 },
  profile: { type: 'path', segments: [{}, {}, {}, {}] },
  entities: [
    { type: 'polyline', points: [{ x: 0, y: 600 }, { x: 0, y: 0 }], closed: false, role: 'outer' },
    { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1200, y: 0 }], closed: false, role: 'outer' },
    { type: 'polyline', points: [{ x: 1200, y: 0 }, { x: 1200, y: 600 }], closed: false, role: 'outer' },
    arc,
    { type: 'circle', cx: 500, cy: 300, r: 25, role: 'cut' },
  ],
};

assert.equal(confirmationPartSizeText(part), 'Measured curved perimeter - 4 segments');
assert.doesNotMatch(confirmationPartSizeText(part), /Diameter/);
assert.equal(confirmationPartSizeText({ profile: { type: 'circle', diameter: 300 } }), 'Diameter 300 mm');

const calls = { lines: [], circles: [], text: [] };
const page = {
  drawRectangle() {},
  drawLine(options) { calls.lines.push(options); },
  drawCircle(options) { calls.circles.push(options); },
  drawText(text) { calls.text.push(text); },
};
const font = { widthOfTextAtSize: (text) => text.length * 5 };
const drawn = drawCompiledGeometry(page, { ok: true, parts: [part] }, 36, 445, 523, 295, font, font, (...values) => values);
assert.equal(drawn, true);
assert.ok(calls.lines.length > 30, 'the PDF renderer must draw the sampled arch as connected lines');
assert.equal(calls.circles.length, 1);
assert.ok(calls.text.includes('Measured curved perimeter - 4 segments'));

console.log('confirmation PDF curved geometry tests passed');
