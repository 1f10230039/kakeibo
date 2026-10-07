// S-02 統計。棒グラフ／円グラフ（切り替えボタン）、左右のスワイプで前後の期間、その下に一覧。
// 棒グラフは支出／収入を切り替えられる（10/6 本人「切り替え」）。一覧もグラフに合わせる。円グラフは支出のカテゴリの内訳だけ。
// 配置は docs/02_画面設計.md の S-02。
// 切り替えでは作り直さず、変わったところだけ書き換える（morphable）。棒は前の高さから新しい高さへ伸び縮みし、
// 円は前の割合から新しい割合へ動く（初めて出たときは、ぐるっと描かれる）。
// 一覧は日付順とカテゴリー別を切り替えられる（10/7 本人）。カテゴリー別は合計の多い順、収入の一覧では名前（バイト代など）ごと。
// 棒グラフは、グループの色の積み上げ・右に縦の目盛り・月の横軸は端の日付だけ（10/7 本人）。
// グラフと一覧の間に、その期間の支出トップ（ホームと同じ写真のカード・5つまで。10/7 本人）。押すと一覧をそのカテゴリで絞り込む（棒グラフのままでも）。

import * as C from '../calc.js';
import { GROUP_CLASS } from '../icons.js';
import { esc, money, icon, onSwipe, seg, tween, liftValue } from '../ui.js';
import { row, topTile } from './home.js';
import { incomeRow } from './income.js';

const UNIT_NAME = { week: '週', month: '月', year: '年' };
const view = { unit: 'month', offset: 0, chart: 'bar', flow: '支出', bucket: null, group: null, cat: null, dir: 0, sort: 'date' };
let groupOfNow = () => 'その他'; // いまのデータでカテゴリのグループを引く（render で入れ替える。押したときに使う）

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
  groupOfNow = groupOf;
  if (view.cat && !view.group) view.group = groupOf(view.cat); // カテゴリから来たら、そのグループの内訳を開いておく

  const incomesInPeriod = C.incomeBetween(data.transactions, p.start, p.end);
  const showIncome = view.chart === 'bar' && view.flow === '収入';
  const pick = showIncome ? C.incomeBetween : C.spendBetween;

  // 一覧の絞り込み：棒（期間の一部）／グループ／カテゴリ。一覧はグラフに合わせて、支出か収入のどちらか
  let list = showIncome ? incomesInPeriod : inPeriod, filterLabel = '';
  if (view.chart === 'bar' && view.bucket !== null && p.buckets[view.bucket]) {
    const b = p.buckets[view.bucket];
    list = pick(list, b.start, b.end);
    filterLabel = detailOf(b) || b.label;
  }
  if (view.cat && !showIncome) { // 円の内訳か、支出トップのカードで選んだカテゴリ
    list = list.filter(t => (t.category || '未分類') === view.cat);
    filterLabel = view.cat;
  } else if (view.chart === 'pie' && view.group) {
    list = list.filter(t => groupOf(t.category) === view.group);
    filterLabel = view.group;
  }

  const top = showIncome ? [] : C.categoryTotals(inPeriod).slice(0, 5);

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
      <div class="stats-main">
      <section class="chart card" id="chart">
        ${view.chart === 'bar'
          ? `<div class="chart-total">${seg('flow', [['支出', '支出'], ['収入', '収入']], view.flow, 'グラフに出すもの')}${money(C.sum(showIncome ? incomesInPeriod : inPeriod), hidden, 'stats-total')}</div>
             ${barChart(C.bucketTotals(data.transactions, p, view.flow), hidden, showIncome,
               showIncome ? null : p.buckets.map(b => C.groupTotals(C.spendBetween(data.transactions, b.start, b.end), data.categories)))}
             ${showIncome ? '' : barLegend(C.groupTotals(inPeriod, data.categories))}`
          : `<div class="chart-total"><span class="label">支出の合計</span>${money(C.sum(inPeriod), hidden, 'stats-total')}</div>
             ${incomesInPeriod.length ? `<div class="chart-income" data-key="inc"><span class="label">収入</span><span class="pos">+${money(C.sum(incomesInPeriod), hidden)}</span></div>` : ''}
             ${pieChart(C.groupTotals(inPeriod, data.categories), hidden)}`}
      </section>
      ${top.length ? `<section class="stats-top" data-key="top">
        <div class="section"><h2>支出トップ</h2></div>
        <div class="tiles${view.cat ? ' picked' : ''}" data-key="tiles">${top.map((c, i) => topTile(c, i, hidden,
          `button type="button" data-top="${esc(c.name)}" aria-pressed="${view.cat === c.name}"`, `top:${c.name}`, view.cat === c.name ? ' on' : '')).join('')}</div>
      </section>` : ''}
      </div>

      <section class="tx-list">
        <div class="section"><h2>一覧</h2>${seg('sort', [['date', '日付順'], ['cat', showIncome ? '名前別' : 'カテゴリー別']], view.sort, '一覧の並べ方')}</div>
        ${filterLabel ? `<div class="filter-row" data-key="filter"><button class="chip filter" data-key="${esc(filterLabel)}" data-act="clear">${esc(filterLabel)}で絞り込み中 ${icon('close')}</button></div>` : ''}
        ${!list.length ? `<p class="empty">この期間の${showIncome ? '収入' : '利用'}はありません</p>`
          : (view.sort === 'cat' ? byCategory : byDate)(list, groupOf, hidden, C.displayNames(data.rules))}
      </section>
    </div>
  </div>`;
}

/** 棒をタップしたときに金額の上に出す期間（月は「9/8〜9/14」、週は「10/6（火）」。年は下の「9月」で分かるので出さない）。 */
function detailOf(b) {
  return view.unit === 'week' ? `${b.sub}（${b.label}）` : view.unit === 'month' ? b.sub : '';
}

/** 下の目盛りの文字：月は棒ごとに書くとくどいので、左端と右端の日付だけ（10/7 本人）。週は曜日、年は月。 */
function axisLabel(buckets, i) {
  if (view.unit !== 'month') return buckets[i].label;
  const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
  return i === 0 ? md(buckets[0].start) : i === buckets.length - 1 ? md(buckets[i].end) : '';
}

/**
 * 棒グラフ。高さは --h（0〜1、縦の目盛りのいちばん上が 1）で、CSS が前の高さから新しい高さへ動かす。初めて出た棒は 0 から伸びる（data-from）。
 * 支出の棒は、円グラフと同じグループの色で積み上げる（10/7 本人）。下から 暮らし・固定費・たのしみ・その他・未分類。収入は1色。
 * 棒を選ぶと、ほかの棒が薄くなり、選んだ棒の上に期間と金額が出る。
 */
function barChart(buckets, hidden, income, parts) {
  const axis = C.niceAxis(Math.max(0, ...buckets.map(b => b.total)));
  const picked = view.bucket !== null;
  // 支出と収入で同じ data-key にして、切り替えると棒が今の高さから伸び縮みするようにする。目盛りは金額ごとの data-key で、上の金額が変わると線が動く
  return `<div class="bars${buckets.length > 7 ? ' many' : ''}${income ? ' income' : ''}${view.unit === 'month' ? ' ends' : ''}${picked ? ' picked' : ''}" data-key="bar" role="group" aria-label="${income ? '収入' : '支出'}の棒グラフ">
    <div class="grid" aria-hidden="true">${axis.ticks.map(v => `<span class="tick" data-key="t:${v}" data-vars="--y:${(v / axis.top).toFixed(4)}">${hidden ? '' : `<i>${esc(C.axisYen(v))}</i>`}</span>`).join('')}</div>
    ${buckets.map((b, i) => {
      const h = b.total ? Math.max(0.035, b.total / axis.top) : 0.012;
      const on = view.bucket === i;
      const detail = detailOf(b);
      const segs = !b.total ? ''
        : income ? '<span class="part inc" data-key="g:収入" data-vars="--s:1" data-from="--s:0"></span>'
        : parts[i].map(g => `<span class="part ${GROUP_CLASS[g.group]}" data-key="g:${esc(g.group)}" data-vars="--s:${(g.total / b.total).toFixed(4)}" data-from="--s:0"></span>`).join('');
      const tip = on && (detail || !hidden) ? `<span class="val" data-key="v">${detail ? `<small>${esc(detail)}</small>` : ''}${hidden ? '' : `<b>${esc(C.yen(b.total))}</b>`}</span>` : '';
      return `<button class="bar${on ? ' on' : ''}" data-bucket="${i}" aria-pressed="${on}" aria-label="${esc(detail || b.label)} ${hidden ? '' : esc(C.yen(b.total))}">
      <span class="col" data-vars="--h:${h.toFixed(4)};--i:${i}" data-from="--h:0">${tip}<span class="fill" data-key="f">${segs}</span></span>
      <span class="lab">${esc(axisLabel(buckets, i))}</span>
    </button>`;
    }).join('')}</div>`;
}

/** 棒の色の見本：この期間に使ったグループだけ。 */
function barLegend(groups) {
  if (!groups.length) return '';
  return `<div class="bar-legend" data-key="legend">${groups.map(g => `<span data-key="${esc(g.group)}"><i class="${GROUP_CLASS[g.group]}"></i>${esc(g.group)}</span>`).join('')}</div>`;
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

/** カテゴリー別：カテゴリー（収入は名前）ごとに、合計の多い順。中は新しい順。
 *  見出しにカテゴリーが出るので、行の名前は、この利用だけの名前 → 店の表示名 → カテゴリー の順（利用先そのものは出さない：10/6 本人）。 */
function byCategory(list, groupOf, hidden, names) {
  const groups = new Map();
  list.forEach(t => {
    const k = t.type === '収入' ? t.memo || '入金' : t.category || '未分類';
    groups.set(k, [...(groups.get(k) || []), t]);
  });
  return [...groups].map(([name, txs]) => ({ name, txs, total: C.sum(txs) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ja'))
    .map(g => `<h3 class="date cat-head" data-key="ch:${esc(g.name)}"><span>${esc(g.name)}<small>${g.txs.length}件</small></span>${money(g.total, hidden)}</h3>
      <div class="list card" data-key="c:${esc(g.name)}">${C.newestFirst(g.txs).map(t => (t.type === '収入' ? incomeRow(t, hidden)
        : row(t, groupOf(t.category), hidden, '', C.subtitleOf(t, names) || t.category || '未分類'))).join('')}</div>`)
    .join('');
}

export function mount(root, ctx) {
  const page = root.firstElementChild;
  pieShown.clear(); // 画面に入るたびに、円はぐるっと描き直す
  const go = changes => { Object.assign(view, { dir: 0 }, changes); ctx.rerender(); };
  page.addEventListener('click', e => {
    const el = e.target.closest('[data-unit], [data-chart], [data-flow], [data-sort], [data-step], [data-bucket], [data-group], [data-cat], [data-top], [data-act="clear"], [data-tx]');
    if (!el) return;
    const d = el.dataset;
    if (d.unit) { if (d.unit !== view.unit) { go({ unit: d.unit, offset: 0, bucket: null }); toFirstTile(); } }
    else if (d.sort) { if (d.sort !== view.sort) go({ sort: d.sort }); }
    else if (d.chart) { if (d.chart !== view.chart) go({ chart: d.chart, bucket: null, group: null, cat: null }); }
    else if (d.flow) { if (d.flow !== view.flow) go({ flow: d.flow, bucket: null, cat: null }); }
    else if (d.step) step(+d.step);
    else if (d.bucket !== undefined) go({ bucket: view.bucket === +d.bucket ? null : +d.bucket, cat: null }); // 棒と支出トップの絞り込みは、どちらか1つ
    else if (d.top) go(view.cat === d.top ? { cat: null } : { cat: d.top, group: groupOfNow(d.top), bucket: null });
    else if (d.group) go({ group: view.group === d.group ? null : d.group, cat: null });
    else if (d.cat) go({ cat: view.cat === d.cat ? null : d.cat });
    else if (d.act === 'clear') go({ bucket: null, group: null, cat: null });
    else if (d.tx) ctx.openDetail(d.tx);
  });
  onSwipe(page.querySelector('#chart'), step);

  function step(dir) {
    if (view.offset + dir > 0) return; // 未来には進まない
    go({ offset: view.offset + dir, bucket: null, dir });
    toFirstTile();
  }
  // 期間を変えたら、支出トップは1位から見せる
  const toFirstTile = () => page.querySelector('.stats-top .tiles')?.scrollTo({ left: 0, behavior: 'smooth' });
}

export function after(root) {
  animatePie(root);
  liftValue(root);
}
