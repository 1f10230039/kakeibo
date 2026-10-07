// S-01 ホーム。配置は docs/02_画面設計.md の S-01、見た目は docs/design/home_3案.html。
// 切り替え（今週／今月・金額を隠す）や取り直しでは作り直さず、変わったところだけ書き換える（morphable）。ボタンの動きは .home にまとめて付ける。

import * as C from '../calc.js';
import { CATEGORY_PHOTO, categoryIcon } from '../icons.js';
import { esc, money, signedMoney, iconMark, icon, seg, info } from '../ui.js';
import { meter } from './budget.js';
import { FIXED_INFO } from './fixed.js';

let topRange = 'month'; // 支出トップの期間：'month'（今月。初めはこちら・10/6 本人）／'week'（今週）

export const morphable = true;

export function render(ctx) {
  const { data, today, look, hidden } = ctx;
  const txs = data.transactions;
  const thisMonth = C.monthToDate(txs, today);
  const lastMonth = C.lastMonthToSameDay(txs, today);
  const diff = thisMonth - lastMonth;
  const debit = C.nextDebit(txs, today);
  const budget = C.budgetFor(data.budgets, C.ym(today));
  const bs = budget && C.budgetStatus(txs, budget.amount, today);
  const sp = C.spendable(txs, data.assets, today);
  const assetsNow = C.assetHistory(data.assets).at(-1);
  const assetDue = C.assetDue(data.assets, today);
  const hasIncome = txs.some(C.isIncome);
  const fixed = C.fixedSummary(txs, data.categories, data.rules, today);
  const hasFixed = fixed.forecast > 0 || fixed.lastMonth > 0;

  const unclassified = C.unclassified(txs).length;
  const stale = C.staleSokuho(txs, today).length;
  const unreadable = data.settings.unreadableMails || 0;

  const start = topRange === 'week' ? C.startOfWeek(today, data.settings.weekStart) : new Date(today.getFullYear(), today.getMonth(), 1);
  const top = C.categoryTotals(C.spendBetween(txs, start, today));
  const recent = C.newestFirst(txs.filter(C.isSpend)).slice(0, 3);
  const names = C.displayNames(data.rules);
  const groupOf = name => (name === '未分類' ? '未分類' : (data.categories.find(c => c.name === name) || { group: 'その他' }).group);

  return `
  <div class="home">
    <div class="home-main">
      <div class="hero">
        <div class="hero-img"></div>
        <div class="top">
          <div><div class="month"><b>${today.getMonth() + 1}</b>月</div><div class="greet">${esc(look.greeting)}</div></div>
          <div class="icons">
            <button class="icon-btn" data-act="hide" aria-label="${hidden ? '金額を出す' : '金額を隠す'}">${icon(hidden ? 'eyeOff' : 'eye')}</button>
            <a class="icon-btn" href="#/menu" aria-label="メニュー">${icon('menu')}</a>
          </div>
        </div>
      </div>

      <section class="spend card">
        <div class="label">今月の支出</div>
        <div class="big">${money(thisMonth, hidden, 'month')}</div>
        <div class="compare">先月の同じ日まで ${money(lastMonth, hidden)}　<b>${hidden ? '' : diff === 0 ? '同じ' : esc(C.yen(Math.abs(diff)).slice(1)) + (diff < 0 ? '円 少ない' : '円 多い')}</b></div>
        ${bs ? `<a class="budget-mini${bs.over ? ' over' : ''}" href="#/budget" aria-label="予算の画面へ">${meter(bs, true)}
          <span class="budget-line"><span>予算の${bs.over ? 'オーバー' : '残り'}</span>${money(Math.abs(bs.remaining), hidden)}</span></a>` : ''}
      </section>

      <div class="pair">
        <a class="mini card" href="#/income"><div class="label">収入</div>
          <div class="num">${hasIncome ? money(C.monthIncome(txs, today), hidden) : '<span class="muted">—</span>'}</div>
          ${hasIncome ? '' : '<div class="soon">記録すると出ます</div>'}</a>
        <div class="mini card linked"><a class="cover" href="#/assets" aria-label="資産の画面へ"></a>
          <div class="label">残高${info('楽天銀行の残高（資産の画面で記録した、いちばん新しい額）から、記録した日のあと〜次の引き落とし日までのカード代を引いた額です。記録のあとの入金や、カード以外の出入りは入っていません。', '残高の出し方')}</div>
          <div class="num">${sp ? signedMoney(sp.amount, hidden) : '<span class="muted">—</span>'}</div>
          ${sp ? '' : '<div class="soon">資産を記録すると出ます</div>'}
          ${assetsNow ? `<div class="asset-total">資産の合計 ${money(assetsNow.total, hidden)}</div>` : ''}</div>
      </div>

      <div class="fixed-mini card linked"><a class="cover" href="#/fixed" aria-label="固定費の画面へ"></a>
        <span class="label">固定費${info(FIXED_INFO(fixed.cats), '固定費の出し方')}</span>
        <span class="num">${hasFixed ? money(fixed.forecast, hidden) : '<span class="muted">—</span>'}</span>${icon('chevron')}
      </div>

      <div class="due"><span>${esc(C.mdw(debit.date))} 引き落とし予定${debit.points && !hidden ? info(`カードの利用 ${C.yen(debit.card)} から、ポイント払い ${C.yen(debit.points)} を引いた額です。`, '引き落とし予定の出し方') : ''}</span><span class="num">${money(debit.amount, hidden)}</span></div>

      <div class="todo">
        ${unclassified ? `<a class="chip" href="#/unclassified"><span class="dot"></span>未分類が${unclassified}件</a>` : ''}
        ${stale ? `<a class="chip" href="#/stale"><span class="dot"></span>確認が必要な速報が${stale}件</a>` : ''}
        ${unreadable ? `<a class="chip" href="#/menu"><span class="dot"></span>読めなかったメールが${unreadable}通</a>` : ''}
        ${assetDue ? `<button class="chip" data-act="asset" data-date="${assetDue.date}"><span class="dot"></span>${assetDue.label}</button>` : ''}
        ${budget ? '' : `<a class="chip" href="#/budget">${icon('budget')}予算を決める</a>`}
        <button class="chip primary" data-act="manual">${icon('plus')}記録する</button>
      </div>
    </div>

    <div class="home-side">
      <div class="section"><h2>支出トップ</h2>
        ${seg('range', [['week', '今週'], ['month', '今月']], topRange, '期間')}
      </div>
      ${top.length ? `<div class="tiles">${top.slice(0, 5).map((c, i) => topTile(c, i, hidden,
        `a href="#/stats?cat=${encodeURIComponent(c.name)}&unit=${topRange}"`, `${topRange}:${c.name}`)).join('')}</div>`
        : `<p class="empty">${topRange === 'week' ? '今週' : '今月'}の支出はまだありません</p>`}

      <div class="section"><h2>最近の利用</h2><a class="more" href="#/stats">すべて ${icon('chevron')}</a></div>
      ${recent.length ? `<div class="list card">${recent.map(t => row(t, groupOf(t.category || '未分類'), hidden, C.subtitleOf(t, names))).join('')}</div>` : '<p class="empty">まだ利用がありません</p>'}
    </div>
  </div>`;
}

/**
 * 支出トップの1枚（ホームと統計で使う）。open は開きタグの中身（'a href="…"' や 'button data-cat="…"'）、key は morph の data-key。
 * 写真のないカテゴリ（未分類・あとで足したカテゴリ）は、そのカテゴリのアイコンを出す。
 */
export function topTile(c, i, hidden, open, key, extraClass = '') {
  const photo = CATEGORY_PHOTO[c.name];
  const tag = open.split(' ')[0];
  return `<${open} class="tile ${photo ? 'photo-' + photo : 'tile-plain'}${extraClass}" data-key="${esc(key)}" data-vars="--i:${i}">
    <span class="rank">${i + 1}</span>${photo ? '' : `<span class="plain-icon">${categoryIcon(c.name)}</span>`}
    <div class="cap"><div class="cat">${esc(c.name)}</div><div class="amt">${money(c.total, hidden)}</div></div>
  </${tag}>`;
}

export function row(t, group, hidden, sub = '', title = t.category || '未分類') {
  const d = C.parseYmd(t.date);
  return `<button class="row" data-key="${esc(t.id)}" data-tx="${esc(t.id)}">
    ${iconMark(t.category, group)}
    <span class="t"><b><span class="cat-name">${esc(title)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</b><small>${d.getMonth() + 1}/${d.getDate()}${t.status === '速報' ? '<span class="badge">速報</span>' : ''}${t.source === '手入力' ? '<span class="badge">手入力</span>' : ''}${t.status === '設定から' ? '<span class="badge">設定から</span>' : ''}</small></span>
    <span class="a">${money(t.amount, hidden)}</span>
  </button>`;
}

export function mount(root, ctx) {
  const page = root.firstElementChild;
  page.addEventListener('click', e => {
    const el = e.target.closest('[data-act], [data-range], [data-tx]');
    if (!el) return;
    const d = el.dataset;
    if (d.act === 'hide') ctx.toggleHidden();
    else if (d.act === 'manual') ctx.openManual();
    else if (d.act === 'asset') ctx.openAsset(d.date);
    else if (d.range && d.range !== topRange) {
      topRange = d.range;
      ctx.rerender();
      page.querySelector('.tiles')?.scrollTo({ left: 0, behavior: 'smooth' });
    } else if (d.tx) ctx.openDetail(d.tx);
  });
}
