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
    // 本物の readTable と同じく、全部の欄が空の行は読まない
    rows: name => JSON.parse(JSON.stringify((t[name] || []).filter(r => Object.keys(r).some(k => k !== '_row' && r[k] !== '' && r[k] !== undefined)))),
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

test('setRule：表示名を付ける。送らなければ前の表示名のまま', () => {
  const { call, store } = setup();
  call({ key: KEY, action: 'setRule', params: { merchant: 'APPLE COM BILL', category: 'サブスク', displayName: 'YouTube Premium' } });
  assert.strictEqual(store.tables['対応表'][0]['表示名'], 'YouTube Premium');
  call({ key: KEY, action: 'setRule', params: { merchant: 'APPLE COM BILL', category: '趣味・娯楽' } });
  assert.strictEqual(store.tables['対応表'][0]['表示名'], 'YouTube Premium');
  assert.strictEqual(store.tables['対応表'][0]['カテゴリ'], '趣味・娯楽');
  const data = call({ key: KEY, action: 'getData', params: { from: '2026-01', to: '2026-12' } }).data;
  assert.deepStrictEqual(data.rules, [{ merchant: 'APPLE COM BILL', category: '趣味・娯楽', displayName: 'YouTube Premium' }]);
  assert.strictEqual(call({ key: KEY, action: 'setRule', params: { merchant: 'X', category: '食費', displayName: '=CMD()' } }).ok, false);
});

test('setMemo：1件だけの名前を付ける・消す。式の書き出しは断る', () => {
  const { call, store } = setup();
  assert.strictEqual(call({ key: KEY, action: 'setMemo', params: { id: 'm_K1_1', memo: ' YouTube Premium ' } }).ok, true);
  assert.strictEqual(store.tables['取引'][0]['メモ'], 'YouTube Premium');
  call({ key: KEY, action: 'setMemo', params: { id: 'm_K1_1', memo: '' } });
  assert.strictEqual(store.tables['取引'][0]['メモ'], '');
  assert.strictEqual(call({ key: KEY, action: 'setMemo', params: { id: 'm_K1_1', memo: '@x' } }).ok, false);
  assert.strictEqual(call({ key: KEY, action: 'setMemo', params: { id: 'h_old', memo: 'x' } }).ok, false); // 取消の行は対象外
});

test('saveDetail：いつもこの内容でない → この行だけ、カテゴリと名前を1回で（変わったほうだけ）', () => {
  const { call, store } = setup();
  assert.deepStrictEqual(call({ key: KEY, action: 'saveDetail', params: { id: 'm_K1_1', category: '食費', name: ' おやつ ', always: false } }), { ok: true, data: { id: 'm_K1_1' } });
  const r = store.tables['取引'][0];
  assert.deepStrictEqual([r['カテゴリ'], r['カテゴリの決め方'], r['メモ']], ['食費', '個別', 'おやつ']);
  assert.strictEqual(store.tables['対応表'].length, 0); // 対応表には入れない
  // 名前だけ変える：カテゴリは書き直さない
  store.tables['取引'][1]['メモ'] = '前の名前';
  call({ key: KEY, action: 'saveDetail', params: { id: 'm_K1_2', category: '趣味・娯楽', name: '', always: false } });
  assert.deepStrictEqual([store.tables['取引'][1]['カテゴリ'], store.tables['取引'][1]['メモ']], ['趣味・娯楽', '']);
});

test('saveDetail：変わっていないほうは書かない（シートへの書き込みの回数＝速さ）', () => {
  const store = memoryStore(baseTables());
  let writes = 0;
  const update = store.update;
  store.update = (name, row) => { writes++; update(name, row); };
  const { call } = setup(store);
  call({ key: KEY, action: 'saveDetail', params: { id: 'm_K1_1', category: '食費', name: '', always: false } }); // カテゴリだけ
  assert.strictEqual(writes, 1);
  writes = 0;
  call({ key: KEY, action: 'saveDetail', params: { id: 'm_K1_1', category: '食費', name: 'おやつ', always: false } }); // 名前だけ
  assert.strictEqual(writes, 1);
  writes = 0;
  call({ key: KEY, action: 'saveDetail', params: { id: 'm_K1_1', category: '食費', name: 'おやつ', always: false } }); // 何も変わらない
  assert.strictEqual(writes, 0);
});

test('saveDetail：いつもこの内容 → 対応表（表示名つき）に入れて同じ店へ。個別の行は、開いた行だけ変える。この行だけの名前は消す', () => {
  const { call, store } = setup();
  store.tables['取引'][1]['メモ'] = 'この行だけの名前';
  assert.strictEqual(call({ key: KEY, action: 'saveDetail', params: { id: 'm_K1_2', category: 'サブスク', name: 'iCloud', always: true } }).ok, true);
  assert.deepStrictEqual(plain(store.tables['対応表']).map(r => [r['利用先'], r['カテゴリ'], r['表示名']]), [['apple com bill', 'サブスク', 'iCloud']]);
  assert.deepStrictEqual(store.tables['取引'].slice(0, 2).map(r => [r['カテゴリ'], r['カテゴリの決め方'], r['メモ'] || '']),
    [['サブスク', '対応表', ''], ['サブスク', '個別', '']]);
});

test('saveDetail：形が違えば何も書かない（カテゴリなし・店名なし・式の書き出し・知らないカテゴリ・収入・取消）', () => {
  const { call, store } = setup();
  call({ key: KEY, action: 'addIncome', params: { date: '2026-10-05', amount: 5000, memo: 'お小遣い' } });
  const before = JSON.stringify(store.tables);
  for (const params of [
    { id: 'm_K1_1', category: '', name: 'x', always: true },
    { id: 'm_S1_1', category: '食費', name: '', always: true },
    { id: 'm_K1_1', category: 'サブスク', name: '=CMD()', always: true },
    { id: 'm_K1_1', category: 'サブスク', name: '@x', always: false },
    { id: 'm_K1_1', category: 'ない', name: '', always: true },
    { id: 'm_K1_1', category: 'ない', name: 'x', always: false },
    { id: 'h_new', category: '食費', name: '', always: false },
    { id: 'h_old', category: '食費', name: '', always: false },
  ]) assert.strictEqual(call({ key: KEY, action: 'saveDetail', params }).ok, false, JSON.stringify(params));
  assert.strictEqual(JSON.stringify(store.tables), before);
});

test('fresh：書き込みの返事に、書いたあとの getData を入れる。getData には付けない。期間が違っても書き込みは成功', () => {
  const { call } = setup();
  const fresh = { from: '2026-01', to: '2026-12' };
  const res = call({ key: KEY, action: 'setMemo', params: { id: 'm_K1_1', memo: 'あたらしい' }, fresh });
  assert.deepStrictEqual(res.data, { id: 'm_K1_1' });
  assert.strictEqual(res.fresh.transactions.find(t => t.id === 'm_K1_1').memo, 'あたらしい');
  assert.deepStrictEqual(Object.keys(res.fresh).sort(), ['assets', 'budgets', 'categories', 'days', 'rules', 'settings', 'transactions']);
  assert.strictEqual('fresh' in call({ key: KEY, action: 'getData', params: fresh, fresh }), false);
  const bad = call({ key: KEY, action: 'setMemo', params: { id: 'm_K1_1', memo: 'つぎ' }, fresh: { from: 'x', to: 'y' } });
  assert.deepStrictEqual([bad.ok, 'fresh' in bad], [true, false]);
  assert.strictEqual('fresh' in call({ key: KEY, action: 'setMemo', params: { id: 'm_K1_1', memo: 'x' } }), false); // 送らなければ今までどおり
  assert.strictEqual(call({ key: KEY, action: 'setMemo', params: { id: 'ない', memo: 'x' }, fresh }).ok, false); // 失敗したときは付けない
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

test('deleteManual：積立の設定から入れた月は消せる。メールで確かめた積立は消せない', () => {
  const t = baseTables();
  const nisa = (id, status) => ({ 'id': id, '種類': '支出', '利用日': '2026-05-01', '利用先': 'FUND', '金額': 10000, '支払月': '', '状態': status, 'カテゴリ': '', 'カテゴリの決め方': '未分類', '出どころ': '楽天証券', '対応する速報': '' });
  t['取引'].push(nisa('s_SET_202605', '設定から'), nisa('m_N1_1', '確定'));
  const { call, store } = setup(memoryStore(t));
  assert.strictEqual(call({ key: KEY, action: 'deleteManual', params: { id: 's_SET_202605' } }).ok, true);
  assert.strictEqual(store.tables['取引'].find(r => r['id'] === 's_SET_202605')['状態'], '取消');
  assert.strictEqual(call({ key: KEY, action: 'deleteManual', params: { id: 'm_N1_1' } }).ok, false);
  assert.strictEqual(store.tables['取引'].find(r => r['id'] === 'm_N1_1')['状態'], '確定');
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

// ---- 予算 ----
test('setBudget：毎月の予算と、その月だけの予算を足す・変える。getData で返る', () => {
  const { call, store } = setup();
  assert.strictEqual(call({ key: KEY, action: 'setBudget', params: { month: '', amount: 50000 } }).ok, true);
  assert.strictEqual(call({ key: KEY, action: 'setBudget', params: { month: '2026-10', amount: 60000 } }).ok, true);
  assert.strictEqual(call({ key: KEY, action: 'setBudget', params: { month: '', amount: 45000 } }).ok, true); // 変える（行は増やさない）
  assert.strictEqual(store.tables['予算'].length, 2);
  const data = call({ key: KEY, action: 'getData', params: { from: '2026-01', to: '2026-12' } }).data;
  assert.deepStrictEqual(data.budgets, [{ month: '', target: '全体', amount: 45000 }, { month: '2026-10', target: '全体', amount: 60000 }]);
});
test('setBudget：null でやめる（行は残して金額を空に）。やめた予算は getData に出ない', () => {
  const { call, store } = setup();
  call({ key: KEY, action: 'setBudget', params: { month: '2026-10', amount: 60000 } });
  assert.strictEqual(call({ key: KEY, action: 'setBudget', params: { month: '2026-10', amount: null } }).ok, true);
  assert.strictEqual(store.tables['予算'].length, 1);
  assert.strictEqual(store.tables['予算'][0]['金額'], '');
  assert.strictEqual(call({ key: KEY, action: 'setBudget', params: { month: '2026-11', amount: null } }).ok, true); // ない予算をやめても行は足さない
  assert.strictEqual(store.tables['予算'].length, 1);
  assert.deepStrictEqual(call({ key: KEY, action: 'getData', params: { from: '2026-01', to: '2026-12' } }).data.budgets, []);
});
test('setBudget：月・金額の形が違えば断る', () => {
  const { call, store } = setup();
  for (const params of [{ month: '2026-13', amount: 1000 }, { month: '10月', amount: 1000 }, { amount: 1000 }, { month: '', amount: 0 }, { month: '', amount: 1.5 },
    { month: '', amount: '50000' }, { month: '', amount: 10000001 }, { month: '' }]) {
    assert.strictEqual(call({ key: KEY, action: 'setBudget', params }).ok, false, JSON.stringify(params));
  }
  assert.strictEqual(store.tables['予算'].length, 0);
});

// ---- CSV の照合（S-09） ----
test('importCsv：CSV にだけあった利用を確定で足し（対応表のカテゴリつき）、選んだものを取り消す', () => {
  const { call, store } = setup();
  call({ key: KEY, action: 'setRule', params: { merchant: 'NETFLIX.COM', category: 'サブスク' } });
  const r = call({ key: KEY, action: 'importCsv', params: {
    add: [{ date: '2026-09-18', merchant: 'NETFLIX.COM', amount: 1590, payMonth: '2026-10' }, { date: '2026-09-11', merchant: '楽天モバイル通信料', amount: 14, payMonth: '2026-10' }],
    cancel: ['m_K1_1'],
  } });
  assert.deepStrictEqual(r, { ok: true, data: { added: 2, cancelled: 1 } });
  const added = store.tables['取引'].filter(x => x['出どころ'] === 'CSV');
  assert.deepStrictEqual(added.map(x => [x.id, x['状態'], x['カテゴリ'], x['カテゴリの決め方'], x['支払月']]),
    [['c_new_1', '確定', 'サブスク', '対応表', '2026-10'], ['c_new_2', '確定', '', '未分類', '2026-10']]);
  assert.strictEqual(store.tables['取引'].find(x => x.id === 'm_K1_1')['状態'], '取消');
});
test('importCsv：1件でも形が違えば何も書かない。取り消せるのはメール／CSV の支出だけ', () => {
  const { call, store } = setup();
  const before = JSON.stringify(store.tables['取引']);
  const good = { date: '2026-09-18', merchant: 'NETFLIX.COM', amount: 1590, payMonth: '2026-10' };
  for (const params of [
    { add: [good, { ...good, amount: 0 }], cancel: [] }, { add: [good, { ...good, merchant: '=HYPERLINK("x")' }], cancel: [] },
    { add: [{ ...good, date: '2026-02-30' }], cancel: [] }, { add: [{ ...good, payMonth: '2026/10' }], cancel: [] },
    { add: [good], cancel: ['h_old'] }, { add: [good], cancel: ['nope'] }, { add: good, cancel: [] }, { add: [] },
    { add: Array(501).fill(good), cancel: [] },
  ]) assert.strictEqual(call({ key: KEY, action: 'importCsv', params }).ok, false, JSON.stringify(params).slice(0, 80));
  call({ key: KEY, action: 'addManual', params: { date: '2026-10-01', amount: 300 } });
  assert.strictEqual(call({ key: KEY, action: 'importCsv', params: { add: [], cancel: ['h_new'] } }).ok, false); // 手入力は deleteManual で
  store.tables['取引'].at(-1)['状態'] = '確定'; // 状態が確定でも、出どころが手入力なら断る
  assert.strictEqual(call({ key: KEY, action: 'importCsv', params: { add: [], cancel: ['h_new'] } }).ok, false);
  store.tables['取引'].at(-1)['状態'] = '手入力';
  assert.strictEqual(JSON.stringify(store.tables['取引'].slice(0, -1)), before);
});

// ---- 収入 ----
test('addIncome：種類＝収入・手入力で足す。名前はメモ。getData で type が収入になる', () => {
  const { call, store } = setup();
  assert.deepStrictEqual(call({ key: KEY, action: 'addIncome', params: { date: '2026-10-25', amount: 52000, memo: ' バイト代 ' } }), { ok: true, data: { id: 'h_new' } });
  const row = store.tables['取引'].at(-1);
  assert.deepStrictEqual([row['種類'], row['状態'], row['出どころ'], row['カテゴリ'], row['メモ'], row['金額']], ['収入', '手入力', '手入力', '', 'バイト代', 52000]);
  const t = call({ key: KEY, action: 'getData', params: { from: '2026-10', to: '2026-10' } }).data.transactions.find(x => x.id === 'h_new');
  assert.deepStrictEqual([t.type, t.memo], ['収入', 'バイト代']);
});
test('addIncome：金額・日付・名前の形が違えば断る', () => {
  const { call, store } = setup();
  const before = store.tables['取引'].length;
  for (const params of [{ date: '2026-10-25', amount: 0 }, { date: '2026-10-25', amount: 1.5 }, { date: '2026-10-25', amount: 100000001 },
    { date: '2026-13-01', amount: 1000 }, { date: '2026-10-25', amount: 1000, memo: '=1+1' }, { date: '2026-10-25', amount: 1000, memo: 'x'.repeat(101) }]) {
    assert.strictEqual(call({ key: KEY, action: 'addIncome', params }).ok, false, JSON.stringify(params));
  }
  assert.strictEqual(store.tables['取引'].length, before);
});
test('収入：カテゴリは付けられない。対応表も収入の行には当てない。名前の変更と取消はできる', () => {
  const { call, store } = setup();
  call({ key: KEY, action: 'addIncome', params: { date: '2026-10-25', amount: 52000, memo: 'バイト代' } });
  store.tables['取引'].push({ 'id': 'h_in2', '種類': '収入', '利用日': '2026-10-26', '利用先': 'APPLE COM BILL', '金額': 1, '支払月': '', '状態': '手入力', 'カテゴリ': '', 'カテゴリの決め方': '', '出どころ': '手入力', '対応する速報': '', _row: store.tables['取引'].length + 2 });
  assert.strictEqual(call({ key: KEY, action: 'setCategory', params: { id: 'h_new', category: '食費' } }).ok, false);
  call({ key: KEY, action: 'setRule', params: { merchant: 'APPLE COM BILL', category: 'サブスク' } });
  assert.strictEqual(store.tables['取引'].find(r => r.id === 'h_in2')['カテゴリ'], '');
  assert.strictEqual(call({ key: KEY, action: 'setMemo', params: { id: 'h_new', memo: 'お小遣い' } }).ok, true);
  assert.strictEqual(call({ key: KEY, action: 'deleteManual', params: { id: 'h_new' } }).ok, true);
  assert.strictEqual(store.tables['取引'].find(r => r.id === 'h_new')['状態'], '取消');
});

// ---- 資産 ----
test('setAssetRecord：楽天銀行と NISA（評価額・元本）を1回で記録する。getData で返る', () => {
  const { call, store } = setup();
  const r = call({ key: KEY, action: 'setAssetRecord', params: { date: '2026-10-31', bank: 123456, nisa: 130000, nisaPrincipal: 120000 } });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(store.tables['資産'].map(x => [x['記録日'], x['項目'], x['金額'], x['元本']]),
    [['2026-10-31', '楽天銀行', 123456, ''], ['2026-10-31', '楽天証券 NISA', 130000, 120000]]);
  assert.deepStrictEqual(call({ key: KEY, action: 'getData', params: { from: '2026-01', to: '2026-12' } }).data.assets, [
    { date: '2026-10-31', item: '楽天銀行', amount: 123456, principal: null },
    { date: '2026-10-31', item: '楽天証券 NISA', amount: 130000, principal: 120000 },
  ]);
});
test('setAssetRecord：同じ日はやり直しで書き換え（行は増やさない）。null の項目はやめる。0 円は記録として残る', () => {
  const { call, store } = setup();
  call({ key: KEY, action: 'setAssetRecord', params: { date: '2026-10-31', bank: 123456, nisa: 130000, nisaPrincipal: 120000 } });
  assert.strictEqual(call({ key: KEY, action: 'setAssetRecord', params: { date: '2026-10-31', bank: 0, nisa: null, nisaPrincipal: null } }).ok, true);
  assert.strictEqual(store.tables['資産'].length, 2);
  assert.deepStrictEqual(call({ key: KEY, action: 'getData', params: { from: '2026-01', to: '2026-12' } }).data.assets,
    [{ date: '2026-10-31', item: '楽天銀行', amount: 0, principal: null }]);
  call({ key: KEY, action: 'setAssetRecord', params: { date: '2026-10-31', bank: null, nisa: null, nisaPrincipal: null } });
  assert.deepStrictEqual(call({ key: KEY, action: 'getData', params: { from: '2026-01', to: '2026-12' } }).data.assets, []);
  call({ key: KEY, action: 'setAssetRecord', params: { date: '2026-11-30', bank: null, nisa: null, nisaPrincipal: null } }); // ない日をやめても行は足さない
  assert.strictEqual(store.tables['資産'].length, 2);
});
test('setAssetRecord：日付・金額の形が違えば断る。元本だけは入れられない', () => {
  const { call, store } = setup();
  const ok = { date: '2026-10-31', bank: 1, nisa: 1, nisaPrincipal: 1 };
  for (const bad of [{ date: '2026-02-30' }, { date: '10/31' }, { bank: -1 }, { bank: 1.5 }, { bank: '1000' }, { nisa: 1000000001 }, { bank: undefined },
    { nisa: null, nisaPrincipal: 5 }]) {
    const params = { ...ok, ...bad };
    if ('bank' in bad && bad.bank === undefined) delete params.bank;
    assert.strictEqual(call({ key: KEY, action: 'setAssetRecord', params }).ok, false, JSON.stringify(bad));
  }
  assert.strictEqual(store.tables['資産'].length, 0);
});

// ---- 誕生日と記念日（10/7） ----
const daysOf = call => call({ key: KEY, action: 'getData', params: { from: '2026-09', to: '2026-10' } }).data.days;
const setDays = (call, birthday, anniversaries) => call({ key: KEY, action: 'setDays', params: { birthday, anniversaries } });

test('setDays：シートがなくても getData は空で返し、初めて書くときにシートを作る。誕生日と記念日を getData で返す', () => {
  const { call, store } = setup();
  assert.deepStrictEqual(daysOf(call), []);
  assert.strictEqual(store.tables['記念日'], undefined);
  assert.strictEqual(setDays(call, '03-15', [{ name: '内定式', md: '10-01' }, { name: ' 記念日 ', md: '02-29' }]).ok, true);
  assert.deepStrictEqual(daysOf(call), [
    { kind: '誕生日', name: '誕生日', md: '03-15' }, { kind: '記念日', name: '内定式', md: '10-01' }, { kind: '記念日', name: '記念日', md: '02-29' }]);
});

test('setDays：入れ替え。減った分の行は空にして読まない。同じなら書かない', () => {
  const { call, store } = setup();
  setDays(call, '03-15', [{ name: 'A', md: '01-02' }, { name: 'B', md: '01-03' }]);
  let writes = 0;
  const update = store.update;
  store.update = (n, r) => { writes++; update(n, r); };
  assert.strictEqual(setDays(call, '03-15', [{ name: 'A', md: '01-02' }, { name: 'B', md: '01-03' }]).ok, true);
  assert.strictEqual(writes, 0, '同じなら書かない');
  assert.strictEqual(setDays(call, '', [{ name: 'B', md: '01-03' }]).ok, true);
  assert.deepStrictEqual(daysOf(call), [{ kind: '記念日', name: 'B', md: '01-03' }]);
  assert.strictEqual(store.tables['記念日'].length, 3, '行は消さずに空にする');
  assert.strictEqual(setDays(call, '12-01', [{ name: 'C', md: '05-05' }, { name: 'D', md: '06-06' }, { name: 'E', md: '07-07' }]).ok, true);
  assert.deepStrictEqual(daysOf(call).map(d => d.name), ['誕生日', 'C', 'D', 'E']);
  // 空の行は読まないので使い回さず、下に足す（シートに空の行が残るだけで、読むものは正しい）
  assert.strictEqual(store.tables['記念日'].length, 6);
});

test('setDays：形が違えば何も書かない（日付・名前の長さ・式の書き出し・件数・誕生日なし）', () => {
  const bad = [
    ['3-15', []], ['13-01', []], ['02-30', []], ['04-31', []], [undefined, []], ['03-15', null],
    ['', [{ name: '', md: '01-01' }]], ['', [{ name: '123456789', md: '01-01' }]], ['', [{ name: '=A1', md: '01-01' }]],
    ['', [{ name: 'A', md: '2026-01-01' }]], ['', [null]], ['', Array.from({ length: 31 }, () => ({ name: 'A', md: '01-01' }))],
  ];
  for (const [b, a] of bad) {
    const { call, store } = setup();
    assert.strictEqual(setDays(call, b, a).ok, false, JSON.stringify([b, a]));
    assert.strictEqual(store.tables['記念日'], undefined, JSON.stringify([b, a]));
  }
  const { call } = setup();
  assert.strictEqual(setDays(call, '', [{ name: '12345678', md: '12-31' }]).ok, true, '8文字までよい');
});

test('getData：シートで手で直した記念日も読む（3/15・2026-03-15）。読めない行・種類の違う行は出さない', () => {
  const tables = baseTables();
  tables['記念日'] = [
    { '種類': '誕生日', '名前': '誕生日', '月日': '3/5' }, { '種類': '記念日', '名前': 'X', '月日': '2026-12-24' },
    { '種類': '記念日', '名前': '', '月日': '01-01' }, { '種類': 'ほか', '名前': 'Y', '月日': '01-01' }, { '種類': '記念日', '名前': 'Z', '月日': '2/30' },
  ];
  const { call } = setup(memoryStore(tables));
  assert.deepStrictEqual(daysOf(call), [{ kind: '誕生日', name: '誕生日', md: '03-05' }, { kind: '記念日', name: 'X', md: '12-24' }]);
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
