/**
 * 共通の定数と小さな道具。
 * シートの名前と列は docs/03_システム設計.md の3章に合わせる。
 */

const TZ = 'Asia/Tokyo';

const SHEET = {
  TX: '取引',
  RULES: '対応表',
  CATEGORIES: 'カテゴリ',
  BUDGET: '予算',
  ASSETS: '資産',
  SETTINGS: '設定',
  LOG: '記録',
};

const HEADERS = {
  [SHEET.TX]: ['id', '種類', '利用日', '利用先', '金額', '支払月', '状態', 'カテゴリ', 'カテゴリの決め方', '出どころ', '対応する速報', 'メモ', '取り込み日時'],
  [SHEET.RULES]: ['利用先', 'カテゴリ', '決めた日', '表示名'],
  [SHEET.CATEGORIES]: ['カテゴリ', 'グループ', '並び順'],
  [SHEET.BUDGET]: ['月', '対象', '金額'],
  [SHEET.ASSETS]: ['記録日', '項目', '金額'],
  [SHEET.SETTINGS]: ['項目', '値'],
  [SHEET.LOG]: ['日時', '読んだメール', '足した', '置き換えた', '速報と結びつけた', '読めなかった', 'メモ'],
};

// 要件定義 6.1 のカテゴリとグループ（10/6 決定）
const INITIAL_CATEGORIES = [
  ['食費', '暮らし'], ['日用品', '暮らし'], ['交通費', '暮らし'], ['健康・医療', '暮らし'],
  ['サブスク', '固定費'], ['通信費', '固定費'],
  ['趣味・娯楽', 'たのしみ'], ['衣服', 'たのしみ'], ['美容', 'たのしみ'], ['交際費', 'たのしみ'],
  ['その他', 'その他'],
];

const INITIAL_SETTINGS = [
  ['週の始まり', '月'],
];

/** 利用先をくらべやすい形にそろえる（全角→半角、空白の詰め、大文字）。 */
function normalizeMerchant(name) {
  return String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** 'YYYY-MM-DD' の翌月を 'YYYY-MM' で返す。 */
function nextMonth(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** 対応表の行から「そろえた利用先 → カテゴリ」の表を作る。 */
function buildRuleMap(ruleRows) {
  const map = {};
  ruleRows.forEach(r => { if (r['利用先']) map[normalizeMerchant(r['利用先'])] = r['カテゴリ']; });
  return map;
}

// ---- ここから下は GAS の上でだけ動く（スプレッドシートを読み書きする） ----

function getSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function nowString() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
}

// 数として持つ列。それ以外は全部「書式なしテキスト」にする
const NUMBER_COLUMNS = ['金額', '並び順', '読んだメール', '足した', '置き換えた', '速報と結びつけた', '読めなかった'];

// シートが勝手に日付型に変えてしまったときに、元の文字の形に戻すための書式
const DATE_TEXT_FORMATS = {
  '利用日': 'yyyy-MM-dd', '記録日': 'yyyy-MM-dd', '決めた日': 'yyyy-MM-dd',
  '支払月': 'yyyy-MM', '月': 'yyyy-MM',
  '取り込み日時': 'yyyy-MM-dd HH:mm', '日時': 'yyyy-MM-dd HH:mm', '値': 'yyyy-MM-dd HH:mm',
};

function columnFormat(header) {
  return NUMBER_COLUMNS.includes(header) ? '#,##0' : '@';
}

/**
 * シートを「見出し → 値」のオブジェクトの配列として読む。
 * それぞれに _row（シートの行番号）を付けておき、書き戻すときに使う。
 */
function readTable(sheet) {
  const values = sheet.getDataRange().getValues();
  const header = values.shift();
  return values
    .map((row, i) => {
      const obj = { _row: i + 2 };
      header.forEach((h, j) => {
        const v = row[j];
        obj[h] = v instanceof Date ? Utilities.formatDate(v, TZ, DATE_TEXT_FORMATS[h] || 'yyyy-MM-dd') : v;
      });
      return obj;
    })
    .filter(obj => header.some(h => obj[h] !== ''));
}

function toValues(sheet, row) {
  return HEADERS[sheet.getName()].map(h => (row[h] === undefined ? '' : row[h]));
}

/**
 * 行を書く。書く直前に列ごとの書式（テキスト／数）を付け直してから setValues する。
 * appendRow は手で打ち込んだときと同じように値を解釈し、'2026-10' などを日付に変えてしまうため使わない（10/6 の最初の取り込みで実際に起きた。直したあとは文字のまま入ることを確認）。
 */
function writeRows(sheet, startRow, rowObjects) {
  if (rowObjects.length === 0) return;
  ensureHeader(sheet);
  const header = HEADERS[sheet.getName()];
  const range = sheet.getRange(startRow, 1, rowObjects.length, header.length);
  range.setNumberFormats(rowObjects.map(() => header.map(columnFormat)));
  range.setValues(rowObjects.map(r => toValues(sheet, r)));
}

/**
 * あとから足した列（対応表の「表示名」など）の見出しが、シートになければ右端に足す。
 * 前からある列の並びは変えない前提（新しい列はいつも右端に足す）。
 */
function ensureHeader(sheet) {
  const header = HEADERS[sheet.getName()];
  const width = sheet.getLastColumn();
  if (width >= header.length) return;
  sheet.getRange(1, width + 1, 1, header.length - width).setValues([header.slice(width)]).setFontWeight('bold');
}

/** 末尾に足す。 */
function appendRows(sheet, rowObjects) {
  writeRows(sheet, sheet.getLastRow() + 1, rowObjects);
}

/**
 * 変えた行（_dirty）はその行だけ書き戻し、新しい行（_row なし）は末尾に足す。
 * シートを丸ごと書き直さないのは、同じ時間に API 側が別の行を変えていても消さないため。
 * ⚠️ 取り込みと API が同じ瞬間（1秒未満の差）に末尾へ足すと、片方が上書きされうる。2つの Apps Script は
 *    同じロックを使えないため。起きる確率はとても低いので、いまは受け入れる（03_システム設計.md 8章）。
 */
function saveRows(sheet, rows) {
  rows.filter(r => r._row && r._dirty).forEach(r => writeRows(sheet, r._row, [r]));
  appendRows(sheet, rows.filter(r => !r._row));
}
