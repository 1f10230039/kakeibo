/**
 * GAS ②「家計簿 API」。スプレッドシート「家計簿データ」に付属させ、ウェブアプリとして公開する。
 * 権限はこのスプレッドシートだけ（appsscript.json の spreadsheets.currentonly）。Gmail には触れない。
 * 仕様は docs/03_システム設計.md の5章。
 *
 * - makeKey()  ：最初に1回だけ手で実行する。合言葉を作り、実行ログに表示する（保存するのはハッシュだけ）
 * - doPost(e)  ：PWA からの呼び出し。本文は JSON の文字列 { key, action, params }
 *
 * 手続きの中身（handleRequest と ACTIONS）は、シートの読み書きを store に任せているので
 * Node.js でテストできる（gas/test/test_api.js）。
 */

/** @OnlyCurrentDoc */

const MAX_AUTH_FAILS_PER_HOUR = 10;
const MIN_KEY_LENGTH = 32;
const WRITABLE_SETTINGS = { '週の始まり': ['月', '日'] };

/** 呼んだ人に見せてよい失敗（合言葉が正しいときだけ返る）。 */
class UserError extends Error {}

// ---- 入口 ----

function doGet() {
  return toJson({ ok: false }); // URL を開いただけでは何も返さない
}

function doPost(e) {
  const body = e && e.postData ? e.postData.contents : '';
  return toJson(handleRequest(body, gasDeps()));
}

function toJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function makeKey() {
  const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); // 64文字
  PropertiesService.getScriptProperties().setProperty('API_KEY_HASH', sha256Hex(key));
  CacheService.getScriptCache().remove('authFails');
  console.log('合言葉（PWA に入れる）: ' + key);
}

function sha256Hex(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function gasDeps() {
  return {
    store: sheetStore(getSpreadsheet),
    auth: makeAuth(PropertiesService.getScriptProperties(), CacheService.getScriptCache(), sha256Hex),
    withLock: fn => {
      const lock = LockService.getScriptLock();
      lock.waitLock(10 * 1000);
      try { return fn(); } finally { lock.releaseLock(); }
    },
    now: nowString,
    newId: () => 'h_' + Utilities.getUuid(),
  };
}

/** シートの読み書き。スプレッドシートは、合言葉が通ってから初めて開く。 */
function sheetStore(openSpreadsheet) {
  let ss;
  const sheet = name => (ss = ss || openSpreadsheet()).getSheetByName(name);
  return {
    rows: name => readTable(sheet(name)),
    update: (name, row) => writeRows(sheet(name), row._row, [row]),
    append: (name, rows) => appendRows(sheet(name), rows),
  };
}

// ---- 合言葉 ----

/**
 * 合言葉は、ハッシュ（SHA-256）にしてスクリプト プロパティの API_KEY_HASH とくらべる。
 * 間違いが1時間に MAX_AUTH_FAILS_PER_HOUR 回に達したら、その後は正しい合言葉でも断る。
 */
function makeAuth(props, cache, digest) {
  return {
    check(key) {
      const fails = Number(cache.get('authFails') || 0);
      if (fails >= MAX_AUTH_FAILS_PER_HOUR) return false;
      const stored = props.getProperty('API_KEY_HASH');
      const ok = !!stored && typeof key === 'string' && key.length >= MIN_KEY_LENGTH && digest(key) === stored;
      if (!ok) cache.put('authFails', String(fails + 1), 60 * 60);
      return ok;
    },
  };
}

// ---- 手続き ----

/**
 * 失敗はどれも { ok: false } だけにする。合言葉が違うのか、本文が壊れているのかを区別させないため。
 * 合言葉が正しいときに限って、直せる失敗の理由（error）を付ける。
 */
function handleRequest(body, deps) {
  let req;
  try { req = JSON.parse(body); } catch (_) { return { ok: false }; }
  if (!req || typeof req !== 'object') return { ok: false };
  if (!deps.auth.check(req.key)) return { ok: false };

  if (typeof req.action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, req.action)) {
    return { ok: false, error: '知らない action です' };
  }
  const params = req.params && typeof req.params === 'object' ? req.params : {};
  try {
    return { ok: true, data: deps.withLock(() => ACTIONS[req.action](params, deps)) };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: 'サーバーの中で失敗しました' };
  }
}

const ACTIONS = {
  getData({ from, to }, { store }) {
    checkMonth(from, 'from');
    checkMonth(to, 'to');
    const settings = Object.fromEntries(store.rows(SHEET.SETTINGS).map(r => [r['項目'], r['値']]));
    return {
      transactions: store.rows(SHEET.TX)
        .filter(r => r['状態'] !== '取消')
        .filter(r => { const m = String(r['利用日']).slice(0, 7); return m >= from && m <= to; })
        .map(toTransaction),
      categories: store.rows(SHEET.CATEGORIES)
        .map(r => ({ name: r['カテゴリ'], group: r['グループ'], order: Number(r['並び順']) }))
        .sort((a, b) => a.order - b.order),
      rules: store.rows(SHEET.RULES).map(r => ({ merchant: r['利用先'], category: r['カテゴリ'], displayName: r['表示名'] || '' })),
      budgets: store.rows(SHEET.BUDGET).map(r => ({ month: r['月'], target: r['対象'], amount: Number(r['金額']) })),
      assets: store.rows(SHEET.ASSETS).map(r => ({ date: r['記録日'], item: r['項目'], amount: Number(r['金額']) })),
      settings: {
        weekStart: settings['週の始まり'] || '月',
        lastIngest: settings['最終取り込み'] || '',
        unreadableMails: String(settings['読めなかったメール'] || '').split(',').filter(Boolean).length,
      },
    };
  },

  /** 1件だけカテゴリを変える（F-12）。空にすると未分類に戻る。 */
  setCategory({ id, category }, { store }) {
    const row = findTx(store, id);
    checkCategory(store, category, true);
    row['カテゴリ'] = category;
    row['カテゴリの決め方'] = category ? '個別' : '未分類';
    store.update(SHEET.TX, row);
    return { id };
  },

  /**
   * 「この店はいつもこのカテゴリ（と名前）」（F-06）。対応表に足すか変えて、
   * 同じ利用先の行のうち、個別に決めたもの以外にまとめて当てる。
   * displayName（表示名）は、一覧で用途の横に出す名前（例：YouTube Premium）。送らなければ今のまま。
   */
  setRule({ merchant, category, displayName }, { store, now }) {
    checkText(merchant, 'merchant', 100, false);
    checkCategory(store, category, false);
    if (displayName !== undefined) checkText(displayName, 'displayName', 100, true);
    const key = normalizeMerchant(merchant);
    const rule = store.rows(SHEET.RULES).find(r => normalizeMerchant(r['利用先']) === key);
    if (rule) {
      rule['カテゴリ'] = category;
      rule['決めた日'] = now().slice(0, 10);
      if (displayName !== undefined) rule['表示名'] = displayName.trim();
      store.update(SHEET.RULES, rule);
    } else {
      store.append(SHEET.RULES, [{ '利用先': merchant.trim(), 'カテゴリ': category, '決めた日': now().slice(0, 10), '表示名': (displayName || '').trim() }]);
    }
    let updated = 0;
    store.rows(SHEET.TX)
      .filter(r => r['状態'] !== '取消' && r['カテゴリの決め方'] !== '個別' && normalizeMerchant(r['利用先']) === key)
      .forEach(r => {
        r['カテゴリ'] = category;
        r['カテゴリの決め方'] = '対応表';
        store.update(SHEET.TX, r);
        updated++;
      });
    return { updated };
  },

  /** 1件だけの名前（メモ）。一覧で用途の横に出る。空にすると消える。手入力でもメールの利用でも付けられる。 */
  setMemo({ id, memo }, { store }) {
    const row = findTx(store, id);
    checkText(memo, 'memo', 100, true);
    row['メモ'] = (memo || '').trim();
    store.update(SHEET.TX, row);
    return { id };
  },

  /** 手入力の支出を足す（F-07）。 */
  addManual({ date, amount, category, memo }, { store, now, newId }) {
    checkDate(date);
    if (!Number.isInteger(amount) || amount < 1 || amount > 10000000) throw new UserError('amount は 1〜10,000,000 の整数にしてください');
    checkCategory(store, category, true);
    checkText(memo, 'memo', 200, true);
    const id = newId();
    store.append(SHEET.TX, [{
      'id': id, '種類': '支出', '利用日': date, '利用先': '', '金額': amount, '支払月': '',
      '状態': '手入力', 'カテゴリ': category || '', 'カテゴリの決め方': category ? '個別' : '未分類',
      '出どころ': '手入力', '対応する速報': '', 'メモ': memo || '', '取り込み日時': now(),
    }]);
    return { id };
  },

  /**
   * 手入力を消す。行そのものは消さずに状態を「取消」にする。
   * 行を消すと下の行の番号がずれて、同じ時間に動いている取り込み側が別の行に書いてしまうため。
   */
  deleteManual({ id }, { store }) {
    const row = findTx(store, id);
    if (row['出どころ'] !== '手入力') throw new UserError('消せるのは手入力だけです');
    row['状態'] = '取消';
    store.update(SHEET.TX, row);
    return { id };
  },

  /**
   * 確定にならない速報の始末（4.3 の5）。
   * linkTo なし：速報を取消にする（キャンセルだった）
   * linkTo あり：その確定の行と結びつけてから、速報を取消にする（確定で金額が変わった）
   */
  resolveSokuho({ id, linkTo }, { store }) {
    const row = findTx(store, id);
    if (row['状態'] !== '速報') throw new UserError('速報ではありません');
    if (linkTo !== undefined) {
      const target = findTx(store, linkTo);
      if (target['状態'] !== '確定' || target['対応する速報']) throw new UserError('結びつけられる確定の行ではありません');
      target['対応する速報'] = id;
      store.update(SHEET.TX, target);
    }
    row['状態'] = '取消';
    store.update(SHEET.TX, row);
    return { id };
  },

  setSetting({ key, value }, { store }) {
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(WRITABLE_SETTINGS, key)) throw new UserError('変えられない設定です');
    if (!WRITABLE_SETTINGS[key].includes(value)) throw new UserError(`${key} は ${WRITABLE_SETTINGS[key].join('／')} のどれかにしてください`);
    const row = store.rows(SHEET.SETTINGS).find(r => r['項目'] === key);
    if (row) { row['値'] = value; store.update(SHEET.SETTINGS, row); }
    else store.append(SHEET.SETTINGS, [{ '項目': key, '値': value }]);
    return { key, value };
  },
};

// ---- 小さな道具 ----

function toTransaction(r) {
  return {
    id: r['id'], type: r['種類'], date: r['利用日'], merchant: r['利用先'], amount: Number(r['金額']),
    payMonth: r['支払月'], status: r['状態'], category: r['カテゴリ'], categoryBy: r['カテゴリの決め方'],
    source: r['出どころ'], memo: r['メモ'],
  };
}

function findTx(store, id) {
  if (typeof id !== 'string' || !id) throw new UserError('id がありません');
  const row = store.rows(SHEET.TX).find(r => r['id'] === id && r['状態'] !== '取消');
  if (!row) throw new UserError('その id の行はありません');
  return row;
}

function checkCategory(store, category, allowEmpty) {
  if (allowEmpty && (category === '' || category === undefined)) return;
  if (typeof category !== 'string' || !store.rows(SHEET.CATEGORIES).some(r => r['カテゴリ'] === category)) {
    throw new UserError('知らないカテゴリです');
  }
}

function checkMonth(v, name) {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new UserError(`${name} は YYYY-MM にしてください`);
}

function checkDate(v) {
  const m = typeof v === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new UserError('date は YYYY-MM-DD にしてください');
}

/** 文字の長さと、表計算の式として読まれる書き出し（= + - @）を断る。 */
function checkText(v, name, maxLength, allowEmpty) {
  if (allowEmpty && (v === '' || v === undefined)) return;
  if (typeof v !== 'string' || !v.trim() || v.length > maxLength) throw new UserError(`${name} は ${maxLength} 文字までの文字にしてください`);
  if (/^[=+\-@]/.test(v.trim())) throw new UserError(`${name} を = + - @ で始めることはできません`);
}
