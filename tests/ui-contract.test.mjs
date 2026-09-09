import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app-v4.js', import.meta.url), 'utf8');
const share = fs.readFileSync(new URL('../share-release.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../job-v4.css', import.meta.url), 'utf8');

const selectorIds = [...app.matchAll(/\$\('#([^']+)'\)/g)].map((m) => m[1]);
for (const id of selectorIds) {
  assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id} required by app-v4.js`);
}

assert.match(html, /src="\.\/share-release\.js"/, 'native share release helper must be loaded');
assert.match(html, /src="\.\/app-v4\.js"/, 'prototype must load app-v4.js');
assert.doesNotMatch(html, /src="\.\/app-v[23]\.js"/, 'prototype must not load an older app entry point');
assert.match(html, /id="geometryPreview"/, 'clean geometry preview must be present');
assert.match(html, /id="dxfState"/, 'DXF release state must be present');
assert.match(html, /multiple/, 'multi-file source upload must remain enabled');
assert.match(html, /id="sendBtn"[^>]*>Share job pack</, 'release action must say Share job pack');
assert.doesNotMatch(html, />Confirm & email</, 'legacy server-email CTA must not remain visible');
assert.doesNotMatch(html, /Customer email/, 'customer email field must not remain in the visible workflow');
assert.match(share, /navigator\.share/, 'native Web Share API must be used when available');
assert.match(share, /navigator\.canShare/, 'file sharing capability must be checked');
assert.match(css, /img\[hidden\]\{display:none!important\}/, 'hidden preview images must stay hidden even when image CSS sets display:block');

console.log(`Quick DXF UI contract passed for ${selectorIds.length} required element IDs.`);
