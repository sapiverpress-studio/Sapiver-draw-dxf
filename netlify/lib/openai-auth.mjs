export function normaliseApiKey(value) {
  const raw = String(value ?? '');
  let key = raw.trim();
  const wrapped = (key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"));
  if (wrapped && key.length >= 2) key = key.slice(1, -1).trim();
  return key;
}

export function keyShape(rawValue) {
  const raw = String(rawValue ?? '');
  const trimmed = raw.trim();
  const normalised = normaliseApiKey(raw);
  const wrapped = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return {
    configured: normalised.length > 0,
    prefix: normalised.slice(0, Math.min(3, normalised.length)),
    suffix: normalised.slice(-4),
    length: normalised.length,
    hadOuterWhitespace: raw !== trimmed,
    hadWrappingQuotes: wrapped,
  };
}

export async function probeOpenAIAuth(apiKey, fetchImpl = fetch) {
  try {
    const response = await fetchImpl('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
    });
    let body = null;
    try { body = await response.json(); } catch {}
    return {
      ok: response.ok,
      status: response.status,
      code: String(body?.error?.code || ''),
      type: String(body?.error?.type || ''),
      requestId: response.headers.get('x-request-id') || null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      code: 'probe_failed',
      type: error?.name || 'Error',
      requestId: null,
    };
  }
}
