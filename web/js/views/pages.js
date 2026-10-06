// ホーム・統計以外の画面：S-00 合言葉、S-06 未分類の振り分け、確認が必要な速報、S-08 メニュー、S-10 対応表、
// 予算・資産（準備中）。

import * as C from '../calc.js';
import * as api from '../api.js';
import { esc, money, icon, toast, seg, selectSeg } from '../ui.js';
import { categoryPicker, openDetail } from './sheets.js';
import { row } from './home.js';

const backBar = (title, href = '#/home') => `<header class="page-head with-back"><a class="back" href="${href}" aria-label="戻る">${icon('back')}</a><h1>${esc(title)}</h1></header>`;

// ---- S-00 合言葉 ----

export const key = {
  render: () => `
  <div class="page key">
    <header class="page-head"><h1>はじめに</h1></header>
    <p class="lead">「家計簿 API」の URL と合言葉を入れてください。この端末の中にだけ保存されます。</p>
    <label class="field"><span>API の URL</span><input id="url" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <label class="field"><span>合言葉（64文字）</span><input id="secret" type="password" autocomplete="off" spellcheck="false"></label>
    <button class="btn primary wide" data-act="save">確かめて保存する</button>
    <p class="note">⚠️ 合言葉は1時間に10回間違えると、その1時間は正しくても入れなくなります。コピーして貼り付けてください。</p>
  </div>`,
  mount(root, ctx) {
    const btn = root.querySelector('[data-act="save"]');
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '確かめています…';
      try {
        await api.setCredentials(root.querySelector('#url').value, root.querySelector('#secret').value);
        toast('つながりました');
        await ctx.refresh();
        location.hash = '#/home';
      } catch (e) {
        toast(e.message, 'warn');
      } finally {
        btn.disabled = false; btn.textContent = '確かめて保存する';
      }
    });
  },
};

// ---- S-06 未分類の振り分け ----

let skipped = new Set();
let lastSortId = null; // 前に出していた利用。違う利用に進んだら、カードを右からすべり込ませる

export const unclassified = {
  render(ctx) {
    const items = C.newestFirst(C.unclassified(ctx.data.transactions)).filter(t => !skipped.has(t.id));
    if (!items.length) {
      skipped = new Set();
      return `<div class="page">${backBar('未分類の振り分け')}<p class="empty big">振り分けを待っている利用はありません 🎉</p></div>`;
    }
    const t = items[0];
    const advanced = !ctx.entering && lastSortId !== null && lastSortId !== t.id;
    lastSortId = t.id;
    return `<div class="page sorter">
      ${backBar('未分類の振り分け')}
      <p class="progress">残り ${items.length} 件</p>
      <section class="sort-card card${advanced ? ' advance' : ''}">
        <div class="sort-merchant">${esc(t.merchant || (t.source === '手入力' ? '手入力' + (t.memo ? '：' + t.memo : '') : '（店名なし）'))}</div>
        <div class="big">${money(t.amount, ctx.hidden)}</div>
        <div class="compare">${esc(C.mdw(C.parseYmd(t.date)))}・${esc(t.status)}</div>
      </section>
      ${t.merchant ? `<label class="switch-row"><span>この店はいつもこの内容<small>次からはカテゴリと名前を自動で付けます</small></span><input type="checkbox" id="always" checked><span class="switch" aria-hidden="true"></span></label>` : ''}
      <label class="field"><span>名前（一覧で用途の横に出ます。なくてもよい）</span><input id="name" data-clear maxlength="100" autocomplete="off" placeholder="例：YouTube Premium" value="${esc(t.memo)}"></label>
      ${categoryPicker(ctx.data.categories, '')}
      <button class="btn ghost wide" data-act="skip">あとで決める</button>
    </div>`;
  },
  mount(root, ctx) {
    const items = C.newestFirst(C.unclassified(ctx.data.transactions)).filter(t => !skipped.has(t.id));
    const t = items[0];
    if (!t) return;
    root.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', async () => {
      const always = root.querySelector('#always')?.checked;
      const cat = b.dataset.pick;
      const name = root.querySelector('#name').value.trim();
      if (/^[=+\-@]/.test(name)) { toast('名前を = + - @ で始めることはできません', 'warn'); return; }
      const job = always
        ? api.setRule(t.merchant, cat, name)
        : api.setCategory(t.id, cat).then(() => (name !== (t.memo || '') ? api.setMemo(t.id, name) : null));
      await ctx.write(job, always ? `「${t.merchant}」をいつも${cat}にしました` : `${cat}にしました`);
    }));
    root.querySelector('[data-act="skip"]').addEventListener('click', () => { skipped.add(t.id); ctx.rerender(); });
  },
};

// ---- 確認が必要な速報（14日たっても確定にならない） ----

export const stale = {
  render(ctx) {
    const items = C.newestFirst(C.staleSokuho(ctx.data.transactions, ctx.today));
    return `<div class="page">${backBar('確認が必要な速報')}
      <p class="lead">速報のメールが来てから14日たっても、確定のメールが来ていない利用です。キャンセルになったか、確定で金額が変わった可能性があります。タップして、キャンセルだったものは取り消してください。</p>
      ${items.length ? `<div class="list card">${items.map(t => row(t, '未分類', ctx.hidden)).join('')}</div>` : '<p class="empty">ありません</p>'}
    </div>`;
  },
  mount(root, ctx) {
    root.querySelectorAll('[data-tx]').forEach(b => b.addEventListener('click', () => openDetail(ctx, b.dataset.tx)));
  },
};

// ---- S-08 メニュー ----

export const menu = {
  render(ctx) {
    const s = ctx.data.settings;
    return `<div class="page menu">
      ${backBar('メニュー')}
      <div class="menu-group-label">設定</div>
      <div class="list card">
        <a class="row link" href="#/rules"><span class="t"><b>カテゴリの対応表</b><small>店 → カテゴリ（${ctx.data.rules.length}件）</small></span>${icon('chevron')}</a>
        <div class="row"><span class="t"><b>週の始まり</b><small>統計の「週」と、ホームの「今週」</small></span>
          ${seg('week', [['月', '月曜'], ['日', '日曜']], s.weekStart, '週の始まり')}</div>
        <a class="row link" href="#/budget"><span class="t"><b>予算</b><small>${budgetLabel(ctx)}</small></span>${icon('chevron')}</a>
        <div class="row"><span class="t"><b>CSV の取り込みと照合</b><small>e-NAVI の CSV の形がわかってから作ります</small></span></div>
      </div>
      <div class="menu-group-label">状態</div>
      <div class="list card">
        <div class="row"><span class="t"><b>最終取り込み</b><small>${esc(s.lastIngest || 'まだ')}</small></span></div>
        <div class="row"><span class="t"><b>データを取った時刻</b><small>${ctx.fetchedAt ? esc(new Date(ctx.fetchedAt).toLocaleString('ja-JP')) : '—'}</small></span><button class="btn small" data-act="refresh">取り直す</button></div>
        ${s.unreadableMails ? `<div class="row"><span class="t"><b>読めなかったメール</b><small>${s.unreadableMails}通。取り込みの Apps Script の「記録」シートを確認する</small></span></div>` : ''}
      </div>
      <div class="menu-group-label">この端末</div>
      <div class="list card">
        <button class="row link" data-act="forget"><span class="t"><b>URL と合言葉を入れ直す</b><small>この端末に保存したものを消します</small></span>${icon('chevron')}</button>
      </div>
      <p class="credit">写真：Unsplash（Unsplash License）。一覧は images/CREDITS.md</p>
    </div>`;
  },
  mount(root, ctx) {
    root.querySelectorAll('[data-week]').forEach(b => b.addEventListener('click', async () => {
      if (b.classList.contains('on')) return;
      selectSeg(b); // 返事を待たずに背景を動かす。失敗したら元に戻す
      if (!(await ctx.write(api.setSetting('週の始まり', b.dataset.week), `週の始まりを${b.dataset.week}曜にしました`))) ctx.rerender();
    }));
    root.querySelector('[data-act="refresh"]').addEventListener('click', () => ctx.refresh(true));
    root.querySelector('[data-act="forget"]').addEventListener('click', () => {
      if (!confirm('この端末に保存した URL と合言葉を消しますか？')) return;
      api.forgetCredentials();
      location.hash = '#/key';
    });
  },
};

/** メニューの「予算」の下に出す一言。 */
function budgetLabel(ctx) {
  const every = ctx.data.budgets.find(b => b.target === '全体' && !b.month && b.amount > 0);
  return every ? `毎月 ${money(every.amount, ctx.hidden)}` : 'まだ決めていません';
}

// ---- S-10 対応表 ----

let editing = null;

export const rules = {
  render(ctx) {
    const list = [...ctx.data.rules].sort((a, b) => a.merchant.localeCompare(b.merchant));
    return `<div class="page">${backBar('カテゴリの対応表', '#/menu')}
      <p class="lead">確定のメールの店名が、ここにあるカテゴリと名前に自動で振り分けられます。タップすると変えられます。</p>
      ${list.length ? `<div class="list card">${list.map(r => `
        <button class="row link" data-merchant="${esc(r.merchant)}"><span class="t"><b>${esc(r.merchant)}</b><small>${esc(r.category)}${r.displayName ? '・' + esc(r.displayName) : ''}</small></span>${icon('chevron')}</button>
        ${editing === r.merchant ? `<div class="row-edit">
          <label class="field"><span>名前（一覧で用途の横に出ます）</span><input id="rule-name" data-clear maxlength="100" autocomplete="off" placeholder="例：YouTube Premium" value="${esc(r.displayName)}"></label>
          ${categoryPicker(ctx.data.categories, r.category)}
          <button class="btn primary wide" data-act="save-rule" data-category="${esc(r.category)}">保存</button>
        </div>` : ''}`).join('')}</div>`
        : '<p class="empty">まだありません。利用の詳細で「この店はいつもこのカテゴリ」をオンにすると増えます。</p>'}
    </div>`;
  },
  mount(root, ctx) {
    root.querySelectorAll('[data-merchant]').forEach(b => b.addEventListener('click', () => { editing = editing === b.dataset.merchant ? null : b.dataset.merchant; ctx.rerender(); }));
    const edit = root.querySelector('.row-edit');
    if (!edit) return;
    let category = edit.querySelector('[data-act="save-rule"]').dataset.category;
    edit.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      category = b.dataset.pick;
      edit.querySelectorAll('[data-pick]').forEach(x => x.classList.toggle('on', x.dataset.pick === category));
    }));
    edit.querySelector('[data-act="save-rule"]').addEventListener('click', async () => {
      const name = edit.querySelector('#rule-name').value.trim();
      if (/^[=+\-@]/.test(name)) { toast('名前を = + - @ で始めることはできません', 'warn'); return; }
      const m = editing; editing = null;
      await ctx.write(api.setRule(m, category, name), `「${m}」を保存しました`);
    });
  },
};

// ---- 予算・資産（準備中） ----

export const soon = (title, stage) => ({
  render: () => `<div class="page soon-page"><header class="page-head"><h1>${esc(title)}</h1></header>
    <div class="soon-card card"><p>${esc(title)}の画面は段階${stage}で作ります。</p></div></div>`,
  mount() {},
});
