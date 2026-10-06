// e-NAVI の明細 CSV（パソコン版 e-NAVI の「ご利用明細」からダウンロード）を読み、取引のシートと照らし合わせる（S-09）。
// 画面にも API にも触らない関数だけを置く（Node.js でテストできる：web/test/）。CSV の中身はこの端末の中だけで読む。
//
// CSV の形（10/6 に本物で確認）：UTF-8（BOM つき）、全部の欄が "" で囲まれている。
//   "利用日","利用店名・商品名","利用者","支払方法","利用金額","手数料/利息","支払総額","支払月","10月支払金額","当月請求額","11月繰越残高","11月以降請求額"
//   利用日は 2026/09/28、支払月は「10月」（その明細の支払い分）か「11月以降」（まだ請求が決まっていない分）。
//   店名は、メールの「利用先」の前に「マスター国内利用　MZZ 」「海外利用　１　」などが付いた形。

import { normalizeMerchant, ymd, parseYmd } from './calc.js';

export class CsvError extends Error {}

/** CSV の文字 → 行の配列（"" で囲んだ欄、欄の中の "" と改行に対応）。 */
export function parseCsvText(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

/** CSV の店名 → メールの「利用先」と同じ形（前に付く「マスター国内利用　MZZ 」などを外し、全角・半角をそろえる）。 */
export function merchantFromCsv(name) {
  return String(name || '').normalize('NFKC').trim()
    .replace(/^マスター国内利用\s+M[A-Z]{2}\s+/, '')
    .replace(/^海外利用\s+\d+\s+/, '')
    .trim();
}

/**
 * e-NAVI の CSV → { statementMonth: 'YYYY-MM'（その明細の支払いの月）, rows, later, skipped }
 * rows：その月の支払い分（確定）。{ date, merchant, rawName, amount, payMonth }
 * later：「11月以降」の分（まだ決まっていない。次の月の CSV で照らし合わせる）
 * skipped：本人以外・マイナス（返金など）・金額が読めない行
 */
export function parseEnaviCsv(text) {
  const all = parseCsvText(text);
  const head = all[0] || [];
  if (head[0] !== '利用日' || head[1] !== '利用店名・商品名' || head[4] !== '利用金額' || head[7] !== '支払月') {
    throw new CsvError('e-NAVI の明細の CSV ではないようです（1行目の項目が違います）');
  }
  const m = /^(\d{1,2})月支払金額$/.exec(head[8] || '');
  if (!m) throw new CsvError('支払いの月が読めませんでした（9列目の項目が違います）');
  const payM = Number(m[1]);

  const items = all.slice(1).map(cols => {
    const d = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(cols[0] || '');
    const amount = Number(String(cols[4] || '').replace(/,/g, ''));
    return {
      date: d ? ymd(new Date(+d[1], +d[2] - 1, +d[3])) : null,
      rawName: cols[1] || '', merchant: merchantFromCsv(cols[1]),
      user: cols[2] || '', amount, label: cols[7] || '',
    };
  });

  // 支払いの年：その月の支払い分のいちばん新しい利用日から決める（12月の利用 → 翌年1月払い）
  const mine = items.filter(it => it.date && it.label === `${payM}月`);
  if (!mine.length) throw new CsvError(`${payM}月の支払い分の利用が見つかりませんでした`);
  const last = mine.map(it => it.date).sort().at(-1);
  const y = Number(last.slice(0, 4)) + (Number(last.slice(5, 7)) > payM ? 1 : 0);
  const statementMonth = `${y}-${String(payM).padStart(2, '0')}`;

  const rows = [], later = [], skipped = [];
  items.forEach(it => {
    if (!it.date || !Number.isInteger(it.amount) || it.amount <= 0 || it.user !== '本人') { skipped.push(it); return; }
    if (it.label === `${payM}月`) rows.push({ date: it.date, merchant: it.merchant, rawName: it.rawName, amount: it.amount, payMonth: statementMonth });
    else later.push(it);
  });
  return { statementMonth, rows, later, skipped };
}

/**
 * CSV（その月の支払い分）と取引のシートを照らし合わせる。
 * - 利用日と金額が同じなら同じ利用とみなす。候補が複数あれば、店名が同じものを先に使う
 * - シート側は、取消・手入力・収入を除いた支出（メール・CSV）。支払月は問わない（速報の仮の支払月がずれていても当たるように）
 * 返すもの：{ matched: [[csv, tx]], csvOnly: [csv]（足す候補）, mailOnly: [tx]（キャンセルかもしれない） }
 *   mailOnly は、シートで支払月がその月なのに CSV に出てこなかったもの
 */
export function reconcile(transactions, parsed) {
  const pool = transactions.filter(t => t.type === '支出' && t.status !== '取消' && (t.source === 'メール' || t.source === 'CSV'));
  const used = new Set();
  const matched = [], csvOnly = [];
  parsed.rows.forEach(c => {
    const cands = pool.filter(t => !used.has(t.id) && t.date === c.date && t.amount === c.amount);
    const t = cands.find(x => x.merchant && normalizeMerchant(x.merchant) === normalizeMerchant(c.merchant)) || cands[0];
    if (t) { used.add(t.id); matched.push([c, t]); } else csvOnly.push(c);
  });
  const mailOnly = pool.filter(t => !used.has(t.id) && t.payMonth === parsed.statementMonth);
  return { matched, csvOnly, mailOnly };
}

/** 「2026-10」→「2026年10月」 */
export function monthLabel(ym) {
  return `${Number(ym.slice(0, 4))}年${Number(ym.slice(5))}月`;
}

export { parseYmd };
