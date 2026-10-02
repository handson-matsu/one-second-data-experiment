const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize, histogram, Measurement } = require('../stats.js');
test('known population statistics use original precision', () => {
  const s = summarize([1000, 2000, 3000, 4000]);
  assert.equal(s.mean, 2500); assert.equal(s.median, 2500);
  assert.equal(s.variance, 1250000); assert.equal(s.sd, Math.sqrt(1250000));
  assert.equal(s.min, 1000); assert.equal(s.max, 4000);
  assert.equal(summarize([1000.123, 1000.125]).mean, 1000.124);
  assert.equal(summarize([3000, 1000, 2000]).median, 2000);
});
for (const [target, count] of [[1000, 10], [1000, 100], [3000, 10]]) {
  test(`${target}ms / ${count}: chained intervals and exact termination`, () => {
    const m = new Measurement(); let now = 50.125; m.start(count, now);
    const expected = [];
    for (let i = 0; i < count; i++) { const interval = target + (i % 7 - 3) * 12.25; expected.push(interval); now += interval; assert.equal(m.tap(now), interval); assert.equal(m.active, i < count - 1); }
    assert.deepEqual(m.values, expected); assert.equal(m.tap(now + target), null); assert.equal(m.values.length, count);
    const model = histogram(m.values, target); assert.equal(model.bins.reduce((n, b) => n + b.count, 0), count);
    m.reset(); assert.equal(m.active, false); assert.deepEqual(m.values, []);
  });
}
test('outliers remain counted without crushing central histogram', () => {
  const values = [...Array(99).fill(1000), 120000];
  const model = histogram(values, 1000);
  assert.equal(model.width, 50); assert.ok(model.bins.length < 20);
  assert.equal(model.bins.at(-1).kind, 'above'); assert.equal(model.bins.at(-1).count, 1);
  assert.equal(model.bins.reduce((n, b) => n + b.count, 0), 100);
});
test('every observation belongs to exactly its labeled bin, including boundaries', () => {
  for (const values of [[0, 50, 950, 1000, 1050, 1100], Array(10).fill(1000), [0, ...Array(98).fill(1000), 1e7], Array.from({length:100}, (_,i)=>i * 77.31)]) {
    const model = histogram(values, 1000);
    for (const bin of model.bins) assert.equal(bin.count, values.filter(x => (bin.lower === null || x >= bin.lower) && (bin.upper === null || x < bin.upper)).length);
    assert.equal(model.bins.reduce((n,b)=>n+b.count,0),values.length);
  }
});
