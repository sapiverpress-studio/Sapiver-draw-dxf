import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildStoredZip } from '../core/zip.js';

const dxf = new TextEncoder().encode('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n');
const zip = buildStoredZip([{ name: 'Test panel.dxf', data: dxf }]);
assert.equal(new DataView(zip.buffer).getUint32(0, true), 0x04034b50);
assert.equal(new DataView(zip.buffer).getUint32(zip.length - 22, true), 0x06054b50);
fs.writeFileSync('/tmp/quick-dxf-test.zip', zip);
console.log('Quick DXF ZIP structure test passed.');
