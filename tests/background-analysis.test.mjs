import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../netlify/functions/analyse-drawing.mjs', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../app-v4.js', import.meta.url), 'utf8');

assert.match(server, /background:\s*true/, 'analysis must use OpenAI background mode');
assert.match(server, /store:\s*true/, 'background response state must be retrievable');
assert.match(server, /responses\.retrieve\(responseId\)/, 'poll path must retrieve the background response');
assert.match(server, /body\?\.action === 'poll'/, 'analysis endpoint must expose a poll action');
assert.match(server, /baseURL:\s*OPENAI_BASE_URL/, 'OpenAI SDK must bypass Netlify AI Gateway');
assert.doesNotMatch(server, /store:\s*false/, 'background analysis must not disable response storage');

assert.match(client, /analysisResponseId/, 'browser must persist the background response ID');
assert.match(client, /async function pollAnalysis/, 'browser must poll pending analyses');
assert.match(client, /resumePendingAnalyses/, 'saved jobs must resume pending analysis after reload');
assert.match(client, /action:\s*'poll'/, 'browser polls the analysis endpoint explicitly');
assert.match(client, /Sol is analysing this drawing in the background/, 'UI must explain background analysis state');

console.log('Quick DXF background analysis contract passed.');
