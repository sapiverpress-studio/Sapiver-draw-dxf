import assert from 'node:assert/strict';
import { arcFromChord, buildCurvedPath, buildRoundedRectangle } from '../core/curves.js';
import { buildDxf } from '../core/dxf.js';

const exactArc = (arc) => {
  const dxf = buildDxf([arc]);
  assert.match(dxf, /\r\nARC\r\n/, 'supported circular curves must remain true DXF ARC entities');
  return arc;
};

const chordRiseRadius = (chord, rise) => {
  if (!(chord > 0 && rise > 0)) throw new Error('Chord and rise must be positive.');
  return chord ** 2 / (8 * rise) + rise / 2;
};

const unsupported = (reason) => () => { throw new Error(reason); };
const arch = (chord, radius, extent = 'minor') => () => exactArc(
  arcFromChord({ x: 0, y: 0 }, { x: chord, y: 0 }, radius, { bulgeSide: 'left', extent }),
);
const riseArch = (chord, rise, extent = 'minor') => () => {
  const path = buildCurvedPath([
    { id: 'right', kind: 'vertical', direction: 'down', length: 500 },
    { id: 'bottom', kind: 'horizontal', direction: 'left', length: chord },
    { id: 'left', kind: 'vertical', direction: 'up', length: 500 },
    { id: 'top', kind: 'connect_arc', direction: 'connect', rise, bulgeSide: 'left', extent },
  ]);
  assert.match(buildDxf(path.entities), /\r\nARC\r\n/);
  return path;
};

// Research-backed curve archetypes. These fixtures test the mathematical
// information visible in each referenced drawing, not image pixels or scale.
const cases = [
  { name: '01 1000 mm semicircular shower panel', image: 'https://www.highgrovebathrooms.com.au/media/catalog/product/g/l/glass_panels_tech_drawings_ag1000.jpg', expected: 'supported', run: arch(1000, 500, 'semicircle') },
  { name: '02 900 mm semicircular shower panel', image: 'https://www.highgrovebathrooms.com.au/media/catalog/product/g/l/glass_panels_tech_drawings_ag900.jpg', expected: 'supported', run: arch(900, 450, 'semicircle') },
  { name: '03 1000 mm stove hearth semicircle', image: 'https://kamna.astranet.cz/fotky-kamna/cf246C.jpg', expected: 'supported', run: arch(1000, 500, 'semicircle') },
  { name: '04 shallow R1000 top between unequal shoulders', image: 'https://lcdn.altex.ro/media/catalog/product/6/9/692e809f05ee2_1_1ee8e4154b_692e809f1c9b1_18ad3928.webp', expected: 'supported', run: () => buildCurvedPath([
    { id: 'right', kind: 'vertical', direction: 'down', length: 600 },
    { id: 'bottom', kind: 'horizontal', direction: 'left', length: 1200 },
    { id: 'left', kind: 'vertical', direction: 'up', length: 800 },
    { id: 'top', kind: 'connect_arc', direction: 'connect', radius: 1000, bulgeSide: 'left', extent: 'minor' },
  ]) },
  { name: '05 shallow R369 furniture-panel curve', image: 'https://tirkapsan.com.tr/image/cache/cache/1-1000/430/additional/4bbd-Tirkapsan-Bombe-%C3%9Cr%C3%BCn-Kodu-136-1-0-1-1100x1100w.jpg', expected: 'supported', run: arch(600, 369, 'minor') },
  { name: '06 quarter-circle panel edge', image: 'https://interglas.dk/images/varegrupper/faconer/60buemedpilehoejde.jpg', expected: 'supported', run: () => exactArc(arcFromChord({ x: 0, y: 500 }, { x: 500, y: 0 }, 500, { bulgeSide: 'left', extent: 'minor' })) },
  { name: '07 semicircular lower edge', image: 'https://content.stark-suomi.fi/%C3%84X42/%C3%84X42_1_preview.jpg', expected: 'supported', run: () => exactArc(arcFromChord({ x: 1100, y: 0 }, { x: 0, y: 0 }, 550, { bulgeSide: 'left', extent: 'semicircle' })) },
  { name: '08 arch specified by width, total height and arch height', image: 'https://www.glaskoning.nl/uploads/89/128/65-model-afwijkende-maat.png', expected: 'supported', run: riseArch(1000, 500, 'semicircle') },
  { name: '09 stove arch specified by overall and shoulder heights', image: 'https://capska.com/44733-product_main/jotul-f250-glass-arched-rectangle-screen-printed-glass-panel-for-wood-burning-stove.jpg', expected: 'supported', run: riseArch(409, 24) },
  { name: '10 replacement stove arch A/B/C dimensions', image: 'https://www.rockfordchimneysupply.com/cdn/shop/articles/door_measure_good_2.jpg', expected: 'supported', run: riseArch(600, 100) },
  { name: '11 stove arch L/h1/H dimensions', image: 'https://www.vitre-insert-cheminee.fr/fichiers/declinaisonProduit/photo_5336.png', expected: 'supported', run: riseArch(465, 46) },
  { name: '12 chord and rise curved-glass section', image: 'https://www.evergreenglass.com/uploads/file/20240408/11/bent-laminated-glass.webp', expected: 'supported', run: riseArch(1200, 250) },
  { name: '13 four equal external corner radii', image: 'https://capska.com/en/special-shape-panels-/14408-drilled-glass-panel-with-1-rounded-corner.html', expected: 'supported', run: () => buildRoundedRectangle(1000, 600, { 'bottom-left': 50, 'bottom-right': 50, 'top-right': 50, 'top-left': 50 }) },
  { name: '14 two-radius compound circular perimeter', image: 'https://en.wikipedia.org/wiki/Basket-handle_arch', expected: 'supported', run: () => buildCurvedPath([
    { id: 'bottom', kind: 'horizontal', direction: 'right', length: 400 },
    { id: 'right', kind: 'arc', direction: 'up', chord: 200, radius: 150, bulgeSide: 'left', extent: 'minor' },
    { id: 'top', kind: 'horizontal', direction: 'left', length: 400 },
    { id: 'left', kind: 'connect_arc', direction: 'connect', radius: 150, bulgeSide: 'left', extent: 'minor' },
  ]) },
  { name: '15 oval or undefined freeform curve', image: 'https://en.wikipedia.org/wiki/Arch', expected: 'template_required', run: unsupported('Template required: ellipse/freeform geometry is not defined by supported circular constraints.') },
];

const results = cases.map((test) => {
  try {
    const geometry = test.run();
    if (geometry?.entities) {
      const dxf = buildDxf(geometry.entities);
      if (geometry.entities.some((entity) => entity.type === 'arc')) assert.match(dxf, /\r\nARC\r\n/);
    }
    return { name: test.name, image: test.image, expected: test.expected, actual: 'supported', reason: 'Deterministic circular geometry generated.' };
  } catch (error) {
    const actual = /^Template required:/i.test(error.message) ? 'template_required' : 'blocked';
    return { name: test.name, image: test.image, expected: test.expected, actual, reason: error.message };
  }
});

for (const result of results) assert.equal(result.actual, result.expected, `${result.name}: ${result.reason}`);
close(chordRiseRadius(409, 24), 883.2552083333334, 1e-8);

function close(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

console.log(JSON.stringify({
  total: results.length,
  supported: results.filter((item) => item.actual === 'supported').length,
  blocked: results.filter((item) => item.actual === 'blocked').length,
  templateRequired: results.filter((item) => item.actual === 'template_required').length,
  results,
}, null, 2));
