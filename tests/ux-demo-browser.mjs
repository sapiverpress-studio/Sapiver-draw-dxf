import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(fs.existsSync);
if(!executablePath)throw new Error('Chromium not installed on test runner');
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox']});
try{
  const page=await browser.newPage();
  await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true});
  const errors=[],backend=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('request',r=>{if(r.url().includes('/.netlify/functions/'))backend.push(r.url())});
  const response=await page.goto('http://127.0.0.1:4173/ux-demo.html',{waitUntil:'networkidle0'});
  assert.equal(response.status(),200);
  assert.equal(await page.$eval('#newJobPanel',el=>el.hidden),true);
  assert.equal(await page.$eval('#savedJobPanel',el=>el.hidden),true);
  assert.equal(await page.$eval('#sourcePanel',el=>el.hidden),true);
  assert.equal(await page.$eval('#reviewPanel',el=>el.hidden),true);
  assert.equal(await page.$eval('.job-panel',el=>el.textContent.includes('No login needed')),false);
  assert.equal(await page.$eval('.mode-buttons',el=>[...el.querySelectorAll('button')].map(b=>b.textContent.trim()).join('|')),'New job|Saved job');

  await page.click('#demoSaved');
  assert.equal(await page.$eval('#savedJobPanel',el=>el.hidden),false);
  assert.match(await page.$eval('#jobResults',el=>el.textContent),/No saved jobs yet/);
  await page.click('#demoNew');
  for(const id of ['jobRef','customerName','staffName','jobDate']){
    assert.equal(await page.$eval('#'+id,el=>el.value),'',id+' must be blank');
  }
  assert.equal(await page.$eval('#sourcePanel',el=>el.hidden),true);
  await page.type('#jobRef','HG-100');
  await page.type('#customerName','Fictional Test');
  await page.type('#staffName','Operator');
  await page.click('#demoSave');
  assert.match(await page.$eval('#demoSaveState',el=>el.textContent),/Saved on this device/);
  await page.click('#demoSaved');
  assert.match(await page.$eval('#jobResults',el=>el.textContent),/HG-100/);
  await page.click('#jobResults button');
  assert.equal(await page.$eval('#jobRef',el=>el.value),'HG-100');
  assert.equal(await page.$eval('#customerName',el=>el.value),'Fictional Test');
  assert.equal(await page.$eval('#reviewPanel',el=>el.hidden),true);
  await page.click('#demoContinue');
  assert.equal(await page.$eval('#sourcePanel',el=>el.hidden),false);
  await page.click('#demoManual');
  assert.equal(await page.$eval('#manualForm',el=>el.hidden),false);
  await page.type('#manualWidth','1200');
  await page.type('#manualHeight','700');
  await page.click('#hasCutout');
  await page.type('#cutWidth','160');
  await page.type('#cutHeight','110');
  await page.type('#cutX','120');
  await page.type('#cutY','90');
  await page.click('#manualForm button[type="submit"]');
  await page.waitForSelector('#guidedReview:not([hidden])',{timeout:5000});
  assert.equal(await page.$eval('#reviewPanel',el=>el.hidden),false);
  assert.equal(await page.$eval('#guidedTaskName',el=>el.textContent.includes('Overall width')),true);
  assert.equal(await page.$eval('#geometryPreview',el=>el.textContent.includes('1200 × 700 mm')),true);
  await page.click('[data-preview-choice="original"]');
  assert.equal(await page.$eval('.preview-stack',el=>el.dataset.activePreview),'original');
  await page.click('[data-preview-choice="dxf"]');
  assert.equal(await page.$eval('.preview-stack',el=>el.dataset.activePreview),'dxf');
  await page.click('#guidedSkip');
  assert.match(await page.$eval('#guidedTaskName',el=>el.textContent),/Overall height/);
  assert.equal(await page.$eval('#guidedProgressFill',el=>el.style.width),'0%');
  await page.click('#guidedPrevious');
  assert.equal(await page.$eval('.guided-current-step .dimension-value-wrap input',el=>el.readOnly),true);
  await page.click('.guided-current-step .guided-edit-button');
  assert.equal(await page.$eval('.guided-current-step .dimension-value-wrap input',el=>el.readOnly),false);
  await page.$eval('.guided-current-step .dimension-value-wrap input',el=>{
    el.value='1250';el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.$eval('.guided-current-step .dimension-confirm',el=>el.click());
  await page.waitForFunction(()=>document.querySelector('#guidedTaskName')?.textContent.includes('Overall height'),{timeout:5000});
  assert.match(await page.$eval('#demoSummary',el=>el.textContent),/1 of 7/);
  assert.match(await page.$eval('#geometryPreview',el=>el.textContent),/1250 × 700 mm/);
  await page.click('#demoSaved');
  // Saved data is the draft at the last explicit save, not the unsaved edit.
  await page.click('#jobResults button');
  assert.equal(await page.$eval('#customerName',el=>el.value),'Fictional Test');
  assert.deepEqual(backend,[],'No production backend calls are allowed from the UX walkthrough');
  assert.deepEqual(errors,[],'Browser must report no JavaScript errors');
  console.log('Blank mobile new/saved job walkthrough: PASS');
}finally{await browser.close()}
