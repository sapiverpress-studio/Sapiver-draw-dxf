import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app-v4.js', import.meta.url), 'utf8');

const selectorIds = [...app.matchAll(/\$\('#([^']+)'\)/g)].map((m) => m[1]);
for (const id of selectorIds) {
  assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id} required by app-v4.js`);
}

assert.match(html, /src="\.\/app-v4\.js"/, 'prototype must load app-v4.js');
assert.doesNotMatch(html, /src="\.\/app-v[23]\.js"/, 'prototype must not load an older app entry point');
assert.match(html, /id="geometryPreview"/, 'clean geometry preview must be present');
assert.match(html, /id="dxfState"/, 'DXF release state must be present');
assert.match(html, /multiple/, 'multi-file source upload must remain enabled');

console.log(`Quick DXF UI contract passed for ${selectorIds.length} required element IDs.`);
