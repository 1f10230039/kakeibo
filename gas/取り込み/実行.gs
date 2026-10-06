/**
 * 取り込み用の Apps Script で、実際にメールを読んでシートに書く部分。
 * Gmail は「読み取り専用」の権限（Gmail API）でだけ触る。メールに印を付けたり消したりはしない。
 *
 * - setup()  ：最初に1回だけ手で実行する。データ用のスプレッドシートを作り、1時間おきのトリガーを入れる
 * - ingest() ：メールを読んで取引のシートに足す。トリガーから1時間おきに動く。手で実行してもよい
 * - addNisaHistory()：積立NISA の前の月を入れる。手で1回だけ実行する（10/7。何回動かしても増えない）
 */

const SENDER = 'info@mail.rakuten-card.co.jp';
// ゴミ箱のメールも読む（本人が届いてすぐ消しても取り込めるように・10/6 本人）。迷惑メールは読まない（楽天カードを名乗る偽のメールを入れないため）
const MAIL_QUERY = `from:${SENDER} カード利用のお知らせ newer_than:60d -in:spam`;
// 楽天証券の積立の約定（10/7）。読み方は 楽天証券.gs
const NISA_QUERY = `from:${SEC_SENDER} subject:積立購入が完了しました newer_than:60d -in:spam`;
const MAX_FAILS = 3; // これだけ続けて読めなかったメールは、あきらめて「やること」に出す
const PROP = { SHEET_ID: 'SHEET_ID', FAILS: 'FAILS', IGNORED: 'IGNORED' };

function setup() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP.SHEET_ID);
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('家計簿データ');
    props.setProperty(PROP.SHEET_ID, ss.getId());
  }
  ss.setSpreadsheetTimeZone(TZ);
  prepareSheets(ss);

  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'ingest')) {
    ScriptApp.newTrigger('ingest').timeBased().everyHours(1).create();
  }
  console.log('データのスプレッドシート: ' + ss.getUrl());
}

/** シートがなければ作り、見出し・書式・初期値を入れる。何回実行しても壊れない。 */
function prepareSheets(ss) {
  const names = Object.values(SHEET);
  names.forEach((name, i) => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      const first = ss.getSheets()[0];
      // 新しく作ったスプレッドシートの最初の空のシートは、そのまま取引のシートにする
      if (i === 0 && first.getLastRow() === 0 && !names.includes(first.getName())) {
        sh = first.setName(name);
      } else {
        sh = ss.insertSheet(name);
      }
    }
    const header = HEADERS[name];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    // 金額などの数以外は「書式なしテキスト」にする。'2026-10' のような値が勝手に日付に変わらないように
    header.forEach((h, j) => {
      sh.getRange(2, j + 1, sh.getMaxRows() - 1, 1).setNumberFormat(columnFormat(h));
    });
  });
  seedIfEmpty(ss.getSheetByName(SHEET.CATEGORIES), INITIAL_CATEGORIES.map(([c, g], i) => [c, g, i + 1]));
  seedIfEmpty(ss.getSheetByName(SHEET.SETTINGS), INITIAL_SETTINGS);
}

function seedIfEmpty(sheet, rows) {
  if (sheet.getLastRow() > 1) return;
  const header = HEADERS[sheet.getName()];
  appendRows(sheet, rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]]))));
}

/** 設定のシートの1項目を書く（なければ足す）。API 側から読む状態もここに置く。 */
function putSetting(ss, key, value) {
  const sh = ss.getSheetByName(SHEET.SETTINGS);
  const row = readTable(sh).find(r => r['項目'] === key);
  if (row) writeRows(sh, row._row, [{ '項目': key, '値': value }]);
  else appendRows(sh, [{ '項目': key, '値': value }]);
}

function ingest() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP.SHEET_ID)) throw new Error('先に setup を実行してください');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return; // 前の回がまだ動いていたら、今回は休む

  const ss = getSpreadsheet();
  const log = { read: 0, added: 0, replaced: 0, linked: 0, failed: 0, memo: '' };
  try {
    const txSheet = ss.getSheetByName(SHEET.TX);
    const rows = readTable(txSheet);
    const ruleMap = buildRuleMap(readTable(ss.getSheetByName(SHEET.RULES)));
    const fails = JSON.parse(props.getProperty(PROP.FAILS) || '{}');
    const ignored = JSON.parse(props.getProperty(PROP.IGNORED) || '{}');
    const known = knownMessageIds(rows);

    const entries = [], nisa = [];
    for (const id of [...new Set([...listMessageIds(MAIL_QUERY), ...listMessageIds(NISA_QUERY)])]) {
      // もう取り込んだもの・対象外とわかっているもの・あきらめたものは、本文を取りにいかない
      if (known.has(id) || ignored[id] || (fails[id] || 0) >= MAX_FAILS) continue;
      const msg = fetchMessage(id);
      log.read++;

      const kind = classifyMail(msg);
      if (!kind) { ignored[id] = msg.time; continue; }

      const es = kind === 'nisa' ? toNisaEntries(id, msgLines(msg)) : toEntries(kind, id, msg.body);
      if (!es) {
        fails[id] = (fails[id] || 0) + 1;
        log.failed++;
        continue;
      }
      delete fails[id];
      es.forEach(e => { e.time = msg.time; (kind === 'nisa' ? nisa : entries).push(e); });
    }

    entries.sort((a, b) => a.time - b.time); // 速報 → 確定 の順に当てはめるため
    const st = mergeEntries(rows, entries, ruleMap, nowString());
    const sn = nisa.length ? mergeNisaWithSetup(ss, rows, nisa, ruleMap) : { added: 0, replaced: 0 };
    saveRows(txSheet, rows);
    Object.assign(log, { added: st.added + sn.added, replaced: st.replaced + sn.replaced, linked: st.linked });

    const givenUp = Object.keys(fails).filter(id => fails[id] >= MAX_FAILS);
    putSetting(ss, '読めなかったメール', givenUp.join(','));
    props.setProperty(PROP.FAILS, JSON.stringify(fails));
    props.setProperty(PROP.IGNORED, JSON.stringify(dropOlderThan(ignored, 70)));
  } catch (err) {
    log.memo = 'エラー: ' + err.message;
    throw err; // トリガーの失敗として Google からメールで知らせてもらう
  } finally {
    putSetting(ss, '最終取り込み', nowString());
    // 何も起きなかった回は記録しない（1時間おきに空の行が増えないように）
    if (log.read || log.memo) {
      appendRows(ss.getSheetByName(SHEET.LOG), [{
        '日時': nowString(), '読んだメール': log.read, '足した': log.added, '置き換えた': log.replaced,
        '速報と結びつけた': log.linked, '読めなかった': log.failed, 'メモ': log.memo,
      }]);
    }
    lock.releaseLock();
  }
}

/** メールの種類：カード（'sokuho'／'kakutei'）、楽天証券の積立（'nisa'）、対象外（null）。送り主で分けてから件名を見る。 */
function classifyMail(msg) {
  if (msg.from.includes(SENDER)) return classifySubject(msg.subject);
  if (msg.from.includes(SEC_SENDER)) return classifySecSubject(msg.subject);
  return null;
}

/** 本文を1行ずつに（楽天証券のメールは HTML だけなので、HTML から文字を取り出す）。 */
function msgLines(msg) {
  return msg.body ? toLines(msg.body) : htmlToLines(msg.html);
}

/**
 * 積立の行を足す前に、カテゴリ「積立・投資」と、ファンドの対応表（表示名「積立NISA」）がなければ足す。そのあと突き合わせる。
 * 対応表・カテゴリのシートはここで書く（取引のシートは呼んだ側が saveRows で書く）。
 */
function mergeNisaWithSetup(ss, rows, entries, ruleMap, settings) {
  const catSheet = ss.getSheetByName(SHEET.CATEGORIES);
  const cat = nisaCategoryRow(readTable(catSheet));
  if (cat) appendRows(catSheet, [cat]);
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const funds = [...entries, ...(settings || [])].map(e => ({ fund: e.fund, account: e.account }));
  const ruleRows = nisaRuleRows(ruleMap, funds, today);
  if (ruleRows.length) appendRows(ss.getSheetByName(SHEET.RULES), ruleRows);
  const st = mergeNisa(rows, entries, ruleMap, nowString());
  if (settings) st.added += fillNisaFromSettings(rows, settings, new Date(), ruleMap, nowString());
  return st;
}

/**
 * 積立NISA の前の月を入れる（10/7 本人）。Apps Script の画面で、この関数を選んで1回だけ実行する。
 * 1. 残っている約定のメールを、日付に関係なく全部読む（ふだんの ingest は 60日より前を読まない）
 * 2. 積立設定のメールから、メールのない月（初回購入日の月〜先月）を「設定から」の状態で埋める
 * もうある行は足さないので、何回動かしてもよい。結果は「記録」のシートとログに出る。
 */
function addNisaHistory() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) throw new Error('取り込みが動いています。少し待ってから、もう一度実行してください');
  const ss = getSpreadsheet();
  try {
    const txSheet = ss.getSheetByName(SHEET.TX);
    const rows = readTable(txSheet);
    const ruleMap = buildRuleMap(readTable(ss.getSheetByName(SHEET.RULES)));
    const entries = [], settings = [];
    let failed = 0;
    for (const id of listMessageIds(`from:${SEC_SENDER} subject:積立購入が完了しました -in:spam`)) {
      const msg = fetchMessage(id);
      const es = classifyMail(msg) === 'nisa' ? toNisaEntries(id, msgLines(msg)) : null;
      if (es) entries.push(...es); else failed++;
    }
    for (const id of listMessageIds(`from:${SEC_SENDER} subject:積立設定が完了しました -in:spam`)) {
      const msg = fetchMessage(id);
      const ss2 = msg.from.includes(SEC_SENDER) ? parseNisaSetting(msgLines(msg)) : null;
      if (ss2) ss2.forEach(s => settings.push(Object.assign({ messageId: id }, s))); else failed++;
    }
    const st = mergeNisaWithSetup(ss, rows, entries, ruleMap, settings);
    saveRows(txSheet, rows);
    const memo = `積立NISA の前の月：約定のメール ${entries.length}件・設定 ${settings.length}件から`;
    appendRows(ss.getSheetByName(SHEET.LOG), [{
      '日時': nowString(), '読んだメール': entries.length + settings.length + failed, '足した': st.added, '置き換えた': st.replaced,
      '速報と結びつけた': 0, '読めなかった': failed, 'メモ': memo,
    }]);
    console.log(`${memo}。足した ${st.added}件・置き換えた ${st.replaced}件・読めなかった ${failed}通`);
  } finally {
    lock.releaseLock();
  }
}

/** 取引のシートに出てくるメール ID（id と 対応する速報 の「m_メールID_何件目」から取り出す）。 */
function knownMessageIds(rows) {
  const ids = new Set();
  rows.forEach(r => [r['id'], r['対応する速報']].forEach(v => {
    const m = /^m_(.+)_\d+$/.exec(String(v || ''));
    if (m) ids.add(m[1]);
  }));
  return ids;
}

function dropOlderThan(map, days) {
  const limit = Date.now() - days * 24 * 60 * 60 * 1000;
  return Object.fromEntries(Object.entries(map).filter(([, t]) => t >= limit));
}

// ---- Gmail API（読み取り専用） ----

function listMessageIds(q) {
  const ids = [];
  let pageToken;
  do {
    const res = Gmail.Users.Messages.list('me', { q, maxResults: 100, pageToken, includeSpamTrash: true }); // 迷惑メールは q の -in:spam で外す
    (res.messages || []).forEach(m => ids.push(m.id));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return ids;
}

function fetchMessage(id) {
  const m = Gmail.Users.Messages.get('me', id, { format: 'full' });
  const header = name => ((m.payload.headers || []).find(h => h.name.toLowerCase() === name) || {}).value || '';
  return {
    subject: header('subject'),
    from: header('from'),
    time: Number(m.internalDate),
    body: findPlainText(m.payload),
    html: findPart(m.payload, 'text/html'), // text/plain がないメール（楽天証券）のため
  };
}

/** メールの部品をたどって、その種類（text/html など）の本文を探す。 */
function findPart(part, mimeType) {
  if (part.mimeType === mimeType && part.body && part.body.data) return decodeBody(part);
  for (const p of part.parts || []) {
    const text = findPart(p, mimeType);
    if (text) return text;
  }
  return '';
}

/** メールの部品をたどって、text/plain の本文を探す。 */
function findPlainText(part) {
  if (part.mimeType === 'text/plain' && part.body && part.body.data) return decodeBody(part);
  for (const p of part.parts || []) {
    const text = findPlainText(p);
    if (text) return text;
  }
  return '';
}

/**
 * Gmail API は本文を UTF-8 に直して返すと報告されている（公式の文書では未確認）。
 * まず UTF-8 で読み、文字化けしたら、メールに書いてある文字コードで読み直す。
 * 「化けた」の判定は2つ：置き換え文字（U+FFFD）が出た、または ESC が混じっている。
 * ISO-2022-JP は ESC で文字の種類を切り替える7ビットの文字コードで、UTF-8 として読んでも U+FFFD が出ないため。
 */
function decodeBody(part) {
  const data = part.body.data;
  let bytes;
  if (Array.isArray(data)) {
    bytes = data;
  } else {
    const s = String(data);
    bytes = Utilities.base64DecodeWebSafe(s + '='.repeat((4 - (s.length % 4)) % 4));
  }
  const utf8 = Utilities.newBlob(bytes).getDataAsString('UTF-8');
  if (!utf8.includes('�') && !utf8.includes('\x1B')) return utf8;

  const ct = ((part.headers || []).find(h => h.name.toLowerCase() === 'content-type') || {}).value || '';
  const charset = (/charset="?([^";\s]+)/i.exec(ct) || [])[1];
  return charset ? Utilities.newBlob(bytes).getDataAsString(charset) : utf8;
}
