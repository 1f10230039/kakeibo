// 集計の計算（js/calc.js）と、季節・時間帯の決まり（js/theme.js）を Node.js で確かめる。
// 実行：node web/test/test.mjs

import assert from 'node:assert';
import * as C from '../js/calc.js';
import * as T from '../js/theme.js';
import * as V from '../js/csv.js';
import fs from 'node:fs';

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

test('引き落とし日：27日が土曜で 29日（月）が昭和の日なら 30日（2024年4月。内閣府の一覧で確かめた月）', () => {
  assert.strictEqual(C.ymd(C.debitDate(2024, 3)), '2024-04-30');
  assert.strictEqual(C.ymd(C.debitDate(2013, 3)), '2013-04-30');
  assert.strictEqual(C.ymd(C.debitDate(2025, 3)), '2025-04-28'); // 4/27 は日曜 → 28日（月）
});

test('祝日：決まった日・第n月曜・春分／秋分・振替休日・国民の休日（内閣府の一覧と同じ日）', () => {
  const yes = ['2026-01-12', '2026-03-20', '2026-05-06', '2026-09-21', '2026-09-22', '2026-09-23', '2027-03-21', '2027-02-23'];
  const no = ['2026-04-30', '2026-12-23', '2026-10-27'];
  yes.forEach(s => assert.strictEqual(C.isHoliday(C.parseYmd(s)), true, s));
  no.forEach(s => assert.strictEqual(C.isHoliday(C.parseYmd(s)), false, s));
  assert.strictEqual(C.isBankHoliday(C.parseYmd('2026-12-31')), true);  // 年末年始
  assert.strictEqual(C.isBankHoliday(C.parseYmd('2027-01-04')), false); // 月曜・仕事始め
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
  assert.deepStrictEqual(m.buckets.map(b => b.sub), ['10/1〜10/4', '10/5〜10/11', '10/12〜10/18', '10/19〜10/25', '10/26〜10/31']);
  assert.deepStrictEqual(m.buckets.map(b => b.label), ['10/1', '10/5', '10/12', '10/19', '10/26']);
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

test('棒グラフの縦の目盛り：きりのいい金額で4本まで', () => {
  const ax = m => { const a = C.niceAxis(m); return [a.top, a.ticks.map(C.axisYen).join(' ')]; };
  assert.deepStrictEqual(ax(34060), [40000, '1万 2万 3万 4万']);
  assert.deepStrictEqual(ax(12490), [15000, '5,000 1万 1.5万']);
  assert.deepStrictEqual(ax(40000), [40000, '1万 2万 3万 4万']); // ちょうどのときは、いちばん上の線まで
  assert.deepStrictEqual(ax(100000), [100000, '2.5万 5万 7.5万 10万']);
  assert.deepStrictEqual(ax(4100), [6000, '2,000 4,000 6,000']);
  assert.deepStrictEqual(ax(3), [3, '1 2 3']); // 1円より細かくしない
  assert.deepStrictEqual(C.niceAxis(0), { top: 1, ticks: [] });
});

test('棒ごとの合計：収入に切り替えると入金だけ（取消は入れない）', () => {
  const p = C.period('month', 0, D(2026, 10, 6), '月');
  const inc = (date, amount, extra = {}) => tx(date, amount, { type: '収入', status: '手入力', source: '手入力', category: '', ...extra });
  const txs = [tx('2026-10-02', 100), inc('2026-10-03', 5000), inc('2026-10-27', 52000), inc('2026-10-28', 1, { status: '取消' })];
  assert.deepStrictEqual(C.bucketTotals(txs, p, '収入').map(b => b.total), [5000, 0, 0, 0, 52000]);
  assert.deepStrictEqual(C.bucketTotals(txs, p).map(b => b.total), [100, 0, 0, 0, 0]);
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

test('固定費：今月・先月・見込み・まだ来ていないもの・店ごとの一覧・推移', () => {
  const cats = [{ name: '食費', group: '暮らし' }, { name: 'サブスク', group: '固定費' }, { name: '通信費', group: '固定費' }];
  const rules = [{ merchant: 'GOOGLE YOUTUBEPR', category: 'サブスク', displayName: 'YouTube Premium' }];
  const sub = (date, amount, merchant, extra = {}) => tx(date, amount, { category: 'サブスク', merchant, id: `${merchant}_${date}`, ...extra });
  const txs = [
    tx('2026-01-10', 500, { merchant: 'SAMPLE MART' }),                  // データの最初の月（固定費ではない）
    sub('2026-08-22', 1280, 'GOOGLE YOUTUBEPR'), sub('2026-09-22', 1280, 'google  youtubepr'), // 表記ゆれも同じ店。今月はまだ（22日ごろ）
    sub('2026-09-05', 1490, 'NETFLIX.COM'), sub('2026-10-05', 1590, 'Netflix.com '),          // 今月来た・100円上がった（表記ゆれ）
    sub('2026-09-03', 130, 'APPLE COM BILL'), sub('2026-09-20', 450, 'APPLE COM BILL'), sub('2026-10-03', 130, 'APPLE COM BILL'), // 2回のうち1回まだ
    sub('2026-08-03', 130, 'APPLE COM BILL'),                            // 8月は1回だけ → 9月（2回）と金額を比べない
    sub('2026-09-02', 300, 'AMAZON DIGITAL'), sub('2026-09-15', 600, 'AMAZON DIGITAL'), sub('2026-10-02', 600, 'AMAZON DIGITAL'), // 遅いほうが先に来た → まだは 300
    sub('2026-09-04', 100, 'CLOUD SVC'), sub('2026-09-18', 200, 'CLOUD SVC'), sub('2026-10-04', 110, 'CLOUD SVC'), // 値段が変わって1回足りない → まだは 200 だけ
    sub('2026-09-01', 2970, 'POVO', { category: '通信費' }),            // 1日ごろのはずが、まだ
    sub('2026-07-15', 980, 'OLD SUB'),                                   // もう止めた（一覧には出ない・推移には残る）
    sub('2026-09-25', 4000, '', { category: '通信費', source: '手入力', status: '手入力', memo: '家のネット' }),
    sub('2026-10-01', 4000, '', { category: '通信費', source: '手入力', status: '手入力', memo: '家のネット', id: 'net2' }),
    sub('2026-10-20', 999, 'FUTURE'), sub('2026-10-02', 777, 'CANCELLED', { status: '取消' }),  // 今日より後・取消は入れない
  ];
  const f = C.fixedSummary(txs, cats, rules, D(2026, 10, 7));
  assert.deepStrictEqual(f.cats, ['サブスク', '通信費']);
  assert.deepStrictEqual([f.thisMonth, f.lastMonth, f.forecast], [6430, 11520, 11630]);
  assert.deepStrictEqual(f.pending.map(p => [p.name, p.amount, p.day, p.late]), [
    ['POVO', 2970, 1, true], ['AMAZON DIGITAL', 300, 2, true], ['CLOUD SVC', 200, 18, false], ['APPLE COM BILL', 450, 20, false], ['YouTube Premium', 1280, 22, false]]);
  assert.deepStrictEqual(f.items.map(i => [i.name, i.amount, i.arrived, i.change, i.days.join(',')]), [
    ['家のネット', 4000, true, 0, '1'], ['POVO', 2970, false, 0, '1'], ['NETFLIX.COM', 1590, true, 100, '5'],
    ['YouTube Premium', 1280, false, 0, '22'], ['AMAZON DIGITAL', 900, false, 0, '2,15'], ['APPLE COM BILL', 580, false, 0, '3,20'], ['CLOUD SVC', 300, false, 0, '4,18']]);
  assert.strictEqual(f.items[0].lastId, 'net2'); // 押すと、いちばん新しい利用の詳細が開く
  assert.deepStrictEqual([f.months.length, f.months[0].month, f.months.at(-1).month], [10, '2026-01', '2026-10']);
  assert.deepStrictEqual(f.months.at(-1), { month: '2026-10', total: 6430, byCat: { 'サブスク': 2430, '通信費': 4000 }, expected: 5200 });
  assert.deepStrictEqual([f.months[6].month, f.months[6].total, f.months[7].total, f.months[6].expected], ['2026-07', 980, 1410, 0]);
  // 月の初め（今月まだ何も来ていない）：今月 0・見込みは先月の分
  const g = C.fixedSummary(txs.filter(t => t.date < '2026-10-01'), cats, rules, D(2026, 10, 1));
  assert.deepStrictEqual([g.thisMonth, g.forecast, g.items.every(i => !i.arrived)], [0, 11520, true]);
  // 先月31日に来たもの：今月（11月）に31日はないので、30日ごろ
  const h = C.fixedSummary([sub('2026-10-31', 500, 'MONTH END')], cats, rules, D(2026, 11, 5));
  assert.deepStrictEqual(h.pending.map(p => [p.day, p.late]), [[30, false]]);
  // 固定費がない・データがない
  assert.deepStrictEqual(C.fixedSummary([], cats, [], D(2026, 10, 7)).months, [{ month: '2026-10', total: 0, byCat: { 'サブスク': 0, '通信費': 0 }, expected: 0 }]);
  assert.strictEqual(C.addMonths('2026-01', -1), '2025-12');
});

test('予算：その月だけの予算 → 毎月の予算 → なし の順。やめた（0）予算は使わない', () => {
  const b = [{ month: '', target: '全体', amount: 50000 }, { month: '2026-10', target: '全体', amount: 60000 }, { month: '2026-11', target: '全体', amount: 0 }];
  assert.deepStrictEqual(C.budgetFor(b, '2026-10'), { amount: 60000, monthly: false });
  assert.deepStrictEqual(C.budgetFor(b, '2026-11'), { amount: 50000, monthly: true });
  assert.strictEqual(C.budgetFor([{ month: '2026-10', target: '全体', amount: 60000 }], '2026-12'), null);
  assert.strictEqual(C.budgetFor([], '2026-10'), null);
});

test('予算の様子：使った・残り・今日までの目安・1日あたり（今日を含めて割る）', () => {
  // 10/6（31日の月）：予算 31,000、使った 10,000
  const s = C.budgetStatus([tx('2026-10-01', 6000), tx('2026-10-06', 4000), tx('2026-10-07', 999), tx('2026-09-30', 500)], 31000, D(2026, 10, 6));
  assert.deepStrictEqual([s.spent, s.remaining, s.pace, s.daysLeft, s.perDay, s.over], [10000, 21000, 6000, 26, 807, false]);
  assert.strictEqual(s.paceRatio, 6 / 31);
});

test('予算の様子：使いすぎたら over、1日あたりは 0', () => {
  const s = C.budgetStatus([tx('2026-10-02', 12000)], 10000, D(2026, 10, 31));
  assert.deepStrictEqual([s.remaining, s.over, s.perDay, s.daysLeft, s.pace], [-2000, true, 0, 1, 10000]);
});

const asset = (date, item, amount, principal = null) => ({ date, item, amount, principal });

test('資産：記録日ごとの合計。記録しなかった項目は前の金額を使う。月ごとはその月の最後の記録', () => {
  const h = C.assetHistory([asset('2026-09-30', '楽天銀行', 100000), asset('2026-09-30', '楽天証券 NISA', 50000, 48000),
    asset('2026-10-31', '楽天銀行', 90000), asset('2026-10-15', '楽天証券 NISA', 61000, 58000)]);
  assert.deepStrictEqual(h.map(x => [x.date, x.total]), [['2026-09-30', 150000], ['2026-10-15', 161000], ['2026-10-31', 151000]]);
  assert.deepStrictEqual([h[2].bank, h[2].nisa, h[2].now.nisa, h[2].now.principal], [90000, null, 61000, 58000]);
  assert.deepStrictEqual(C.assetMonthly(h).map(m => [m.month, m.total]), [['2026-09', 150000], ['2026-10', 151000]]);
});

test('NISA の損益：評価額 − 元本。元本がなければ出さない', () => {
  assert.deepStrictEqual(C.nisaGain(130000, 120000), { amount: 10000, ratio: 10000 / 120000 });
  assert.strictEqual(C.nisaGain(130000, null), null);
});

test('残高：楽天銀行の記録から、記録した日より後〜次の引き落とし日までの引き落としを引く', () => {
  const txs = [tx('2026-09-10', 3000, { payMonth: '2026-10' }), tx('2026-10-05', 5000, { payMonth: '2026-11' }),
    tx('2026-10-06', 999, { payMonth: '', source: '手入力', status: '手入力' })];
  // 10/31 に記録（10/27 の分はもう引かれている）→ 11/5 には 11/27 の分だけ引く
  const a = C.spendable(txs, [asset('2026-10-31', '楽天銀行', 100000)], D(2026, 11, 5));
  assert.deepStrictEqual([a.amount, a.debits.map(d => d.payMonth)], [95000, ['2026-11']]);
  // 10/20 に記録 → 10/28 には、記録のあとの 10/27 の分と、次の 11/27 の分を引く
  const b = C.spendable(txs, [asset('2026-09-30', '楽天銀行', 1), asset('2026-10-20', '楽天銀行', 100000)], D(2026, 10, 28));
  assert.deepStrictEqual([b.amount, b.bankDate, b.debits.map(d => C.ymd(d.date))], [92000, '2026-10-20', ['2026-10-27', '2026-11-27']]);
  // 10/27 当日の記録は、その日の引き落としを引いたあととみなす
  assert.strictEqual(C.spendable(txs, [asset('2026-10-27', '楽天銀行', 100000)], D(2026, 10, 27)).amount, 100000);
  assert.strictEqual(C.spendable(txs, [asset('2026-10-27', '楽天証券 NISA', 1)], D(2026, 10, 27)), null);
});

test('「資産を記録する」：25日〜月末は今月、1〜7日は先月（記録日は先月末）。前の25日から記録があれば出さない', () => {
  assert.deepStrictEqual(C.assetDue([], D(2026, 10, 25)), { label: '今月の資産を記録する', date: '2026-10-25' });
  assert.deepStrictEqual(C.assetDue([], D(2026, 11, 3)), { label: '先月の資産を記録する', date: '2026-10-31' });
  assert.strictEqual(C.assetDue([], D(2026, 10, 10)), null);
  assert.strictEqual(C.assetDue([asset('2026-10-28', '楽天銀行', 1)], D(2026, 11, 3)), null);
  assert.deepStrictEqual(C.assetDue([asset('2026-10-20', '楽天銀行', 1)], D(2026, 11, 3)).label, '先月の資産を記録する');
  assert.deepStrictEqual(C.assetDue([], D(2026, 1, 5)).date, '2025-12-31');
});

test('収入：今月の入金（1日〜今日、取消は入れない）。支出の集計と未分類には入らない', () => {
  const inc = (date, amount, extra = {}) => tx(date, amount, { type: '収入', status: '手入力', source: '手入力', category: '', payMonth: '', ...extra });
  const txs = [inc('2026-10-03', 5000, { memo: 'お小遣い' }), inc('2026-09-25', 52000, { memo: 'バイト代' }), inc('2026-10-04', 999, { status: '取消' }), tx('2026-10-02', 300)];
  assert.strictEqual(C.monthIncome(txs, D(2026, 10, 6)), 5000);
  assert.strictEqual(C.monthToDate(txs, D(2026, 10, 6)), 300);
  assert.deepStrictEqual(C.unclassified(txs).map(t => t.amount), []);
  assert.deepStrictEqual(C.categoryTotals(txs).map(c => c.total), [300]);
  assert.deepStrictEqual(C.incomeNames(txs), ['お小遣い', 'バイト代']);
  assert.deepStrictEqual(C.incomeNames([inc('2026-10-01', 1, { memo: '仕送り' })]), ['仕送り', 'バイト代', 'お小遣い']);
});

// ---- e-NAVI の CSV（fixtures/enavi_dummy.csv は本物と同じ形のダミー） ----
const enavi = fs.readFileSync(new URL('./fixtures/enavi_dummy.csv', import.meta.url), 'utf8');

test('CSV：その月の支払い分・「以降」の分・外す行（返金・家族）に分け、店名をメールの形にそろえる', () => {
  const p = V.parseEnaviCsv(enavi);
  assert.strictEqual(p.statementMonth, '2026-10');
  assert.deepStrictEqual(p.rows.map(r => [r.date, r.merchant, r.amount, r.payMonth]), [
    ['2026-09-28', 'SAMPLE MART', 1100, '2026-10'], ['2026-09-28', 'SAMPLE MART', 1100, '2026-10'],
    ['2026-09-20', 'EXAMPLE* CLOUD SVC', 3604, '2026-10'], ['2026-09-18', 'EXAMPLE.COM', 1590, '2026-10'],
    ['2026-09-10', 'サンプルホンテン', 341, '2026-10'],
  ]);
  assert.deepStrictEqual([p.later.length, p.skipped.map(s => s.amount)], [1, [-500, 800]]);
});

const enaviOld = fs.readFileSync(new URL('./fixtures/enavi_dummy_old.csv', import.meta.url), 'utf8');

test('CSV（前の月の形）：支払月の列なし・「利用国USA」を外す・補足の行と空の行は飛ばす・キャンセルの欄は足さない', () => {
  const p = V.parseEnaviCsv(enaviOld);
  assert.strictEqual(p.statementMonth, '2026-07');
  assert.deepStrictEqual(p.rows.map(r => [r.date, r.merchant, r.amount, r.payMonth]), [
    ['2026-06-30', 'サンプルマート', 1000, '2026-07'], ['2026-06-29', 'EXAMPLE* CLOUD SVC', 3693, '2026-07'],
    ['2026-06-22', 'SAMPLE MART', 149, '2026-07'], ['2026-05-27', 'EXAMPLE BOOKS', 6600, '2026-07'],
  ]);
  assert.deepStrictEqual([p.cancels.map(c => [c.date, c.amount]), p.skipped.map(s => s.amount), p.later.length], [[['2026-07-15', 561]], [800], 0]);
});

test('合計：明細の利用・キャンセルなど・差し引いた支払金額・シートのその月の支払い分（取消・手入力・収入・ほかの月は入れない）', () => {
  const p = V.parseEnaviCsv(enaviOld);
  const t = (amount, extra = {}) => ({ id: 'x' + amount, type: '支出', date: '2026-06-30', amount, status: '確定', source: 'メール', payMonth: '2026-07', ...extra });
  const txs = [t(1000), t(3693, { source: 'CSV' }), t(149, { status: '速報' }), t(999, { status: '取消' }), t(300, { source: '手入力', status: '手入力' }),
    t(5000, { type: '収入', source: '手入力', status: '手入力' }), t(7, { payMonth: '2026-08' })];
  assert.deepStrictEqual({ ...V.totals(txs, p) }, { use: 11442, cancel: 561, pay: 10881, sheet: 4842, diff: -6600 });
});

test('CSV：12月の利用 → 翌年1月払い。形の違うファイルは断る', () => {
  const jan = enavi.replace('10月支払金額', '1月支払金額').replace(/"10月"/g, '"1月"').replace(/2026\/09/g, '2026/12');
  assert.strictEqual(V.parseEnaviCsv(jan).statementMonth, '2027-01');
  assert.throws(() => V.parseEnaviCsv('"日付","店"\n"2026/09/01","x"'), V.CsvError);
  assert.throws(() => V.parseEnaviCsv(enavi.replace(/"10月"/g, '"9月"')), V.CsvError);
});

test('CSV：欄の中のカンマ・"" ・改行も読める', () => {
  assert.deepStrictEqual(V.parseCsvText('"a,b","c""d"\r\n"e\nf",g\n'), [['a,b', 'c"d'], ['e\nf', 'g']]);
});

test('照合：利用日と金額で当てる（同じものが2つなら2つ目は足す候補）。手入力・収入・取消には当てない', () => {
  const t = (id, date, amount, extra = {}) => ({ id, type: '支出', date, amount, status: '確定', source: 'メール', payMonth: '2026-10', merchant: '', category: '', ...extra });
  const txs = [
    t('m_1', '2026-09-28', 1100, { merchant: 'SAMPLE MART' }),
    t('m_s', '2026-09-20', 3604, { status: '速報', payMonth: '2026-11' }), // 速報の仮の支払月がずれていても当たる
    t('c_1', '2026-09-18', 1590, { source: 'CSV', merchant: 'EXAMPLE.COM' }), // 前に CSV から足した行
    t('h_1', '2026-09-10', 341, { source: '手入力', status: '手入力' }),
    t('i_1', '2026-09-10', 341, { type: '収入', source: '手入力', status: '手入力' }),
    t('x_1', '2026-09-10', 341, { status: '取消' }),
    t('m_9', '2026-09-15', 999, { merchant: 'GONE SHOP' }), // CSV に出てこない → キャンセルかも
    t('m_n', '2026-10-02', 500, { payMonth: '2026-11' }), // 来月払いの分は、この CSV では見ない
  ];
  const r = V.reconcile(txs, V.parseEnaviCsv(enavi));
  assert.deepStrictEqual(r.matched.map(([, x]) => x.id), ['m_1', 'm_s', 'c_1']);
  assert.deepStrictEqual(r.csvOnly.map(c => [c.date, c.amount]), [['2026-09-28', 1100], ['2026-09-10', 341]]);
  assert.deepStrictEqual(r.mailOnly.map(x => x.id), ['m_9']);
});

test('照合：同じ日・同じ金額の候補が複数なら、店名が同じほうに当てる', () => {
  const t = (id, merchant) => ({ id, type: '支出', date: '2026-09-28', amount: 1100, status: '確定', source: 'メール', payMonth: '2026-10', merchant });
  const one = { statementMonth: '2026-10', rows: [{ date: '2026-09-28', merchant: 'SAMPLE MART', amount: 1100, payMonth: '2026-10' }] };
  const r = V.reconcile([t('m_a', 'OTHER SHOP'), t('m_b', 'sample　ｍａｒｔ')], one);
  assert.deepStrictEqual([r.matched[0][1].id, r.mailOnly.map(x => x.id)], ['m_b', ['m_a']]);
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
