const A4 = [595.28, 841.89];

function wrap(text, font, size, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth || !line) line = test;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function safe(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function drawLines(page, lines, x, y, font, size, lineHeight, options = {}) {
  for (const line of lines) {
    page.drawText(line, { x, y, font, size, ...options });
    y -= lineHeight;
  }
  return y;
}

async function embedPreview(pdfDoc, source) {
  if (!source?.previewUrl) return null;
  try {
    const response = await fetch(source.previewUrl, { cache: 'no-store' });
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (type.includes('png') || source.previewUrl.startsWith('data:image/png')) return await pdfDoc.embedPng(bytes);
    return await pdfDoc.embedJpg(bytes);
  } catch {
    return null;
  }
}

function drawHeader(page, fontBold, job, label) {
  page.drawText('QUICK DXF - CUSTOMER CONFIRMATION', { x: 36, y: 808, font: fontBold, size: 12 });
  page.drawText(`${label}   Job ${safe(job.jobRef, job.id)}   Rev ${job.revision}`, { x: 36, y: 789, font: fontBold, size: 9 });
  page.drawLine({ start: { x: 36, y: 780 }, end: { x: 559, y: 780 }, thickness: 0.7 });
}

function drawApproval(page, font, fontBold, y) {
  const statement = 'I confirm the drawing(s), figured dimensions and feature positions shown in this revision match the item(s) I require to be manufactured.';
  y = drawLines(page, wrap(statement, fontBold, 9, 520), 36, y, fontBold, 9, 12);
  y -= 18;
  page.drawLine({ start: { x: 36, y }, end: { x: 275, y }, thickness: 0.7 });
  page.drawLine({ start: { x: 320, y }, end: { x: 559, y }, thickness: 0.7 });
  page.drawText('Customer signature', { x: 36, y: y - 13, font, size: 8 });
  page.drawText('Date', { x: 320, y: y - 13, font, size: 8 });
  y -= 48;
  page.drawLine({ start: { x: 36, y }, end: { x: 275, y }, thickness: 0.7 });
  page.drawLine({ start: { x: 320, y }, end: { x: 559, y }, thickness: 0.7 });
  page.drawText('Staff signature', { x: 36, y: y - 13, font, size: 8 });
  page.drawText('Date', { x: 320, y: y - 13, font, size: 8 });
}

function drawDimensionTable(page, source, font, fontBold, startY, includeFooter = true) {
  const x = 36;
  const cols = [x, 310, 408, 559];
  let y = startY;
  page.drawText('CONFIRMED DIMENSIONS', { x, y, font: fontBold, size: 9 });
  y -= 16;
  page.drawLine({ start: { x, y: y + 4 }, end: { x: cols[3], y: y + 4 }, thickness: 0.6 });
  page.drawText('Description', { x: cols[0], y, font: fontBold, size: 8 });
  page.drawText('Value', { x: cols[1], y, font: fontBold, size: 8 });
  page.drawText('Reference', { x: cols[2], y, font: fontBold, size: 8 });
  y -= 13;
  for (const d of source.dimensions || []) {
    const desc = safe(d.label, 'Dimension');
    const descLines = wrap(desc, font, 7.5, cols[1] - cols[0] - 8).slice(0, 2);
    page.drawText(descLines[0] || '', { x: cols[0], y, font, size: 7.5 });
    if (descLines[1]) page.drawText(descLines[1], { x: cols[0], y: y - 9, font, size: 7.5 });
    page.drawText(`${d.valueMm ?? '—'} mm`, { x: cols[1], y, font, size: 7.5 });
    const ref = String(d.reference || 'unknown').toUpperCase() + (d.fromEdge && d.fromEdge !== 'unknown' ? ` FROM ${String(d.fromEdge).toUpperCase()}` : '');
    page.drawText(ref, { x: cols[2], y, font, size: 7.5 });
    y -= descLines[1] ? 22 : 15;
    page.drawLine({ start: { x, y: y + 5 }, end: { x: cols[3], y: y + 5 }, thickness: 0.25 });
  }
  if (includeFooter) page.drawText('Figured dimensions are authoritative. This sheet records the values confirmed for manufacture.', { x, y: 24, font, size: 7 });
  return y;
}

export async function buildConfirmationPdf(job) {
  const { PDFDocument, StandardFonts, rgb } = await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const sources = Array.isArray(job.sources) ? job.sources : [];

  if (sources.length > 1) {
    const page = pdfDoc.addPage(A4);
    drawHeader(page, fontBold, job, 'Approval summary');
    let y = 748;
    const fields = [
      ['Customer', safe(job.customerName)], ['Date', safe(job.date)], ['Staff', safe(job.staffName)], ['Drawings', String(sources.length)],
    ];
    for (const [label, value] of fields) {
      page.drawText(`${label}:`, { x: 36, y, font: fontBold, size: 9 });
      page.drawText(value, { x: 120, y, font, size: 9 });
      y -= 20;
    }
    y -= 8;
    page.drawText('INCLUDED DRAWINGS', { x: 36, y, font: fontBold, size: 9 });
    y -= 18;
    sources.forEach((source, index) => {
      page.drawText(`Drawing ${String.fromCharCode(65 + index)} - ${safe(source.name)}`, { x: 36, y, font, size: 8 });
      page.drawText(`${source.dimensions?.length || 0} confirmed dimensions`, { x: 400, y, font, size: 8 });
      y -= 16;
    });
    y -= 25;
    drawApproval(page, font, fontBold, y);
    page.drawText(`Job ${safe(job.jobRef, job.id)} - Revision ${job.revision}`, { x: 36, y: 24, font, size: 7, color: rgb(0.3, 0.3, 0.3) });
  }

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const page = pdfDoc.addPage(A4);
    const label = `Drawing ${String.fromCharCode(65 + index)}`;
    drawHeader(page, fontBold, job, label);
    page.drawText(safe(source.name), { x: 36, y: 760, font: fontBold, size: 10 });

    const image = await embedPreview(pdfDoc, source);
    let tableY = 430;
    if (image) {
      const bounds = image.scale(1);
      const maxW = 523, maxH = 300;
      const scale = Math.min(maxW / bounds.width, maxH / bounds.height, 1);
      const w = bounds.width * scale, h = bounds.height * scale;
      page.drawRectangle({ x: 36, y: 445, width: 523, height: 295, borderWidth: 0.5, borderColor: rgb(0.75, 0.75, 0.75) });
      page.drawImage(image, { x: 36 + (523 - w) / 2, y: 445 + (295 - h) / 2, width: w, height: h });
      tableY = 420;
    } else {
      page.drawText('Source preview unavailable - use the confirmed dimension schedule below.', { x: 36, y: 700, font, size: 9 });
      tableY = 660;
    }

    const remainingY = drawDimensionTable(page, source, font, fontBold, tableY);
    if (sources.length === 1) {
      if (remainingY > 145) drawApproval(page, font, fontBold, Math.min(remainingY - 12, 145));
      else page.drawText('See following page for approval signature area.', { x: 36, y: 55, font: fontBold, size: 8 });
    } else {
      page.drawText('Customer initials: __________________', { x: 36, y: 55, font: fontBold, size: 8 });
    }
  }

  if (sources.length === 1 && (sources[0].dimensions?.length || 0) > 11) {
    const page = pdfDoc.addPage(A4);
    drawHeader(page, fontBold, job, 'Approval signature');
    drawApproval(page, font, fontBold, 700);
  }

  return await pdfDoc.save();
}
