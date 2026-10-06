// S-03 予算（段階②）。今月の予算（全体）に対して、いくら使って、あといくら残っているか。
// 予算は「毎月の予算」と「その月だけの予算」（毎月の予算より優先）。決まりは docs/03_システム設計.md の 3.4 と7章。
// 取り直しでは作り直さず、変わったところだけ書き換える（morphable）。横棒は前の長さから伸び縮みする。

import * as C from '../calc.js';
import * as api from '../api.js';
import { esc, money, openSheet, toast, icon, bindAmountInput, amountOf, busy } from '../ui.js';

export const morphable = true;

const findBudget = (budgets, month) => budgets.find(b => b.target === '全体' && b.month === month && b.amount > 0) || null;

// 最後に描いたときの ctx。書き換え（morph）では mount をやり直さないので、ボタンの動きはこれで新しいデータを見る
let live = null;

export function render(ctx) {
  live = ctx;
  const { data, today, hidden } = ctx;
  const month = C.ym(today), m = today.getMonth() + 1;
  const b = C.budgetFor(data.budgets, month);
  const every = findBudget(data.budgets, '');
  const only = findBudget(data.budgets, month);
  return `<div class="budget page">
    <header class="page-head"><h1>予算</h1></header>
    ${b ? main(C.budgetStatus(data.transactions, b.amount, today), m, hidden) : empty()}
    <div class="menu-group-label">予算の決め方</div>
    <div class="list card">
      <button class="row link" data-act="edit" data-month="">
        <span class="t"><b>毎月の予算</b><small>${every ? (only ? `${m}月は下の金額を使っています` : '月ごとに決めていない月は、この金額') : 'まだ決めていません'}</small></span>
        ${every ? `<span class="a">${money(every.amount, hidden)}</span>` : ''}${icon('chevron')}</button>
      <button class="row link" data-act="edit" data-month="${month}">
        <span class="t"><b>${m}月だけの予算</b><small>${only ? '毎月の予算の代わりに、こちらを使います' : '今月だけ金額を変えたいときに'}</small></span>
        ${only ? `<span class="a">${money(only.amount, hidden)}</span>` : ''}${icon('chevron')}</button>
    </div>
  </div>`;
}

function main(s, m, hidden) {
  const pct = Math.round(s.ratio * 100);
  const diff = s.spent - s.pace; // 今日までの目安との差（＋なら目安より多く使っている）
  const vsPace = hidden ? '' : diff === 0 ? '目安ちょうど' : `目安より ${C.yen(Math.abs(diff)).slice(1)}円 ${diff < 0 ? '少ない' : '多い'}`;
  return `<section class="card budget-main${s.over ? ' over' : ''}">
      <div class="label">${m}月の予算の${s.over ? 'オーバー' : '残り'}</div>
      <div class="big">${money(Math.abs(s.remaining), hidden, 'budget-left')}</div>
      ${meter(s)}
      <div class="meter-legend"><span>使った ${money(s.spent, hidden)}（${pct}%）</span><span>予算 ${money(s.amount, hidden)}</span></div>
      <div class="meter-note"><span class="pace-mark"></span>今日までの目安</div>
    </section>
    <div class="pair">
      <div class="mini card"><div class="label">1日あたり</div><div class="num">${s.over ? '—' : money(s.perDay, hidden)}</div>
        <div class="soon">今日を入れて あと${s.daysLeft}日</div></div>
      <div class="mini card"><div class="label">今日までの目安</div><div class="num">${money(s.pace, hidden)}</div>
        <div class="soon">${esc(vsPace)}</div></div>
    </div>`;
}

/** 使った割合の横棒。縦線は今日までの目安。ホームでも小さい版（small）を使う。 */
export function meter(s, small = false) {
  return `<div class="meter${small ? ' small' : ''}${s.over ? ' over' : ''}" role="img" aria-label="予算の${Math.round(s.ratio * 100)}%を使いました。縦線は今日までの目安">
    <span class="used" data-vars="--r:${Math.min(1, s.ratio).toFixed(4)}" data-from="--r:0"></span>
    <span class="pace" data-vars="--p:${s.paceRatio.toFixed(4)}"></span>
  </div>`;
}

function empty() {
  return `<section class="card budget-empty">
    <p>月の予算を決めると、今月あといくら使えるか、1日あたりいくらまでかが、ここに出ます。</p>
    <button class="btn primary" data-act="edit" data-month="">${icon('plus')}予算を決める</button>
  </section>`;
}

export function mount(root) {
  root.firstElementChild.addEventListener('click', e => {
    const el = e.target.closest('[data-act="edit"]');
    if (el) openEditor(live, el.dataset.month);
  });
}

/** 予算を決める・変える・やめる。month：'' なら毎月の予算、'YYYY-MM' ならその月だけの予算。 */
function openEditor(ctx, month) {
  const now = findBudget(ctx.data.budgets, month);
  const m = month ? Number(month.slice(5)) : 0;
  const title = month ? `${m}月だけの予算` : '毎月の予算';
  openSheet(`
    <h2 class="sheet-title">${esc(title)}</h2>
    <p class="sheet-note">${month ? `${m}月だけ、毎月の予算の代わりにこの金額を使います。` : '月ごとに決めていない月は、この金額を使います。'}
      数えるのは、カードと手入力の支出です（利用日がその月のもの）。</p>
    <label class="amount-input"><span>¥</span><input id="amount" inputmode="numeric" pattern="[0-9]*" placeholder="0" autocomplete="off" aria-label="予算の金額" value="${now ? now.amount : ''}"></label>
    <button class="btn primary wide" data-act="save">保存する</button>
    ${now ? `<div class="sheet-actions"><button class="btn danger" data-act="remove">${month ? `${m}月だけの予算をやめる（毎月の予算に戻す）` : '毎月の予算をなくす'}</button></div>` : ''}
  `, (sheet, close) => {
    const amountEl = sheet.querySelector('#amount');
    bindAmountInput(amountEl);
    // 送っている間はボタンを押せなくする。うまくいったら閉じ、失敗したら入れた金額を残したまま押せるように戻す
    const send = async (btn, job, doneText) => {
      const restore = busy(btn); // 押した直後に、ボタンの中にぐるぐると「保存しています…」
      if (await ctx.write(job, doneText)) close();
      else restore();
    };
    const saveBtn = sheet.querySelector('[data-act="save"]');
    saveBtn.addEventListener('click', () => {
      const amount = amountOf(amountEl);
      if (!Number.isInteger(amount) || amount < 1 || amount > 10000000) { toast('金額を入れてください（1,000万円まで）', 'warn'); amountEl.focus(); return; }
      send(saveBtn, api.setBudget(month, amount), `${title}を ${C.yen(amount)} にしました`);
    });
    amountEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !saveBtn.disabled) saveBtn.click(); });
    const removeBtn = sheet.querySelector('[data-act="remove"]');
    removeBtn?.addEventListener('click', () => {
      if (!confirm(`${title}をやめますか？`)) return;
      send(removeBtn, api.setBudget(month, null), month ? `${m}月は毎月の予算に戻しました` : '毎月の予算をなくしました');
    });
    setTimeout(() => amountEl.focus(), 250);
  });
}
