// ホーム・統計・予算・資産以外の画面：S-00 合言葉、S-06 未分類の振り分け、確認が必要な速報、S-08 メニュー、S-10 対応表、S-13 誕生日と記念日。

import * as C from '../calc.js';
import * as api from '../api.js';
import { info, esc, money, icon, toast, seg, selectSeg, busy } from '../ui.js';
import { categoryPicker, openDetail, saveTx } from './sheets.js';
import { row } from './home.js';
import { ANNIVERSARY_NAME_MAX } from '../days.js';

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
      ${t.merchant ? `<label class="switch-row"><span>この店はいつもこの内容${info('オンにすると、カテゴリと名前を対応表に入れて、次からこの店の利用に自動で付けます。オフなら、この1件だけです。')}</span><input type="checkbox" id="always" checked><span class="switch" aria-hidden="true"></span></label>` : ''}
      <label class="field"><span>名前${info('一覧で用途の横に出る名前です（例：サブスク　YouTube Premium）。なくてもかまいません。')}</span><input id="name" data-clear maxlength="100" autocomplete="off" placeholder="例：YouTube Premium" value="${esc(t.memo)}"></label>
      ${categoryPicker(ctx.data.categories, '')}
      <button class="btn ghost wide" data-act="skip">あとで決める</button>
    </div>`;
  },
  mount(root, ctx) {
    const items = C.newestFirst(C.unclassified(ctx.data.transactions)).filter(t => !skipped.has(t.id));
    const t = items[0];
    if (!t) return;
    // カテゴリを押したら、返事を待たずに次の利用へ進む（裏で保存。10/7）
    root.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      const always = !!root.querySelector('#always')?.checked;
      const name = root.querySelector('#name').value.trim();
      if (/^[=+\-@]/.test(name)) { toast('名前を = + - @ で始めることはできません', 'warn'); return; }
      saveTx(ctx, t, { category: b.dataset.pick, name, always });
    }));
    root.querySelector('[data-act="skip"]').addEventListener('click', () => { skipped.add(t.id); ctx.rerender(); });
  },
};

// ---- 確認が必要な速報（14日たっても確定にならない） ----

export const stale = {
  render(ctx) {
    const items = C.newestFirst(C.staleSokuho(ctx.data.transactions, ctx.today));
    return `<div class="page">${backBar('確認が必要な速報')}
      <p class="lead">14日たっても確定のメールが来ていない速報です${info('キャンセルになったか、確定で金額が変わった可能性があります。タップして、キャンセルだったものは取り消してください。')}</p>
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
        <a class="row link" href="#/fixed"><span class="t"><b>固定費</b><small>毎月の固定費と推移・サブスクの一覧</small></span>${icon('chevron')}</a>
        <a class="row link" href="#/days"><span class="t"><b>誕生日と記念日</b><small>${esc(daysLabel(ctx.data.days || []))}</small></span>${icon('chevron')}</a>
        <a class="row link" href="#/csv"><span class="t"><b>CSV の取り込みと照合</b><small>e-NAVI の明細の CSV と、メールの記録を照らし合わせる（パソコンで）</small></span>${icon('chevron')}</a>
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

/** メニューの「誕生日と記念日」の下に出す一言。 */
function daysLabel(days) {
  const b = days.find(d => d.kind === '誕生日');
  const n = days.filter(d => d.kind === '記念日').length;
  if (!b && !n) return 'その日は、ホームに決まった挨拶が出ます';
  return [b && `誕生日 ${mdText(b.md)}`, n && `記念日 ${n}件`].filter(Boolean).join('・');
}

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
      <p class="lead">店ごとのカテゴリと名前です${info('確定のメールの店名が、ここにあるカテゴリと名前に自動で振り分けられます。タップすると変えられます。')}</p>
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
    edit.querySelector('[data-act="save-rule"]').addEventListener('click', async e => {
      const name = edit.querySelector('#rule-name').value.trim();
      if (/^[=+\-@]/.test(name)) { toast('名前を = + - @ で始めることはできません', 'warn'); return; }
      const m = editing;
      const restore = busy(e.currentTarget);
      if (await ctx.write(api.setRule(m, category, name), `「${m}」を保存しました`)) { editing = null; ctx.rerender(); } else restore();
    });
  },
};

// ---- S-13 誕生日と記念日（10/7 本人：誕生日＋好きな記念日をアプリで入れる。シートの「記念日」に保存） ----
// その日はホームに決まった挨拶（誕生日は専用の写真も）が出る（js/days.js）。年は入れない（毎年その日に出す）。
// 変えたものは下の「保存」でまとめて送る（1回の通信で全部を入れ替える）。

const DAYS_INFO = '誕生日は「お誕生日おめでとうございます」と専用の写真、記念日は「今日は◯◯ですね」がホームに出ます。\n年は入れません（毎年その日に出ます）。2/29 は、うるう年でない年は 2/28 に出ます。\nここで入れたものは、スプレッドシートの「記念日」に保存されます。';
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

let daysDraft = null; // { birthday: 'MM-DD' | '', anniversaries: [{ name, md }] }

const mdText = md => `${Number(md.slice(0, 2))}月${Number(md.slice(3))}日`;

function draftOf(days) {
  const b = days.find(d => d.kind === '誕生日');
  return { birthday: b ? b.md : '', anniversaries: days.filter(d => d.kind === '記念日').map(d => ({ name: d.name, md: d.md })) };
}

const sameDraft = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 月と日の選ぶ欄。empty なら「—」（まだ入れていない）を選べる。 */
function mdPicker(id, md, empty) {
  const m = md ? Number(md.slice(0, 2)) : 0, d = md ? Number(md.slice(3)) : 0;
  const opts = (n, on, unit) => (empty ? `<option value="0"${on ? '' : ' selected'}>—</option>` : '')
    + Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${on === i + 1 ? ' selected' : ''}>${i + 1}${unit}</option>`).join('');
  return `<span class="md-pick" data-md="${id}">
    <select aria-label="月" data-part="m">${opts(12, m, '月')}</select>
    <select aria-label="日" data-part="d">${opts(31, d, '日')}</select>
  </span>`;
}

/** 選ぶ欄の値を 'MM-DD' に。どちらかが「—」なら ''、ない日（2/30 など）なら null。 */
function readPicker(el) {
  const m = Number(el.querySelector('[data-part="m"]').value), d = Number(el.querySelector('[data-part="d"]').value);
  if (!m || !d) return '';
  if (d > DAYS_IN_MONTH[m - 1]) return null;
  return `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const days = {
  render(ctx) {
    const saved = draftOf(ctx.data.days || []);
    if (ctx.entering || !daysDraft) daysDraft = saved;
    const list = daysDraft.anniversaries;
    return `<div class="page days-page">${backBar('誕生日と記念日', '#/menu')}
      <p class="lead">その日は、ホームに決まった挨拶が出ます${info(DAYS_INFO)}</p>
      <div class="menu-group-label">誕生日</div>
      <div class="list card"><div class="row"><span class="t"><b>誕生日</b></span>${mdPicker('birthday', daysDraft.birthday, true)}</div></div>
      <div class="menu-group-label">記念日</div>
      <div class="list card">
        ${list.map((a, i) => `<div class="row"><span class="t"><b>${esc(a.name)}</b><small>${mdText(a.md)}</small></span>
          <button class="btn small ghost" data-del="${i}" aria-label="${esc(a.name)}を消す">消す</button></div>`).join('')}
        <div class="row-edit add-day">
          <label class="field"><span>名前（${ANNIVERSARY_NAME_MAX}文字まで）</span>
            <input id="day-name" maxlength="${ANNIVERSARY_NAME_MAX}" autocomplete="off" placeholder="例：結婚記念日"></label>
          <div class="add-day-row">${mdPicker('new', '', true)}<button class="btn small" data-act="add-day">${icon('plus')}足す</button></div>
        </div>
      </div>
      <button class="btn primary wide" data-act="save-days"${sameDraft(daysDraft, saved) ? ' disabled' : ''}>保存</button>
    </div>`;
  },
  mount(root, ctx) {
    const saveBtn = root.querySelector('[data-act="save-days"]');
    const touch = () => { saveBtn.disabled = sameDraft(daysDraft, draftOf(ctx.data.days || [])); };
    root.querySelector('[data-md="birthday"]').addEventListener('change', e => {
      const md = readPicker(e.currentTarget);
      if (md === null) { toast('その日はありません', 'warn'); return; }
      daysDraft.birthday = md;
      touch();
    });
    root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      daysDraft.anniversaries.splice(Number(b.dataset.del), 1);
      ctx.rerender();
    }));
    const add = () => {
      const name = root.querySelector('#day-name').value.trim();
      const md = readPicker(root.querySelector('[data-md="new"]'));
      if (!name) { toast('名前を入れてください', 'warn'); return; }
      if (/^[=+\-@]/.test(name)) { toast('名前を = + - @ で始めることはできません', 'warn'); return; }
      if (!md) { toast(md === null ? 'その日はありません' : '月と日を選んでください', 'warn'); return; }
      if (daysDraft.anniversaries.length >= 30) { toast('記念日は30件までです', 'warn'); return; }
      daysDraft.anniversaries.push({ name, md });
      daysDraft.anniversaries.sort((a, b) => (a.md < b.md ? -1 : a.md > b.md ? 1 : 0));
      ctx.rerender();
    };
    root.querySelector('[data-act="add-day"]').addEventListener('click', add);
    root.querySelector('#day-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    saveBtn.addEventListener('click', () => {
      const birthdayEl = root.querySelector('[data-md="birthday"]');
      if (readPicker(birthdayEl) === null) { toast('誕生日に、ない日が選ばれています', 'warn'); return; }
      const value = JSON.parse(JSON.stringify(daysDraft));
      const next = [...(value.birthday ? [{ kind: '誕生日', name: '誕生日', md: value.birthday }] : []),
        ...value.anniversaries.map(a => ({ kind: '記念日', name: a.name, md: a.md }))];
      ctx.saveSoon(data => { data.days = next.map(d => ({ ...d })); }, () => api.setDays(value.birthday, value.anniversaries), '誕生日と記念日を保存しました');
    });
  },
};
