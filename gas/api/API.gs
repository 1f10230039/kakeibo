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
const ASSET_ITEMS = { bank: '楽天銀行', nisa: '楽天証券 NISA' }; // 資産の項目（10/6 本人「この2つ」）
const MAX_ASSET = 1000000000;
const MAX_ANNIVERSARIES = 30;
const POINT_PAYMENT = 'ポイント払い'; // 取引の状態：カードの請求をポイントで払った記録（10/7。web/js/calc.js と同じ）
const ANNIVERSARY_NAME_MAX = 8; // ホームの挨拶「今日は◯◯ですね」が14文字に収まるように（web/js/days.js と同じ）

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

/**
 * シートの読み書き。スプレッドシートは、合言葉が通ってから初めて開く。
 * あとから足したシート（記念日・10/7）は、まだなければ読むときは空、初めて書くときに作る（GAS ① の setup を動かし直さなくてよいように）。
 */
function sheetStore(openSpreadsheet) {
  let ss;
  const open = () => (ss = ss || openSpreadsheet());
  const sheet = name => open().getSheetByName(name);
  return {
    rows: name => { const sh = sheet(name); return sh ? readTable(sh) : []; },
    update: (name, row) => writeRows(sheet(name), row._row, [row]),
    append: (name, rows) => appendRows(sheet(name) || createSheet(open(), name), rows),
  };
}

function createSheet(ss, name) {
  const sh = ss.insertSheet(name);
  const header = HEADERS[name];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
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
    return deps.withLock(() => {
      const out = { ok: true, data: ACTIONS[req.action](params, deps) };
      // 書き込みのあとの新しいデータ（10/7）：fresh に getData と同じ期間を送ると、同じ返事に入れて返す。取り直しの通信が1回減る
      if (req.action !== 'getData' && req.fresh && typeof req.fresh === 'object') {
        try { out.fresh = ACTIONS.getData(req.fresh, deps); } catch (_) { /* 書き込みはできている。取り直しは PWA が別にする */ }
      }
      return out;
    });
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
      budgets: store.rows(SHEET.BUDGET)
        .filter(r => r['金額'] !== '' && Number(r['金額']) > 0) // 金額が空の行は「やめた予算」
        .map(r => ({ month: r['月'], target: r['対象'], amount: Number(r['金額']) })),
      assets: store.rows(SHEET.ASSETS)
        .filter(r => r['金額'] !== '' && r['金額'] !== undefined) // 金額が空の行は「やめた記録」。0 円は記録として残す
        .map(r => ({ date: r['記録日'], item: r['項目'], amount: Number(r['金額']), principal: r['元本'] === '' || r['元本'] === undefined ? null : Number(r['元本']) })),
      settings: {
        weekStart: settings['週の始まり'] || '月',
        lastIngest: settings['最終取り込み'] || '',
        unreadableMails: String(settings['読めなかったメール'] || '').split(',').filter(Boolean).length,
      },
      // 誕生日と記念日（10/7）。シートで手で直した行も読めるように、月日は「3/15」「2026-03-15」の形も受け取る。読めない行は出さない
      days: store.rows(SHEET.DAYS)
        .map(r => ({ kind: r['種類'], name: String(r['名前'] || '').trim(), md: toMonthDay(r['月日']) }))
        .filter(d => d.md && (d.kind === '誕生日' || (d.kind === '記念日' && d.name))),
    };
  },

  /** 1件だけカテゴリを変える（F-12）。空にすると未分類に戻る。 */
  setCategory({ id, category }, { store }) {
    const row = findTx(store, id);
    if (row['種類'] !== '支出') throw new UserError('カテゴリを付けられるのは支出だけです');
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
      .filter(r => r['種類'] === '支出' && r['状態'] !== '取消' && r['カテゴリの決め方'] !== '個別' && normalizeMerchant(r['利用先']) === key)
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

  /**
   * 利用の詳細の「保存」（10/7 本人：カテゴリ・「この店はいつもこの内容」・名前を、保存ボタンでまとめて1回で）。
   * always：対応表に入れ、同じ店の行にまとめて当てる（setRule）。この行が「個別」なら、この行も変える。
   *   名前は店の表示名にして、この行だけの名前は消す（消さないと、こちらが優先して出てしまう）。
   * always でない：この行だけ。カテゴリと名前の、変わったほうだけ書く。
   * 書く前に全部の形を確かめる（途中まで書いて失敗しないように）。
   */
  saveDetail({ id, category, name, always }, deps) {
    const row = findTx(deps.store, id);
    if (row['種類'] !== '支出') throw new UserError('カテゴリを付けられるのは支出だけです');
    checkText(name, 'name', 100, true);
    const memo = (name || '').trim();
    if (always) {
      if (!row['利用先']) throw new UserError('店名のない利用は「いつもこの内容」にできません');
      if (!category) throw new UserError('先にカテゴリを選んでください');
      checkCategory(deps.store, category, false);
      ACTIONS.setRule({ merchant: row['利用先'], category, displayName: memo }, deps);
      if (row['カテゴリの決め方'] === '個別' && row['カテゴリ'] !== category) ACTIONS.setCategory({ id, category }, deps);
      if (row['メモ']) ACTIONS.setMemo({ id, memo: '' }, deps);
    } else {
      checkCategory(deps.store, category, true);
      if ((category || '') !== (row['カテゴリ'] || '')) ACTIONS.setCategory({ id, category: category || '' }, deps);
      if (memo !== String(row['メモ'] || '')) ACTIONS.setMemo({ id, memo }, deps);
    }
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
   * 収入を手で足す（F-31）。楽天銀行の取引通知メールに金額が載るか分かるまでは手入力（10/6 本人）。
   * memo は名前（バイト代・お小遣いなど）。カテゴリは付けない。
   */
  addIncome({ date, amount, memo }, { store, now, newId }) {
    checkDate(date);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000000) throw new UserError('amount は 1〜100,000,000 の整数にしてください');
    checkText(memo, 'memo', 100, true);
    const id = newId();
    store.append(SHEET.TX, [{
      'id': id, '種類': '収入', '利用日': date, '利用先': '', '金額': amount, '支払月': '',
      '状態': '手入力', 'カテゴリ': '', 'カテゴリの決め方': '', '出どころ': '手入力', '対応する速報': '',
      'メモ': (memo || '').trim(), '取り込み日時': now(),
    }]);
    return { id };
  },

  /**
   * カードの請求をポイントで払った記録（10/7 本人。楽天カードの「ポイントで支払いサービス」）。`{ date, amount }`
   * 種類＝収入（名前「ポイント」）・状態＝ポイント払い・支払月＝使った日の月（その月の27日の請求から引かれる。受付は毎月12日〜24日ごろ）。
   * 支出はそのまま。引き落とし予定から引くのは PWA の計算（calc.js）。消すときは手入力と同じ deleteManual。
   * お店や通信料で使ったポイントは記録しない（カードには残りだけ請求されるので、支出はもう合っている）。
   */
  addPointPayment({ date, amount }, { store, now, newId }) {
    checkDate(date);
    if (!Number.isInteger(amount) || amount < 1 || amount > 10000000) throw new UserError('amount は 1〜10,000,000 の整数にしてください');
    const id = newId();
    store.append(SHEET.TX, [{
      'id': id, '種類': '収入', '利用日': date, '利用先': '', '金額': amount, '支払月': date.slice(0, 7),
      '状態': POINT_PAYMENT, 'カテゴリ': '', 'カテゴリの決め方': '', '出どころ': '手入力', '対応する速報': '',
      'メモ': 'ポイント', '取り込み日時': now(),
    }]);
    return { id };
  },

  /**
   * 手入力を消す。行そのものは消さずに状態を「取消」にする。
   * 行を消すと下の行の番号がずれて、同じ時間に動いている取り込み側が別の行に書いてしまうため。
   * 積立の設定から埋めた月（出どころ＝楽天証券・状態＝設定から）も消せる（10/7：メールで確かめていない、たぶん払った記録なので）。
   */
  deleteManual({ id }, { store }) {
    const row = findTx(store, id);
    const fromSetting = row['出どころ'] === '楽天証券' && row['状態'] === '設定から';
    if (row['出どころ'] !== '手入力' && !fromSetting) throw new UserError('消せるのは、手入力と、積立の設定から入れた記録だけです');
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

  /**
   * e-NAVI の CSV との照合の結果を反映する（F-08, F-09・S-09）。照らし合わせは PWA の中で行い、本人がチェックしたものだけが届く。
   * add：CSV にだけあった利用（確定分）。出どころ＝CSV・状態＝確定で足し、対応表があればカテゴリを付ける
   * cancel：メールにだけあった利用（キャンセルかもしれない）の id。状態を「取消」にする（行は消さない）
   * 先にぜんぶ確かめてから書く（1件でも形が違えば、何も書かない）。
   */
  importCsv({ add, cancel }, { store, now, newId }) {
    if (!Array.isArray(add) || !Array.isArray(cancel)) throw new UserError('add と cancel は配列にしてください');
    if (add.length > 500 || cancel.length > 200) throw new UserError('一度に送れるのは、足す500件・取り消す200件までです');
    add.forEach((a, i) => {
      if (!a || typeof a !== 'object') throw new UserError(`add[${i}] の形が違います`);
      checkDate(a.date);
      checkText(a.merchant, `add[${i}].merchant`, 100, false);
      if (!Number.isInteger(a.amount) || a.amount < 1 || a.amount > 10000000) throw new UserError(`add[${i}].amount は 1〜10,000,000 の整数にしてください`);
      checkMonth(a.payMonth, `add[${i}].payMonth`);
    });
    const targets = cancel.map(id => {
      const row = findTx(store, id);
      if (row['種類'] !== '支出' || !['メール', 'CSV'].includes(row['出どころ']) || !['確定', '速報'].includes(row['状態'])) {
        throw new UserError('取り消せるのは、メールか CSV から入った支出だけです');
      }
      return row;
    });

    const ruleMap = buildRuleMap(store.rows(SHEET.RULES));
    const batch = newId().replace(/^h_/, '');
    store.append(SHEET.TX, add.map((a, i) => {
      const category = ruleMap[normalizeMerchant(a.merchant)] || '';
      return {
        'id': `c_${batch}_${i + 1}`, '種類': '支出', '利用日': a.date, '利用先': a.merchant.trim(), '金額': a.amount, '支払月': a.payMonth,
        '状態': '確定', 'カテゴリ': category, 'カテゴリの決め方': category ? '対応表' : '未分類',
        '出どころ': 'CSV', '対応する速報': '', 'メモ': '', '取り込み日時': now(),
      };
    }));
    targets.forEach(row => { row['状態'] = '取消'; store.update(SHEET.TX, row); });
    return { added: add.length, cancelled: targets.length };
  },

  /**
   * 予算（F-21）。いまは全体の予算だけ（U-02 → 10/6 本人「全体だけ」）。
   * month：'' なら毎月の予算、'YYYY-MM' ならその月だけの予算（毎月の予算より優先）。
   * amount：1〜10,000,000 の整数。null なら、その予算をやめる（行は消さずに金額を空にする。行の番号をずらさないため）。
   */
  setBudget({ month, amount }, { store }) {
    if (month !== '') checkMonth(month, 'month');
    if (amount !== null && (!Number.isInteger(amount) || amount < 1 || amount > 10000000)) {
      throw new UserError('amount は 1〜10,000,000 の整数か、null（やめる）にしてください');
    }
    const row = store.rows(SHEET.BUDGET).find(r => r['月'] === month && r['対象'] === '全体');
    if (row) { row['金額'] = amount === null ? '' : amount; store.update(SHEET.BUDGET, row); }
    else if (amount !== null) store.append(SHEET.BUDGET, [{ '月': month, '対象': '全体', '金額': amount }]);
    return { month, amount };
  },

  /**
   * 資産の記録（F-33）。月1回、本人が楽天銀行の残高と、楽天証券 NISA の評価額・元本（積み立てた額）を写す。
   * 同じ記録日・項目の行があれば書き換え、なければ足す。null の項目は、その日の行をやめる（金額を空に。行は消さない）。
   * 3つとも null なら、その日の記録をやめることになる。
   */
  setAssetRecord({ date, bank, nisa, nisaPrincipal }, { store }) {
    checkDate(date);
    for (const [name, v] of [['bank', bank], ['nisa', nisa], ['nisaPrincipal', nisaPrincipal]]) {
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > MAX_ASSET)) throw new UserError(`${name} は 0〜1,000,000,000 の整数か、null にしてください`);
    }
    if (nisa === null && nisaPrincipal !== null) throw new UserError('nisaPrincipal は nisa と一緒に入れてください');
    const rows = store.rows(SHEET.ASSETS);
    const put = (item, amount, principal) => {
      const row = rows.find(r => r['記録日'] === date && r['項目'] === item);
      const values = { '金額': amount === null ? '' : amount, '元本': principal === null ? '' : principal };
      if (row) store.update(SHEET.ASSETS, Object.assign(row, values));
      else if (amount !== null) store.append(SHEET.ASSETS, [Object.assign({ '記録日': date, '項目': item }, values)]);
    };
    put(ASSET_ITEMS.bank, bank, null);
    put(ASSET_ITEMS.nisa, nisa, nisaPrincipal);
    return { date };
  },

  setSetting({ key, value }, { store }) {
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(WRITABLE_SETTINGS, key)) throw new UserError('変えられない設定です');
    if (!WRITABLE_SETTINGS[key].includes(value)) throw new UserError(`${key} は ${WRITABLE_SETTINGS[key].join('／')} のどれかにしてください`);
    const row = store.rows(SHEET.SETTINGS).find(r => r['項目'] === key);
    if (row) { row['値'] = value; store.update(SHEET.SETTINGS, row); }
    else store.append(SHEET.SETTINGS, [{ '項目': key, '値': value }]);
    return { key, value };
  },

  /**
   * 誕生日と記念日を、まとめて入れ替える（10/7。ホームの挨拶と写真に使う）。
   * birthday：'MM-DD'（'' ならなし）。anniversaries：[{ name（8文字まで）, md: 'MM-DD' }]（30件まで）。
   * 前の行は上から書き直し、余った行は空にする（空の行は読まない。シートの行を消す手続きはないので）。
   */
  setDays({ birthday, anniversaries }, { store }) {
    if (birthday !== '') checkMonthDay(birthday, 'birthday');
    if (!Array.isArray(anniversaries) || anniversaries.length > MAX_ANNIVERSARIES) throw new UserError(`記念日は ${MAX_ANNIVERSARIES} 件までです`);
    anniversaries.forEach(a => {
      if (!a || typeof a !== 'object') throw new UserError('記念日の形がおかしいです');
      checkText(a.name, '記念日の名前', ANNIVERSARY_NAME_MAX, false);
      checkMonthDay(a.md, '記念日の日付');
    });
    const want = [
      ...(birthday ? [{ '種類': '誕生日', '名前': '誕生日', '月日': birthday }] : []),
      ...anniversaries.map(a => ({ '種類': '記念日', '名前': a.name.trim(), '月日': a.md })),
    ];
    const rows = store.rows(SHEET.DAYS);
    const blank = { '種類': '', '名前': '', '月日': '' };
    rows.forEach((row, i) => {
      const next = want[i] || blank;
      if (Object.keys(next).some(k => String(row[k]) !== next[k])) store.update(SHEET.DAYS, Object.assign(row, next));
    });
    if (want.length > rows.length) store.append(SHEET.DAYS, want.slice(rows.length));
    return { birthday, anniversaries: anniversaries.map(a => ({ name: a.name.trim(), md: a.md })) };
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

/** 'MM-DD'（年なし）か。2/29 はよい（誕生日がうるう日の人がいる）。 */
function checkMonthDay(v, name) {
  const m = typeof v === 'string' && /^(\d{2})-(\d{2})$/.exec(v);
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > days[+m[1] - 1]) throw new UserError(`${name} は MM-DD にしてください`);
}

/** シートの月日を 'MM-DD' に。「3/15」「03-15」「2026-03-15」を受け取る。読めなければ ''。 */
function toMonthDay(v) {
  const m = /^(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/.exec(String(v || '').trim());
  if (!m) return '';
  const md = `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  try { checkMonthDay(md, ''); return md; } catch (_) { return ''; }
}

/** 文字の長さと、表計算の式として読まれる書き出し（= + - @）を断る。 */
function checkText(v, name, maxLength, allowEmpty) {
  if (allowEmpty && (v === '' || v === undefined)) return;
  if (typeof v !== 'string' || !v.trim() || v.length > maxLength) throw new UserError(`${name} は ${maxLength} 文字までの文字にしてください`);
  if (/^[=+\-@]/.test(v.trim())) throw new UserError(`${name} を = + - @ で始めることはできません`);
}
