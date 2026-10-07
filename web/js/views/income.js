// S-11 収入（段階③）。入金の記録を月ごとに並べる。ホームの「収入」のカードから開く。
// いまは手入力（楽天銀行の取引通知メールに金額が載るか分かったら、自動にする）。名前（バイト代・お小遣いなど）で区別する。

import * as C from '../calc.js';
import { info, esc, money, icon, incomeMark } from '../ui.js';

export const morphable = true;

let live = null; // 最後に描いたときの ctx（morph では mount をやり直さないため）

/** 収入の1行（ホーム・統計・この画面で使う）。 */
export function incomeRow(t, hidden) {
  const d = C.parseYmd(t.date);
  return `<button class="row income" data-key="${esc(t.id)}" data-tx="${esc(t.id)}">
    ${incomeMark()}
    <span class="t"><b><span class="cat-name">${esc(t.memo || '入金')}</span>${t.merchant && t.memo ? `<span class="sub">${esc(t.merchant)}</span>` : ''}</b>
      <small>${d.getMonth() + 1}/${d.getDate()}${C.isPointPayment(t) ? '<span class="badge">ポイント払い</span>' : `<span class="badge">収入</span>${t.source === '手入力' ? '<span class="badge">手入力</span>' : ''}`}</small></span>
    <span class="a pos">+${money(t.amount, hidden)}</span>
  </button>`;
}

export function render(ctx) {
  live = ctx;
  const { data, today, hidden } = ctx;
  const incomes = C.newestFirst(data.transactions.filter(C.isIncome));
  const months = new Map();
  incomes.forEach(t => {
    const m = t.date.slice(0, 7);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(t);
  });
  return `<div class="page income-page">
    <header class="page-head with-back"><a class="back" href="#/home" aria-label="戻る">${icon('back')}</a><h1>収入</h1></header>
    <section class="card income-main">
      <div class="label">${today.getMonth() + 1}月の収入${info('楽天銀行への入金（バイト代・お小遣いなど）の合計です。\nいまは手で記録します。楽天銀行の取引通知メールに金額が載っているか分かったら、自動で入るようにします。', '収入の数え方')}</div>
      <div class="big">${money(C.monthIncome(data.transactions, today), hidden, 'income-month')}</div>
      <button class="btn primary" data-act="add">${icon('plus')}収入を記録する</button>
    </section>
    ${incomes.length ? [...months].map(([m, list]) => `
      <h3 class="date month-head" data-key="h:${m}"><span>${Number(m.slice(0, 4))}年${Number(m.slice(5))}月</span><span>${money(C.sum(list), hidden)}</span></h3>
      <div class="list card" data-key="l:${m}">${list.map(t => incomeRow(t, hidden)).join('')}</div>`).join('')
      : '<p class="empty">まだ収入の記録はありません</p>'}
  </div>`;
}

export function mount(root) {
  root.firstElementChild.addEventListener('click', e => {
    const el = e.target.closest('[data-act="add"], [data-tx]');
    if (!el) return;
    if (el.dataset.act === 'add') live.openManual('収入');
    else live.openDetail(el.dataset.tx);
  });
}
