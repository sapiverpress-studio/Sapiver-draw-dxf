import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { storageScope } from '../netlify/functions/_quick-dxf-store.mjs';

// Production must always see the EXISTING site-wide job store.
// Nonproduction and unknown contexts must never see production jobs.
assert.equal(storageScope({ deploy: { context: 'production' } }), 'production');
for (const context of ['deploy-preview', 'branch-deploy', 'dev', 'unknown']) {
  assert.equal(storageScope({ deploy: { context } }), 'isolated', context);
}
assert.equal(storageScope(), 'isolated');
assert.equal(storageScope({}), 'isolated');

const storage = readFileSync('netlify/functions/_quick-dxf-store.mjs', 'utf8');
assert.match(storage, /getStore\(options\)/, 'Production must access persistent Netlify Blobs');
assert.match(storage, /getDeployStore\(options\)/, 'Preview must remain isolated');
for (const path of [
  'netlify/functions/jobs.mjs',
  'netlify/functions/job-file.mjs',
  'netlify/functions/access.mjs',
  'netlify/functions/analyse-drawing.mjs',
]) {
  const source = readFileSync(path, 'utf8');
  assert.match(source, /store\(context\)/, path + ': missing context-aware storage');
  assert.match(source, /request, context/, path + ': missing deployment context parameter');
}

const html = readFileSync('index.html', 'utf8');
const app = readFileSync('app-v5-base.js', 'utf8');
const tabs = readFileSync('job-entry-tabs.js', 'utf8');
assert.ok(html.indexOf('id="jobModeNew"') < html.indexOf('id="jobRef"'));
assert.ok(html.indexOf('id="jobModeSaved"') < html.indexOf('id="jobRef"'));
assert.match(html, /id="jobSearch"/, 'Saved-job search must remain available');
assert.match(html, /id="cameraInput"[^>]+capture="environment"/, 'Camera capture lost');
assert.match(html, /id="fileInput"/, 'File upload lost');
assert.match(html, /id="analyseBtn"/, 'AI analysis button missing');
assert.match(app, /\/\.netlify\/functions\/analyse-drawing/, 'Existing AI API route lost');
assert.match(app, /function analyseSource\(/, 'AI analysis initiation missing');
assert.match(app, /const result = await apiJson\(API\.analyse/, 'AI API call missing');
assert.match(tabs, /jobModeSaved/, 'Saved job tab missing');
assert.doesNotMatch(html, /ux-demo\.html/, 'Mock demonstration must not replace live app');
assert.match(readFileSync('netlify/functions/analyse-drawing.mjs','utf8'),
  /requireAuth\(request, json\)/, 'AI API must remain protected');
console.log('Production integration contract: PASS');
