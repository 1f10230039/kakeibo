// S-02 統計。棒グラフ／円グラフ（切り替えボタン）、左右のスワイプで前後の期間、その下に利用一覧。
// 配置は docs/02_画面設計.md の S-02。
// 切り替えでは作り直さず、変わったところだけ書き換える（morphable）。棒は前の高さから新しい高さへ伸び縮みし、
// 円は前の割合から新しい割合へ動く（初めて出たときは、ぐるっと描かれる）。

import * as C from '../calc.js';
import { GROUP_CLASS } from '../icons.js';
import { esc, money, icon, onSwipe, seg, tween } from '../ui.js';
import { row } from './home.js';
import { incomeRow } from './income.js';

const UNIT_NAME = { week: '週', month: '月', year: '年' };
const view = { unit: 'month', offset: 0, chart: 'bar', bucket: null, group: null, cat: null, dir: 0 };

export const morphable = true;

/** 統計の画面に入るとき。ホームの支出トップのタイルから来たとき（#/stats?cat=食費&unit=week）は、そのカテゴリを開く。 */
export function enter(query) {
  view.dir = 0;
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
  // 収入も一覧に出す（支出と区別して）。カテゴリやグループで絞り込んでいるときは出さない
  let incomes = C.incomeBetween(data.transactions, p.start, p.end);
  const incomeTotal = C.sum(incomes);
  if (view.chart === 'bar' && view.bucket !== null && p.buckets[view.bucket]) {
    const b = p.buckets[view.bucket];
    incomes = C.incomeBetween(incomes, b.start, b.end);
  }
  if (view.chart === 'pie' && (view.cat || view.group)) incomes = [];
  if (view.chart === 'pie' && view.cat) {
    list = list.filter(t => (t.category || '未分類') === view.cat);
    filterLabel = view.cat;
  } else if (view.chart === 'pie' && view.group) {
    list = list.filter(t => groupOf(t.category) === view.group);
    filterLabel = view.group;
  }

  return `
  <div class="stats page" data-dir="${view.dir}">
    <header class="page-head"><h1>統計</h1></header>
    <div class="controls">
      ${seg('unit', ['week', 'month', 'year'].map(u => [u, UNIT_NAME[u]]), view.unit, '期間の単位')}
      ${seg('chart', [['bar', '棒'], ['pie', '円']], view.chart, 'グラフの種類')}
    </div>
    <div class="period">
      <button class="nav" data-step="-1" aria-label="前へ">${icon('left')}</button>
      <span class="period-label"><span data-key="${esc(p.label)}">${esc(p.label)}</span></span>
      <button class="nav" data-step="1" aria-label="次へ" ${view.offset >= 0 ? 'disabled' : ''}>${icon('right')}</button>
    </div>

    <div class="stats-body">
      <section class="chart card" id="chart">
        <div class="chart-total"><span class="label">支出の合計</span>${money(C.sum(inPeriod), hidden, 'stats-total')}</div>
        ${incomeTotal ? `<div class="chart-income" data-key="inc"><span class="label">収入</span><span class="pos">+${money(incomeTotal, hidden)}</span></div>` : ''}
        ${view.chart === 'bar' ? barChart(C.bucketTotals(data.transactions, p), hidden) : pieChart(C.groupTotals(inPeriod, data.categories), hidden)}
      </section>

      <section class="tx-list">
        <div class="section"><h2>一覧</h2>${filterLabel ? `<button class="chip filter" data-key="${esc(filterLabel)}" data-act="clear">${esc(filterLabel)}で絞り込み中 ${icon('close')}</button>` : ''}</div>
        ${list.length || incomes.length ? byDate([...list, ...incomes], groupOf, hidden, C.displayNames(data.rules)) : '<p class="empty">この期間の利用はありません</p>'}
      </section>
    </div>
  </div>`;
}

/** 棒グラフ。高さは --h（0〜1）で、CSS が前の高さから新しい高さへ動かす。初めて出た棒は 0 から伸びる（data-from）。 */
function barChart(buckets, hidden) {
  const max = Math.max(1, ...buckets.map(b => b.total));
  return `<div class="bars${buckets.length > 7 ? ' many' : ''}" data-key="bar" role="group" aria-label="支出の棒グラフ">${buckets.map((b, i) => {
    const h = b.total ? Math.max(0.035, b.total / max) : 0.012;
    const on = view.bucket === i;
    return `<button class="bar${on ? ' on' : ''}" data-bucket="${i}" aria-pressed="${on}" aria-label="${esc(b.label)} ${hidden ? '' : esc(C.yen(b.total))}">
      <span class="col" data-vars="--h:${h.toFixed(4)};--i:${i}" data-from="--h:0">${on && !hidden ? `<span class="val">${esc(C.yen(b.total))}</span>` : ''}<span class="fill"></span></span>
      <span class="lab">${esc(b.label)}</span>
    </button>`;
  }).join('')}</div>`;
}

const R = 70, L = 2 * Math.PI * R;

function pieChart(groups, hidden) {
  const total = groups.reduce((a, g) => a + g.total, 0);
  if (!total) return '<div class="pie-wrap" data-key="pie"><div class="pie-empty">この期間の支出はありません</div></div>';
  let acc = 0;
  const arcs = groups.map(g => {
    const len = (g.total / total) * L;
    const cls = view.group === g.group ? ' on' : view.group ? ' dim' : '';
    const arc = `<circle class="arc ${GROUP_CLASS[g.group]}${cls}" data-key="${esc(g.group)}" data-group="${esc(g.group)}" data-len="${len}" data-off="${-acc}" r="${R}" cx="90" cy="90"
      stroke-dasharray="${len} ${L - len}" stroke-dashoffset="${-acc}"/>`;
    acc += len;
    return arc;
  }).join('');
  const legend = groups.map(g => {
    const open = view.group === g.group;
    return `<button class="legend-row${open ? ' open' : ''}" data-key="row:${esc(g.group)}" data-group="${esc(g.group)}">
        <span class="swatch ${GROUP_CLASS[g.group]}"></span><span class="name">${esc(g.group)}</span>
        <span class="pct">${Math.round((g.total / total) * 100)}%</span><span class="amt">${money(g.total, hidden)}</span>
      </button>
      ${open ? `<div class="legend-cats" data-key="cats:${esc(g.group)}">${g.categories.map(c => `<button class="legend-cat${view.cat === c.name ? ' on' : ''}" data-key="${esc(c.name)}" data-cat="${esc(c.name)}"><span>${esc(c.name)}</span><span>${money(c.total, hidden)}</span></button>`).join('')}</div>` : ''}`;
  }).join('');
  return `<div class="pie-wrap" data-key="pie"><div class="pie">
      <svg viewBox="0 0 180 180" role="img" aria-label="グループごとの円グラフ"><g transform="rotate(-90 90 90)">${arcs}</g></svg>
    </div>
    <div class="legend">${legend}</div></div>`;
}

const pieShown = new Map(); // グループ → いま描いている [長さ, 始まりの位置]

/** 円の各グループを、いま描いている長さ・位置から新しい長さ・位置へ動かす。初めて出たときは 12時の位置からぐるっと描く。 */
function animatePie(root) {
  const arcs = [...root.querySelectorAll('.arc')];
  if (!arcs.length) { pieShown.clear(); return; }
  const first = !pieShown.size;
  const plan = arcs.map(a => {
    const to = [Number(a.dataset.len), Number(a.dataset.off)];
    return { a, to, from: pieShown.get(a.dataset.group) || (first ? [0, 0] : [0, to[1]]) };
  });
  pieShown.clear();
  plan.forEach(({ a, to }) => pieShown.set(a.dataset.group, to));
  if (plan.every(({ from, to }) => from[0] === to[0] && from[1] === to[1])) return;
  tween('pie', first ? 900 : 600, p => plan.forEach(({ a, from, to }) => {
    const len = from[0] + (to[0] - from[0]) * p, off = from[1] + (to[1] - from[1]) * p;
    a.setAttribute('stroke-dasharray', `${len} ${L - len}`);
    a.setAttribute('stroke-dashoffset', off);
    pieShown.set(a.dataset.group, [len, off]);
  }));
}

function byDate(list, groupOf, hidden, names) {
  const sorted = C.newestFirst(list);
  let html = '', current = '';
  sorted.forEach(t => {
    if (t.date !== current) {
      if (current) html += '</div>';
      current = t.date;
      html += `<h3 class="date" data-key="h:${esc(t.date)}">${esc(C.mdw(C.parseYmd(t.date)))}</h3><div class="list card" data-key="d:${esc(t.date)}">`;
    }
    html += t.type === '収入' ? incomeRow(t, hidden) : row(t, groupOf(t.category), hidden, C.subtitleOf(t, names));
  });
  return html + '</div>';
}

export function mount(root, ctx) {
  const page = root.firstElementChild;
  pieShown.clear(); // 画面に入るたびに、円はぐるっと描き直す
  const go = changes => { Object.assign(view, { dir: 0 }, changes); ctx.rerender(); };
  page.addEventListener('click', e => {
    const el = e.target.closest('[data-unit], [data-chart], [data-step], [data-bucket], [data-group], [data-cat], [data-act="clear"], [data-tx]');
    if (!el) return;
    const d = el.dataset;
    if (d.unit) { if (d.unit !== view.unit) go({ unit: d.unit, offset: 0, bucket: null }); }
    else if (d.chart) { if (d.chart !== view.chart) go({ chart: d.chart, bucket: null, group: null, cat: null }); }
    else if (d.step) step(+d.step);
    else if (d.bucket !== undefined) go({ bucket: view.bucket === +d.bucket ? null : +d.bucket });
    else if (d.group) go({ group: view.group === d.group ? null : d.group, cat: null });
    else if (d.cat) go({ cat: view.cat === d.cat ? null : d.cat });
    else if (d.act === 'clear') go({ bucket: null, group: null, cat: null });
    else if (d.tx) ctx.openDetail(d.tx);
  });
  onSwipe(page.querySelector('#chart'), step);

  function step(dir) {
    if (view.offset + dir > 0) return; // 未来には進まない
    go({ offset: view.offset + dir, bucket: null, dir });
  }
}

export function after(root) {
  animatePie(root);
}
