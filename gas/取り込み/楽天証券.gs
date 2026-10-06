/**
 * 楽天証券の積立（積立NISA）のメールの「分解」と「突き合わせ」（10/7 本人：積立NISA も支出・固定費に入れる）。
 * 規則は docs/03_システム設計.md の 4.5。ここの関数はシートにもメールにも触らないので、Node.js でテストできる（gas/test/）。
 *
 * - 「【投資信託】積立購入が完了しました（約定）」：1回の積立。HTML だけのメール（text/plain の本文がない）。
 *   「◯月◯日に完了（約定）した注文」の下に、ファンド名と 口座区分／分配金コース／購入金額（10,000円）／注文日（2026年10月1日）の表
 * - 「【投資信託】積立設定が完了しました」：「積立設定内容」の下に、ファンド名と 引落方法／積立指定日（毎月1日）／積立金額／口座区分／初回購入日 の表。
 *   メールが残っていない前の月を埋めるときだけ使う（実行.gs の addNisaHistory。手で1回だけ動かす）
 * 取引の行は、種類＝支出・利用日＝注文日・利用先＝ファンド名・出どころ＝楽天証券・支払月＝空（カードの引き落としや CSV の照合には入らない）。
 * ファンド名・金額などはメールから読むだけで、このリポジトリには書かない（公開しているため）。
 */

const SEC_SENDER = 'service@rakuten-sec.co.jp';
const NISA_SOURCE = '楽天証券';      // 取引の「出どころ」
const NISA_CATEGORY = '積立・投資';   // グループは固定費
const NISA_FROM_SETTING = '設定から'; // 積立設定から埋めた月の「状態」（メールで確かめた月は「確定」）

/** 楽天証券のメールの種類。'nisa'（積立の約定）／ null（対象外）。 */
function classifySecSubject(subject) {
  return String(subject || '').normalize('NFKC').includes('積立購入が完了しました') ? 'nisa' : null;
}

/** 文字 → 1行ずつ（前後の空白と、表の区切りの | を外し、空の行は捨てる）。全角・半角はそろえる。 */
function toLines(text) {
  return String(text || '').normalize('NFKC').split(/\r?\n/)
    .map(l => l.replace(/^[\s|]+|[\s|]+$/g, ''))
    .filter(l => l && !/^[-|:\s]+$/.test(l)); // 空の行と、表の区切り線（---|---）は捨てる
}

/** HTML のメール → 1行ずつの文字。表のマス・段落・改行のところで行を分ける。 */
function htmlToLines(html) {
  const text = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th|tr|p|div|li|table|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&copy;/g, '©')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
  return toLines(text);
}

const SEC_LABEL = /^(口座区分|分配金コース|購入金額|注文日|引落方法|積立指定日|積立金額|ボーナス設定|初回購入日|入金締切日)(?:[\s|:：]+(.+))?$/;

/** 表を読む：lines[i] から続く「見出し → 値」（値は次の行。同じ行に並んでいてもよい）。見出しでない行で終わり。 */
function readSecTable(lines, i) {
  const fields = {};
  for (; i < lines.length; i++) {
    const m = SEC_LABEL.exec(lines[i]);
    if (!m) break;
    if (m[2]) fields[m[1]] = m[2].trim();
    else { fields[m[1]] = lines[i + 1] || ''; i++; }
  }
  return { fields, end: i };
}

/** 見出しの行（例：「◯月◯日に完了(約定)した注文」）より下の表を全部。title は表のすぐ上の行（ファンド名）。 */
function secTables(lines, headPattern) {
  const head = lines.findIndex(l => headPattern.test(l));
  if (head < 0) return null;
  const out = [];
  for (let i = head + 1; i < lines.length; i++) {
    if (!SEC_LABEL.test(lines[i])) continue;
    const { fields, end } = readSecTable(lines, i);
    out.push({ title: lines[i - 1], fields });
    i = end - 1;
  }
  return out;
}

const secYen = s => { const m = /^([\d,]+)\s*円$/.exec(String(s || '')); return m ? Number(m[1].replace(/,/g, '')) : null; };
const secDate = s => { const m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(String(s || '')); return m ? toIsoDate(m[1], m[2], m[3]) : null; };
const isFundTitle = t => !!t && !SEC_LABEL.test(t) && !/した注文|積立設定内容/.test(t);

/**
 * 約定のメール → [{ date（注文日）, fund, amount, account（口座区分） }]（1通に1件以上）。
 * 1件でも形が合わなければ、そのメールは丸ごと null（中途半端に取り込まない）。
 */
function parseNisaOrders(lines) {
  const tables = secTables(lines, /\d{1,2}月\d{1,2}日に完了\(約定\)した注文/);
  if (!tables || !tables.length) return null;
  const items = [];
  for (const { title, fields } of tables) {
    const date = secDate(fields['注文日']), amount = secYen(fields['購入金額']);
    if (!isFundTitle(title) || !date || !amount || !fields['口座区分']) return null;
    items.push({ date, fund: title, amount, account: fields['口座区分'] });
  }
  return items;
}

/** 積立設定のメール → [{ fund, day（毎月の日）, amount, account, first（初回購入日） }]。毎月の積立でないもの・形が合わないものは null。 */
function parseNisaSetting(lines) {
  const tables = secTables(lines, /積立設定内容/);
  if (!tables || !tables.length) return null;
  const items = [];
  for (const { title, fields } of tables) {
    const day = /^毎月(\d{1,2})日$/.exec(fields['積立指定日'] || '');
    const amount = secYen(fields['積立金額']), first = secDate(fields['初回購入日']);
    if (!isFundTitle(title) || !day || !amount || !first || !fields['口座区分']) return null;
    items.push({ fund: title, day: Number(day[1]), amount, account: fields['口座区分'], first });
  }
  return items;
}

/** 1通の約定のメールを、取り込む単位に。id は「m_メールID_何件目」（カードのメールと同じ形。次からは読みにいかない）。 */
function toNisaEntries(messageId, lines) {
  const items = parseNisaOrders(lines);
  if (!items) return null;
  return items.map((it, i) => Object.assign({ kind: 'nisa', id: `m_${messageId}_${i + 1}` }, it));
}

// ---- 営業日（設定から埋める月の日付：指定日が休みなら次の営業日。東証の休み＝土日・祝日・12/31〜1/3） ----
// web/js/calc.js の isHoliday と同じ決まり（テストで全部の日が一致するか確かめる）。

const SEC_FIXED_HOLIDAYS = ['1-1', '2-11', '2-23', '4-29', '5-3', '5-4', '5-5', '8-11', '11-3', '11-23'];

function secNthMonday(y, m0, n) {
  return 1 + ((8 - new Date(y, m0, 1).getDay()) % 7) + (n - 1) * 7;
}
function secAddDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function secNationalHoliday(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  if (SEC_FIXED_HOLIDAYS.includes(`${m}-${day}`)) return true;
  if ((m === 1 && day === secNthMonday(y, 0, 2)) || (m === 7 && day === secNthMonday(y, 6, 3))
    || (m === 9 && day === secNthMonday(y, 8, 3)) || (m === 10 && day === secNthMonday(y, 9, 2))) return true;
  const k = y - 1980, leap = Math.floor(k / 4);
  if (m === 3 && day === Math.floor(20.8431 + 0.242194 * k - leap)) return true;
  if (m === 9 && day === Math.floor(23.2488 + 0.242194 * k - leap)) return true;
  return false;
}
function secHoliday(d) {
  if (secNationalHoliday(d)) return true;
  for (let back = 1, p = secAddDays(d, -1); secNationalHoliday(p); back++, p = secAddDays(d, -back)) {
    if (p.getDay() === 0) return true;
  }
  return secNationalHoliday(secAddDays(d, -1)) && secNationalHoliday(secAddDays(d, 1));
}
function isMarketHoliday(d) {
  const m = d.getMonth() + 1, day = d.getDate();
  return d.getDay() === 0 || d.getDay() === 6 || secHoliday(d) || (m === 12 && day === 31) || (m === 1 && day <= 3);
}

/** その月（'YYYY-MM'）の day 日。月にその日がなければ月末。休みなら次の営業日（月をまたぐこともある）。 */
function secBusinessDay(month, day) {
  const y = Number(month.slice(0, 4)), m0 = Number(month.slice(5, 7)) - 1;
  let d = new Date(y, m0, Math.min(day, new Date(y, m0 + 1, 0).getDate()));
  while (isMarketHoliday(d)) d = secAddDays(d, 1);
  return toIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// ---- 突き合わせ ----

const isNisaRow = r => r['出どころ'] === NISA_SOURCE && r['状態'] !== '取消';
const sameFund = (r, fund) => normalizeMerchant(r['利用先']) === normalizeMerchant(fund);

/** 'YYYY-MM' の次の月。 */
function secNextMonth(month) {
  return nextMonth(month + '-01');
}

/**
 * 約定のメールを取引の行に当てはめる。rows はその場で書き換える。
 * 設定から埋めた同じファンド・同じ月の行があれば、それをメールの行に置き換える（行は増やさない）。
 */
function mergeNisa(rows, entries, ruleMap, now) {
  const stats = { added: 0, replaced: 0, skipped: 0 };
  const seen = new Set(rows.map(r => r['id']));
  for (const e of entries) {
    if (seen.has(e.id)) { stats.skipped++; continue; }
    seen.add(e.id);
    const planned = rows.find(r => isNisaRow(r) && r['状態'] === NISA_FROM_SETTING && sameFund(r, e.fund) && String(r['利用日']).slice(0, 7) === e.date.slice(0, 7));
    if (planned) {
      Object.assign(planned, { 'id': e.id, '利用日': e.date, '金額': e.amount, '状態': '確定', _dirty: true });
      stats.replaced++;
      continue;
    }
    const row = {
      'id': e.id, '種類': '支出', '利用日': e.date, '利用先': e.fund, '金額': e.amount, '支払月': '',
      '状態': '確定', 'カテゴリ': '', 'カテゴリの決め方': '未分類', '出どころ': NISA_SOURCE,
      '対応する速報': '', 'メモ': '', '取り込み日時': now,
    };
    applyRule(row, ruleMap);
    rows.push(row);
    stats.added++;
  }
  return stats;
}

/**
 * 積立設定から、メールのない月を埋める（初回購入日の月〜先月。今月は約定のメールを待つ）。
 * もうその月に同じファンドの行（メール・設定から・手で直したもの）があれば足さない。何回動かしても増えない（id でも確かめる）。
 * settings：[{ messageId, fund, day, amount, first }]
 */
function fillNisaFromSettings(rows, settings, today, ruleMap, now) {
  let added = 0;
  const cur = toIsoDate(today.getFullYear(), today.getMonth() + 1, 1).slice(0, 7);
  const ids = new Set(rows.map(r => r['id']));
  for (const s of settings) {
    const firstMonth = s.first.slice(0, 7);
    for (let m = firstMonth; m < cur; m = secNextMonth(m)) {
      const id = `s_${s.messageId}_${m.replace('-', '')}`;
      if (ids.has(id) || rows.some(r => isNisaRow(r) && sameFund(r, s.fund) && String(r['利用日']).slice(0, 7) === m)) continue;
      const row = {
        'id': id, '種類': '支出', '利用日': m === firstMonth ? s.first : secBusinessDay(m, s.day), '利用先': s.fund, '金額': s.amount,
        '支払月': '', '状態': NISA_FROM_SETTING, 'カテゴリ': '', 'カテゴリの決め方': '未分類', '出どころ': NISA_SOURCE,
        '対応する速報': '', 'メモ': '', '取り込み日時': now,
      };
      applyRule(row, ruleMap);
      rows.push(row);
      ids.add(id);
      added++;
    }
  }
  return added;
}

/**
 * 積立のファンドが対応表になければ、足す行を返す（カテゴリ＝積立・投資、表示名＝NISA なら「積立NISA」）。ruleMap も書き換える。
 * 本人が対応表でカテゴリを変えていたら、そのまま（足さない）。
 */
function nisaRuleRows(ruleMap, funds, today) {
  const rows = [];
  funds.forEach(({ fund, account }) => {
    const key = normalizeMerchant(fund);
    if (ruleMap[key] !== undefined) return;
    ruleMap[key] = NISA_CATEGORY;
    rows.push({ '利用先': fund, 'カテゴリ': NISA_CATEGORY, '決めた日': today, '表示名': /NISA/.test(account || '') ? '積立NISA' : '積立' });
  });
  return rows;
}

/** カテゴリのシートに「積立・投資」（グループ：固定費）がなければ、足す行を返す（並び順はいちばん後ろ）。なければ null。 */
function nisaCategoryRow(categoryRows) {
  if (categoryRows.some(r => r['カテゴリ'] === NISA_CATEGORY)) return null;
  const last = Math.max(0, ...categoryRows.map(r => Number(r['並び順']) || 0));
  return { 'カテゴリ': NISA_CATEGORY, 'グループ': '固定費', '並び順': last + 1 };
}
