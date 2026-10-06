// S-12 固定費（10/7 本人）。今月の固定費（見込み）と先月との差、月ごとの推移、今月まだ来ていないもの、店（サブスク）ごとの一覧。
// 固定費＝グループが「固定費」のカテゴリ（いまはサブスク・通信費）。月は利用日で数える（ほかの画面と同じ）。計算は calc.js の fixedSummary。
// ホームの「固定費」のカードと、メニューから開く。棒をタップすると、その月の内訳が下に出る。行を押すと、いちばん新しい利用の詳細が開く。

import * as C from '../calc.js';
import { esc, money, icon, iconMark, liftValue } from '../ui.js';
import { row } from './home.js';

let pick = null; // 選んだ月（'YYYY-MM'）
let live = null; // 書き換えたあとも、いまの ctx でシートを開くため

export const morphable = true;

export function render(ctx) {
  live = ctx;
  const { data, today, hidden } = ctx;
  const f = C.fixedSummary(data.transactions, data.categories, data.rules, today);
  if (pick && !f.months.some(m => m.month === pick)) pick = null;
  const rest = f.forecast - f.thisMonth;
  const diff = f.forecast - f.lastMonth;
  const names = C.displayNames(data.rules);

  return `<div class="page fixed-page">
    <header class="page-head with-back"><a class="back" href="#/home" aria-label="戻る">${icon('back')}</a><h1>固定費</h1></header>

    <section class="card fixed-main">
      <div class="label">${today.getMonth() + 1}月の固定費${rest ? 'の見込み' : ''}</div>
      <div class="big">${money(f.forecast, hidden, 'fixed-month')}</div>
      ${rest ? `<div class="compare">もう来た分 ${money(f.thisMonth, hidden)}・まだの分 ${money(rest, hidden)}</div>` : ''}
      <div class="compare">先月 ${money(f.lastMonth, hidden)}${hidden || !f.lastMonth ? '' : `　<b>${diff === 0 ? '同じ' : `${esc(C.yen(Math.abs(diff)).slice(1))}円 ${diff < 0 ? '少ない' : '多い'}`}</b>`}</div>
    </section>

    <section class="card chart fixed-chart">
      <div class="chart-total"><span class="label">月ごとの固定費</span></div>
      ${monthChart(f, hidden)}
      ${legend(f)}
    </section>
    ${pick ? monthDetail(data.transactions, f, pick, hidden, names) : ''}

    ${f.pending.length ? `<div class="section"><h2>今月まだ来ていないもの</h2><span class="more">${money(rest, hidden)}</span></div>
      <div class="list card">${f.pending.map(p => `<button class="row" data-key="p:${esc(p.key)}:${p.amount}" data-tx="${esc(p.lastId)}">
        ${iconMark(p.category, C.FIXED_GROUP)}
        <span class="t"><b><span class="cat-name">${esc(p.name)}</span></b><small>${p.day}日ごろ${p.late ? '<span class="badge warn">まだ来ていません</span>' : ''}</small></span>
        <span class="a muted">${money(p.amount, hidden)}</span>
      </button>`).join('')}</div>
      <p class="note-s fixed-note">先月の同じころに来た分です。解約したものは、来月から出なくなります。</p>` : ''}

    <div class="section"><h2>いまの固定費</h2>${f.items.length ? `<span class="more">毎月 ${money(C.sum(f.items), hidden)} ほど</span>` : ''}</div>
    ${f.items.length ? `<div class="list card">${f.items.map(i => `<button class="row" data-key="i:${esc(i.key)}" data-tx="${esc(i.lastId)}">
        ${iconMark(i.category, C.FIXED_GROUP)}
        <span class="t"><b><span class="cat-name">${esc(i.name)}</span></b><small>毎月${i.days.join('・')}日ごろ・${esc(i.category)}${i.arrived ? '' : '<span class="badge">今月はまだ</span>'}</small></span>
        <span class="a">${money(i.amount, hidden)}${i.change && !hidden ? `<small class="chg ${i.change > 0 ? 'up' : 'down'}">先月より${i.change > 0 ? '+' : '−'}${esc(C.yen(Math.abs(i.change)))}</small>` : ''}</span>
      </button>`).join('')}</div>`
      : `<p class="empty">今月と先月の固定費はありません</p>`}
    <p class="note">固定費は、カテゴリが「${f.cats.map(esc).join('」「')}」の支出です。行を押すと、いちばん新しい利用の詳細が開きます。</p>
  </div>`;
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

/** 選んだ月の固定費の一覧（新しい順）。 */
function monthDetail(txs, f, month, hidden, names) {
  const list = C.newestFirst(txs.filter(t => C.isSpend(t) && f.cats.includes(t.category) && t.date.slice(0, 7) === month));
  return `<div class="section" data-key="md-head:${month}"><h2>${Number(month.slice(5))}月の固定費</h2><span class="more">${money(C.sum(list), hidden)}</span></div>
    ${list.length ? `<div class="list card" data-key="md:${month}">${list.map(t => row(t, C.FIXED_GROUP, hidden, C.subtitleOf(t, names))).join('')}</div>`
      : `<p class="empty" data-key="md:${month}">この月の固定費はありません</p>`}`;
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
