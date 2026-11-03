import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(fs.existsSync);
if (!executablePath) throw new Error('Chromium not available on test runner');
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/.netlify/functions/access')) {
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, authenticated: true }) });
    }
    if (url.includes('/.netlify/functions/jobs')) {
      if (request.method() === 'PUT') {
        const job = JSON.parse(request.postData() || '{}');
        return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, job }) });
      }
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, jobs: [] }) });
    }
    return request.continue();
  });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  const dims = [
    ['w', 'Overall width', 500, 'size', 'unknown'],
    ['h', 'Overall height', 300, 'size', 'unknown'],
    ['cw', 'Cut-out width', 80, 'size', 'unknown'],
    ['ch', 'Cut-out height', 60, 'size', 'unknown'],
    ['cx', 'Cut-out X', 100, 'edge', 'left'],
    ['cy', 'Cut-out Y', 80, 'edge', 'bottom'],
  ].map(([id, label, valueMm, reference, fromEdge]) => ({
    id, label, valueMm, reference, fromEdge, role: id === 'cx' || id === 'cy' ? 'position' : 'size',
    rawText: String(valueMm), confidence: 'high', confirmed: false,
  }));
  const job = {
    id: 'guided-browser-test', revision: 1, status: 'draft', jobRef: 'GLASS-18437',
    customerName: 'Example Customer', staffName: 'Tester', date: '2026-11-03',
    activeSourceId: 'source-1',
    sources: [{
      id: 'source-1', name: 'panel.png', kind: 'image', contentType: 'image/png',
      fileId: 'source-1.png', fileKey: 'files/guided/test.png', sourceRevision: 1,
      previewUrl: null, analysisStatus: 'review', manufacturingControlsV1: true,
      toughened: false, glassThicknessMm: 6, dimensions: dims,
      analysis: {
        units: 'mm', drawing_label: 'Test panel', production_ready: false,
        requires_human_review: true, uncertainties: [], summary: 'Test panel',
        analysis_checks: {
          perimeter_traced: true, dimension_targets_followed: true,
          all_clear_figures_linked: true, square_markers_classified: true,
          perimeter_topology_closes: true, unsupported_geometry_present: false,
        },
        dimensions: [], parts: [{
          id: 'p1', label: 'Panel',
          profile: {
            type: 'rectangle', width_mm: 500, height_mm: 300,
            width_dimension_id: 'w', height_dimension_id: 'h', diameter_dimension_id: null,
            corner_radii: [],
          },
          features: [{
            id: 'Socket cut-out 1', type: 'rectangular_cutout', quantity: 1,
            width_mm: 80, height_mm: 60, x_mm: 100, y_mm: 80,
            x_reference: 'edge', x_from_edge: 'left', y_reference: 'edge', y_from_edge: 'bottom',
            width_dimension_id: 'cw', height_dimension_id: 'ch', x_dimension_id: 'cx', y_dimension_id: 'cy',
            cutout_finish: 'unpolished', cutout_finish_confirmed: false,
            touching_edge: 'none',
          }],
          dimension_ids: ['w', 'h', 'cw', 'ch', 'cx', 'cy'],
        }],
      },
    }],
  };
  await page.evaluate((data) => localStorage.setItem('quick-dxf-unsynced-v1', JSON.stringify(data)), job);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#guidedReview:not([hidden])', { timeout: 5000 });
  assert.equal(await page.$eval('body', (el) => el.dataset.deskStep), 'start');
  assert.equal(await page.$eval('.source-panel', (el) => getComputedStyle(el).display), 'none');
  assert.equal(await page.$eval('.review-panel', (el) => getComputedStyle(el).display), 'none');
  // Simulate reopening a saved job at the review step, retaining the fixture's
  // authentic analysed drawing and the real production confirmation controls.
  await page.evaluate(() => { document.body.dataset.deskStep = 'review'; });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.review-panel')).display !== 'none');
  assert.equal(await page.$eval('svg [data-slot-key="p0:profile:width"]', (el) => el.classList.contains('is-active-dimension')), true);


  const basics = await page.evaluate(() => ({
    jobRef: document.querySelector('#jobRef')?.value,
    customer: document.querySelector('#customerName')?.value,
    search: document.querySelector('#jobSearch')?.placeholder,
    active: document.querySelector('.guided-current-step .dimension-title-row strong')?.textContent,
    otherVisible: [...document.querySelectorAll('.feature-group:not(.auxiliary-group)')]
      .filter((group) => getComputedStyle(group).display !== 'none').length,
    headerTop: document.querySelector('.job-panel').compareDocumentPosition(document.querySelector('.review-panel')),
  }));
  assert.equal(basics.jobRef, 'GLASS-18437');
  assert.equal(basics.customer, 'Example Customer');
  assert.match(basics.search, /reference|customer/i);
  assert.equal(basics.active, 'Overall width');
  assert.equal(basics.otherVisible, 1);
  assert.ok(basics.headerTop & 4, 'Job details and saved-job search must precede the review');

  await page.click('[data-preview-choice="original"]');
  assert.equal(await page.$eval('.preview-stack', (node) => node.dataset.activePreview), 'original');
  await page.click('[data-preview-choice="dxf"]');
  assert.equal(await page.$eval('.preview-stack', (node) => node.dataset.activePreview), 'dxf');

  await page.click('#guidedSkip');
  assert.match(await page.$eval('#guidedTaskName', (node) => node.textContent), /Overall height/);
  assert.equal(await page.$eval('svg [data-slot-key="p0:profile:height"]', (el) => el.classList.contains('is-active-dimension')), true);
  assert.equal(await page.$eval('svg [data-slot-key="p0:profile:width"]', (el) => el.classList.contains('is-active-dimension')), false);
  assert.equal(await page.$eval('#guidedProgressFill', (node) => node.style.width), '0%');
  await page.click('#guidedPrevious');

  const readOnlyBefore = await page.$eval('.guided-current-step .dimension-value-wrap input', (input) => input.readOnly);
  assert.equal(readOnlyBefore, true);
  await page.click('.guided-current-step .guided-edit-button');
  assert.equal(await page.$eval('.guided-current-step .dimension-value-wrap input', (input) => input.readOnly), false);
  await page.$eval('.guided-current-step .dimension-value-wrap input', (input) => {
    input.value = '520';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.$eval('.guided-current-step .dimension-confirm', (button) => button.click());
  await page.waitForFunction(
    () => document.querySelector('.guided-current-step .dimension-title-row strong')?.textContent === 'Overall height',
    { timeout: 3000 },
  );
  assert.ok(Math.abs(parseFloat(await page.$eval('#guidedProgressFill', (node) => node.style.width)) - (100 / 7)) < 0.001, 'Progress is proportional to confirmed checks');

  await page.$eval('.guided-current-step .dimension-confirm', (button) => button.click());
  await page.waitForFunction(
    () => document.querySelector('.guided-current-step .dimension-title-row strong')?.textContent?.includes('width') &&
      document.querySelector('.guided-current-step .dimension-title-row strong')?.textContent !== 'Overall width',
    { timeout: 3000 },
  );
  assert.match(await page.$eval('#guidedFeatureName', (node) => node.textContent), /cut-out/i);

  const labels = [];
  for (let i = 0; i < 8; i++) {
    const label = await page.$eval('.guided-current-step .dimension-title-row strong', (node) => node.textContent.trim());
    labels.push(label);
    const moved = await page.evaluate(() => {
      const next = document.querySelector('#guidedNext');
      if (next.disabled) return false;
      next.click();
      return true;
    });
    if (!moved) break;
  }
  assert.ok(labels.some((label) => /edge finish/i.test(label)), 'Cut-out finish should be reachable in the same guided review');

  const hasWrongWord = await page.evaluate(() => document.querySelector('#guidedReview')?.textContent.includes('Correct'));
  assert.equal(hasWrongWord, false);
  assert.deepEqual(pageErrors, [], 'No browser runtime exceptions expected');
  console.log('Guided review browser checks passed');
} finally {
  await browser.close();
}
