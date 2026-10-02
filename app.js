'use strict';
const $ = id => document.getElementById(id);
const session = new TimeData.Measurement();
const experiment = ExperimentData.createReporter(ExperimentConfig);
let target = 1000, feedback = true, ready = false;
const seconds = ms => (ms / 1000).toFixed(2);
function show(id) {
  ['setup', 'measurement', 'results'].forEach(name => $(name).hidden = name !== id);
  window.scrollTo(0, 0);
}
$('settings').addEventListener('change', () => {
  $('start-target').textContent = `${new FormData($('settings')).get('target')}秒`;
});
$('settings').addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData($('settings'));
  target = Number(data.get('target')) * 1000;
  feedback = data.get('feedback') === 'on';
  session.reset();
  experiment.reset();
  session.count = Number(data.get('count'));
  ready = true;
  $('tap').querySelector('span').textContent = 'START';
  $('tap').setAttribute('aria-label', 'START：測定を開始');
  $('completed').textContent = '0';
  $('total').textContent = ` / ${session.count}`;
  $('progress').style.width = '0%';
  $('last-value').innerHTML = '—<small>秒</small>';
  $('feedback-area').hidden = !feedback;
  $('measure-instruction').textContent = '中央の START を押すと測定が始まります。';
  show('measurement');
  $('tap').focus({ preventScroll: true });
});
function record() {
  const now = performance.now();
  if (ready) {
    session.start(session.count, now);
    experiment.start(target / 1000, session.count, feedback ? 'on' : 'off');
    ready = false;
    $('tap').querySelector('span').textContent = 'STOP';
    $('tap').setAttribute('aria-label', 'STOP：測定を記録し、次の測定を開始');
    $('measure-instruction').textContent = `${target / 1000}秒だと思うたびに STOP。続けて次の測定が始まります。`;
    return;
  }
  const value = session.tap(now);
  if (value === null) return;
  $('completed').textContent = session.values.length;
  $('progress').style.width = `${session.values.length / session.count * 100}%`;
  if (feedback) $('last-value').innerHTML = `${seconds(value)}<small>秒</small>`;
  if (!session.active) {
    const completedAt = new Date().toISOString();
    renderResults();
    experiment.complete(session.values, completedAt);
  }
}
// Pointer-down timestamps avoid release latency. Click is reserved for assistive technology.
$('tap').addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  record();
});
$('tap').addEventListener('click', event => { if (event.detail === 0) record(); });
let heldKey = false;
document.addEventListener('keydown', event => {
  if (!['Space', 'Enter'].includes(event.code)) return;
  if ((ready || session.active) && (document.activeElement === $('tap') || document.activeElement === document.body)) {
    event.preventDefault();
    if (!event.repeat && !heldKey) record();
    heldKey = true;
  }
});
document.addEventListener('keyup', event => { if (['Space', 'Enter'].includes(event.code)) heldKey = false; });
window.addEventListener('blur', () => { heldKey = false; });
function reset() { session.reset(); experiment.reset(); ready = false; heldKey = false; show('setup'); $('settings').querySelector('button').focus({ preventScroll: true }); }
$('reset').addEventListener('click', reset);
$('restart').addEventListener('click', reset);
function svgFrame(label, content) {
  return `<svg viewBox="0 0 480 290" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:ui-monospace,monospace;font-size:13px;fill:#657361}.grid{stroke:#e9ede5;stroke-width:1}.reference{stroke:#b89146;stroke-width:1.5;stroke-dasharray:5 4}</style>${content}</svg>`;
}
function binLabel(bin) {
  if (bin.kind === 'below') return `${seconds(bin.upper)}未満`;
  if (bin.kind === 'above') return `${seconds(bin.lower)}以上`;
  return `${seconds(bin.lower)}以上 ～ ${seconds(bin.upper)}未満`;
}
function drawHistogram(model) {
  const bins = model.bins, left = 43, top = 24, width = 420, height = 207;
  const step = width / bins.length, ymax = Math.max(1, ...bins.map(b => b.count));
  const tick = Math.max(1, Math.ceil(ymax / 4)), limit = Math.ceil(ymax / tick) * tick;
  let svg = '<text x="5" y="12">度数</text>';
  for (let n = 0; n <= limit; n += tick) {
    const y = top + height - n / limit * height;
    svg += `<line class="grid" x1="${left}" y1="${y}" x2="463" y2="${y}"/><text x="33" y="${y + 4}" text-anchor="end">${n}</text>`;
  }
  bins.forEach((bin, i) => {
    const x = left + i * step, h = bin.count / limit * height;
    svg += `<rect data-count="${bin.count}" x="${x + 2}" y="${top + height - h}" width="${Math.max(1, step - 4)}" height="${h}" rx="2" fill="${bin.kind === 'regular' ? '#75a684' : '#b8bcaa'}"><title>${binLabel(bin)}秒：${bin.count}回</title></rect>`;
    if (bin.kind !== 'regular') svg += `<text x="${x + step / 2}" y="250" text-anchor="middle">${bin.kind === 'below' ? '未満' : '以上'}</text>`;
    else if (i % Math.max(1, Math.ceil(bins.length / 7)) === 0) svg += `<text x="${x}" y="250" text-anchor="middle">${seconds(bin.lower)}</text>`;
  });
  const offset = bins[0].kind === 'below' ? 1 : 0;
  const tx = left + (offset + (target - model.start) / model.width) * step;
  svg += `<line class="reference" x1="${tx}" y1="17" x2="${tx}" y2="231"/><text x="${Math.max(75, Math.min(430, tx))}" y="12" text-anchor="middle">目標 ${seconds(target)}</text><text x="255" y="279" text-anchor="middle">時間（秒）</text>`;
  $('histogram').innerHTML = svgFrame('測定時間のヒストグラム。各階級の度数は下の度数分布表でも確認できます。', svg);
}
function drawSequence(values) {
  const low = Math.min(target, ...values), high = Math.max(target, ...values);
  const pad = Math.max((high - low) * .12, target * .08);
  const min = Math.max(0, low - pad), max = high + pad;
  const x = i => 48 + i / Math.max(1, values.length - 1) * 410;
  const y = value => 231 - (value - min) / (max - min) * 207;
  let svg = '<text x="0" y="12">時間（秒）</text>';
  for (let i = 0; i <= 4; i++) {
    const value = min + (max - min) * i / 4, py = y(value);
    svg += `<line class="grid" x1="48" y1="${py}" x2="458" y2="${py}"/><text x="40" y="${py + 4}" text-anchor="end">${seconds(value)}</text>`;
  }
  svg += `<line class="reference" x1="48" y1="${y(target)}" x2="458" y2="${y(target)}"/><polyline fill="none" stroke="#4e8967" stroke-width="1.6" points="${values.map((value, i) => `${x(i)},${y(value)}`).join(' ')}"/>`;
  values.forEach((value, i) => { svg += `<circle data-index="${i + 1}" data-value="${value}" cx="${x(i)}" cy="${y(value)}" r="${values.length > 50 ? 2.4 : 3.5}" fill="#227655"><title>${i + 1}回目：${seconds(value)}秒</title></circle>`; });
  [...new Set([0, ...[.25, .5, .75, 1].map(f => Math.round((values.length - 1) * f))])].forEach(i => { svg += `<text x="${x(i)}" y="251" text-anchor="middle">${i + 1}</text>`; });
  svg += '<text x="255" y="279" text-anchor="middle">測定回数</text>';
  $('sequence').innerHTML = svgFrame(`${values.length}回の測定値を測定順に表示。目標時間は${seconds(target)}秒。全測定値は下のデータ一覧で確認できます。`, svg);
}
function renderResults() {
  const values = session.values, stats = TimeData.summarize(values), model = TimeData.histogram(values, target);
  const variance = (stats.variance / 1e6).toFixed(4);
  const cards = [['目標', seconds(target), '秒'], ['平均', seconds(stats.mean), '秒'], ['中央値', seconds(stats.median), '秒'], ['分散（母分散）', variance, '秒²'], ['標準偏差', seconds(stats.sd), '秒'], ['最小値', seconds(stats.min), '秒'], ['最大値', seconds(stats.max), '秒'], ['測定回数', values.length, '回']];
  $('summary').innerHTML = cards.map(([label, value, unit], i) => `<div class="stat ${i === 1 || i === 4 ? 'highlight' : ''}"><div class="stat-label">${label}</div><div class="stat-value">${value}<small>${unit}</small></div></div>`).join('');
  $('result-context').textContent = `${target / 1000}秒チャレンジ / ${values.length}回のタップ / フィードバック${feedback ? 'あり' : 'なし'}`;
  drawHistogram(model); drawSequence(values);
  $('bin-note').textContent = `階級幅：${seconds(model.width)}秒。階級は下端を含み、上端を含みません。${model.hasOutliers ? '極端な値は端の「未満・以上」にまとめ、すべて度数に含めています。' : ''}`;
  $('frequency-body').innerHTML = model.bins.map(bin => `<tr><th scope="row">${binLabel(bin)}</th><td>${bin.count}</td></tr>`).join('');
  $('frequency-total').textContent = values.length;
  $('data-count').textContent = `${values.length}件 ＋`;
  $('data-list').innerHTML = values.map((value, i) => `<li><span>${i + 1}回目</span><strong>${seconds(value)}秒</strong></li>`).join('');
  document.querySelectorAll('details').forEach(element => element.open = false);
  show('results');
  $('results-title').focus({ preventScroll: true });
}

// Export a snapshot without changing the session or the displayed results.
$('download-csv').addEventListener('click', () => {
  if (session.active || ready || !session.values.length || $('results').hidden) return;
  const values = session.values;
  const stats = TimeData.summarize(values);
  const rows = [
    ['測定回', '測定時間（秒）'],
    ...values.map((value, i) => [i + 1, value / 1000]),
    ['', ''],
    ['統計量', '値'],
    ['目標（秒）', target / 1000],
    ['平均（秒）', stats.mean / 1000],
    ['中央値（秒）', stats.median / 1000],
    ['分散（母分散・秒²）', stats.variance / 1e6],
    ['標準偏差（秒）', stats.sd / 1000],
    ['最小値（秒）', stats.min / 1000],
    ['最大値（秒）', stats.max / 1000],
    ['測定回数', values.length]
  ];
  const escapeCell = value => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  // UTF-8 BOM and CRLF make Japanese labels recognizable in Excel.
  const csv = '\uFEFF' + rows.map(row => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `1-second-data-${target / 1000}s-${values.length}回-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Allow the browser to begin the download before releasing its Blob URL.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
