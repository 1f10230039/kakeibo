// S-12 固定費（10/7 本人）。今月の固定費（見込み）と先月との差、月ごとの推移、今月まだ来ていないもの、店（サブスク）ごとの一覧。
// 固定費＝グループが「固定費」のカテゴリ（いまはサブスク・通信費）。月は利用日で数える（ほかの画面と同じ）。計算は calc.js の fixedSummary。
// ホームの「固定費」のカードと、メニューから開く。行を押すと、その利用の詳細が開く（「まだ」の行は、その店のいちばん新しい利用）。
// 棒グラフの下は、選んだ月の「◯月の固定費」の一覧1つだけ（10/7 本人）。今月は、もう来たものとまだ来ていないものを日にちの順に混ぜて出す。
// パッと見の情報を減らすため、出し方の説明は ⓘ に入れる。
// グラフを左右になぞると、選ぶ月が前後に1つずつ動く（10/7 本人：統計と同じように）。一覧はなぞった向きからすべり込む。

import * as C from '../calc.js';
import { esc, money, icon, iconMark, liftValue, info, onSwipe } from '../ui.js';

let pick = null; // タップ・スワイプで選んだ月（'YYYY-MM'）。null なら選んでいない（下は今月のもの）
let dir = 0;     // 前の月へ動いたら -1、次の月へなら 1（一覧の入ってくる向き）
let live = null; // 書き換えたあとも、いまの ctx でシートを開くため

export const morphable = true;

/** 固定費の出し方（ホームのカードと、この画面の ⓘ）。 */
export const FIXED_INFO = cats => `カテゴリのグループが「固定費」（${cats.join('・')}）の支出を、利用日の月で数えます。\n今月の金額は、もう来た分に、先月来たのに今月まだ来ていないもの（先月と同じ金額）を足した見込みです。`;

const CURRENT_INFO = 'もう来たものと、まだ来ていないものを、日にちの順に並べています。\n「まだ」は、先月来たのに今月まだ来ていないものです。「◯日ごろ」は先月来た日で、金額も先月の金額です。その日を過ぎても来ていなければ、「まだ」が赤くなります。\n解約したものは、来月から出なくなります。年に1回のものも、払った次の月に「まだ」で出ることがあります。';

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

  return `<div class="page fixed-page" data-dir="${dir}">
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

    <div class="month-list" data-key="ml:${shown}">${monthSection(data.transactions, f, shown, shown === cur, hidden, names, today)}</div>
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

/**
 * 選んだ月の「◯月の固定費」。1行＝1回の利用。名前が先、下に日付。
 * 今月は、まだ来ていないもの（先月の分）も同じ一覧に入れて、月の日にちの順に並べる（来たものが先）。見出しの右は今月の見込み。
 * 前の月は、その月に来たものを日にちの順に。
 */
function monthSection(txs, f, month, isCurrent, hidden, names, today) {
  const todayStr = C.ymd(today);
  const came = txs.filter(t => C.isSpend(t) && f.cats.includes(t.category) && t.date.slice(0, 7) === month && t.date <= todayStr);
  // 値段が変わった印：今月そろった店で、今月1回だけのもの
  const changeOf = new Map(isCurrent ? f.items.filter(i => i.arrived && i.change && i.days.length === 1).map(i => [i.key, i.change]) : []);
  const entries = [
    ...came.map(t => ({ day: Number(t.date.slice(8, 10)), order: 0, t })),
    ...(isCurrent ? f.pending.map(p => ({ day: p.day, order: 1, p })) : []),
  ].sort((a, b) => a.day - b.day || a.order - b.order || (a.t && b.t ? (a.t.id < b.t.id ? -1 : 1) : 0));
  const total = isCurrent ? f.forecast : C.sum(came);
  const m = Number(month.slice(5));
  const rowHtml = e => {
    if (e.t) {
      const t = e.t, change = changeOf.get(C.fixedKey(t));
      return `<button class="row" data-key="t:${esc(t.id)}" data-tx="${esc(t.id)}">
        ${iconMark(t.category, C.FIXED_GROUP)}
        <span class="t"><b><span class="cat-name">${esc(C.fixedName(t, names))}</span></b><small>${m}/${e.day}${t.status === '設定から' ? '<span class="badge">設定から</span>' : ''}</small></span>
        <span class="a">${money(t.amount, hidden)}${change && !hidden ? `<small class="chg ${change > 0 ? 'up' : 'down'}">${change > 0 ? '+' : '−'}${esc(C.yen(Math.abs(change)))}</small>` : ''}</span>
      </button>`;
    }
    const p = e.p;
    return `<button class="row yet" data-key="p:${esc(p.key)}:${p.amount}" data-tx="${esc(p.lastId)}">
        ${iconMark(p.category, C.FIXED_GROUP)}
        <span class="t"><b><span class="cat-name">${esc(p.name)}</span></b><small>${p.day}日ごろ<span class="badge${p.late ? ' warn' : ''}">まだ</span></small></span>
        <span class="a muted">${money(p.amount, hidden)}</span>
      </button>`;
  };
  return `<div class="section" data-key="md-head:${month}"><h2>${m}月の固定費${isCurrent ? info(CURRENT_INFO) : ''}</h2><span class="more">${isCurrent && f.pending.length ? '見込み ' : ''}${money(total, hidden)}</span></div>
    ${entries.length ? `<div class="list card" data-key="md:${month}">${entries.map(rowHtml).join('')}</div>`
      : `<p class="empty" data-key="md:${month}">${isCurrent ? '今月の固定費はまだありません' : 'この月の固定費はありません'}</p>`}`;
}

export function mount(root) {
  const page = root.firstElementChild;
  page.addEventListener('click', e => {
    const el = e.target.closest('[data-month], [data-tx]');
    if (!el) return;
    if (el.dataset.month) { pick = pick === el.dataset.month ? null : el.dataset.month; dir = 0; live.rerender(); }
    else live.openDetail(el.dataset.tx);
  });
  onSwipe(page.querySelector('.fixed-chart'), step);
}

/** 選ぶ月を前後に1つ動かす（グラフにある月の中だけ。端より先へは動かない）。 */
function step(d) {
  const months = C.fixedSummary(live.data.transactions, live.data.categories, live.data.rules, live.today).months.map(m => m.month);
  const i = months.indexOf(pick || C.ym(live.today));
  const next = months[i + d];
  if (i < 0 || !next) return;
  pick = next;
  dir = d;
  live.rerender();
}

export function after(root) {
  liftValue(root);
}
