// 下から出るシート：S-05 利用の詳細、S-07 手入力。

import * as C from '../calc.js';
import * as api from '../api.js';
import { esc, money, iconMark, openSheet, toast, icon } from '../ui.js';

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
    <div class="name-row"><input id="name" maxlength="100" autocomplete="off" placeholder="例：YouTube Premium" value="${esc(t.memo || ruleName)}">
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

// ---- S-07 手入力 ----

export function openManual(ctx) {
  let category = '';
  openSheet(`
    <h2 class="sheet-title">支出を記録する</h2>
    <p class="sheet-note">500円以下の買い物（カードの通知が来ない）や、現金で払ったものを足します。</p>
    <label class="amount-input"><span>¥</span><input id="amount" inputmode="numeric" pattern="[0-9]*" placeholder="0" autocomplete="off" aria-label="金額"></label>
    <div class="field-row">
      <label class="field"><span>日付</span><input id="date" type="date" value="${C.ymd(ctx.today)}" max="${C.ymd(ctx.today)}"></label>
      <label class="field grow"><span>名前（なくてもよい）</span><input id="memo" maxlength="100" autocomplete="off" placeholder="例：コンビニ"></label>
    </div>
    <div class="sheet-label">カテゴリ（あとで決めてもよい）</div>
    ${categoryPicker(ctx.data.categories, '')}
    <button class="btn primary wide" data-act="save">${icon('plus')}記録する</button>
  `, (sheet, close) => {
    const amountEl = sheet.querySelector('#amount');
    amountEl.addEventListener('input', () => {
      const digits = amountEl.value.replace(/[^0-9０-９]/g, '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
      amountEl.value = digits ? Number(digits).toLocaleString('ja-JP') : '';
      amountEl.style.width = `${Math.max(2, amountEl.value.length) + 1}ch`; // 「¥」のすぐ横に数字が並ぶように、幅を中身に合わせる
    });
    sheet.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      category = category === b.dataset.pick ? '' : b.dataset.pick;
      sheet.querySelectorAll('[data-pick]').forEach(x => x.classList.toggle('on', x.dataset.pick === category));
    }));
    sheet.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const amount = Number(amountEl.value.replace(/,/g, ''));
      const date = sheet.querySelector('#date').value;
      const memo = sheet.querySelector('#memo').value.trim();
      if (!Number.isInteger(amount) || amount < 1) { toast('金額を入れてください', 'warn'); amountEl.focus(); return; }
      if (/^[=+\-@]/.test(memo)) { toast('名前を = + - @ で始めることはできません', 'warn'); return; }
      await ctx.write(api.addManual({ date, amount, category, memo }), `${C.yen(amount)} を記録しました`);
      close();
    });
    setTimeout(() => amountEl.focus(), 250);
  });
}
