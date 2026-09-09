import assert from 'node:assert/strict';
import fs from 'node:fs';
import { downloadFiles, releaseRefs } from '../share-release.js';

const confirmationPdf = { name: 'confirm.pdf', url: '/confirm.pdf' };
const signedProof = { name: 'signed.jpg', url: '/signed.jpg' };
const dxf1 = { name: 'part-a.dxf', url: '/part-a.dxf' };
const dxf2 = { name: 'part-b.dxf', url: '/part-b.dxf' };

const shareSource = fs.readFileSync(new URL('../share-release.js', import.meta.url), 'utf8');

assert.deepEqual(
  releaseRefs({ outcome: 'production', confirmationPdf, signedProof, dxfFiles: [dxf1, dxf2] }),
  [confirmationPdf, signedProof, dxf1, dxf2],
  'production share pack must include confirmation PDF, signed proof and all DXFs',
);

assert.deepEqual(
  releaseRefs({ outcome: 'export', confirmationPdf, signedProof, dxfFiles: [dxf1, dxf2] }),
  [confirmationPdf, dxf1, dxf2],
  'customer export share pack must exclude internal signed-proof image',
);

assert.deepEqual(releaseRefs(null), [], 'missing job should produce no share refs');
assert.equal(typeof downloadFiles, 'function', 'direct download fallback must remain available');
assert.match(shareSource, /files:\s*\[zipFile\]/, 'native sharing must send one ZIP file rather than several separate files');

console.log('Quick DXF release sharing contract passed.');
