/* Pure calculations use unrounded milliseconds; only presentation uses seconds. */
(function (root) {
  'use strict';
  function summarize(values) {
    if (!values.length) throw new Error('At least one measurement is required.');
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
    const variance = values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / values.length;
    const middle = Math.floor(values.length / 2);
    return { mean, median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, variance, sd: Math.sqrt(variance), min: sorted[0], max: sorted[sorted.length - 1] };
  }
  function quantile(sorted, p) {
    const i = (sorted.length - 1) * p, lo = Math.floor(i);
    return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
  }
  function histogram(values, target) {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantile(sorted, .25), q3 = quantile(sorted, .75);
    const base = target * .05, spread = Math.max(q3 - q1, base);
    const central = sorted.filter(x => x >= q1 - 3 * spread && x <= q3 + 3 * spread);
    const low = Math.max(0, Math.min(target - base, central[0]));
    const high = Math.max(target + base, central[central.length - 1]);
    const desired = Math.max(base, (high - low) / 16);
    const power = 10 ** Math.floor(Math.log10(desired));
    const width = [1, 2, 2.5, 5, 10].map(x => x * power).find(x => x >= desired - 1e-9);
    const start = Math.floor(low / width) * width;
    const count = Math.max(4, Math.ceil((high - start) / width) + 1);
    const end = start + count * width;
    const bins = Array.from({ length: count }, (_, i) => ({ lower: start + i * width, upper: start + (i + 1) * width, count: 0, kind: 'regular' }));
    const below = { lower: null, upper: start, count: 0, kind: 'below' };
    const above = { lower: end, upper: null, count: 0, kind: 'above' };
    values.forEach(value => {
      if (value < start) below.count++;
      else if (value >= end) above.count++;
      else bins[Math.min(count - 1, Math.floor((value - start) / width))].count++;
    });
    return { bins: [...(below.count ? [below] : []), ...bins, ...(above.count ? [above] : [])], width, start, end, hasOutliers: !!(below.count || above.count) };
  }
  class Measurement {
    start(count, now) { this.count = count; this.previous = now; this.values = []; this.active = true; }
    tap(now) {
      if (!this.active) return null;
      const value = now - this.previous;
      this.previous = now;
      this.values.push(value);
      if (this.values.length === this.count) this.active = false;
      return value;
    }
    reset() { this.active = false; this.values = []; }
  }
  const api = { summarize, histogram, Measurement };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimeData = api;
})(typeof window !== 'undefined' ? window : globalThis);
