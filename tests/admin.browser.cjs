const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createServer}=require('../tools/test-server.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const server=createServer();
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.calls=[];window.fail=false;let accepting=true;
   const response=(filter,page)=>({accepting,timezone:'Asia/Tokyo',summary:{total:65,production:60,test:5,unknown:0,legacy:2,latest:'2026-10-02T12:00:00Z',target_seconds:{1:30,3:20,5:15},feedback_mode:{on:40,off:25},planned_count:{10:30,30:20,50:10,100:5}},count:filter.data_type?5:65,page:page||1,totalPages:filter.data_type?1:2,headers:['session_id','data_type','value_001_ms','value_100_ms'],rows:[['<img src=x onerror=alert(1)>',filter.data_type||'production',1000.125,999.875]]});
   const runner=(success,failure)=>new Proxy({}, {get:(_,key)=>{
    if(key==='withSuccessHandler')return fn=>runner(fn,failure);
    if(key==='withFailureHandler')return fn=>runner(success,fn);
    return (...args)=>{window.calls.push({name:key,args});setTimeout(()=>{
     if(window.fail){failure(Error('模擬エラー'));return;}
     if(key==='getDashboard')success(response(...args));
     if(key==='setAccepting'){accepting=args[0];success({accepting});}
     if(key==='exportCsv')success({csv:'\uFEFFsession_id,value_001_ms,value_100_ms\r\nexample,1000.125,999.875\r\n',filename:'sessions-test.csv',count:5});
    },10);};
   }});
   window.google={script:{run:runner()}};
  });
  await page.goto(pathToFileURL(path.resolve(__dirname,'../gas/admin/Admin.html')).href);
  await page.waitForFunction(()=>document.getElementById('count').textContent.includes('65件'));
  assert.equal(await page.locator('#data img').count(),0);
  await page.locator('#next').click();await page.waitForFunction(()=>document.getElementById('page').textContent==='2 / 2');
  page.once('dialog',d=>d.accept());await page.locator('#toggle').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('OFF'));
  await page.locator('[name=data_type]').selectOption('test');await page.locator('[name=target_seconds]').selectOption('5');await page.locator('[name=feedback_mode]').selectOption('on');await page.locator('[name=planned_count]').selectOption('100');
  await page.locator('[name=from]').fill('2026-10-01');await page.locator('[name=to]').fill('2026-10-02');
  await page.locator('button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('count').textContent.includes('5件')&&!document.getElementById('csv').disabled);
  const filters={data_type:'test',target_seconds:'5',feedback_mode:'on',planned_count:'100',from:'2026-10-01',to:'2026-10-02'};
  assert.deepEqual(await page.evaluate(()=>calls.filter(c=>c.name==='getDashboard').at(-1).args[0]),filters);
  const pending=page.waitForEvent('download');await page.locator('#csv').click();const dl=await pending;
  const chunks=[];for await(const b of await dl.createReadStream())chunks.push(b);assert.ok(Buffer.concat(chunks).toString('utf8').includes('1000.125,999.875'));
  assert.deepEqual(await page.evaluate(()=>calls.find(c=>c.name==='exportCsv').args[0]),filters);
  await page.screenshot({path:'/private/tmp/one-second-admin-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'/private/tmp/one-second-admin-mobile.png',fullPage:true});
  await page.evaluate(()=>window.fail=true);await page.locator('#refresh').click();await page.waitForFunction(()=>document.getElementById('error').textContent==='模擬エラー');
  assert.equal(await page.locator('#refresh').isEnabled(),true);assert.deepEqual(errors,[]);
  console.log('PASS admin UI: counts, paging, acceptance confirmation, combined filters, CSV, escaped text, responsive layout, error recovery');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const testPage=await browser.newPage();
  await testPage.addInitScript(()=>{window.sent=[];window.fetch=(url,options)=>{window.sent.push(JSON.parse(options.body));return Promise.resolve({});};});
  await testPage.route('https://**',r=>r.abort());
  await testPage.goto('http://127.0.0.1:'+server.address().port);
  assert.ok((await testPage.title()).includes('TEST'));
  await testPage.evaluate(()=>{document.querySelector('input[name=count][value="10"]').checked=true;document.getElementById('settings').requestSubmit();let now=0;Object.defineProperty(performance,'now',{value:()=>now});record();for(let i=0;i<10;i++){now+=1000.125;record();}});
  const sent=await testPage.evaluate(()=>window.sent);assert.equal(sent.length,1);assert.equal(sent[0].data_type,'test');assert.deepEqual(sent[0].measurements_ms,Array(10).fill(1000.125));
  console.log('PASS local test launcher browser integration: one test payload, exact measurement precision, no real GAS requests');
 }finally{if(server.listening)await new Promise(r=>server.close(r));await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
