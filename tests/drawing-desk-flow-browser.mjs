import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(fs.existsSync);
if(!executablePath)throw new Error('Chromium unavailable');
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox']});
const page=await browser.newPage();
await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true});
const errors=[];
const requests=[];
page.on('pageerror',e=>errors.push(String(e)));
await page.setRequestInterception(true);
page.on('request',request=>{
  const url=request.url();
  if(url.includes('/.netlify/functions/')) {
    requests.push({url,method:request.method()});
    if(url.includes('/access'))return request.respond({
      status:200, contentType:'application/json',
      body:JSON.stringify({configured:true,authenticated:true}),
    });
    if(url.includes('/jobs')) {
      if(request.method()==='PUT'){
        const job=JSON.parse(request.postData()||'{}');
        return request.respond({status:200,contentType:'application/json',
          body:JSON.stringify({ok:true,job:{...job,createdAt:'2026-11-03T11:00:00Z',updatedAt:'2026-11-03T11:00:00Z'}})});
      }
      return request.respond({status:200,contentType:'application/json',body:'{"ok":true,"jobs":[]}'});
    }
    if(url.includes('/job-file'))return request.respond({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,fileKey:'files/mock-source.png',url:'/test-image.png'})});
    if(url.includes('/analyse-drawing'))return request.respond({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,model:'test-fixture',extraction:{
        drawing_label:'Test glass',units:'mm',production_ready:false,
        analysis_checks:{perimeter_traced:true,dimension_targets_followed:true,all_clear_figures_linked:true,
          square_markers_classified:true,perimeter_topology_closes:true,unsupported_geometry_present:false},
        uncertainties:[],
        dimensions:[
          {id:'w',target:'p1.profile.width_mm',role:'overall',reference:'size',value:1000,raw_text:'1000',confidence:'high'},
          {id:'h',target:'p1.profile.height_mm',role:'overall',reference:'size',value:500,raw_text:'500',confidence:'high'},
        ],
        parts:[{id:'p1',label:'Glass panel',profile:{
          type:'rectangle',width_mm:1000,height_mm:500,width_dimension_id:'w',height_dimension_id:'h',
          diameter_mm:null,diameter_dimension_id:null,corner_radii:[],
        },features:[],dimension_ids:['w','h']}],
      }})});
  }
  return request.continue();
});

try {
  const response=await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200);
  await page.waitForSelector('.mode-buttons');
  await page.waitForFunction(()=>document.body.dataset.deskStep==='start');

  // Initial screen never exposes later steps.
  assert.equal(await page.$eval('.source-panel',el=>getComputedStyle(el).display),'none');
  assert.equal(await page.$eval('.review-panel',el=>getComputedStyle(el).display),'none');
  assert.equal(await page.$eval('.approval-panel',el=>getComputedStyle(el).display),'none');
  assert.equal(await page.$eval('.release-panel',el=>getComputedStyle(el).display),'none');
  await page.click('#jobModeSaved');
  assert.equal(await page.$eval('#savedJobWorkspace',el=>el.hidden),false);
  assert.equal(await page.$eval('#newJobWorkspace',el=>el.hidden),true);
  await page.click('#jobModeNew');
  assert.equal(await page.$eval('#jobRef',el=>el.value),'');
  assert.equal(await page.$eval('#customerName',el=>el.value),'');
  await page.click('#deskNextDrawing');
  assert.match(await page.$eval('#deskJobError',el=>el.textContent),/job reference/);
  assert.equal(await page.$eval('body',el=>el.dataset.deskStep),'start');

  await page.type('#jobRef','HG-123');
  await page.type('#customerName','Fictional customer');
  await page.click('#deskNextDrawing');
  assert.equal(await page.$eval('body',el=>el.dataset.deskStep),'drawing');
  assert.equal(await page.$eval('.source-panel',el=>getComputedStyle(el).display!=='none'),true);
  assert.equal(await page.$eval('.review-panel',el=>getComputedStyle(el).display),'none');
  assert.equal(await page.$eval('#cameraInput',el=>el.getAttribute('capture')),'environment');
  assert.equal(await page.$eval('#fileInput',el=>el.accept.includes('pdf')),true);

  // Manual drawing creates no preset socket cut-out.
  await page.click('#manualDrawingBtn');
  assert.equal(await page.$eval('#manualCutouts',el=>el.children.length),0);
  await page.type('#manualWidth','800');
  await page.type('#manualHeight','400');
  await page.click('#manualDrawingForm button[type="submit"]');
  await page.waitForFunction(()=>document.body.dataset.deskStep==='review',{timeout:7500});
  await page.waitForSelector('#guidedReview:not([hidden])');
  assert.equal(await page.$eval('#guidedTaskName',el=>el.textContent.includes('width')),true);
  assert.equal(await page.$eval('svg [data-slot-key="p0:profile:width"]',el=>el.classList.contains('is-active-dimension')),true);
  await page.click('#guidedNext');
  assert.equal(await page.$eval('svg [data-slot-key="p0:profile:height"]',el=>el.classList.contains('is-active-dimension')),true);
  await page.click('#deskReviewBack');
  assert.equal(await page.$eval('body',el=>el.dataset.deskStep),'drawing');

  // Start a truly new job and exercise the actual protected camera -> AI client.
  await page.click('#deskDrawingBack');
  await page.click('#jobModeNew');
  await page.type('#jobRef','HG-124');
  await page.type('#customerName','Another fictional customer');
  await page.click('#deskNextDrawing');
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+3AiwAAAAASUVORK5CYII=';
  await page.evaluate(data=>{
    const bytes=Uint8Array.from(atob(data),x=>x.charCodeAt(0));
    const transfer=new DataTransfer();
    transfer.items.add(new File([bytes],'drawing.png',{type:'image/png'}));
    const input=document.querySelector('#cameraInput');
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  },png);
  await page.waitForFunction(()=>document.querySelector('#aiState')?.textContent.includes('Ready for AI analysis'),{timeout:10000});
  assert.equal(await page.$eval('#manufacturingSettings',el=>el.hidden),false);
  await page.$eval('#glassThickness',el=>{
    el.value='6';el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.select('#toughenedGlass','no');
  await page.waitForFunction(()=>!document.querySelector('#analyseBtn').disabled,{timeout:5000});
  await page.click('#analyseBtn');
  await page.waitForFunction(()=>document.body.dataset.deskStep==='review',{timeout:10000});
  assert.ok(requests.some(x=>x.url.includes('/analyse-drawing')),'AI route was not called');
  assert.equal(await page.$eval('svg [data-slot-key="p0:profile:width"]',el=>el.classList.contains('is-active-dimension')),true);
  assert.equal(await page.$eval('#guidedTaskName',el=>el.textContent.includes('Overall width')),true);
  assert.deepEqual(errors,[],'Unexpected browser errors');

  console.log('Full screen-by-screen mobile flow and simulated camera-to-AI wiring: PASS');
} finally {await browser.close();}
