import OpenAI from 'openai';
import { fileKey, json, safeFileId, safeId, store } from './_quick-dxf-store.mjs';
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA } from './_quick-dxf-analysis.mjs';

const MODEL = 'gpt-5.6-sol';
const env = (key) => Netlify.env.get(key) || '';

function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function resolveStoredFileKey(jobId, revision, fileId, suppliedKey) {
  const explicit = String(suppliedKey || '');
  if (explicit.startsWith(`files/${jobId}/`) && !explicit.includes('..')) return explicit;
  return fileKey(jobId, revision, fileId);
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const apiKey = env('QUICK_DXF_API');
  if (!apiKey) return json({ error: 'QUICK_DXF_API is not configured on the server.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }

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

  const openai = new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
  let uploadedFile;
  let sourcePart;

  try {
    if (contentType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
      const file = new File([bytes], filename, { type: 'application/pdf' });
      uploadedFile = await openai.files.create({
        file,
        purpose: 'user_data',
        expires_after: { anchor: 'created_at', seconds: 3600 },
      });
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
      store: false,
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

    let extraction;
    try { extraction = JSON.parse(response.output_text); }
    catch { return json({ error: 'AI analysis returned invalid structured data.' }, 502); }

    return json({
      ok: true,
      model: MODEL,
      responseId: response.id,
      usage: response.usage || null,
      extraction,
    });
  } catch (error) {
    console.error('Quick DXF analysis failed', error);
    return json({ error: 'Drawing analysis failed. No production data was approved.', detail: String(error?.message || error) }, 502);
  } finally {
    if (uploadedFile?.id) {
      try { await openai.files.delete(uploadedFile.id); } catch (error) { console.warn('Could not delete temporary OpenAI file', error); }
    }
  }
};
