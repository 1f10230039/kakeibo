// S-04 資産（段階③）。楽天銀行の残高と、楽天証券 NISA の評価額・元本（積み立てた額）を月1回手で記録し、
// 合計・推移・残高（カード代を引いた額）を見る。計算の決まりは docs/03_システム設計.md の7章。
// 取り直しやグラフの点の選択では作り直さず、変わったところだけ書き換える（morphable）。

import * as C from '../calc.js';
import * as api from '../api.js';
import { esc, money, signedMoney, openSheet, toast, icon, bindAmountInput, amountOf } from '../ui.js';

export const morphable = true;

let live = null;     // 最後に描いたときの ctx（morph では mount をやり直さないので、ボタンの動きはこれで新しいデータを見る）
let selected = null; // グラフで選んだ月（YYYY-MM）。なければいちばん新しい月

const orDash = (v, hidden) => (v === null || v === undefined ? '<span class="muted">—</span>' : money(v, hidden));

export function render(ctx) {
  live = ctx;
  const { data, today, hidden } = ctx;
  const history = C.assetHistory(data.assets);
  if (!history.length) {
    return `<div class="assets page"><header class="page-head"><h1>資産</h1></header>
      <section class="card asset-empty">
        <p>月に1回、楽天銀行の残高と楽天証券 NISA の金額を記録すると、合計と推移がここに出ます。</p>
        <button class="btn primary" data-act="add">${icon('plus')}資産を記録する</button>
      </section></div>`;
  }
  const last = history.at(-1);
  const gain = C.nisaGain(last.now.nisa, last.now.principal);
  const sp = C.spendable(data.transactions, data.assets, today);
  return `<div class="assets page">
    <header class="page-head"><h1>資産</h1></header>
    <section class="card asset-main">
      <div class="label">資産の合計</div>
      <div class="big">${money(last.total, hidden, 'asset-total')}</div>
      <div class="compare">${esc(C.mdw(C.parseYmd(last.date)))} の記録から</div>
      <div class="asset-items">
        <div class="asset-item"><span class="mark-dot g1"></span><span>楽天銀行</span>${orDash(last.now.bank, hidden)}</div>
        <div class="asset-item"><span class="mark-dot g2"></span><span>楽天証券 NISA</span>${orDash(last.now.nisa, hidden)}</div>
        ${gain ? `<div class="asset-gain">元本 ${money(last.now.principal, hidden)}・<span class="${gain.amount < 0 ? 'neg' : 'pos'}">${hidden ? '' : `${gain.amount < 0 ? '−' : '+'}${esc(C.yen(Math.abs(gain.amount)))}（${gain.amount < 0 ? '−' : '+'}${(Math.abs(gain.ratio) * 100).toFixed(1)}%）`}</span></div>` : ''}
      </div>
    </section>
    <section class="card asset-chart">
      ${lineChart(C.assetMonthly(history), hidden)}
    </section>
    ${sp ? spendCard(sp, hidden) : ''}
    <div class="section"><h2>記録</h2><button class="chip primary" data-act="add">${icon('plus')}記録する</button></div>
    <div class="list card">${[...history].reverse().map(h => recordRow(h, hidden)).join('')}</div>
  </div>`;
}

/** 資産の合計の折れ線（月ごと）。線は描かれていくように出て、点を押すとその月の合計が出る。 */
function lineChart(points, hidden) {
  if (points.length < 2) {
    return `<div class="chart-head"><h2>推移</h2></div><p class="chart-note">記録が2か月分たまると、ここに線で推移が出ます。</p>`;
  }
  const sel = points.find(p => p.month === selected) || points.at(-1);
  const W = 320, H = 170, L = 18, R = 18, T = 36, B = 26;
  const first = points[0].month;
  const index = m => (Number(m.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(m.slice(5)) - Number(first.slice(5));
  const span = Math.max(1, index(points.at(-1).month));
  const totals = points.map(p => p.total);
  const min = Math.min(...totals), max = Math.max(...totals);
  const pad = Math.max((max - min) * 0.25, max * 0.02, 1); // 上下に少し余白（変化が小さくても線が平らになりすぎない）
  const lo = min - pad, hi = max + pad;
  const xy = p => [L + (index(p.month) / span) * (W - L - R), T + (1 - (p.total - lo) / (hi - lo)) * (H - T - B)];
  const pts = points.map(xy);
  const f = n => n.toFixed(1);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ');
  const area = `${line} L${f(pts.at(-1)[0])} ${H - B} L${f(pts[0][0])} ${H - B} Z`;
  const years = new Set(points.map(p => p.month.slice(0, 4))).size > 1;
  const label = m => (years && (m.endsWith('-01') || m === first) ? `${m.slice(2, 4)}/${Number(m.slice(5))}` : `${Number(m.slice(5))}月`);
  const every = Math.ceil(points.length / 6); // 月の名前は6つまで
  const [sx, sy] = pts[points.indexOf(sel)];
  const tipX = Math.min(W - 44, Math.max(44, sx));
  return `<div class="chart-head"><h2>推移</h2><span class="sel">${esc(label(sel.month))}の合計</span></div>
    <svg class="line-chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="資産の合計の推移">
      <defs><linearGradient id="asset-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-a"/><stop offset="1" class="stop-b"/></linearGradient></defs>
      <path class="area" d="${area}"/>
      <path class="line" d="${line}" pathLength="1"/>
      ${points.map((p, i) => {
        const [x, y] = pts[i];
        return `<g class="pt${p === sel ? ' on' : ''}" data-key="pt:${p.month}" data-month="${p.month}" data-vars="--i:${i}" role="button" aria-label="${esc(label(p.month))} ${hidden ? '' : esc(C.yen(p.total))}">
          <circle class="hit" cx="${f(x)}" cy="${f(y)}" r="16"/><circle class="dot" cx="${f(x)}" cy="${f(y)}" r="4"/>
          ${i % every === 0 || i === points.length - 1 ? `<text class="mlab" x="${f(x)}" y="${H - 6}">${esc(label(p.month))}</text>` : ''}
        </g>`;
      }).join('')}
      <g class="tip" data-key="tip:${sel.month}"><text x="${f(tipX)}" y="${f(Math.max(14, sy - 14))}">${hidden ? '¥ ••••' : esc(C.yen(sel.total))}</text></g>
    </svg>`;
}

/** ホームの「残高」の中身：楽天銀行の記録 − 記録のあとの引き落とし。 */
function spendCard(sp, hidden) {
  return `<section class="card asset-spend">
    <div class="label">残高（ホームに出る額）</div>
    <div class="spend-lines">
      <div><span>楽天銀行（${esc(C.mdw(C.parseYmd(sp.bankDate)))} の記録）</span>${money(sp.bankAmount, hidden)}</div>
      ${sp.debits.map(d => `<div><span>− ${esc(C.mdw(d.date))} の引き落とし</span>${money(d.amount, hidden)}</div>`).join('')}
      <div class="sum"><span>カード代を引いた額</span>${signedMoney(sp.amount, hidden)}</div>
    </div>
    <p class="note-s">記録した日のあとの入金（バイト代など）や、カード以外の出入りは入っていません。</p>
  </section>`;
}

function recordRow(h, hidden) {
  const part = (name, v) => `${name} ${v === null ? '—' : hidden ? '¥ ••••' : esc(C.yen(v))}`;
  return `<button class="row link" data-key="r:${h.date}" data-date="${h.date}">
    <span class="t"><b>${esc(C.mdw(C.parseYmd(h.date)))}</b><small>${part('楽天銀行', h.bank)}・${part('NISA', h.nisa)}</small></span>
    ${icon('chevron')}</button>`;
}

export function mount(root) {
  root.firstElementChild.addEventListener('click', e => {
    const el = e.target.closest('[data-month], [data-act="add"], [data-date]');
    if (!el) return;
    if (el.dataset.month) { selected = el.dataset.month; live.rerender(); }
    else if (el.dataset.act === 'add') openAssetSheet(live);
    else openAssetSheet(live, { date: el.dataset.date, edit: true });
  });
}

/**
 * 資産を記録するシート。date：記録日の初期値（なければ今日）。edit：その日の記録を直す（日付は変えない・消せる）。
 * 入れなかった項目は送らない（null）。その日にもう記録があれば、その金額を入れた状態で開く。
 */
export function openAssetSheet(ctx, { date, edit = false } = {}) {
  const history = C.assetHistory(ctx.data.assets);
  const today = C.ymd(ctx.today);
  const day = date || today;
  const field = (id, label) => `<div class="asset-field"><div class="sheet-label">${label}</div>
      <label class="amount-input small"><span>¥</span><input id="${id}" inputmode="numeric" pattern="[0-9]*" placeholder="0" autocomplete="off" aria-label="${label}"></label>
      <div class="before" data-before="${id}"></div></div>`;
  openSheet(`
    <h2 class="sheet-title">${edit ? `${esc(C.mdw(C.parseYmd(day)))} の記録` : '資産を記録する'}</h2>
    <p class="sheet-note">楽天銀行のアプリと楽天証券の画面を見て、金額を写します。入れなかった項目は、前の記録の金額のまま数えます。</p>
    ${edit ? '' : `<label class="field"><span>記録日</span><input id="date" type="date" value="${day}" max="${today}"></label>`}
    ${field('bank', '楽天銀行の残高')}
    ${field('nisa', '楽天証券 NISA の評価額')}
    ${field('principal', 'NISA の元本（積み立てた額）')}
    <button class="btn primary wide" data-act="save">保存する</button>
    ${edit ? '<div class="sheet-actions"><button class="btn danger" data-act="remove">この日の記録を消す</button></div>' : ''}
  `, (sheet, close) => {
    const els = { bank: sheet.querySelector('#bank'), nisa: sheet.querySelector('#nisa'), principal: sheet.querySelector('#principal') };
    const dateEl = sheet.querySelector('#date');
    const currentDate = () => (dateEl ? dateEl.value : day);
    // 記録日に合わせて、その日の金額（あれば）と「前回」の金額を出し直す
    const fill = () => {
      const d = currentDate();
      const same = history.find(h => h.date === d);
      const prev = [...history].reverse().find(h => h.date < d);
      for (const [id, el] of Object.entries(els)) {
        el.value = same && same[id] !== null ? String(same[id]) : '';
        el.dispatchEvent(new Event('input'));
        const before = prev ? prev.now[id] : null;
        sheet.querySelector(`[data-before="${id}"]`).textContent = before === null ? '' : `前回（${C.mdw(C.parseYmd(prev.date))}）${C.yen(before)}`;
      }
      if (!edit) sheet.querySelector('.sheet-title').textContent = same ? `${C.mdw(C.parseYmd(d))} の記録を直す` : '資産を記録する';
    };
    Object.values(els).forEach(bindAmountInput);
    dateEl?.addEventListener('change', fill);
    fill();

    const read = el => (el.value === '' ? null : amountOf(el));
    const send = async (btn, job, doneText) => {
      const text = btn.textContent;
      btn.disabled = true;
      btn.textContent = '保存しています…';
      if (await ctx.write(job, doneText)) close();
      else { btn.disabled = false; btn.textContent = text; }
    };
    const saveBtn = sheet.querySelector('[data-act="save"]');
    saveBtn.addEventListener('click', () => {
      const d = currentDate();
      const v = { bank: read(els.bank), nisa: read(els.nisa), principal: read(els.principal) };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today) { toast('記録日を選んでください（今日まで）', 'warn'); return; }
      if (v.bank === null && v.nisa === null) { toast('楽天銀行か NISA の金額を入れてください', 'warn'); els.bank.focus(); return; }
      if (v.principal !== null && v.nisa === null) { toast('元本は、NISA の評価額と一緒に入れてください', 'warn'); els.nisa.focus(); return; }
      if (Object.values(v).some(x => x !== null && x > 1000000000)) { toast('金額は10億円までにしてください', 'warn'); return; }
      send(saveBtn, api.setAssetRecord(d, v.bank, v.nisa, v.principal), `${C.mdw(C.parseYmd(d))} の資産を記録しました`);
    });
    const removeBtn = sheet.querySelector('[data-act="remove"]');
    removeBtn?.addEventListener('click', () => {
      if (!confirm(`${C.mdw(C.parseYmd(day))} の記録を消しますか？`)) return;
      send(removeBtn, api.setAssetRecord(day, null, null, null), '記録を消しました');
    });
  });
}
