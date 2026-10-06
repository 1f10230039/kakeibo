/**
 * 楽天カードの利用通知メールの「分解」と「突き合わせ」。
 * 規則は docs/03_システム設計.md の4章。
 *
 * ここの関数はシートにもメールにも触らないので、パソコンの Node.js でテストできる（gas/test/）。
 * メールを読んでシートに書く部分は 実行.gs。
 */

/**
 * 件名からメールの種類を決める。
 * 'sokuho'（速報版）／ 'kakutei'（確定版）／ null（対象外：家族カード、登録完了のお知らせなど）
 */
function classifySubject(subject) {
  const s = String(subject || '').normalize('NFKC');
  if (s.includes('【速報版】カード利用のお知らせ(本人ご利用分)')) return 'sokuho';
  if (s.startsWith('カード利用のお知らせ(本人ご利用分)')) return 'kakutei';
  return null;
}

/** '2026/9/7' → '2026-09-07' */
function toIsoDate(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toYen(text) {
  return Number(text.replace(/,/g, ''));
}

/**
 * 速報版の本文 → [{ date, amount }]（1通に1件）。形が合わなければ null。
 * 本文の例：■利用日: 2026/10/01 ／ ■利用者: 本人 ／ ■利用金額: 2,000 円
 */
function parseSokuho(body) {
  const text = String(body || '').normalize('NFKC');
  const date = text.match(/■利用日:\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  const amount = text.match(/■利用金額:\s*([\d,]+)\s*円/);
  if (!date || !amount) return null;
  return [{ date: toIsoDate(date[1], date[2], date[3]), amount: toYen(amount[1]) }];
}

/**
 * 確定版の本文 → [{ date, merchant, amount, payMonth }]（1通に1件以上）。
 * 1件でも形が合わなければ、そのメールは丸ごと null（中途半端に取り込まない）。
 */
function parseKakutei(body) {
  const text = String(body || '').normalize('NFKC');
  const chunks = text.split('■利用日:').slice(1);
  if (chunks.length === 0) return null;

  const items = [];
  for (const chunk of chunks) {
    const date = chunk.match(/^\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    const merchant = chunk.match(/■利用先:[ \t]*(.+)/);
    const amount = chunk.match(/■利用金額:\s*([\d,]+)\s*円/);
    const payMonth = chunk.match(/■支払月:\s*(\d{4})\/(\d{1,2})/);
    if (!date || !merchant || !amount || !payMonth) return null;
    items.push({
      date: toIsoDate(date[1], date[2], date[3]),
      merchant: merchant[1].trim(),
      amount: toYen(amount[1]),
      payMonth: `${payMonth[1]}-${String(payMonth[2]).padStart(2, '0')}`,
    });
  }
  return items;
}

/**
 * 1通のメールを、取り込む単位（entry）に直す。形が合わなければ null。
 * id は「m_メールID_何件目」。
 */
function toEntries(kind, messageId, body) {
  const items = kind === 'sokuho' ? parseSokuho(body) : parseKakutei(body);
  if (!items) return null;
  return items.map((it, i) => Object.assign({ kind, id: `m_${messageId}_${i + 1}` }, it));
}

function applyRule(row, ruleMap) {
  if (row['カテゴリの決め方'] === '個別') return;
  const cat = ruleMap[normalizeMerchant(row['利用先'])];
  row['カテゴリ'] = cat || '';
  row['カテゴリの決め方'] = cat ? '対応表' : '未分類';
}

/**
 * 取り込む単位を、今ある取引の行に当てはめる（4.3 速報と確定の突き合わせ）。
 * rows はその場で書き換える。entries はメールの古い順に並べて渡す。
 * 戻り値は数の集計。
 */
function mergeEntries(rows, entries, ruleMap, now) {
  const stats = { added: 0, replaced: 0, linked: 0, skipped: 0 };
  const seen = new Set();
  rows.forEach(r => { seen.add(r['id']); if (r['対応する速報']) seen.add(r['対応する速報']); });

  for (const e of entries) {
    if (seen.has(e.id)) { stats.skipped++; continue; }
    seen.add(e.id);

    const same = r => r['出どころ'] === 'メール' && r['利用日'] === e.date && Number(r['金額']) === e.amount;
    // e-NAVI の CSV（S-09）から先に足した行。同じ利用日・同じ金額なら、このメールの分とみなして二重にしない
    // （ゴミ箱のメールも読むようにしたので、CSV で足したあとに、その分のメールが遅れて入ってくることがある・10/6）
    const fromCsv = r => r['出どころ'] === 'CSV' && r['状態'] === '確定' && r['利用日'] === e.date && Number(r['金額']) === e.amount;

    if (e.kind === 'sokuho') {
      // 確定版（または CSV の行）のほうが先にあれば、新しい行は作らずに結びつけるだけ
      const kakutei = rows.find(r => same(r) && r['状態'] === '確定' && !r['対応する速報'])
        || rows.find(r => fromCsv(r) && !r['対応する速報']);
      if (kakutei) {
        kakutei['対応する速報'] = e.id;
        kakutei._dirty = true;
        stats.linked++;
        continue;
      }
      rows.push({
        'id': e.id, '種類': '支出', '利用日': e.date, '利用先': '', '金額': e.amount,
        '支払月': nextMonth(e.date), // 仮。確定版で書き換える（3.1.1）
        '状態': '速報', 'カテゴリ': '', 'カテゴリの決め方': '未分類',
        '出どころ': 'メール', '対応する速報': '', 'メモ': '', '取り込み日時': now,
      });
      stats.added++;
      continue;
    }

    // 確定版：同じ利用日・同じ金額の速報があれば、古いほうから置き換える
    const sokuho = rows.find(r => same(r) && r['状態'] === '速報');
    if (sokuho) {
      sokuho['対応する速報'] = sokuho['id'];
      sokuho['id'] = e.id;
      sokuho['利用先'] = e.merchant;
      sokuho['支払月'] = e.payMonth;
      sokuho['状態'] = '確定';
      applyRule(sokuho, ruleMap);
      sokuho._dirty = true;
      stats.replaced++;
      continue;
    }
    // CSV から足した行があれば、その行をこのメールの行にする（id をメールのものにして、次からは読みにいかない）
    const csv = rows.find(fromCsv);
    if (csv) {
      csv['id'] = e.id;
      csv['利用先'] = e.merchant;
      csv['支払月'] = e.payMonth;
      csv['出どころ'] = 'メール';
      applyRule(csv, ruleMap);
      csv._dirty = true;
      stats.replaced++;
      continue;
    }
    const row = {
      'id': e.id, '種類': '支出', '利用日': e.date, '利用先': e.merchant, '金額': e.amount,
      '支払月': e.payMonth, '状態': '確定', 'カテゴリ': '', 'カテゴリの決め方': '未分類',
      '出どころ': 'メール', '対応する速報': '', 'メモ': '', '取り込み日時': now,
    };
    applyRule(row, ruleMap);
    rows.push(row);
    stats.added++;
  }
  return stats;
}
