// Run with Playwright available through NODE_PATH and CHROME_PATH if needed.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
 const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {}) });
 try {
 const page = await browser.newPage(); const errors = [];
 const externalRequests = [];
 // Fail on external traffic, and block it so regression tests never send access logs.
 await page.route(/^https?:\/\//, route => {
  externalRequests.push(route.request().url());
  return route.abort();
 });
 page.on('pageerror', e => errors.push(e.message));
 const url = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
 for (const [target, count, feedback] of [1,3,5].flatMap(target => [10,30,50,100].flatMap(count => ['on','off'].map(feedback => [target,count,feedback])))) {
  await page.goto(url);
  await page.evaluate(() => { ExperimentConfig.endpoint = ''; });
  await page.evaluate(() => {window.testNow=123.25; Object.defineProperty(performance,'now',{value:()=>window.testNow, configurable:true});});
  await page.locator(`input[name=target][value="${target}"]`).check();
  await page.locator(`input[name=count][value="${count}"]`).check();
  await page.locator(`input[name=feedback][value="${feedback}"]`).check();
  await page.locator('.start').click();
  assert.equal(await page.locator('#completed').textContent(),'0');
  assert.equal(await page.locator('#feedback-area').isVisible(),feedback==='on');
  assert.equal(await page.locator('#tap > span').textContent(),'START');
  // Waiting on the measurement screen must not enter the first interval.
  await page.evaluate(() => window.testNow += 45000);
  assert.deepEqual(await page.evaluate(() => ({ active: session.active, values: session.values })), { active: false, values: [] });
  const box = await page.locator('#tap').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  assert.equal(await page.locator('#tap > span').textContent(),'STOP');
  assert.equal(await page.locator('#completed').textContent(),'0');
  assert.equal(await page.evaluate(() => session.previous),45123.25);
  // Start is recorded at press, not release; release must not record a STOP.
  await page.evaluate(() => window.testNow += 125);
  await page.mouse.up();
  assert.equal(await page.locator('#completed').textContent(),'0');
  const expected=[];
  for(let i=0;i<count;i++) {
   const interval=target*1000+(i%5-2)*21.25; expected.push(interval);
   await page.evaluate(ms=>window.testNow+=ms,interval - (i === 0 ? 125 : 0));
   await page.locator('#tap').click();
   assert.equal(await page.locator('#completed').textContent(),String(i+1));
   if(i<count-1) assert.equal(await page.locator('#results').isVisible(),false);
  }
  assert.equal(await page.locator('#results').isVisible(),true);
  assert.equal(await page.evaluate(() => session.active),false);
  await page.evaluate(() => { window.testNow += 1000; record(); });
  assert.equal(await page.evaluate(() => session.values.length),count);
  const plotted = await page.locator('#sequence circle').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.value)));
  assert.deepEqual(plotted,expected);
  assert.equal(await page.locator('#data-list li').count(),count);
  const bars=await page.locator('#histogram rect').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.count)));
  const table=await page.locator('#frequency-body td').allTextContents();
  assert.deepEqual(bars,table.map(Number)); assert.equal(bars.reduce((a,b)=>a+b,0),count);
  const mean=expected.reduce((a,b)=>a+b,0)/count;
  const variance=expected.reduce((s,x)=>s+(x-mean)**2,0)/count;
  const cardValues=await page.locator('.stat-value').allTextContents();
  assert.equal(cardValues[1],(mean/1000).toFixed(2)+'秒');
  assert.equal(cardValues[3],(variance/1e6).toFixed(4)+'秒²');
  const beforeExport = await page.locator('#results').innerHTML();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-csv').click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith('.csv'));
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = bytes.subarray(3).toString('utf8');
  assert.ok(!csv.replace(/\r\n/g, '').includes('\n'));
  const rows = csv.trimEnd().split('\r\n').map(row => row.split(','));
  assert.deepEqual(rows[0], ['測定回', '測定時間（秒）']);
  assert.deepEqual(rows.slice(1, count + 1).map(row => row.map(Number)), expected.map((v, i) => [i + 1, v / 1000]));
  const exportedStats = Object.fromEntries(rows.slice(count + 3));
  const sorted = [...expected].sort((a,b)=>a-b);
  const expectedStats = {
   '目標（秒）': target, '平均（秒）': mean / 1000,
   '中央値（秒）': (sorted[count / 2 - 1] + sorted[count / 2]) / 2000,
   '分散（母分散・秒²）': variance / 1e6,
   '標準偏差（秒）': Math.sqrt(variance) / 1000,
   '最小値（秒）': sorted[0] / 1000, '最大値（秒）': sorted.at(-1) / 1000,
   '測定回数': count
  };
  for (const [label, value] of Object.entries(expectedStats)) assert.equal(Number(exportedStats[label]), value);
  assert.equal(await page.locator('#results').innerHTML(), beforeExport);
  assert.deepEqual(await page.evaluate(() => session.values), expected);
  console.log(`PASS CSV: ${count} rows, precise values, all statistics, UTF-8 BOM, CRLF, unchanged results`);
  console.log(`PASS ${target}s / ${count} taps / feedback ${feedback}: intervals, exact count, statistics, graph order, histogram/table`);
 }
 for(const [width,height] of [[390,844],[768,1024],[1440,1000]]) {
  await page.setViewportSize({width,height});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`/private/tmp/one-second-result-${width}.png`,fullPage:true});
  await page.goto(url);
  await page.evaluate(() => { ExperimentConfig.endpoint = ''; });
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`/private/tmp/one-second-setup-${width}.png`,fullPage:true});
  await page.locator('.start').click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`/private/tmp/one-second-measure-${width}.png`,fullPage:true});
  await page.locator('#tap').press('Space');
  assert.equal(await page.locator('#completed').textContent(),'0');
  assert.equal(await page.locator('#tap > span').textContent(),'STOP');
  await page.locator('#tap').press('Space');
  assert.equal(await page.locator('#completed').textContent(),'1');
  await page.locator('#reset').click(); assert.equal(await page.locator('#setup').isVisible(),true);
  console.log(`PASS ${width}x${height}: no horizontal overflow, keyboard input, reset`);
  // Complete another run so next viewport also inspects populated results.
  await page.locator('input[name=count][value="10"]').check();
  await page.locator('.start').click();
  await page.locator('#tap').click();
  for(let i=0;i<10;i++) await page.locator('#tap').click();
 }
 assert.deepEqual(externalRequests,[]);console.log('PASS no external HTTP requests');
 assert.deepEqual(errors,[]);console.log('PASS no browser errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
