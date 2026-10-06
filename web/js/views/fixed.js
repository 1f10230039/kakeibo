// S-12 固定費（10/7 本人）。今月の固定費（見込み）と先月との差、月ごとの推移、今月まだ来ていないもの、店（サブスク）ごとの一覧。
// 固定費＝グループが「固定費」のカテゴリ（いまはサブスク・通信費）。月は利用日で数える（ほかの画面と同じ）。計算は calc.js の fixedSummary。
// ホームの「固定費」のカードと、メニューから開く。行を押すと、いちばん新しい利用の詳細が開く。
// 棒グラフの下は、選んだ月で変わる（10/7 本人）：前の月はその月の一覧だけ。今月（初め）は、今月の一覧＋まだ来ていないもの＋いまの固定費。
// パッと見の情報を減らすため、出し方の説明は ⓘ に入れる。

import * as C from '../calc.js';
import { esc, money, icon, iconMark, liftValue, info } from '../ui.js';
import { row } from './home.js';

let pick = null; // タップして選んだ月（'YYYY-MM'）。null なら選んでいない（下は今月のもの）
let live = null; // 書き換えたあとも、いまの ctx でシートを開くため

export const morphable = true;

/** 固定費の出し方（ホームのカードと、この画面の ⓘ）。 */
export const FIXED_INFO = cats => `カテゴリのグループが「固定費」（${cats.join('・')}）の支出を、利用日の月で数えます。\n今月の金額は、もう来た分に、先月来たのに今月まだ来ていないもの（先月と同じ金額）を足した見込みです。`;

const PENDING_INFO = '先月来たのに、今月まだ来ていないものです。「◯日ごろ」は先月来た日です。\n解約したものは、来月から出なくなります。年に1回のものも、払った次の月にここに出ることがあります。';
const ITEMS_INFO = '今月か先月に来た店です。金額は、今月分がそろっていれば今月、まだなら先月の金額です。前の月から金額が変わったときは、その差も出します。\n行を押すと、いちばん新しい利用の詳細が開きます。';

export function render(ctx) {
  live = ctx;
  const { data, today, hidden } = ctx;
  const f = C.fixedSummary(data.transactions, data.categories, data.rules, today);
  const cur = C.ym(today);
  if (pick && !f.months.some(m => m.month === pick)) pick = null;
  const shown = pick || cur; // 下に出す月
  const rest = f.forecast - f.thisMonth;
  const diff = f.forecast - f.lastMonth;
  const names = C.displayNames(data.rules);

  return `<div class="page fixed-page">
    <header class="page-head with-back"><a class="back" href="#/home" aria-label="戻る">${icon('back')}</a><h1>固定費</h1></header>

    <section class="card fixed-main">
      <div class="label">${today.getMonth() + 1}月の固定費${rest ? 'の見込み' : ''}${info(FIXED_INFO(f.cats), '固定費の出し方')}</div>
      <div class="big">${money(f.forecast, hidden, 'fixed-month')}</div>
      <div class="compare">先月 ${money(f.lastMonth, hidden)}${hidden || !f.lastMonth ? '' : `　<b>${diff === 0 ? '同じ' : `${esc(C.yen(Math.abs(diff)).slice(1))}円 ${diff < 0 ? '少ない' : '多い'}`}</b>`}</div>
    </section>

    <section class="card chart fixed-chart">
      <div class="chart-total"><span class="label">月ごとの固定費</span></div>
      ${monthChart(f, hidden)}
      ${legend(f)}
    </section>

    ${monthList(data.transactions, f, shown, hidden, names, shown === cur, today)}
    ${shown === cur ? current(f, rest, hidden) : ''}
  </div>`;
}

/** 今月だけ：まだ来ていないもの・いまの固定費。 */
function current(f, rest, hidden) {
  return `${f.pending.length ? `<div class="section" data-key="pend-head"><h2>まだ来ていないもの${info(PENDING_INFO)}</h2><span class="more">${money(rest, hidden)}</span></div>
      <div class="list card" data-key="pend">${f.pending.map(p => `<button class="row" data-key="p:${esc(p.key)}:${p.amount}" data-tx="${esc(p.lastId)}">
        ${iconMark(p.category, C.FIXED_GROUP)}
        <span class="t"><b><span class="cat-name">${esc(p.name)}</span></b><small>${p.day}日ごろ${p.late ? '<span class="badge warn">まだ</span>' : ''}</small></span>
        <span class="a muted">${money(p.amount, hidden)}</span>
      </button>`).join('')}</div>` : ''}

    <div class="section" data-key="items-head"><h2>いまの固定費${info(ITEMS_INFO)}</h2>${f.items.length ? `<span class="more">毎月 ${money(C.sum(f.items), hidden)} ほど</span>` : ''}</div>
    ${f.items.length ? `<div class="list card" data-key="items">${f.items.map(i => `<button class="row" data-key="i:${esc(i.key)}" data-tx="${esc(i.lastId)}">
        ${iconMark(i.category, C.FIXED_GROUP)}
        <span class="t"><b><span class="cat-name">${esc(i.name)}</span></b><small>毎月${i.days.join('・')}日ごろ</small></span>
        <span class="a">${money(i.amount, hidden)}${i.change && !hidden ? `<small class="chg ${i.change > 0 ? 'up' : 'down'}">${i.change > 0 ? '+' : '−'}${esc(C.yen(Math.abs(i.change)))}</small>` : ''}</span>
      </button>`).join('')}</div>`
      : '<p class="empty" data-key="items">今月と先月の固定費はありません</p>'}`;
}

/** 月ごとの棒グラフ。カテゴリ（サブスク・通信費）で色を分けて積み上げ、今月はまだ来ていない分を斜線で足す。 */
function monthChart(f, hidden) {
  const axis = C.niceAxis(Math.max(0, ...f.months.map(m => m.total + m.expected)));
  const many = f.months.length > 7;
  return `<div class="bars fixed-bars${many ? ' many' : ''}${pick ? ' picked' : ''}" data-key="fixed-bar" role="group" aria-label="月ごとの固定費の棒グラフ">
    <div class="grid" aria-hidden="true">${axis.ticks.map(v => `<span class="tick" data-key="t:${v}" data-vars="--y:${(v / axis.top).toFixed(4)}">${hidden ? '' : `<i>${esc(C.axisYen(v))}</i>`}</span>`).join('')}</div>
    ${f.months.map((m, i) => {
      const all = m.total + m.expected;
      const h = all ? Math.max(0.035, all / axis.top) : 0.012;
      const on = pick === m.month;
      const mm = Number(m.month.slice(5));
      const parts = !all ? '' : f.cats.map((c, j) => (m.byCat[c] ? `<span class="part f${Math.min(j, 2)}" data-key="g:${esc(c)}" data-vars="--s:${(m.byCat[c] / all).toFixed(4)}" data-from="--s:0"></span>` : '')).join('')
        + (m.expected ? `<span class="part exp" data-key="g:exp" data-vars="--s:${(m.expected / all).toFixed(4)}" data-from="--s:0"></span>` : '');
      const label = `${Number(m.month.slice(0, 4))}年${mm}月`;
      const tip = on ? `<span class="val" data-key="v"><small>${mm}月${m.expected && !hidden ? `（見込み ${esc(C.yen(all))}）` : ''}</small>${hidden ? '' : `<b>${esc(C.yen(m.total))}</b>`}</span>` : '';
      return `<button class="bar${on ? ' on' : ''}" data-month="${m.month}" aria-pressed="${on}" aria-label="${label} ${hidden ? '' : esc(C.yen(m.total))}">
        <span class="col" data-vars="--h:${h.toFixed(4)};--i:${i}" data-from="--h:0">${tip}<span class="fill" data-key="f">${parts}</span></span>
        <span class="lab">${mm}月</span>
      </button>`;
    }).join('')}</div>`;
}

function legend(f) {
  const used = f.cats.filter(c => f.months.some(m => m.byCat[c]));
  const exp = f.months.some(m => m.expected);
  if (!used.length && !exp) return '';
  return `<div class="bar-legend" data-key="legend">${used.map(c => `<span data-key="${esc(c)}"><i class="part f${Math.min(f.cats.indexOf(c), 2)}"></i>${esc(c)}</span>`).join('')}${exp ? '<span data-key="exp"><i class="part exp"></i>まだ来ていない分</span>' : ''}</div>`;
}

/** 選んだ月の固定費の一覧（新しい順）。今月は、もう来た分。 */
function monthList(txs, f, month, hidden, names, isCurrent, today) {
  const list = C.newestFirst(txs.filter(t => C.isSpend(t) && f.cats.includes(t.category) && t.date.slice(0, 7) === month && t.date <= C.ymd(today)));
  const m = Number(month.slice(5));
  return `<div class="section" data-key="md-head:${month}"><h2>${m}月${isCurrent ? 'に来た分' : 'の固定費'}</h2><span class="more">${money(C.sum(list), hidden)}</span></div>
    ${list.length ? `<div class="list card" data-key="md:${month}">${list.map(t => row(t, C.FIXED_GROUP, hidden, C.subtitleOf(t, names))).join('')}</div>`
      : `<p class="empty" data-key="md:${month}">${isCurrent ? '今月はまだ来ていません' : 'この月の固定費はありません'}</p>`}`;
}

export function mount(root) {
  root.firstElementChild.addEventListener('click', e => {
    const el = e.target.closest('[data-month], [data-tx]');
    if (!el) return;
    if (el.dataset.month) { pick = pick === el.dataset.month ? null : el.dataset.month; live.rerender(); }
    else live.openDetail(el.dataset.tx);
  });
}

export function after(root) {
  liftValue(root);
}
