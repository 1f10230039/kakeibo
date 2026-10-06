// 下から出るシート：S-05 利用の詳細（支出・収入）、S-07 手入力（支出・収入）。

import * as C from '../calc.js';
import * as api from '../api.js';
import { esc, money, iconMark, incomeMark, openSheet, toast, icon, seg, selectSeg, bindAmountInput, amountOf } from '../ui.js';

/** カテゴリをグループごとに並べたボタン。 */
export function categoryPicker(categories, selected) {
  const groups = [...new Set(categories.map(c => c.group))];
  return groups.map(g => `<div class="picker-group"><div class="picker-label">${esc(g)}</div><div class="picker">
    ${categories.filter(c => c.group === g).map(c => `<button class="pick${c.name === selected ? ' on' : ''}" data-pick="${esc(c.name)}">${esc(c.name)}</button>`).join('')}
  </div></div>`).join('');
}

// ---- S-05 利用の詳細 ----

export function openDetail(ctx, id) {
  const t = ctx.data.transactions.find(x => x.id === id);
  if (!t) return;
  if (t.type === '収入') return openIncomeDetail(ctx, t);
  const group = t.category ? (ctx.data.categories.find(c => c.name === t.category) || { group: 'その他' }).group : '未分類';
  const d = C.parseYmd(t.date);
  const stale = C.staleSokuho([t], ctx.today).length > 0;
  const canRule = !!t.merchant;
  const ruleName = canRule ? C.displayNames(ctx.data.rules).get(C.normalizeMerchant(t.merchant)) || '' : '';
  const alwaysOn = canRule && (t.categoryBy === '対応表' || (!t.memo && !!ruleName));

  openSheet(`
    <div class="detail-head">${iconMark(t.category, group)}<div><div class="detail-cat">${esc(t.category || '未分類')}${C.subtitleOf(t, C.displayNames(ctx.data.rules)) ? `<span class="sub">${esc(C.subtitleOf(t, C.displayNames(ctx.data.rules)))}</span>` : ''}</div>
      <div class="detail-merchant">${t.merchant ? esc(t.merchant) : t.source === '手入力' ? '手入力' : '速報：店名は確定版のメールで届きます'}</div></div>
      <div class="detail-amt">${money(t.amount, ctx.hidden)}</div></div>
    <dl class="facts">
      <div><dt>利用日</dt><dd>${esc(C.mdw(d))}</dd></div>
      <div><dt>状態</dt><dd>${esc(t.status)}</dd></div>
      ${t.payMonth ? `<div><dt>支払月</dt><dd>${esc(t.payMonth.replace('-', '年'))}月${t.status === '速報' ? '（仮）' : ''}</dd></div>` : ''}
    </dl>
    ${canRule ? `<label class="switch-row"><span>この店はいつもこの内容<small>カテゴリと名前を「${esc(t.merchant)}」の他の利用にもまとめて付けます</small></span>
      <input type="checkbox" id="always" ${alwaysOn ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>` : ''}
    <div class="sheet-label">カテゴリ</div>
    ${categoryPicker(ctx.data.categories, t.category)}
    <div class="sheet-label">名前（一覧で用途の横に出ます。なくてもよい）</div>
    <div class="name-row"><input id="name" data-clear maxlength="100" autocomplete="off" placeholder="例：YouTube Premium" value="${esc(t.memo || ruleName)}">
      <button class="btn small" data-act="name">保存</button></div>
    <div class="sheet-actions">
      ${t.source === '手入力' ? '<button class="btn danger" data-act="delete">この記録を消す</button>' : ''}
      ${stale ? '<button class="btn danger" data-act="cancel">キャンセルだったので取り消す</button>' : ''}
    </div>
  `, (sheet, close) => {
    const always = () => !!sheet.querySelector('#always')?.checked;
    const nameEl = sheet.querySelector('#name');
    const name = () => nameEl.value.trim();
    const badName = () => { if (/^[=+\-@]/.test(name())) { toast('名前を = + - @ で始めることはできません', 'warn'); return true; } return false; };

    sheet.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', async () => {
      if (badName()) return;
      const cat = b.dataset.pick;
      // 対応表は「個別」に決めた行を変えないので、この行が個別なら、この行だけは別に変える
      const job = always()
        ? api.setRule(t.merchant, cat, name()).then(() => (t.categoryBy === '個別' ? api.setCategory(t.id, cat) : null))
        : api.setCategory(t.id, cat);
      await ctx.write(job, always() ? `「${t.merchant}」をいつも${cat}にしました` : `${cat}にしました`);
      close();
    }));

    sheet.querySelector('[data-act="name"]').addEventListener('click', async () => {
      if (badName()) return;
      if (always()) {
        if (!t.category) { toast('先にカテゴリを選んでください', 'warn'); return; }
        // 店の名前にするので、この利用だけの名前があれば消す（消さないと、こちらが優先して出てしまう）
        const job = api.setRule(t.merchant, t.category, name()).then(() => (t.memo ? api.setMemo(t.id, '') : null));
        await ctx.write(job, name() ? `「${t.merchant}」の名前を「${name()}」にしました` : '名前を消しました');
      } else {
        await ctx.write(api.setMemo(t.id, name()), name() ? `名前を「${name()}」にしました` : '名前を消しました');
      }
      close();
    });
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') sheet.querySelector('[data-act="name"]').click(); });

    sheet.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
      if (!confirm('この手入力の記録を消しますか？')) return;
      await ctx.write(api.deleteManual(t.id), '消しました');
      close();
    });
    sheet.querySelector('[data-act="cancel"]')?.addEventListener('click', async () => {
      if (!confirm('この速報を取り消しますか？（キャンセルになった利用のとき）')) return;
      await ctx.write(api.resolveSokuho(t.id), '取り消しました');
      close();
    });
  });
}

/** 収入の詳細：名前を変える・手入力なら消す。 */
function openIncomeDetail(ctx, t) {
  openSheet(`
    <div class="detail-head">${incomeMark()}<div><div class="detail-cat">${esc(t.memo || '入金')}</div>
      <div class="detail-merchant">${t.merchant ? esc(t.merchant) : t.source === '手入力' ? '手入力' : ''}</div></div>
      <div class="detail-amt pos">+${money(t.amount, ctx.hidden)}</div></div>
    <dl class="facts">
      <div><dt>入金日</dt><dd>${esc(C.mdw(C.parseYmd(t.date)))}</dd></div>
      <div><dt>種類</dt><dd>収入</dd></div>
    </dl>
    <div class="sheet-label">名前（バイト代・お小遣いなど。一覧に出ます）</div>
    <div class="name-row"><input id="name" data-clear maxlength="100" autocomplete="off" placeholder="例：バイト代" value="${esc(t.memo || '')}">
      <button class="btn small" data-act="name">保存</button></div>
    ${nameChips(C.incomeNames(ctx.data.transactions), t.memo)}
    <div class="sheet-actions">
      ${t.source === '手入力' ? '<button class="btn danger" data-act="delete">この記録を消す</button>' : ''}
    </div>
  `, (sheet, close) => {
    const nameEl = sheet.querySelector('#name');
    bindNameChips(sheet, nameEl);
    sheet.querySelector('[data-act="name"]').addEventListener('click', async () => {
      const name = nameEl.value.trim();
      if (/^[=+\-@]/.test(name)) { toast('名前を = + - @ で始めることはできません', 'warn'); return; }
      await ctx.write(api.setMemo(t.id, name), name ? `名前を「${name}」にしました` : '名前を消しました');
      close();
    });
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') sheet.querySelector('[data-act="name"]').click(); });
    sheet.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
      if (!confirm('この収入の記録を消しますか？')) return;
      await ctx.write(api.deleteManual(t.id), '消しました');
      close();
    });
  });
}

/** 収入の名前の候補のボタン（押すと名前の欄に入る）。 */
function nameChips(names, current = '') {
  return `<div class="picker name-chips">${names.map(n => `<button class="pick${n === current ? ' on' : ''}" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>`;
}
function bindNameChips(sheet, nameEl) {
  const sync = () => sheet.querySelectorAll('[data-name]').forEach(b => b.classList.toggle('on', b.dataset.name === nameEl.value.trim()));
  sheet.querySelectorAll('[data-name]').forEach(b => b.addEventListener('click', () => {
    nameEl.value = b.dataset.name;
    nameEl.dispatchEvent(new Event('input')); // 消す × を出す
  }));
  nameEl.addEventListener('input', sync);
}

// ---- S-07 手入力 ----

/** 手入力。kind：'支出'（500円以下・現金など）か '収入'（入金。10/6 から）。シートの上で切り替えられる。 */
export function openManual(ctx, kind = '支出') {
  let category = '';
  const TEXT = {
    '支出': { title: '支出を記録する', note: '500円以下の買い物（カードの通知が来ない）や、現金で払ったものを足します。', label: '名前（なくてもよい）', ph: '例：コンビニ', done: ' を記録しました' },
    '収入': { title: '収入を記録する', note: '楽天銀行への入金（バイト代・お小遣いなど）を足します。名前を付けると、一覧で区別できます。', label: '名前（バイト代など）', ph: '例：バイト代', done: ' の収入を記録しました' },
  };
  openSheet(`
    <div class="manual-head"><h2 class="sheet-title" data-text="title"></h2>${seg('kind', [['支出', '支出'], ['収入', '収入']], kind, '記録の種類')}</div>
    <p class="sheet-note" data-text="note"></p>
    <label class="amount-input"><span>¥</span><input id="amount" inputmode="numeric" pattern="[0-9]*" placeholder="0" autocomplete="off" aria-label="金額"></label>
    <div class="field-row">
      <label class="field"><span>日付</span><input id="date" type="date" value="${C.ymd(ctx.today)}" max="${C.ymd(ctx.today)}"></label>
      <label class="field grow"><span data-text="label"></span><input id="memo" data-clear maxlength="100" autocomplete="off"></label>
    </div>
    <div class="only-income">${nameChips(C.incomeNames(ctx.data.transactions))}</div>
    <div class="only-spend"><div class="sheet-label">カテゴリ（あとで決めてもよい）</div>
    ${categoryPicker(ctx.data.categories, '')}</div>
    <button class="btn primary wide" data-act="save">${icon('plus')}記録する</button>
  `, (sheet, close) => {
    const amountEl = sheet.querySelector('#amount');
    const memoEl = sheet.querySelector('#memo');
    const apply = () => {
      sheet.dataset.kind = kind;
      sheet.querySelectorAll('[data-text]').forEach(el => { el.textContent = TEXT[kind][el.dataset.text]; });
      memoEl.placeholder = TEXT[kind].ph;
    };
    apply();
    sheet.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.kind === kind) return;
      selectSeg(b);
      kind = b.dataset.kind;
      apply();
    }));
    bindAmountInput(amountEl);
    bindNameChips(sheet, memoEl);
    sheet.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      category = category === b.dataset.pick ? '' : b.dataset.pick;
      sheet.querySelectorAll('[data-pick]').forEach(x => x.classList.toggle('on', x.dataset.pick === category));
    }));
    sheet.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const amount = amountOf(amountEl);
      const date = sheet.querySelector('#date').value;
      const memo = memoEl.value.trim();
      if (!Number.isInteger(amount) || amount < 1) { toast('金額を入れてください', 'warn'); amountEl.focus(); return; }
      if (/^[=+\-@]/.test(memo)) { toast('名前を = + - @ で始めることはできません', 'warn'); return; }
      const job = kind === '収入' ? api.addIncome({ date, amount, memo }) : api.addManual({ date, amount, category, memo });
      await ctx.write(job, `${C.yen(amount)}${TEXT[kind].done}`);
      close();
    });
    setTimeout(() => amountEl.focus(), 250);
  });
}
