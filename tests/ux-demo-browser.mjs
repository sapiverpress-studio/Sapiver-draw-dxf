import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(fs.existsSync);
if (!executablePath) throw new Error('Chromium not available on GitHub Actions runner');
const browser = await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage();
  await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true});
  const errors=[];
  const backendCalls=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('request',request=>{
    if (request.url().includes('/.netlify/functions/')) backendCalls.push(request.url());
  });
  const response=await page.goto('http://127.0.0.1:4173/ux-demo.html',{waitUntil:'networkidle0'});
  assert.equal(response.status(),200);
  await page.waitForSelector('#guidedReview:not([hidden])',{timeout:6000});
  assert.equal(await page.$eval('#jobRef',x=>x.value),'DEMO-18437');
  assert.equal(await page.$eval('#customerName',x=>x.value),'Example Customer');
  assert.equal(await page.$eval('#jobSearch',x=>x.placeholder.includes('customer')),true);
  assert.equal(await page.$eval('#guidedTaskName',x=>x.textContent.includes('Overall width')),true);
  assert.equal(await page.$eval('.preview-stack',x=>x.dataset.activePreview),'dxf');
  assert.equal(await page.$eval('#accessGate',x=>Boolean(x)).catch(()=>false),false);
  assert.equal(await page.$eval('.job-grid',x=>getComputedStyle(x).gridTemplateColumns.split(' ').length),1,'Job metadata should stack on mobile');

  await page.click('[data-preview-choice="original"]');
  assert.equal(await page.$eval('.preview-stack',x=>x.dataset.activePreview),'original');
  await page.click('[data-preview-choice="dxf"]');
  assert.equal(await page.$eval('.preview-stack',x=>x.dataset.activePreview),'dxf');

  await page.click('#guidedSkip');
  assert.match(await page.$eval('#guidedTaskName',x=>x.textContent),/Overall height/);
  assert.equal(await page.$eval('#guidedProgressFill',x=>x.style.width),'0%');
  await page.click('#guidedPrevious');
  assert.equal(await page.$eval('.guided-current-step .dimension-value-wrap input',x=>x.readOnly),true);
  await page.click('.guided-current-step .guided-edit-button');
  assert.equal(await page.$eval('.guided-current-step .dimension-value-wrap input',x=>x.readOnly),false);
  await page.$eval('.guided-current-step .dimension-value-wrap input',x=>{
    x.value='1250';x.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.$eval('.guided-current-step .dimension-confirm',x=>x.click());
  await page.waitForFunction(()=>document.querySelector('#guidedTaskName')?.textContent.includes('Overall height'),{timeout:5000});
  assert.equal(await page.$eval('#demoSummary',x=>x.textContent.includes('1 of 7 confirmed')),true);
  assert.match(await page.$eval('#geometryPreview',x=>x.textContent),/1250 mm/);

  await page.$eval('#jobSearch',x=>{x.value='garden';x.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.match(await page.$eval('#jobResults',x=>x.textContent),/Sample Garden Centre/);
  await page.$eval('#jobResults button',x=>x.click());
  assert.equal(await page.$eval('#customerName',x=>x.value),'Sample Garden Centre');
  await page.click('#demoSave');
  assert.match(await page.$eval('#demoSaveState',x=>x.textContent),/Demo job saved/);
  assert.deepEqual(backendCalls,[],'Demo must never call protected backend or production storage');
  assert.deepEqual(errors,[],'No browser exceptions');
  console.log('No-login mobile UX demonstration: PASS');
} finally {await browser.close();}
