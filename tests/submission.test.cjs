const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../experiment.js'), 'utf8');
function setup(crypto = webcrypto, fetch) {
  const calls = [];
  const context = vm.createContext({ crypto, fetch: fetch || ((url, options) => { calls.push({url, ...options}); return Promise.resolve({}); }) });
  vm.runInContext(source, context);
  return { calls, reporter: context.ExperimentData.createReporter({endpoint:'https://example.invalid/exec', appVersion:'test/1'}) };
}
test('uses randomUUID when available and consumes each completed session exactly once', () => {
  const { calls, reporter } = setup({randomUUID: () => 'test-uuid'});
  reporter.start(3, 10, 'off');
  const values = Array.from({length:10}, (_,i) => 3000.125 + i / 8);
  reporter.complete(values.slice(0,9), '2026-10-02T12:00:00.000Z');
  assert.equal(calls.length,0);
  reporter.complete(values, '2026-10-02T12:00:00.000Z');
  reporter.complete(values, '2026-10-02T12:00:01.000Z');
  reporter.reset(); reporter.complete(values, '2026-10-02T12:00:02.000Z');
  assert.equal(calls.length,1);
  const data = JSON.parse(calls[0].body);
  assert.equal(data.session_id,'test-uuid');
  assert.deepEqual(data.measurements_ms,values);
  values[0] = 0;
  assert.equal(JSON.parse(calls[0].body).measurements_ms[0],3000.125);
  assert.equal(calls[0].method,'POST');
  assert.equal(calls[0].mode,'no-cors');
  assert.equal(calls[0].headers['Content-Type'],'text/plain;charset=UTF-8');
});
for (const [name, crypto] of [
  ['random bytes', {getRandomValues: bytes => webcrypto.getRandomValues(bytes)}],
  ['throwing randomUUID', {randomUUID: () => {throw Error('unavailable');}, getRandomValues: bytes => webcrypto.getRandomValues(bytes)}],
  ['no crypto', undefined]
]) test(`unique session IDs with ${name}`, () => {
  // null also exercises the genuinely absent crypto fallback (setup defaults undefined).
  const {calls,reporter} = setup(crypto || null);
  for(let i=0;i<1000;i++) {reporter.start(1,10,'on');reporter.complete(Array(10).fill(1000),'2026-10-02T12:00:00.000Z');}
  const ids=calls.map(call=>JSON.parse(call.body).session_id);
  assert.equal(new Set(ids).size,1000);
  if(crypto) ids.forEach(id=>assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
});
for(const failure of ['throw','reject']) test(`${failure} is contained without retry`, async () => {
  let attempts=0;
  const {reporter}=setup(webcrypto,()=>{attempts++;if(failure==='throw')throw Error('offline');return Promise.reject(Error('offline'));});
  reporter.start(1,10,'on');
  assert.doesNotThrow(()=>reporter.complete(Array(10).fill(1000),'2026-10-02T12:00:00.000Z'));
  reporter.complete(Array(10).fill(1000),'2026-10-02T12:00:01.000Z');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,1);
});
test('reset discards an incomplete session',()=>{
 const {calls,reporter}=setup();reporter.start(1,10,'on');reporter.reset();reporter.complete(Array(10).fill(1000),'2026-10-02T12:00:00.000Z');assert.equal(calls.length,0);
});

test('public hosts always production; test opt-in works only on loopback without persisted modes',()=>{
 for(const [hostname,localTest,expected] of [['example.github.io',true,'production'],['example.github.io',false,'production'],['127.0.0.1',true,'test'],['localhost',false,'production'],['',true,'production']]){
  const calls=[];const context=vm.createContext({crypto:webcrypto,location:{hostname,search:'?data_type=test',hash:'#test'},fetch:(url,options)=>{calls.push(options);return Promise.resolve({});}});
  vm.runInContext(source,context);
  const config={endpoint:'https://example.invalid',appVersion:'1',localTest};const reporter=context.ExperimentData.createReporter(config);
  reporter.start(1,10,'on');config.localTest=!localTest;
  reporter.complete(Array(10).fill(1000.125),'2026-10-02T12:00:00.000Z');
  assert.equal(JSON.parse(calls[0].body).data_type,expected);
 }
});
