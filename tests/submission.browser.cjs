// All submissions are intercepted in-page; no experiment data leaves this test.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
 const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
 try {
  const page = await browser.newPage();
  const errors=[], network=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\//,route=>{network.push(route.request().url());return route.abort();});
  await page.addInitScript(()=>{
   window.requests=[];window.failure='';window.now=123.25;
   Object.defineProperty(performance,'now',{value:()=>window.now});
   window.fetch=(url,options)=>{
    window.requests.push({url,...options,resultsVisible:!document.getElementById('results').hidden});
    if(window.failure==='throw')throw Error('offline');
    if(window.failure==='reject')return Promise.reject(Error('offline'));
    if(window.failure==='pending')return new Promise(()=>{});
    return Promise.resolve({ok:window.failure!=='off',json:()=>Promise.resolve({accepted:window.failure!=='off'})});
   };
   window.addEventListener('unhandledrejection',e=>{throw Error('Unhandled rejection: '+e.reason);});
  });
  const url=pathToFileURL(path.resolve(__dirname,'../index.html')).href;
  async function prepare(target,count,feedback,failure='') {
   await page.goto(url);
   await page.evaluate(({target,count,feedback,failure})=>{
    ExperimentConfig.endpoint='https://example.invalid/experiment/exec';window.failure=failure;
    for(const [name,value] of Object.entries({target,count,feedback}))document.querySelector(`input[name="${name}"][value="${value}"]`).checked=true;
    document.getElementById('settings').requestSubmit();
   },{target,count,feedback,failure});
  }
  async function run(count) {
   return page.evaluate(count=>{
    const tap=()=>document.getElementById('tap').dispatchEvent(new PointerEvent('pointerdown',{isPrimary:true,button:0}));
    if(window.requests.length)throw Error('sent before START');
    window.now+=45000;
    const beforeStart=Date.now();tap();const afterStart=Date.now();
    if(window.requests.length)throw Error('sent at START');
    const expected=[];
    for(let i=0;i<count;i++){
     const interval=1000+(i%7-3)*12.125;expected.push(interval);window.now+=interval;
     tap();
     if(window.requests.length!==(i===count-1?1:0))throw Error('wrong send timing at '+i);
    }
    return {expected,beforeStart,afterStart,afterComplete:Date.now(),calls:window.requests};
   },count);
  }
  for(const target of [1,3,5])for(const count of [10,30,50,100])for(const feedback of ['on','off']){
   await prepare(target,count,feedback);
   const {expected,beforeStart,afterStart,afterComplete,calls}=await run(count);
   const data=JSON.parse(calls[0].body);
   assert.equal(calls[0].url,'https://example.invalid/experiment/exec');
   assert.equal(calls[0].method,'POST');assert.equal(calls[0].resultsVisible,true);
   assert.equal(data.target_seconds,target);assert.equal(data.planned_count,count);assert.equal(data.feedback_mode,feedback);
   assert.deepEqual(data.measurements_ms,expected);
   assert.deepEqual(data.measurements_ms,await page.evaluate(()=>session.values));
   assert.equal(data.app_version,'one-second-data-experiment/1.0.0');assert.equal(data.schema_version,'1');
   assert.ok(data.session_id.length>=32);
   for(const key of ['started_at','completed_at'])assert.equal(new Date(data[key]).toISOString(),data[key]);
   assert.ok(Date.parse(data.started_at)>=beforeStart && Date.parse(data.started_at)<=afterStart);
   assert.ok(Date.parse(data.completed_at)>=Date.parse(data.started_at) && Date.parse(data.completed_at)<=afterComplete);
   await page.evaluate(()=>{record();renderResults();experiment.complete(session.values,new Date().toISOString());});
   assert.equal(await page.evaluate(()=>requests.length),1);
   await page.locator('#restart').click();
   assert.equal(await page.evaluate(()=>requests.length),1);
   console.log(`PASS submission ${target}s / ${count} / ${feedback}: timing, metadata, precision, no duplicate`);
  }
  await prepare(1,10,'on');
  await page.evaluate(()=>{record();window.now+=1000.125;record();});
  await page.locator('#reset').click();
  assert.equal(await page.evaluate(()=>requests.length),0);
  await page.locator('.start').click();await run(10);
  const firstId=await page.evaluate(()=>JSON.parse(requests[0].body).session_id);
  await page.locator('#restart').click();await page.locator('.start').click();
  await page.evaluate(()=>{record();for(let i=0;i<10;i++){window.now+=1000.125;record();}});
  assert.equal(await page.evaluate(()=>requests.length),2);
  assert.notEqual(await page.evaluate(()=>JSON.parse(requests[1].body).session_id),firstId);
  console.log('PASS incomplete reset sends nothing; subsequent sessions get separate IDs');
  for(const failure of ['reject','throw','off','pending']){
   await prepare(5,10,'off',failure);const {expected}=await run(10);
   assert.equal(await page.locator('#results').isVisible(),true);
   assert.equal(await page.locator('#sequence circle').count(),10);
   const before=await page.locator('#results').innerHTML();
   const downloadPromise=page.waitForEvent('download');await page.locator('#download-csv').click();
   const download=await downloadPromise;const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
   const csv=Buffer.concat(chunks).toString('utf8');
   assert.deepEqual(csv.split('\r\n').slice(1,11).map(row=>Number(row.split(',')[1])),expected.map(v=>v/1000));
   assert.equal(await page.locator('#results').innerHTML(),before);
   await page.evaluate(()=>{renderResults();record();});
   assert.equal(await page.evaluate(()=>requests.length),1);
   assert.ok(!(await page.locator('body').innerText()).includes('example.invalid'));
   assert.ok(!(await page.locator('body').innerText()).includes('offline'));
   console.log(`PASS ${failure}: results, graph, CSV, no retry`);
  }
  await page.goto(url);
  await page.evaluate(()=>{ExperimentConfig.endpoint='';document.querySelector('input[name=count][value="10"]').checked=true;document.getElementById('settings').requestSubmit();record();for(let i=0;i<10;i++){window.now+=1000;record();}});
  assert.equal(await page.evaluate(()=>requests.length),0);
  assert.equal(await page.locator('#results').isVisible(),true);
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  console.log('PASS missing endpoint, no browser errors, no real external requests');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
