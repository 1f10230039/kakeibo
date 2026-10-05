// GAS のコードのうち、シートやメールに触らない部分を Node.js で確かめる。
// 実行：node gas/test/test.js
// fixtures/ のメールは、実物と同じ形でダミーの日付・店名・金額にしたもの。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const gasDir = path.join(__dirname, '..');
// GAS の Utilities の代わり（本文の文字コードの読み直しを試すため）。GAS の本物とまったく同じではない
const Utilities = {
  base64DecodeWebSafe: s => Buffer.from(s, 'base64url'),
  newBlob: bytes => ({ getDataAsString: cs => new TextDecoder(cs).decode(Buffer.from(bytes)) }),
};
const ctx = vm.createContext({ console, Utilities, Buffer });
for (const f of ['共通.gs', '取り込み/取り込み.gs', '取り込み/実行.gs']) {
  vm.runInContext(fs.readFileSync(path.join(gasDir, f), 'utf8'), ctx, { filename: f });
}
const g = name => vm.runInContext(name, ctx);
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('件名で種類を見分ける', () => {
  const c = g('classifySubject');
  assert.strictEqual(c('【速報版】カード利用のお知らせ(本人ご利用分)'), 'sokuho');
  assert.strictEqual(c('カード利用のお知らせ(本人ご利用分)'), 'kakutei');
  assert.strictEqual(c('カード利用のお知らせ（本人ご利用分）'), 'kakutei'); // 全角かっこでも
  assert.strictEqual(c('カード利用のお知らせ(家族ご利用分)'), null);
  assert.strictEqual(c('楽天銀行残高表示サービスご登録完了のお知らせ'), null);
});

test('速報版を分解する', () => {
  const items = g('parseSokuho')(fixture('sokuho.txt'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(items)), [{ date: '2026-01-10', amount: 1234 }]);
});

test('確定版を分解する（1通に2件）', () => {
  const items = g('parseKakutei')(fixture('kakutei.txt'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(items)), [
    { date: '2026-01-10', merchant: 'SAMPLE MART', amount: 1234, payMonth: '2026-02' },
    { date: '2026-01-11', merchant: 'EXAMPLE CAFE', amount: 980, payMonth: '2026-02' },
  ]);
});

test('全角のコロンでも読める', () => {
  const body = fixture('sokuho.txt').replace(/■利用日: /, '■利用日：');
  assert.strictEqual(g('parseSokuho')(body)[0].date, '2026-01-10');
});

test('形が合わないメールは null（1件でも欠けたら丸ごと）', () => {
  assert.strictEqual(g('parseSokuho')('本文が空っぽ'), null);
  const broken = fixture('kakutei.txt').replace('■支払月: 2026/02\n\n■利用日: 2026/01/11', '\n■利用日: 2026/01/11');
  assert.strictEqual(g('parseKakutei')(broken), null);
});

// ---- 突き合わせ ----
const entriesOf = (kind, id, file) => g('toEntries')(kind, id, fixture(file));
const merge = (rows, entries, rules = {}) => g('mergeEntries')(rows, entries, rules, '2026-01-12 10:00');

test('速報 → 確定 で、速報の行が確定に置き換わる', () => {
  const rows = [];
  merge(rows, entriesOf('sokuho', 'S1', 'sokuho.txt'));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]['状態'], '速報');
  assert.strictEqual(rows[0]['支払月'], '2026-02'); // 仮の支払月＝翌月

  const st = merge(rows, entriesOf('kakutei', 'K1', 'kakutei.txt'));
  assert.deepStrictEqual({ ...st }, { added: 1, replaced: 1, linked: 0, skipped: 0 });
  assert.strictEqual(rows.length, 2);
  const r = rows[0];
  assert.strictEqual(r['id'], 'm_K1_1');
  assert.strictEqual(r['対応する速報'], 'm_S1_1');
  assert.strictEqual(r['状態'], '確定');
  assert.strictEqual(r['利用先'], 'SAMPLE MART');
  assert.strictEqual(rows[1]['利用先'], 'EXAMPLE CAFE');
});

test('同じメールを2回読んでも増えない', () => {
  const rows = [];
  merge(rows, entriesOf('sokuho', 'S1', 'sokuho.txt'));
  merge(rows, entriesOf('kakutei', 'K1', 'kakutei.txt'));
  const st = merge(rows, [...entriesOf('sokuho', 'S1', 'sokuho.txt'), ...entriesOf('kakutei', 'K1', 'kakutei.txt')]);
  assert.deepStrictEqual({ ...st }, { added: 0, replaced: 0, linked: 0, skipped: 3 });
  assert.strictEqual(rows.length, 2);
});

test('確定が先に届いたら、あとの速報は結びつけるだけ', () => {
  const rows = [];
  merge(rows, entriesOf('kakutei', 'K1', 'kakutei.txt'));
  const st = merge(rows, entriesOf('sokuho', 'S1', 'sokuho.txt'));
  assert.deepStrictEqual({ ...st }, { added: 0, replaced: 0, linked: 1, skipped: 0 });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0]['対応する速報'], 'm_S1_1');
});

test('同じ日・同じ金額の速報が2つあれば、古いほうから置き換える', () => {
  const rows = [];
  merge(rows, [...entriesOf('sokuho', 'S1', 'sokuho.txt'), ...entriesOf('sokuho', 'S2', 'sokuho.txt')]);
  merge(rows, entriesOf('kakutei', 'K1', 'kakutei.txt'));
  assert.strictEqual(rows[0]['状態'], '確定');
  assert.strictEqual(rows[0]['対応する速報'], 'm_S1_1');
  assert.strictEqual(rows[1]['状態'], '速報'); // S2 は残る（14日たったら「やること」に出る）
});

test('対応表があればカテゴリが付き、なければ未分類', () => {
  const rows = [];
  merge(rows, entriesOf('kakutei', 'K1', 'kakutei.txt'), { 'SAMPLE MART': '食費' });
  assert.strictEqual(rows[0]['カテゴリ'], '食費');
  assert.strictEqual(rows[0]['カテゴリの決め方'], '対応表');
  assert.strictEqual(rows[1]['カテゴリ'], '');
  assert.strictEqual(rows[1]['カテゴリの決め方'], '未分類');
});

test('対応表の利用先は、空白・全角・大小文字の違いを気にしない', () => {
  const map = g('buildRuleMap')([{ '利用先': ' sample　ｍａｒｔ ', 'カテゴリ': '食費' }]);
  assert.strictEqual(map['SAMPLE MART'], '食費');
});

test('個別に決めたカテゴリは、確定で置き換えても変えない', () => {
  const rows = [];
  merge(rows, entriesOf('sokuho', 'S1', 'sokuho.txt'));
  rows[0]['カテゴリ'] = '交際費';
  rows[0]['カテゴリの決め方'] = '個別';
  merge(rows, entriesOf('kakutei', 'K1', 'kakutei.txt'), { 'SAMPLE MART': '食費' });
  assert.strictEqual(rows[0]['カテゴリ'], '交際費');
});

test('取引の行から、取り込み済みのメール ID を取り出す', () => {
  const ids = g('knownMessageIds')([
    { 'id': 'm_K1_1', '対応する速報': 'm_S1_1' },
    { 'id': 'm_K1_2', '対応する速報': '' },
    { 'id': 'h_2026-10-06 12:00', '対応する速報': '' },
  ]);
  assert.deepStrictEqual([...ids].sort(), ['K1', 'S1']);
});

test('本文：UTF-8 ならそのまま読む', () => {
  const part = { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="iso-2022-jp"' }],
    body: { data: fixture('sokuho_utf8.b64') } };
  assert.strictEqual(g('decodeBody')(part), fixture('sokuho.txt'));
});

test('本文：UTF-8 で化けたら、書いてある文字コード（ISO-2022-JP）で読み直す', () => {
  const part = { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="iso-2022-jp"' }],
    body: { data: fixture('sokuho_iso2022jp.b64') } };
  assert.strictEqual(g('decodeBody')(part), fixture('sokuho.txt'));
});

test('本文：入れ子の部品から text/plain を探す（HTML は使わない）', () => {
  const payload = { mimeType: 'multipart/alternative', parts: [
    { mimeType: 'text/plain', headers: [], body: { data: fixture('sokuho_utf8.b64') } },
    { mimeType: 'text/html', headers: [], body: { data: 'PGI-aHRtbDwvYj4' } },
  ] };
  assert.strictEqual(g('findPlainText')(payload), fixture('sokuho.txt'));
});

test('12月の速報の仮の支払月は翌年1月', () => {
  assert.strictEqual(g('nextMonth')('2026-12-15'), '2027-01');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  NG  ' + name + '\n      ' + e.message.split('\n').join('\n      ')); }
}
console.log(`\n${tests.length - failed} / ${tests.length} 通過`);
process.exit(failed ? 1 : 0);
