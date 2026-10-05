// 集計の計算（js/calc.js）と、季節・時間帯の決まり（js/theme.js）を Node.js で確かめる。
// 実行：node web/test/test.mjs

import assert from 'node:assert';
import * as C from '../js/calc.js';
import * as T from '../js/theme.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const D = (y, m, d) => new Date(y, m - 1, d);
const tx = (date, amount, extra = {}) => ({ id: 'm_' + date + '_' + amount, type: '支出', date, amount, status: '確定', category: '食費', source: 'メール', payMonth: '', ...extra });

test('今月の支出：利用日で数え、取消は入れず、速報は入れる', () => {
  const txs = [tx('2026-10-01', 1000), tx('2026-10-06', 500, { status: '速報' }), tx('2026-10-03', 9999, { status: '取消' }), tx('2026-09-30', 700)];
  assert.strictEqual(C.monthToDate(txs, D(2026, 10, 6)), 1500);
});

test('先月の同じ日まで：先月1日〜先月の同じ日', () => {
  const txs = [tx('2026-09-01', 100), tx('2026-09-06', 200), tx('2026-09-07', 400)];
  assert.strictEqual(C.lastMonthToSameDay(txs, D(2026, 10, 6)), 300);
});

test('先月の同じ日まで：先月にその日がなければ先月末まで（3/31 → 2/28）', () => {
  const txs = [tx('2026-02-27', 100), tx('2026-02-28', 200)];
  assert.strictEqual(C.lastMonthToSameDay(txs, D(2026, 3, 31)), 300);
});

test('先月の同じ日まで：1月なら前の年の12月', () => {
  assert.strictEqual(C.lastMonthToSameDay([tx('2025-12-05', 800)], D(2026, 1, 10)), 800);
});

test('引き落とし日：27日、土曜なら29日（月）、日曜なら28日（月）', () => {
  assert.strictEqual(C.ymd(C.debitDate(2026, 9)), '2026-10-27');   // 火曜
  assert.strictEqual(C.ymd(C.debitDate(2026, 2)), '2026-03-27');   // 金曜
  assert.strictEqual(C.ymd(C.debitDate(2026, 5)), '2026-06-29');   // 6/27 は土曜
  assert.strictEqual(C.ymd(C.debitDate(2026, 8)), '2026-09-28');   // 9/27 は日曜
});

test('次の引き落とし：27日までは今月分、過ぎたら来月分。手入力は入れない', () => {
  const txs = [tx('2026-09-10', 3000, { payMonth: '2026-10' }), tx('2026-10-02', 500, { payMonth: '2026-11' }),
    tx('2026-09-12', 300, { payMonth: '', source: '手入力', status: '手入力' })];
  const a = C.nextDebit(txs, D(2026, 10, 6));
  assert.deepStrictEqual([C.ymd(a.date), a.payMonth, a.amount], ['2026-10-27', '2026-10', 3000]);
  const b = C.nextDebit(txs, D(2026, 10, 28));
  assert.deepStrictEqual([C.ymd(b.date), b.payMonth, b.amount], ['2026-11-27', '2026-11', 500]);
});

test('週の始まり：月曜／日曜', () => {
  assert.strictEqual(C.ymd(C.startOfWeek(D(2026, 10, 6), '月')), '2026-10-05'); // 10/6 は火曜
  assert.strictEqual(C.ymd(C.startOfWeek(D(2026, 10, 6), '日')), '2026-10-04');
  assert.strictEqual(C.ymd(C.startOfWeek(D(2026, 10, 4), '月')), '2026-09-28'); // 日曜は前の週
});

test('統計の期間：週は7本、月は週ごと（端は短い）、年は12本', () => {
  const w = C.period('week', 0, D(2026, 10, 6), '月');
  assert.deepStrictEqual([C.ymd(w.start), C.ymd(w.end), w.buckets.length, w.buckets[0].label], ['2026-10-05', '2026-10-11', 7, '月']);
  const m = C.period('month', 0, D(2026, 10, 6), '月');
  // 2026年10月：1日(木)〜4日(日)、5〜11、12〜18、19〜25、26〜31
  assert.deepStrictEqual(m.buckets.map(b => b.sub), ['1〜4日', '5〜11日', '12〜18日', '19〜25日', '26〜31日']);
  const y = C.period('year', -1, D(2026, 10, 6), '月');
  assert.deepStrictEqual([y.label, y.buckets.length, C.ymd(y.buckets[11].end)], ['2025年', 12, '2025-12-31']);
});

test('統計の期間：月の前後（1月の前は前の年の12月）', () => {
  assert.strictEqual(C.period('month', -1, D(2026, 1, 15), '月').label, '2025年12月');
});

test('棒ごとの合計', () => {
  const p = C.period('month', 0, D(2026, 10, 6), '月');
  const t = C.bucketTotals([tx('2026-10-02', 100), tx('2026-10-05', 200), tx('2026-10-31', 50)], p);
  assert.deepStrictEqual(t.map(b => b.total), [100, 200, 0, 0, 50]);
});

test('カテゴリ・グループの合計（未分類も出す）', () => {
  const cats = [{ name: '食費', group: '暮らし' }, { name: 'サブスク', group: '固定費' }];
  const txs = [tx('2026-10-01', 100), tx('2026-10-02', 300, { category: 'サブスク' }), tx('2026-10-03', 50, { category: '' })];
  assert.deepStrictEqual(C.categoryTotals(txs).map(c => c.name), ['サブスク', '食費', '未分類']);
  assert.deepStrictEqual(C.groupTotals(txs, cats).map(g => [g.group, g.total]), [['暮らし', 100], ['固定費', 300], ['未分類', 50]]);
});

test('未分類：確定・手入力でカテゴリが空のもの（速報と取消は入れない）', () => {
  const txs = [tx('2026-10-01', 1, { category: '' }), tx('2026-10-01', 2, { category: '', status: '速報' }),
    tx('2026-10-01', 3, { category: '', status: '取消' }), tx('2026-10-01', 4, { category: '', status: '手入力' })];
  assert.deepStrictEqual(C.unclassified(txs).map(t => t.amount), [1, 4]);
});

test('確認が必要な速報：14日たったもの', () => {
  const txs = [tx('2026-09-22', 1, { status: '速報' }), tx('2026-09-23', 2, { status: '速報' }), tx('2026-09-01', 3)];
  assert.deepStrictEqual(C.staleSokuho(txs, D(2026, 10, 6)).map(t => t.amount), [1]);
});

test('名前（サブタイトル）：この利用だけの名前 → 店の表示名 → なし の順', () => {
  const names = C.displayNames([{ merchant: 'Google *YouTubePremium', category: 'サブスク', displayName: 'YouTube Premium' }, { merchant: 'SAMPLE MART', category: '食費', displayName: '' }]);
  assert.strictEqual(C.subtitleOf({ merchant: 'GOOGLE *YOUTUBEPREMIUM ', memo: '' }, names), 'YouTube Premium'); // 表記ゆれも同じ店
  assert.strictEqual(C.subtitleOf({ merchant: 'GOOGLE *YOUTUBEPREMIUM', memo: '家族の分' }, names), '家族の分');
  assert.strictEqual(C.subtitleOf({ merchant: 'SAMPLE MART', memo: '' }, names), '');
  assert.strictEqual(C.subtitleOf({ merchant: '', memo: '' }, names), '');
});

test('金額の書き方', () => {
  assert.strictEqual(C.yen(1234567), '¥1,234,567');
});

test('季節：3〜5月 春、6〜8月 夏、9〜11月 秋、12〜2月 冬', () => {
  assert.deepStrictEqual([1, 2, 3, 5, 6, 8, 9, 11, 12].map(T.seasonOf), ['winter', 'winter', 'spring', 'spring', 'summer', 'summer', 'autumn', 'autumn', 'winter']);
});

test('時間帯と挨拶の境目', () => {
  const cases = [[4, 'night', '遅くまでおつかれさまです'], [5, 'morning', 'おはようございます'], [9, 'morning', 'おはようございます'], [10, 'day', 'こんにちは'],
    [15, 'day', 'こんにちは'], [16, 'evening', 'おつかれさまです'], [18, 'evening', 'おつかれさまです'], [19, 'night', 'こんばんは'], [22, 'night', 'こんばんは'], [23, 'night', '遅くまでおつかれさまです']];
  cases.forEach(([h, slot, g]) => {
    assert.strictEqual(T.slotOf(h), slot, `${h}時`);
    assert.strictEqual(T.greetingOf(h), g, `${h}時`);
  });
});

test('見た目：秋の夜は C と満月の写真', () => {
  const look = T.lookOf(new Date(2026, 9, 6, 21, 0));
  assert.deepStrictEqual([look.theme, look.hero], ['c', 'images/hero/autumn-night.webp']);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  NG  ' + name + '\n      ' + e.message.split('\n').join('\n      ')); }
}
console.log(`\n${tests.length - failed} / ${tests.length} 通過`);
process.exit(failed ? 1 : 0);
