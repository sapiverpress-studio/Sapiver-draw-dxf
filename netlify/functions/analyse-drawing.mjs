import OpenAI from 'openai';
import { fileKey, json, safeFileId, safeId, store } from './_quick-dxf-store.mjs';
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA } from './_quick-dxf-analysis.mjs';
import { keyShape, normaliseApiKey, probeOpenAIAuth } from '../lib/openai-auth.mjs';
import { requireAuth } from '../lib/access-auth.mjs';

const MODEL = 'gpt-5.6-sol';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const env = (key) => Netlify.env.get(key) || '';
const PENDING_STATUSES = new Set(['queued', 'in_progress']);
const RESPONSE_ID_RE = /^resp_[A-Za-z0-9_-]{8,250}$/;

function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function resolveStoredFileKey(jobId, revision, fileId, suppliedKey) {
  const explicit = String(suppliedKey || '');
  if (explicit.startsWith(`files/${jobId}/`) && !explicit.includes('..')) return explicit;
  return fileKey(jobId, revision, fileId);
}

function publicOpenAIError(error) {
  const status = Number(error?.status) || null;
  const code = String(error?.code || error?.error?.code || '').trim();
  const type = String(error?.type || error?.error?.type || '').trim();
  const message = String(error?.message || error || 'Unknown OpenAI error').replace(/\s+/g, ' ').trim().slice(0, 700);
  const prefix = status ? `OpenAI ${status}` : 'OpenAI request failed';
  const meta = [code, type].filter(Boolean).join(' / ');
  return `${prefix}${meta ? ` (${meta})` : ''}: ${message}`;
}

function completedResponse(response) {
  let extraction;
  try { extraction = JSON.parse(response.output_text); }
  catch { return json({ error: 'AI analysis completed but returned invalid structured data.' }, 502); }

  return json({
    ok: true,
    pending: false,
    status: response.status,
    model: MODEL,
    responseId: response.id,
    usage: response.usage || null,
    extraction,
  });
}

function terminalError(response) {
  const reason = String(
    response?.error?.message ||
    response?.incomplete_details?.reason ||
    response?.status ||
    'unknown terminal state',
  ).replace(/\s+/g, ' ').trim().slice(0, 500);
  return json({
    error: `Drawing analysis ended without a result (${reason}).`,
    responseId: response?.id || null,
    status: response?.status || null,
  }, 502);
}

async function authFailure(error, rawApiKey, apiKey) {
  const detail = publicOpenAIError(error);
  const status = Number(error?.status) || null;
  let auth = null;

  if (status === 401) {
    const probe = await probeOpenAIAuth(apiKey);
    auth = {
      key: keyShape(rawApiKey),
      sdkStatus: status,
      directProbe: probe,
    };
  }

  console.error('Quick DXF analysis failed', {
    detail,
    status,
    code: error?.code,
    requestId: error?.request_id,
    auth,
  });

  const authSummary = auth
    ? ` Direct authentication probe: ${auth.directProbe.status ?? 'no status'}${auth.directProbe.code ? ` (${auth.directProbe.code})` : ''}.`
    : '';

  return json({
    error: `Drawing analysis failed. ${detail}${authSummary}`,
    requestId: error?.request_id || null,
    auth,
  }, 502);
}

export default async (request) => {
  const denied = requireAuth(request, json);
  if (denied) return denied;
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const rawApiKey = env('QUICK_DXF_API');
  const apiKey = normaliseApiKey(rawApiKey);
  if (!apiKey) return json({ error: 'QUICK_DXF_API is not configured on the server.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }

  // Netlify AI Gateway injects OPENAI_BASE_URL automatically. Quick DXF uses its
  // own OpenAI project key, so pin the official API endpoint explicitly.
  const openai = new OpenAI({ apiKey, baseURL: OPENAI_BASE_URL, maxRetries: 0, timeout: 20_000 });

  if (body?.action === 'poll') {
    const responseId = String(body?.responseId || '').trim();
    if (!RESPONSE_ID_RE.test(responseId)) return json({ error: 'Invalid analysis response ID.' }, 400);

    try {
      const response = await openai.responses.retrieve(responseId);
      if (PENDING_STATUSES.has(response.status)) {
        return json({
          ok: true,
          pending: true,
          status: response.status,
          model: MODEL,
          responseId: response.id,
        }, 202);
      }
      if (response.status === 'completed') return completedResponse(response);
      return terminalError(response);
    } catch (error) {
      return authFailure(error, rawApiKey, apiKey);
    }
  }

  const jobId = safeId(body?.jobId);
  const revision = Math.max(1, Number(body?.revision) || 1);
  const fileId = safeFileId(body?.fileId);
  if (!jobId || !fileId) return json({ error: 'Invalid drawing reference.' }, 400);

  const s = store();
  const key = resolveStoredFileKey(jobId, revision, fileId, body?.fileKey);
  const stream = await s.get(key, { type: 'stream' });
  if (!stream) return json({ error: 'Drawing file not found.' }, 404);
  const metadata = await s.getMetadata(key).catch(() => null);
  const contentType = String(metadata?.metadata?.contentType || body?.contentType || 'application/octet-stream');
  const filename = String(metadata?.metadata?.filename || body?.filename || fileId);
  const bytes = await new Response(stream).arrayBuffer();

  let sourcePart;

  try {
    if (contentType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
      const file = new File([bytes], filename, { type: 'application/pdf' });
      const uploadedFile = await openai.files.create({
        file,
        purpose: 'user_data',
        expires_after: { anchor: 'created_at', seconds: 3600 },
      });
      // The background response may continue after this function returns. The
      // uploaded PDF therefore expires automatically instead of being deleted here.
      sourcePart = { type: 'input_file', file_id: uploadedFile.id };
    } else if (/^image\/(jpeg|png|webp)$/.test(contentType)) {
      sourcePart = {
        type: 'input_image',
        image_url: `data:${contentType};base64,${base64(bytes)}`,
        detail: 'high',
      };
    } else {
      return json({ error: 'Only PDF, JPEG, PNG and WebP drawings can be analysed.' }, 415);
    }

    const response = await openai.responses.create({
      model: MODEL,
      reasoning: { effort: 'medium' },
      background: true,
      store: true,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: ANALYSIS_PROMPT },
          sourcePart,
        ],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'quick_dxf_extraction',
          description: 'Structured proposal of simple fabrication geometry and figured dimensions for mandatory human review.',
          strict: true,
          schema: ANALYSIS_SCHEMA,
        },
      },
    });

    if (response.status === 'completed') return completedResponse(response);
    if (!PENDING_STATUSES.has(response.status)) return terminalError(response);

    return json({
      ok: true,
      pending: true,
      status: response.status,
      model: MODEL,
      responseId: response.id,
    }, 202);
  } catch (error) {
    return authFailure(error, rawApiKey, apiKey);
  }
};
