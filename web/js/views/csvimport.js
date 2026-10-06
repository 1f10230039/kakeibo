// S-09 CSV の取り込みと照合（F-08, F-09）。メニューから開く。
// パソコン版 e-NAVI の「ご利用明細」でダウンロードした CSV を選ぶと、この端末の中で読み、取引のシートと照らし合わせる。
// 送るのは、本人がチェックした「足す」「取り消す」の行だけ（10/6 本人：足すのはその月の支払い分だけ、キャンセルかもの分は最初はチェックなし）。
// 照らし合わせは描くたびに今のデータでやり直すので、反映したあとは自動で「一致」に入る。

import * as C from '../calc.js';
import * as api from '../api.js';
import * as V from '../csv.js';
import { esc, money, icon, toast } from '../ui.js';

const state = { parsed: null, error: '', picks: new Map() }; // picks：'a:何行目' / 'c:id' → チェックしたか（決めていなければ初めの値）

const isPicked = (key, initial) => (state.picks.has(key) ? state.picks.get(key) : initial);

export function render(ctx) {
  const { data, hidden } = ctx;
  const head = `<header class="page-head with-back"><a class="back" href="#/menu" aria-label="戻る">${icon('back')}</a><h1>CSV の照合</h1></header>
    <p class="lead">パソコン版 e-NAVI の「ご利用明細」でダウンロードした明細の CSV を選びます。ファイルはこの端末の中だけで読み、チェックした行だけを記録します。</p>
    <label class="btn wide file-btn">${icon('plus')}CSV を選ぶ<input type="file" id="csv-file" accept=".csv,text/csv"></label>
    ${state.error ? `<p class="note warn-text">${esc(state.error)}</p>` : ''}`;
  if (!state.parsed) return `<div class="page csv-page">${head}</div>`;

  const p = state.parsed;
  const rec = V.reconcile(data.transactions, p);
  const rules = new Map(data.rules.map(r => [C.normalizeMerchant(r.merchant), r.category]));
  const addRows = rec.csvOnly.map(c => ({ c, key: `a:${p.rows.indexOf(c)}` }));
  const cancelRows = rec.mailOnly.map(t => ({ t, key: `c:${t.id}` }));
  const nextM = Number(p.statementMonth.slice(5)) % 12 + 1;

  return `<div class="page csv-page">${head}
    <section class="card csv-summary">
      <div class="label">${esc(V.monthLabel(p.statementMonth))}払いの明細</div>
      <div class="csv-counts">
        <div><b>${p.rows.length}</b><span>CSV の件数</span></div>
        <div><b>${rec.matched.length}</b><span>一致</span></div>
        <div><b>${addRows.length}</b><span>足す候補</span></div>
        <div><b>${cancelRows.length}</b><span>キャンセルかも</span></div>
      </div>
      ${totalsBlock(V.totals(data.transactions, p), p, hidden)}
      ${p.later.length ? `<p class="note-s">${nextM}月以降の支払い分 ${p.later.length}件は、まだ決まっていないので、次の月の CSV で照らし合わせます。</p>` : ''}
      ${p.skipped.length ? `<p class="note-s">本人以外の利用などの ${p.skipped.length}件は読みませんでした。</p>` : ''}
    </section>
    ${!addRows.length && !cancelRows.length ? '<p class="empty big">CSV とメールの記録は、全部一致しました 🎉</p>' : ''}
    ${addRows.length ? `<div class="section"><h2>CSV にだけある利用</h2><span class="more">足す</span></div>
      <p class="note">メールが届いていない・取り込めていない利用です。チェックしたものを記録します。</p>
      <div class="list card">${addRows.map(({ c, key }) => `
        <label class="row check-row" data-key="${key}">
          <input type="checkbox" data-pick-key="${key}" ${isPicked(key, true) ? 'checked' : ''}>
          <span class="t"><b>${esc(c.merchant || c.rawName)}</b><small>${esc(C.mdw(C.parseYmd(c.date)))}・${esc(rules.get(C.normalizeMerchant(c.merchant)) || '未分類')}</small></span>
          <span class="a">${money(c.amount, hidden)}</span>
        </label>`).join('')}</div>` : ''}
    ${cancelRows.length ? `<div class="section"><h2>メールにだけある利用</h2><span class="more">キャンセルかも</span></div>
      <p class="note">この月の支払い分なのに、明細に出てこない利用です。キャンセルになったものだけチェックして取り消します。</p>
      <div class="list card">${cancelRows.map(({ t, key }) => `
        <label class="row check-row" data-key="${key}">
          <input type="checkbox" data-pick-key="${key}" ${isPicked(key, false) ? 'checked' : ''}>
          <span class="t"><b>${esc(t.merchant || '（店名なし）')}</b><small>${esc(C.mdw(C.parseYmd(t.date)))}<span class="badge">${esc(t.status)}</span></small></span>
          <span class="a">${money(t.amount, hidden)}</span>
        </label>`).join('')}</div>` : ''}
    ${addRows.length || cancelRows.length ? '<button class="btn primary wide" data-act="apply"></button>' : ''}
  </div>`;
}

/** 合計：シートのその月の支払い分が、明細の利用の合計と同じなら、その月はそろっている（10/6 本人）。 */
function totalsBlock(t, p, hidden) {
  const m = Number(p.statementMonth.slice(5));
  const state = t.diff === 0 ? '<span class="ok">✓ そろっています</span>'
    : `<span class="ng">${hidden ? '' : esc(C.yen(Math.abs(t.diff)))} ${t.diff < 0 ? '足りません' : '多いです'}</span>`;
  return `<dl class="csv-totals">
      <div><dt>明細の利用の合計</dt><dd>${money(t.use, hidden)}</dd></div>
      <div><dt>シートの${m}月払いの合計</dt><dd>${money(t.sheet, hidden)}${state}</dd></div>
      ${t.cancel ? `<div><dt>キャンセルなど ${p.cancels.length}件</dt><dd>−${money(t.cancel, hidden)}</dd></div>` : ''}
      <div class="pay"><dt>差し引いた支払金額</dt><dd>${money(t.pay, hidden)}</dd></div>
    </dl>
    <p class="note-s">${t.cancel ? 'キャンセルなどの行は、元の利用と同じ金額とは限らないので、シートには入れません。' : ''}差し引いた支払金額は、e-NAVI の一覧の支払金額と同じになるはずです。違うときは、ポイントでの支払いなど、CSV に出てこないものがあるのかもしれません。</p>`;
}

export function mount(root, ctx) {
  const page = root.firstElementChild;
  const fileEl = page.querySelector('#csv-file');
  fileEl.addEventListener('change', async () => {
    const file = fileEl.files[0];
    if (!file) return;
    try {
      state.parsed = V.parseEnaviCsv(await file.text());
      state.error = '';
    } catch (e) {
      state.parsed = null;
      state.error = e instanceof V.CsvError ? e.message : 'ファイルが読めませんでした';
    }
    state.picks = new Map();
    ctx.rerender();
  });
  if (!state.parsed) return;

  const p = state.parsed;
  const rec = V.reconcile(ctx.data.transactions, p);
  const chosen = () => ({
    add: rec.csvOnly.filter(c => isPicked(`a:${p.rows.indexOf(c)}`, true)).map(c => ({ date: c.date, merchant: c.merchant || c.rawName, amount: c.amount, payMonth: c.payMonth })),
    cancel: rec.mailOnly.filter(t => isPicked(`c:${t.id}`, false)).map(t => t.id),
  });
  const btn = page.querySelector('[data-act="apply"]');
  const label = () => {
    if (!btn) return;
    const { add, cancel } = chosen();
    btn.textContent = `反映する（足す ${add.length}件・取り消す ${cancel.length}件）`;
    btn.disabled = !add.length && !cancel.length;
  };
  label();
  page.querySelectorAll('[data-pick-key]').forEach(cb => cb.addEventListener('change', () => { state.picks.set(cb.dataset.pickKey, cb.checked); label(); }));
  btn?.addEventListener('click', async () => {
    const { add, cancel } = chosen();
    if (!confirm(`足す ${add.length}件・取り消す ${cancel.length}件を反映しますか？`)) return;
    btn.disabled = true;
    btn.textContent = '反映しています…';
    // チェックの覚えは残す（反映した行は「一致」に入る。外したままの行は、外したまま出す）。失敗したら、選んだまま押せるように戻す
    if (!(await ctx.write(api.importCsv(add, cancel), `${add.length}件足して、${cancel.length}件取り消しました`))) label();
  });
}
