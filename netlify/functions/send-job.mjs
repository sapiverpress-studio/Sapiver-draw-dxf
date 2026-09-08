import { jobHeadKey, jobRevisionKey, json, safeId, store } from './_quick-dxf-store.mjs';

const MAX_ATTACH_BYTES = 20_000_000;
const env = (key) => Netlify.env.get(key) || '';

function validEmail(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function attachmentFromRef(s, ref) {
  if (!ref?.fileKey || !ref?.name) return null;
  const stream = await s.get(ref.fileKey, { type: 'stream' });
  if (!stream) throw new Error(`Missing attachment: ${ref.name}`);
  const bytes = await new Response(stream).arrayBuffer();
  return { name: ref.name, bytes, content: Buffer.from(bytes).toString('base64') };
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const brevoKey = env('BREVO_API_KEY');
  const fromEmail = env('QUICK_DXF_FROM_EMAIL');
  if (!brevoKey) return json({ error: 'BREVO_API_KEY is not configured.' }, 503);
  if (!fromEmail) return json({ error: 'QUICK_DXF_FROM_EMAIL is not configured.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const jobId = safeId(body?.jobId);
  const revision = Math.max(1, Number(body?.revision) || 1);
  const outcome = body?.outcome === 'export' ? 'export' : body?.outcome === 'production' ? 'production' : null;
  if (!jobId || !outcome) return json({ error: 'Invalid release request.' }, 400);

  const s = store();
  const key = jobRevisionKey(jobId, revision);
  const job = await s.get(key, { type: 'json' });
  if (!job) return json({ error: 'Job revision not found.' }, 404);
  if (job.status === 'sent') return json({ ok: true, alreadySent: true, sentAt: job.sentAt });
  if (job.status !== 'locked') return json({ error: 'The signed revision must be locked before it can be sent.' }, 409);
  if (!job.confirmationPdf?.fileKey) return json({ error: 'Confirmation PDF is missing.' }, 409);
  if (!job.signedProof?.fileKey) return json({ error: 'Signed confirmation photograph is missing.' }, 409);
  if (!Array.isArray(job.dxfFiles) || !job.dxfFiles.length) return json({ error: 'DXF output is missing.' }, 409);

  const toEmail = outcome === 'production'
    ? validEmail(env('QUICK_DXF_PRODUCTION_EMAIL'))
    : validEmail(body?.customerEmail || job.customerEmail);
  if (!toEmail) return json({ error: outcome === 'production' ? 'Production email is not configured.' : 'Customer email is required.' }, 400);

  const refs = [job.confirmationPdf, job.signedProof, ...job.dxfFiles];
  if (outcome === 'production' && job.includeOriginalsInProductionEmail) {
    refs.push(...(job.sources || []).filter((source) => source.fileKey).map((source) => ({ fileKey: source.fileKey, name: source.name })));
  }

  let total = 0;
  const attachments = [];
  try {
    for (const ref of refs) {
      const item = await attachmentFromRef(s, ref);
      if (!item) continue;
      total += item.bytes.byteLength;
      if (total > MAX_ATTACH_BYTES) return json({ error: 'Release pack exceeds the 20 MB email attachment limit.' }, 413);
      attachments.push({ name: item.name, content: item.content });
    }
  } catch (error) {
    return json({ error: error.message }, 409);
  }

  const jobRef = String(job.jobRef || job.id);
  const customer = String(job.customerName || 'Customer');
  const subject = outcome === 'production'
    ? `Quick DXF production job ${jobRef} - Rev ${revision}`
    : `Your DXF files - ${jobRef} - Rev ${revision}`;
  const htmlContent = outcome === 'production'
    ? `<p>Approved Quick DXF job <strong>${jobRef}</strong>, revision ${revision}, for ${customer}.</p><p>The attached pack contains the confirmed drawing PDF, signed approval evidence and DXF output.</p>`
    : `<p>Please find the confirmed DXF file${job.dxfFiles.length === 1 ? '' : 's'} for job <strong>${jobRef}</strong>, revision ${revision}.</p><p>The confirmation PDF is included with the released files.</p>`;

  const brevo = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { email: fromEmail, name: env('QUICK_DXF_FROM_NAME') || 'Quick DXF' },
      to: [{ email: toEmail }],
      subject,
      htmlContent,
      attachment: attachments,
    }),
  });

  if (!brevo.ok) {
    const detail = await brevo.text().catch(() => '');
    console.error('Quick DXF email failed', brevo.status, detail);
    return json({ error: 'Email send failed. Job remains locked but not sent.' }, 502);
  }

  const sentAt = new Date().toISOString();
  const sent = { ...job, status: 'sent', outcome, sentAt, sentTo: toEmail, updatedAt: sentAt };
  await s.setJSON(key, sent, { metadata: { updatedAt: sentAt, status: 'sent', revision: String(revision) } });
  await s.setJSON(jobHeadKey(jobId), sent, { metadata: { updatedAt: sentAt, status: 'sent', jobRef: jobRef.slice(0, 120) } });
  return json({ ok: true, sentAt, to: toEmail });
};
