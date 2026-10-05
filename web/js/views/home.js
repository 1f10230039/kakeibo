// S-01 ホーム。配置は docs/02_画面設計.md の S-01、見た目は docs/design/home_3案.html。

import * as C from '../calc.js';
import { CATEGORY_PHOTO, categoryIcon } from '../icons.js';
import { esc, money, iconMark, icon } from '../ui.js';

let topRange = 'week'; // 支出トップの期間：'week'（今週）／'month'（今月）

export function render(ctx) {
  const { data, today, look, hidden } = ctx;
  const txs = data.transactions;
  const thisMonth = C.monthToDate(txs, today);
  const lastMonth = C.lastMonthToSameDay(txs, today);
  const diff = thisMonth - lastMonth;
  const debit = C.nextDebit(txs, today);

  const unclassified = C.unclassified(txs).length;
  const stale = C.staleSokuho(txs, today).length;
  const unreadable = data.settings.unreadableMails || 0;

  const start = topRange === 'week' ? C.startOfWeek(today, data.settings.weekStart) : new Date(today.getFullYear(), today.getMonth(), 1);
  const top = C.categoryTotals(C.spendBetween(txs, start, today));
  const recent = C.newestFirst(txs.filter(C.isSpend)).slice(0, 3);
  const groupOf = name => (name === '未分類' ? '未分類' : (data.categories.find(c => c.name === name) || { group: 'その他' }).group);

  return `
  <div class="home">
    <div class="home-main">
      <div class="hero">
        <div class="top">
          <div><div class="month">${today.getMonth() + 1}月</div><div class="greet${look.greeting.length >= 9 ? ' long' : ''}">${esc(look.greeting)}</div></div>
          <div class="icons">
            <button class="icon-btn" data-act="hide" aria-label="${hidden ? '金額を出す' : '金額を隠す'}">${icon(hidden ? 'eyeOff' : 'eye')}</button>
            <a class="icon-btn" href="#/menu" aria-label="メニュー">${icon('menu')}</a>
          </div>
        </div>
      </div>

      <section class="spend card">
        <div class="label">今月の支出</div>
        <div class="big">${money(thisMonth, hidden)}</div>
        <div class="compare">先月の同じ日まで ${money(lastMonth, hidden)}　<b>${hidden ? '' : diff === 0 ? '同じ' : esc(C.yen(Math.abs(diff)).slice(1)) + (diff < 0 ? '円 少ない' : '円 多い')}</b></div>
      </section>

      <div class="pair">
        <div class="mini card"><div class="label">収入</div><div class="num muted">—</div><div class="soon">段階③から</div></div>
        <div class="mini card"><div class="label">残高</div><div class="num muted">—</div><div class="soon">段階③から</div></div>
      </div>

      <div class="due"><span>${esc(C.mdw(debit.date))} 引き落とし予定</span><span class="num">${money(debit.amount, hidden)}</span></div>

      <div class="todo">
        ${unclassified ? `<a class="chip" href="#/unclassified"><span class="dot"></span>未分類が${unclassified}件</a>` : ''}
        ${stale ? `<a class="chip" href="#/stale"><span class="dot"></span>確認が必要な速報が${stale}件</a>` : ''}
        ${unreadable ? `<a class="chip" href="#/menu"><span class="dot"></span>読めなかったメールが${unreadable}通</a>` : ''}
        <button class="chip primary" data-act="manual">${icon('plus')}記録する</button>
      </div>
    </div>

    <div class="home-side">
      <div class="section"><h2>支出トップ</h2>
        <div class="seg" role="group" aria-label="期間">
          <button class="${topRange === 'week' ? 'on' : ''}" data-range="week">今週</button>
          <button class="${topRange === 'month' ? 'on' : ''}" data-range="month">今月</button>
        </div>
      </div>
      ${top.length ? `<div class="tiles">${top.slice(0, 5).map((c, i) => `
        <a class="tile ${CATEGORY_PHOTO[c.name] ? 'photo-' + CATEGORY_PHOTO[c.name] : 'tile-plain'}" href="#/stats?cat=${encodeURIComponent(c.name)}&unit=${topRange}">
          <span class="rank">${i + 1}</span>${CATEGORY_PHOTO[c.name] ? '' : `<span class="plain-icon">${categoryIcon('未分類')}</span>`}
          <div class="cap"><div class="cat">${esc(c.name)}</div><div class="amt">${money(c.total, hidden)}</div></div>
        </a>`).join('')}</div>` : `<p class="empty">${topRange === 'week' ? '今週' : '今月'}の支出はまだありません</p>`}

      <div class="section"><h2>最近の利用</h2><a class="more" href="#/stats">すべて ${icon('chevron')}</a></div>
      ${recent.length ? `<div class="list card">${recent.map(t => row(t, groupOf(t.category || '未分類'), hidden)).join('')}</div>` : '<p class="empty">まだ利用がありません</p>'}
    </div>
  </div>`;
}

export function row(t, group, hidden) {
  const d = C.parseYmd(t.date);
  return `<button class="row" data-tx="${esc(t.id)}">
    ${iconMark(t.category, group)}
    <span class="t"><b>${esc(t.category || '未分類')}</b><small>${d.getMonth() + 1}/${d.getDate()}${t.status === '速報' ? '<span class="badge">速報</span>' : ''}${t.source === '手入力' ? '<span class="badge">手入力</span>' : ''}</small></span>
    <span class="a">${money(t.amount, hidden)}</span>
  </button>`;
}

export function mount(root, ctx) {
  root.querySelector('[data-act="hide"]').addEventListener('click', ctx.toggleHidden);
  root.querySelector('[data-act="manual"]').addEventListener('click', ctx.openManual);
  root.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { topRange = b.dataset.range; ctx.rerender(); }));
  root.querySelectorAll('[data-tx]').forEach(b => b.addEventListener('click', () => ctx.openDetail(b.dataset.tx)));
}
