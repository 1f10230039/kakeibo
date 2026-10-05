// GAS ②（API）の手続きを Node.js で確かめる。シートの代わりにメモリ上の表を使う。
// 実行：node gas/test/test_api.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');

const gasDir = path.join(__dirname, '..');
const ctx = vm.createContext({ console: { log() {}, error() {} } }); // API の中の console.error は黙らせる
for (const f of ['共通.gs', 'api/API.gs']) {
  vm.runInContext(fs.readFileSync(path.join(gasDir, f), 'utf8'), ctx, { filename: f });
}
const g = name => vm.runInContext(name, ctx);
const plain = v => JSON.parse(JSON.stringify(v));

const KEY = 'k'.repeat(40) + '0123456789abcdef0123';
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** メモリ上のシート。rows() は読むたびにコピーを返す（本物の readTable と同じく、書き戻すまで変わらない）。 */
function memoryStore(tables) {
  const t = JSON.parse(JSON.stringify(tables));
  Object.values(t).forEach(rows => rows.forEach((r, i) => { r._row = i + 2; }));
  return {
    tables: t,
    rows: name => JSON.parse(JSON.stringify(t[name] || [])),
    update: (name, row) => { t[name][row._row - 2] = JSON.parse(JSON.stringify(row)); },
    append: (name, rows) => rows.forEach(r => { t[name] = t[name] || []; t[name].push({ ...r, _row: t[name].length + 2 }); }),
  };
}

function baseTables() {
  return {
    '取引': [
      { 'id': 'm_K1_1', '種類': '支出', '利用日': '2026-01-10', '利用先': 'APPLE COM BILL', '金額': 1234, '支払月': '2026-02', '状態': '確定', 'カテゴリ': '', 'カテゴリの決め方': '未分類', '出どころ': 'メール', '対応する速報': '' },
      { 'id': 'm_K1_2', '種類': '支出', '利用日': '2026-01-11', '利用先': 'apple com bill', '金額': 980, '支払月': '2026-02', '状態': '確定', 'カテゴリ': '趣味・娯楽', 'カテゴリの決め方': '個別', '出どころ': 'メール', '対応する速報': '' },
      { 'id': 'm_S1_1', '種類': '支出', '利用日': '2026-02-01', '利用先': '', '金額': 1500, '支払月': '2026-03', '状態': '速報', 'カテゴリ': '', 'カテゴリの決め方': '未分類', '出どころ': 'メール', '対応する速報': '' },
      { 'id': 'h_old', '種類': '支出', '利用日': '2026-02-02', '利用先': '', '金額': 300, '支払月': '', '状態': '取消', 'カテゴリ': '食費', 'カテゴリの決め方': '個別', '出どころ': '手入力', '対応する速報': '' },
    ],
    '対応表': [],
    'カテゴリ': [['食費', '暮らし', 1], ['サブスク', '固定費', 5], ['趣味・娯楽', 'たのしみ', 7]].map(([c, gr, o]) => ({ 'カテゴリ': c, 'グループ': gr, '並び順': o })),
    '予算': [], '資産': [],
    '設定': [{ '項目': '週の始まり', '値': '月' }, { '項目': '最終取り込み', '値': '2026-10-06 06:12' }, { '項目': '読めなかったメール', '値': '' }],
  };
}

function setup(storeOverride) {
  const cache = new Map();
  const store = storeOverride || memoryStore(baseTables());
  const deps = {
    store,
    auth: g('makeAuth')({ getProperty: () => sha(KEY) }, { get: k => cache.get(k), put: (k, v) => cache.set(k, v) }, sha),
    withLock: fn => fn(),
    now: () => '2026-10-06 21:00',
    newId: () => 'h_new',
  };
  const call = obj => plain(g('handleRequest')(typeof obj === 'string' ? obj : JSON.stringify(obj), deps));
  return { call, store, cache };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---- 合言葉 ----
test('合言葉なし → { ok: false } だけ', () => {
  const { call } = setup();
  assert.deepStrictEqual(call({ action: 'getData', params: { from: '2026-09', to: '2026-10' } }), { ok: false });
});
test('間違った合言葉 → 同じ { ok: false } だけ', () => {
  const { call } = setup();
  assert.deepStrictEqual(call({ key: 'x'.repeat(64), action: 'getData', params: { from: '2026-09', to: '2026-10' } }), { ok: false });
});
test('短すぎる合言葉・文字でない合言葉 → { ok: false }', () => {
  const { call } = setup();
  assert.deepStrictEqual(call({ key: 'short', action: 'getData' }), { ok: false });
  assert.deepStrictEqual(call({ key: ['a'.repeat(64)], action: 'getData' }), { ok: false });
});
test('壊れた本文・JSON でない本文 → { ok: false }', () => {
  const { call } = setup();
  assert.deepStrictEqual(call('{not json'), { ok: false });
  assert.deepStrictEqual(call('null'), { ok: false });
  assert.deepStrictEqual(call(''), { ok: false });
});
test('10回間違えたら、正しい合言葉でも断る', () => {
  const { call } = setup();
  for (let i = 0; i < 10; i++) call({ key: 'x'.repeat(64), action: 'getData' });
  assert.deepStrictEqual(call({ key: KEY, action: 'getData', params: { from: '2026-09', to: '2026-10' } }), { ok: false });
});
test('9回の間違いなら、正しい合言葉は通る', () => {
  const { call } = setup();
  for (let i = 0; i < 9; i++) call({ key: 'x'.repeat(64), action: 'getData' });
  assert.strictEqual(call({ key: KEY, action: 'getData', params: { from: '2026-09', to: '2026-10' } }).ok, true);
});

// ---- action の名前 ----
test('知らない action・Object の持ち物の名前（__proto__ など）は断る', () => {
  const { call } = setup();
  for (const action of ['nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 123]) {
    const res = call({ key: KEY, action });
    assert.strictEqual(res.ok, false, String(action));
    assert.strictEqual(res.error, '知らない action です');
  }
});

// ---- getData ----
test('getData：期間の中で、取消を除いた取引と設定を返す', () => {
  const { call } = setup();
  const res = call({ key: KEY, action: 'getData', params: { from: '2026-02', to: '2026-02' } });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.data.transactions.map(t => t.id), ['m_S1_1']); // h_old は取消、1月分は期間外
  assert.deepStrictEqual(res.data.settings, { weekStart: '月', lastIngest: '2026-10-06 06:12', unreadableMails: 0 });
  assert.deepStrictEqual(res.data.categories.map(c => c.name), ['食費', 'サブスク', '趣味・娯楽']);
});
test('getData：月の形が違えば断る', () => {
  const { call } = setup();
  assert.strictEqual(call({ key: KEY, action: 'getData', params: { from: '2026-13', to: '2026-10' } }).ok, false);
  assert.strictEqual(call({ key: KEY, action: 'getData', params: {} }).ok, false);
});

// ---- カテゴリ ----
test('setCategory：1件だけ変えて「個別」にする。知らないカテゴリは断る', () => {
  const { call, store } = setup();
  assert.strictEqual(call({ key: KEY, action: 'setCategory', params: { id: 'm_K1_1', category: 'サブスク' } }).ok, true);
  assert.strictEqual(store.tables['取引'][0]['カテゴリ'], 'サブスク');
  assert.strictEqual(store.tables['取引'][0]['カテゴリの決め方'], '個別');
  assert.strictEqual(call({ key: KEY, action: 'setCategory', params: { id: 'm_K1_1', category: 'ないカテゴリ' } }).ok, false);
  assert.strictEqual(call({ key: KEY, action: 'setCategory', params: { id: 'm_nope', category: '食費' } }).ok, false);
});
test('setRule：対応表に足し、同じ利用先の「個別」以外の行にまとめて当てる', () => {
  const { call, store } = setup();
  const res = call({ key: KEY, action: 'setRule', params: { merchant: 'APPLE COM BILL', category: 'サブスク' } });
  assert.deepStrictEqual(res, { ok: true, data: { updated: 1 } });
  assert.strictEqual(store.tables['取引'][0]['カテゴリ'], 'サブスク');
  assert.strictEqual(store.tables['取引'][1]['カテゴリ'], '趣味・娯楽'); // 個別は変えない
  assert.strictEqual(store.tables['対応表'].length, 1);
  // 2回目は足さずに書き換える（表記ゆれも同じ店として扱う）
  call({ key: KEY, action: 'setRule', params: { merchant: ' apple  com bill ', category: '食費' } });
  assert.strictEqual(store.tables['対応表'].length, 1);
  assert.strictEqual(store.tables['対応表'][0]['カテゴリ'], '食費');
});

// ---- 手入力 ----
test('addManual：足す。金額・日付・メモの形が違えば断る', () => {
  const { call, store } = setup();
  assert.strictEqual(call({ key: KEY, action: 'addManual', params: { date: '2026-10-06', amount: 450, category: '食費', memo: 'コンビニ' } }).ok, true);
  const row = store.tables['取引'].at(-1);
  assert.deepStrictEqual([row['id'], row['金額'], row['状態'], row['出どころ'], row['カテゴリの決め方']], ['h_new', 450, '手入力', '手入力', '個別']);
  const bad = params => call({ key: KEY, action: 'addManual', params }).ok;
  assert.strictEqual(bad({ date: '2026-10-06', amount: '450' }), false);
  assert.strictEqual(bad({ date: '2026-10-06', amount: 0 }), false);
  assert.strictEqual(bad({ date: '2026-10-06', amount: 1.5 }), false);
  assert.strictEqual(bad({ date: '2026-02-30', amount: 100 }), false);
  assert.strictEqual(bad({ date: '2026/10/06', amount: 100 }), false);
  assert.strictEqual(bad({ date: '2026-10-06', amount: 100, memo: '=IMPORTXML("http://x","//a")' }), false);
  assert.strictEqual(bad({ date: '2026-10-06', amount: 100, memo: 'あ'.repeat(201) }), false);
});
test('deleteManual：手入力だけ「取消」にできる（行は消さない）', () => {
  const { call, store } = setup();
  call({ key: KEY, action: 'addManual', params: { date: '2026-10-06', amount: 450 } });
  const before = store.tables['取引'].length;
  assert.strictEqual(call({ key: KEY, action: 'deleteManual', params: { id: 'h_new' } }).ok, true);
  assert.strictEqual(store.tables['取引'].length, before);
  assert.strictEqual(store.tables['取引'].at(-1)['状態'], '取消');
  assert.strictEqual(call({ key: KEY, action: 'deleteManual', params: { id: 'm_K1_1' } }).ok, false);
});

// ---- 速報の始末 ----
test('resolveSokuho：取消にする／確定の行と結びつける', () => {
  let { call, store } = setup();
  assert.strictEqual(call({ key: KEY, action: 'resolveSokuho', params: { id: 'm_S1_1' } }).ok, true);
  assert.strictEqual(store.tables['取引'][2]['状態'], '取消');

  ({ call, store } = setup());
  assert.strictEqual(call({ key: KEY, action: 'resolveSokuho', params: { id: 'm_S1_1', linkTo: 'm_K1_1' } }).ok, true);
  assert.strictEqual(store.tables['取引'][0]['対応する速報'], 'm_S1_1');
  assert.strictEqual(store.tables['取引'][2]['状態'], '取消');
  assert.strictEqual(call({ key: KEY, action: 'resolveSokuho', params: { id: 'm_K1_1' } }).ok, false); // 確定は対象外
});

// ---- 設定 ----
test('setSetting：週の始まりだけ、月／日だけ', () => {
  const { call, store } = setup();
  assert.strictEqual(call({ key: KEY, action: 'setSetting', params: { key: '週の始まり', value: '日' } }).ok, true);
  assert.strictEqual(store.tables['設定'][0]['値'], '日');
  assert.strictEqual(call({ key: KEY, action: 'setSetting', params: { key: '週の始まり', value: '火' } }).ok, false);
  assert.strictEqual(call({ key: KEY, action: 'setSetting', params: { key: '最終取り込み', value: 'x' } }).ok, false);
  assert.strictEqual(call({ key: KEY, action: 'setSetting', params: { key: '__proto__', value: 'x' } }).ok, false);
});

// ---- 中の失敗 ----
test('シートの読み書きで失敗しても、中身を漏らさず決まった文だけ返す', () => {
  const broken = { rows() { throw new Error('秘密のパス /x/y'); }, update() {}, append() {} };
  const { call } = setup(broken);
  assert.deepStrictEqual(call({ key: KEY, action: 'getData', params: { from: '2026-09', to: '2026-10' } }), { ok: false, error: 'サーバーの中で失敗しました' });
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  NG  ' + name + '\n      ' + e.message.split('\n').join('\n      ')); }
}
console.log(`\n${tests.length - failed} / ${tests.length} 通過`);
process.exit(failed ? 1 : 0);
