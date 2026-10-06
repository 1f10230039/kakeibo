// 下から出るシート：S-05 利用の詳細（支出・収入）、S-07 手入力（支出・収入）。

import * as C from '../calc.js';
import * as api from '../api.js';
import { info, esc, money, iconMark, incomeMark, openSheet, toast, icon, seg, selectSeg, bindAmountInput, amountOf, busy } from '../ui.js';

/** カテゴリをグループごとに並べたボタン。 */
export function categoryPicker(categories, selected) {
  const groups = [...new Set(categories.map(c => c.group))];
  return groups.map(g => `<div class="picker-group"><div class="picker-label">${esc(g)}</div><div class="picker">
    ${categories.filter(c => c.group === g).map(c => `<button class="pick${c.name === selected ? ' on' : ''}" data-pick="${esc(c.name)}">${esc(c.name)}</button>`).join('')}
  </div></div>`).join('');
}

// ---- S-05 利用の詳細 ----

/**
 * 利用のカテゴリ・名前・「この店はいつもこの内容」を保存する（S-05 と S-06 の振り分け）。
 * 返事を待たずに先に画面へ出し、裏で1回の通信で保存する（10/7 本人）。画面の変え方は GAS ② の saveDetail と同じ。
 * choice：{ category, name, always }
 */
export function saveTx(ctx, t, { category, name, always }) {
  const key = C.normalizeMerchant(t.merchant);
  const patch = data => {
    const me = data.transactions.find(x => x.id === t.id);
    if (always) {
      const rule = data.rules.find(r => C.normalizeMerchant(r.merchant) === key);
      if (rule) Object.assign(rule, { category, displayName: name });
      else data.rules.push({ merchant: t.merchant, category, displayName: name });
      data.transactions.forEach(x => {
        if (x.type === '支出' && x.status !== '取消' && x.categoryBy !== '個別' && C.normalizeMerchant(x.merchant) === key) Object.assign(x, { category, categoryBy: '対応表' });
      });
      if (me) { if (me.categoryBy === '個別') me.category = category; me.memo = ''; }
    } else if (me) {
      if (category !== (me.category || '')) Object.assign(me, { category, categoryBy: category ? '個別' : '未分類' });
      me.memo = name;
    }
  };
  ctx.saveSoon(patch, () => api.saveDetail({ id: t.id, category, name, always }, t),
    always ? `「${t.merchant}」をいつも${category}にしました` : '保存しました');
}

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
      ${t.source === '楽天証券' ? `<div><dt>出どころ</dt><dd>楽天証券${info(t.status === '設定から' ? 'メールが残っていなかった月を、積立の設定（毎月の日・金額）から入れた記録です。この月に積立をしていなければ、下のボタンで消してください。' : '楽天証券の「積立購入が完了しました（約定）」のメールから入れた記録です。利用日は注文日です。カードではないので、引き落としには入りません。')}</dd></div>` : ''}
    </dl>
    ${canRule ? `<label class="switch-row"><span>この店はいつもこの内容${info(`オンにすると、カテゴリと名前を対応表に入れて、「${t.merchant}」のほかの利用にもまとめて付けます。\nオフなら、この1件だけ変えます。`)}</span>
      <input type="checkbox" id="always" ${alwaysOn ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>` : ''}
    <div class="sheet-label">カテゴリ</div>
    ${categoryPicker(ctx.data.categories, t.category)}
    <div class="sheet-label">名前${info('一覧で用途の横に出る名前です（例：サブスク　YouTube Premium）。なくてもかまいません。')}</div>
    <div class="name-row"><input id="name" data-clear maxlength="100" autocomplete="off" enterkeyhint="done" placeholder="例：YouTube Premium" value="${esc(t.memo || ruleName)}"></div>
    <button class="btn primary wide" data-act="save">保存</button>
    <div class="sheet-actions">
      ${t.source === '手入力' || t.status === '設定から' ? '<button class="btn danger" data-act="delete">この記録を消す</button>' : ''}
      ${stale ? '<button class="btn danger" data-act="cancel">キャンセルだったので取り消す</button>' : ''}
    </div>
  `, (sheet, close) => {
    // カテゴリのボタンと「いつもこの内容」のスイッチは、選ぶだけ（10/7 本人）。保存ボタンで、名前とまとめて保存する
    let cat = t.category || '';
    const nameEl = sheet.querySelector('#name');
    const firstName = nameEl.value.trim();
    sheet.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      cat = b.dataset.pick;
      sheet.querySelectorAll('[data-pick]').forEach(x => x.classList.toggle('on', x === b));
    }));

    sheet.querySelector('[data-act="save"]').addEventListener('click', () => {
      const always = !!sheet.querySelector('#always')?.checked;
      const name = nameEl.value.trim();
      if (/^[=+\-@]/.test(name)) { toast('名前を = + - @ で始めることはできません', 'warn'); return; }
      if (always && !cat) { toast('先にカテゴリを選んでください', 'warn'); return; }
      const changed = cat !== (t.category || '') || name !== firstName || always !== alwaysOn;
      close();
      if (!changed) return; // 何も変えていなければ、閉じるだけ
      // 名前を変えていなければ、この行の名前はそのまま（欄に出ていた店の表示名を、この行の名前に写さない）
      saveTx(ctx, t, { category: cat, name: always || name !== firstName ? name : t.memo || '', always });
    });
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) sheet.querySelector('[data-act="save"]').click(); });

    sheet.querySelector('[data-act="delete"]')?.addEventListener('click', async e => {
      if (!confirm(t.status === '設定から' ? '積立の設定から入れた記録です。この月に積立をしていなければ、消してください。消しますか？' : 'この手入力の記録を消しますか？')) return;
      const restore = busy(e.currentTarget, '消しています…');
      if (await ctx.write(api.deleteManual(t.id), '消しました')) close(); else restore();
    });
    sheet.querySelector('[data-act="cancel"]')?.addEventListener('click', async e => {
      if (!confirm('この速報を取り消しますか？（キャンセルになった利用のとき）')) return;
      const restore = busy(e.currentTarget, '取り消しています…');
      if (await ctx.write(api.resolveSokuho(t.id), '取り消しました')) close(); else restore();
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
    sheet.querySelector('[data-act="name"]').addEventListener('click', async e => {
      const name = nameEl.value.trim();
      if (/^[=+\-@]/.test(name)) { toast('名前を = + - @ で始めることはできません', 'warn'); return; }
      if (name === (t.memo || '')) { close(); return; }
      const restore = busy(e.currentTarget, '保存中');
      if (await ctx.write(api.setMemo(t.id, name), name ? `名前を「${name}」にしました` : '名前を消しました')) close(); else restore();
    });
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) sheet.querySelector('[data-act="name"]').click(); });
    sheet.querySelector('[data-act="delete"]')?.addEventListener('click', async e => {
      if (!confirm('この収入の記録を消しますか？')) return;
      const restore = busy(e.currentTarget, '消しています…');
      if (await ctx.write(api.deleteManual(t.id), '消しました')) close(); else restore();
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
    <div class="manual-head"><h2 class="sheet-title"><span data-text="title"></span>${info('', '説明を見る')}</h2>${seg('kind', [['支出', '支出'], ['収入', '収入']], kind, '記録の種類')}</div>
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
      sheet.querySelector('.manual-head [data-info]').dataset.info = TEXT[kind].note; // ⓘ の説明も、支出／収入で変える
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
    sheet.querySelector('[data-act="save"]').addEventListener('click', async e => {
      const amount = amountOf(amountEl);
      const date = sheet.querySelector('#date').value;
      const memo = memoEl.value.trim();
      if (!Number.isInteger(amount) || amount < 1) { toast('金額を入れてください', 'warn'); amountEl.focus(); return; }
      if (/^[=+\-@]/.test(memo)) { toast('名前を = + - @ で始めることはできません', 'warn'); return; }
      const restore = busy(e.currentTarget, '記録しています…');
      const job = kind === '収入' ? api.addIncome({ date, amount, memo }) : api.addManual({ date, amount, category, memo });
      // 失敗したら、入れた金額などを残したまま、もう一度押せるように戻す
      if (await ctx.write(job, `${C.yen(amount)}${TEXT[kind].done}`)) close(); else restore();
    });
    setTimeout(() => amountEl.focus(), 250);
  });
}
