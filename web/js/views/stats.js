// S-02 統計。棒グラフ／円グラフ（切り替えボタン）、左右のスワイプで前後の期間、その下に利用一覧。
// 配置は docs/02_画面設計.md の S-02。

import * as C from '../calc.js';
import { GROUP_CLASS } from '../icons.js';
import { esc, money, icon, onSwipe } from '../ui.js';
import { row } from './home.js';

const UNIT_NAME = { week: '週', month: '月', year: '年' };
const view = { unit: 'month', offset: 0, chart: 'bar', bucket: null, group: null, cat: null };

/** ホームの支出トップのタイルから来たとき（#/stats?cat=食費&unit=week）。 */
export function enter(query) {
  if (query.get('cat')) {
    Object.assign(view, { unit: query.get('unit') === 'week' ? 'week' : 'month', offset: 0, chart: 'pie', bucket: null, group: null, cat: query.get('cat') });
  }
}

export function render(ctx) {
  const { data, today, hidden } = ctx;
  const p = C.period(view.unit, view.offset, today, data.settings.weekStart);
  const inPeriod = C.spendBetween(data.transactions, p.start, p.end);
  const groupOf = name => (!name || name === '未分類' ? '未分類' : (data.categories.find(c => c.name === name) || { group: 'その他' }).group);
  if (view.cat && !view.group) view.group = groupOf(view.cat); // カテゴリから来たら、そのグループの内訳を開いておく

  // 一覧の絞り込み：棒（期間の一部）／グループ／カテゴリ
  let list = inPeriod, filterLabel = '';
  if (view.chart === 'bar' && view.bucket !== null && p.buckets[view.bucket]) {
    const b = p.buckets[view.bucket];
    list = C.spendBetween(list, b.start, b.end);
    filterLabel = view.unit === 'week' ? `${b.sub}（${b.label}）` : view.unit === 'month' ? `${b.label}（${b.sub}）` : b.label;
  }
  if (view.chart === 'pie' && view.cat) {
    list = list.filter(t => (t.category || '未分類') === view.cat);
    filterLabel = view.cat;
  } else if (view.chart === 'pie' && view.group) {
    list = list.filter(t => groupOf(t.category) === view.group);
    filterLabel = view.group;
  }

  return `
  <div class="stats page">
    <header class="page-head"><h1>統計</h1></header>
    <div class="controls">
      <div class="seg" role="group" aria-label="期間の単位">
        ${['week', 'month', 'year'].map(u => `<button class="${view.unit === u ? 'on' : ''}" data-unit="${u}">${UNIT_NAME[u]}</button>`).join('')}
      </div>
      <div class="seg" role="group" aria-label="グラフの種類">
        <button class="${view.chart === 'bar' ? 'on' : ''}" data-chart="bar">棒</button>
        <button class="${view.chart === 'pie' ? 'on' : ''}" data-chart="pie">円</button>
      </div>
    </div>
    <div class="period">
      <button class="nav" data-step="-1" aria-label="前へ">${icon('left')}</button>
      <span>${esc(p.label)}</span>
      <button class="nav" data-step="1" aria-label="次へ" ${view.offset >= 0 ? 'disabled' : ''}>${icon('right')}</button>
    </div>

    <div class="stats-body">
      <section class="chart card" id="chart">
        <div class="chart-total"><span class="label">合計</span>${money(C.sum(inPeriod), hidden)}</div>
        ${view.chart === 'bar' ? barChart(C.bucketTotals(data.transactions, p), hidden) : pieChart(C.groupTotals(inPeriod, data.categories), hidden)}
        <div class="hint">← 左右になぞると前後の${UNIT_NAME[view.unit]}へ →</div>
      </section>

      <section class="tx-list">
        <div class="section"><h2>利用一覧</h2>${filterLabel ? `<button class="chip filter" data-act="clear">${esc(filterLabel)}で絞り込み中 ${icon('close')}</button>` : ''}</div>
        ${list.length ? byDate(list, groupOf, hidden) : '<p class="empty">この期間の利用はありません</p>'}
      </section>
    </div>
  </div>`;
}

function barChart(buckets, hidden) {
  const max = Math.max(1, ...buckets.map(b => b.total));
  const W = 320, H = 170, gap = buckets.length > 7 ? 6 : 12;
  const bw = (W - gap * (buckets.length - 1)) / buckets.length;
  const bars = buckets.map((b, i) => {
    const h = b.total ? Math.max(6, (b.total / max) * (H - 34)) : 3;
    const x = i * (bw + gap), y = H - 14 - h;
    const on = view.bucket === i;
    return `<g class="bar${on ? ' on' : ''}" data-bucket="${i}" role="button" aria-label="${esc(b.label)} ${hidden ? '' : esc(C.yen(b.total))}">
      <rect class="hit" x="${x}" y="0" width="${bw}" height="${H}"/>
      <rect class="fill" x="${x}" y="${y}" width="${bw}" height="${h}" rx="${Math.min(10, bw / 2)}"/>
      ${on && !hidden ? `<text class="val" x="${x + bw / 2}" y="${y - 6}">${esc(C.yen(b.total))}</text>` : ''}
      <text class="lab" x="${x + bw / 2}" y="${H}">${esc(b.label)}</text>
    </g>`;
  }).join('');
  return `<svg class="bars" viewBox="-4 -16 ${W + 8} ${H + 20}" role="img" aria-label="支出の棒グラフ">${bars}</svg>`;
}

function pieChart(groups, hidden) {
  const total = groups.reduce((a, g) => a + g.total, 0);
  if (!total) return '<div class="pie-empty">この期間の支出はありません</div>';
  const R = 70, L = 2 * Math.PI * R;
  let acc = 0;
  const arcs = groups.map(g => {
    const len = (g.total / total) * L;
    const seg = `<circle class="arc ${GROUP_CLASS[g.group]}${view.group && view.group !== g.group ? ' dim' : ''}" data-group="${esc(g.group)}" r="${R}" cx="90" cy="90"
      stroke-dasharray="${len} ${L - len}" stroke-dashoffset="${-acc}"/>`;
    acc += len;
    return seg;
  }).join('');
  const legend = groups.map(g => {
    const open = view.group === g.group;
    return `<button class="legend-row${open ? ' open' : ''}" data-group="${esc(g.group)}">
        <span class="swatch ${GROUP_CLASS[g.group]}"></span><span class="name">${esc(g.group)}</span>
        <span class="pct">${Math.round((g.total / total) * 100)}%</span><span class="amt">${money(g.total, hidden)}</span>
      </button>
      ${open ? `<div class="legend-cats">${g.categories.map(c => `<button class="legend-cat${view.cat === c.name ? ' on' : ''}" data-cat="${esc(c.name)}"><span>${esc(c.name)}</span><span>${money(c.total, hidden)}</span></button>`).join('')}</div>` : ''}`;
  }).join('');
  return `<div class="pie">
      <svg viewBox="0 0 180 180" role="img" aria-label="グループごとの円グラフ"><g transform="rotate(-90 90 90)">${arcs}</g></svg>
    </div>
    <div class="legend">${legend}</div>`;
}

function byDate(list, groupOf, hidden) {
  const sorted = C.newestFirst(list);
  let html = '', current = '';
  sorted.forEach(t => {
    if (t.date !== current) {
      if (current) html += '</div>';
      current = t.date;
      html += `<h3 class="date">${esc(C.mdw(C.parseYmd(t.date)))}</h3><div class="list card">`;
    }
    html += row(t, groupOf(t.category), hidden);
  });
  return html + '</div>';
}

export function mount(root, ctx) {
  const go = changes => { Object.assign(view, changes); ctx.rerender(); };
  root.querySelectorAll('[data-unit]').forEach(b => b.addEventListener('click', () => go({ unit: b.dataset.unit, offset: 0, bucket: null })));
  root.querySelectorAll('[data-chart]').forEach(b => b.addEventListener('click', () => go({ chart: b.dataset.chart, bucket: null, group: null, cat: null })));
  root.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => step(+b.dataset.step)));
  root.querySelectorAll('[data-bucket]').forEach(g => g.addEventListener('click', () => go({ bucket: view.bucket === +g.dataset.bucket ? null : +g.dataset.bucket })));
  root.querySelectorAll('[data-group]').forEach(g => g.addEventListener('click', () => go({ group: view.group === g.dataset.group ? null : g.dataset.group, cat: null })));
  root.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); go({ cat: view.cat === b.dataset.cat ? null : b.dataset.cat }); }));
  root.querySelector('[data-act="clear"]')?.addEventListener('click', () => go({ bucket: null, group: null, cat: null }));
  root.querySelectorAll('[data-tx]').forEach(b => b.addEventListener('click', () => ctx.openDetail(b.dataset.tx)));
  onSwipe(root.querySelector('#chart'), step);

  function step(dir) {
    if (view.offset + dir > 0) return; // 未来には進まない
    go({ offset: view.offset + dir, bucket: null });
  }
}
