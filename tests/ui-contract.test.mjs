import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app-v5.js', import.meta.url), 'utf8');
const share = fs.readFileSync(new URL('../share-release.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../job-v4.css', import.meta.url), 'utf8');

const selectorIds = [...app.matchAll(/\$\('#([^']+)'\)/g)].map((m) => m[1]);
for (const id of selectorIds) {
  assert.ok(html.includes(`id="${id}"`) || app.includes(`id="${id}"`) || app.includes(`.id = '${id}'`), `Neither index.html nor app-v5.js creates #${id}`);
}

assert.match(html, /src="\.\/share-release\.js"/, 'native share release helper must be loaded');
assert.match(html, /src="\.\/app-v5\.js"/, 'prototype must load app-v5.js');
assert.doesNotMatch(html, /src="\.\/app-v[23]\.js"/, 'prototype must not load an older app entry point');
assert.match(html, /id="geometryPreview"/, 'clean geometry preview must be present');
assert.match(html, /id="dxfState"/, 'DXF release state must be present');
assert.match(html, /multiple/, 'multi-file source upload must remain enabled');
assert.match(html, /id="sendBtn"[^>]*>Share job pack</, 'release action must say Share job pack');
assert.doesNotMatch(html, />Confirm & email</, 'legacy server-email CTA must not remain visible');
assert.doesNotMatch(html, /Customer email/, 'customer email field must not remain in the visible workflow');
assert.match(share, /navigator\.share/, 'native Web Share API must be used when available');
assert.match(share, /navigator\.canShare/, 'file sharing capability must be checked');
assert.match(html, /id="accessKeypad"/, 'six-digit login keypad must be present');
assert.match(html, /id="manualDrawingBtn"/, 'manual drawing entry must be present');
assert.match(html, /id="addManualCutoutBtn"[^>]*>Add another cut-out</, 'repeatable cut-out control must be present');
assert.match(app, /Edge of previous cut-out/, 'uploaded drawing review must offer chained cut-out positioning');
assert.match(app, /dataset\.reviewGroup/, 'review groups must explicitly identify perimeter and feature sections');
assert.match(html, /id="purgeJobBtn"/, 'protected permanent deletion control must be present');
assert.match(html, /assets\/halifaxglass-logo\.svg/, 'Halifax Glass logo must be present in the tool header');
assert.match(html, /halifax-glass\.css/, 'Halifax Glass visual theme must be loaded');
assert.match(app, /permanent: 'true'/, 'permanent deletion must call the protected server operation');
assert.match(css, /img\[hidden\]\{display:none!important\}/, 'hidden preview images must stay hidden even when image CSS sets display:block');

console.log(`Quick DXF UI contract passed for ${selectorIds.length} required element IDs.`);
