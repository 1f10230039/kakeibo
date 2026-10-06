// e-NAVI の明細 CSV（パソコン版 e-NAVI の「ご利用明細」からダウンロード）を読み、取引のシートと照らし合わせる（S-09）。
// 画面にも API にも触らない関数だけを置く（Node.js でテストできる：web/test/）。CSV の中身はこの端末の中だけで読む。
//
// CSV の形（10/6 に本物9つで確認）：UTF-8（BOM つき）、全部の欄が "" で囲まれている。形は2つある。
// A. いちばん新しい明細（請求がまだ動いている月）：8列目が「支払月」
//   "利用日","利用店名・商品名","利用者","支払方法","利用金額","手数料/利息","支払総額","支払月","10月支払金額","当月請求額","11月繰越残高","11月以降請求額"
//   支払月は「10月」（その明細の支払い分）か「11月以降」（まだ決まっていない分）。店名の前に「マスター国内利用　MZZ 」「海外利用　１　」が付く
// B. 前の月の明細（確定済み）：「支払月」の列がなく、8列目が「7月支払金額」。6月払いからは「当月請求額」の列が増える
//   "利用日","利用店名・商品名","利用者","支払方法","利用金額","手数料/利息","支払総額","7月支払金額","当月請求額","8月繰越残高","新規サイン"
//   店名の前には何も付かず、海外の利用は後ろに「利用国USA」が付き、次の行に日付のない「現地利用額…変換レート…」が来る
// どちらも、途中に空の行があり、「■ご利用キャンセルなど」の見出しのあとにキャンセル・返金の行が続く（金額はプラスで書いてある）。
// キャンセルの行は、元の利用と同じ金額とは限らない（一部の返金・値段の調整など）。なので足さずに、合計だけ出す。

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

/** CSV の店名 → メールの「利用先」と同じ形（前後に付く「マスター国内利用　MZZ 」「利用国USA」などを外し、全角・半角をそろえる）。 */
export function merchantFromCsv(name) {
  return String(name || '').normalize('NFKC').trim()
    .replace(/^マスター国内利用\s+M[A-Z]{2}\s+/, '')
    .replace(/^海外利用\s+\d+\s+/, '')
    .replace(/利用国[A-Z]{2,3}$/, '')
    .trim();
}

/**
 * e-NAVI の CSV → { statementMonth: 'YYYY-MM'（その明細の支払いの月）, rows, later, cancels, skipped }
 * rows：その月の支払い分。{ date, merchant, rawName, amount, payMonth }
 * later：「11月以降」の分（形 A だけ。まだ決まっていないので、次の月の CSV で照らし合わせる）
 * cancels：「■ご利用キャンセルなど」の行（足さない。合計だけ出す）
 * skipped：本人以外・マイナス・金額が読めない行
 */
export function parseEnaviCsv(text) {
  const all = parseCsvText(text);
  const head = all[0] || [];
  if (head[0] !== '利用日' || head[1] !== '利用店名・商品名' || head[4] !== '利用金額') {
    throw new CsvError('e-NAVI の明細の CSV ではないようです（1行目の項目が違います）');
  }
  const hasPayCol = head[7] === '支払月'; // 形 A
  const m = /^(\d{1,2})月支払金額$/.exec(head[hasPayCol ? 8 : 7] || '');
  if (!m) throw new CsvError('支払いの月が読めませんでした（「◯月支払金額」の列がありません）');
  const payM = Number(m[1]);

  let inCancel = false;
  const items = [];
  all.slice(1).forEach(cols => {
    if (/^■/.test(cols[0] || '')) { inCancel = true; return; } // ここから下はキャンセル・返金
    const d = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(cols[0] || '');
    if (!d) return; // 空の行・「現地利用額…」の補足の行
    items.push({
      date: ymd(new Date(+d[1], +d[2] - 1, +d[3])),
      rawName: cols[1] || '', merchant: merchantFromCsv(cols[1]),
      user: cols[2] || '', amount: Number(String(cols[4] || '').replace(/,/g, '')),
      cancel: inCancel, thisMonth: hasPayCol ? cols[7] === `${payM}月` : true,
    });
  });

  // 支払いの年：その月の支払い分のいちばん新しい利用日から決める（12月の利用 → 翌年1月払い）
  const mine = items.filter(it => !it.cancel && it.thisMonth);
  if (!mine.length) throw new CsvError(`${payM}月の支払い分の利用が見つかりませんでした`);
  const last = mine.map(it => it.date).sort().at(-1);
  const y = Number(last.slice(0, 4)) + (Number(last.slice(5, 7)) > payM ? 1 : 0);
  const statementMonth = `${y}-${String(payM).padStart(2, '0')}`;

  const rows = [], later = [], cancels = [], skipped = [];
  items.forEach(it => {
    if (!Number.isInteger(it.amount) || it.amount <= 0 || it.user !== '本人') skipped.push(it);
    else if (it.cancel) cancels.push(it);
    else if (it.thisMonth) rows.push({ date: it.date, merchant: it.merchant, rawName: it.rawName, amount: it.amount, payMonth: statementMonth });
    else later.push(it);
  });
  return { statementMonth, rows, later, cancels, skipped };
}

/**
 * 合計（10/6 本人）：明細の利用の合計、キャンセルなどの合計、差し引いた支払金額（e-NAVI の一覧の支払金額と同じはず）、
 * シートのその月の支払い分の合計（メール・CSV の支出。取消は除く）。シートの合計が明細の利用の合計と同じなら、その月はそろっている。
 */
export function totals(transactions, parsed) {
  const sum = list => list.reduce((a, x) => a + x.amount, 0);
  const use = sum(parsed.rows), cancel = sum(parsed.cancels);
  const sheet = sum(transactions.filter(t => t.type === '支出' && t.status !== '取消' && (t.source === 'メール' || t.source === 'CSV') && t.payMonth === parsed.statementMonth));
  return { use, cancel, pay: use - cancel, sheet, diff: sheet - use };
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
