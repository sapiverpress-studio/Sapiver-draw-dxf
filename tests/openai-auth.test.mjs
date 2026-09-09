import assert from 'node:assert/strict';
import { keyShape, normaliseApiKey, probeOpenAIAuth } from '../netlify/functions/_openai-auth.mjs';

assert.equal(normaliseApiKey('  sk-test-1234  '), 'sk-test-1234');
assert.equal(normaliseApiKey('"sk-test-1234"'), 'sk-test-1234');
assert.equal(normaliseApiKey("'sk-test-1234'"), 'sk-test-1234');

assert.deepEqual(keyShape('  sk-test-ABCD  '), {
  configured: true,
  prefix: 'sk-',
  suffix: 'ABCD',
  length: 12,
  hadOuterWhitespace: true,
  hadWrappingQuotes: false,
});

const fakeFetch = async (_url, options) => {
  assert.equal(options.headers.authorization, 'Bearer sk-test-1234');
  return new Response(JSON.stringify({ error: { code: 'invalid_api_key', type: 'invalid_request_error' } }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' },
  });
};

const probe = await probeOpenAIAuth('sk-test-1234', fakeFetch);
assert.deepEqual(probe, {
  ok: false,
  status: 401,
  code: 'invalid_api_key',
  type: 'invalid_request_error',
  requestId: 'req_test',
});

console.log('Quick DXF OpenAI auth diagnostics contract passed.');
