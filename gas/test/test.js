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
for (const f of ['共通.gs', '取り込み/取り込み.gs', '取り込み/楽天証券.gs', '取り込み/実行.gs']) {
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

const csvRow = (date, amount, extra = {}) => ({
  'id': 'c_x' + date + amount, '種類': '支出', '利用日': date, '利用先': 'SAMPLE MART', '金額': amount, '支払月': '2026-02',
  '状態': '確定', 'カテゴリ': '', 'カテゴリの決め方': '未分類', '出どころ': 'CSV', '対応する速報': '', 'メモ': '', '取り込み日時': '', ...extra,
});

test('CSV から足した行と同じ日・同じ金額の確定版は、新しい行を作らずにメールの行に置き換える', () => {
  const rows = [csvRow('2026-01-10', 1234, { 'カテゴリ': '交際費', 'カテゴリの決め方': '個別' })];
  const st = merge(rows, entriesOf('kakutei', 'K1', 'kakutei.txt'));
  assert.deepStrictEqual({ ...st }, { added: 1, replaced: 1, linked: 0, skipped: 0 }); // 2件目（01-11）は新しく足す
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual([rows[0]['id'], rows[0]['出どころ'], rows[0]['カテゴリ']], ['m_K1_1', 'メール', '交際費']); // 個別のカテゴリは残す
  assert.deepStrictEqual([...g('knownMessageIds')(rows)], ['K1']); // 次からはこのメールを読みにいかない
});

test('CSV から足した行と同じ日・同じ金額の速報は、結びつけるだけ（行を増やさない）', () => {
  const rows = [csvRow('2026-01-10', 1234)];
  const st = merge(rows, entriesOf('sokuho', 'S1', 'sokuho.txt'));
  assert.deepStrictEqual({ ...st }, { added: 0, replaced: 0, linked: 1, skipped: 0 });
  assert.deepStrictEqual([rows.length, rows[0]['対応する速報'], rows[0]['状態']], [1, 'm_S1_1', '確定']);
});

test('取消にした CSV の行や、金額の違う CSV の行には当てない', () => {
  const rows = [csvRow('2026-01-10', 1234, { '状態': '取消' }), csvRow('2026-01-10', 999)];
  merge(rows, entriesOf('sokuho', 'S1', 'sokuho.txt'));
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[2]['状態'], '速報');
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

// ---- 楽天証券の積立（積立NISA。10/7） ----

const NISA_FUND = 'サンプル 全世界株式ファンド(ダミー)'; // 全角のかっこは半角にそろう
const nisaRuleMap = () => ({ [g('normalizeMerchant')(NISA_FUND)]: '積立・投資' });

test('楽天証券：送り主と件名で見分ける（楽天証券を名乗るほかの送り主は読まない）', () => {
  const c = g('classifyMail');
  assert.strictEqual(c({ from: '楽天証券 <service@rakuten-sec.co.jp>', subject: '【投資信託】積立購入が完了しました（約定）' }), 'nisa');
  assert.strictEqual(c({ from: 'service@rakuten-sec.co.jp', subject: '【投資信託】次回積立予定をお知らせします' }), null);
  assert.strictEqual(c({ from: 'mktg_nws@rakuten-sec.co.jp', subject: '【投資信託】積立購入が完了しました（約定）' }), null);
  assert.strictEqual(c({ from: 'info@mail.rakuten-card.co.jp', subject: 'カード利用のお知らせ(本人ご利用分)' }), 'kakutei');
});

test('楽天証券：HTML だけの約定のメールを分解する（注文日・ファンド・金額・口座区分）', () => {
  const lines = g('htmlToLines')(fixture('nisa_order.html'));
  assert.ok(!lines.some(l => /<|>|th,td|mso/.test(l)), 'タグ・CSS・Outlook 用の書き込み・コメント（中に > があっても）は残らない');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g('parseNisaOrders')(lines))),
    [{ date: '2026-05-01', fund: NISA_FUND, amount: 12345, account: 'NISAつみたて投資枠' }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g('toNisaEntries')('X1', lines))).map(e => [e.kind, e.id]), [['nisa', 'm_X1_1']]);
});

test('楽天証券：1通に2つのファンド・表が「見出し | 値」の1行でも読める。1つでも欠けたら丸ごと null', () => {
  const html = fixture('nisa_order.html');
  const block = html.slice(html.indexOf('<tr>\n<td style="font-weight:bold; background'), html.indexOf('<!--その他件数-->'));
  const two = html.replace('<!--その他件数-->', block.replace('サンプル 全世界株式ファンド（ダミー）', 'もう一つのファンド').replace('12,345円', '3,000円') + '<!--その他件数-->');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g('parseNisaOrders')(g('htmlToLines')(two)))).map(i => [i.fund, i.amount]), [[NISA_FUND, 12345], ['もう一つのファンド', 3000]]);
  const md = '| 5月7日に完了（約定）した注文 |\n| |\n| サンプル 全世界株式ファンド（ダミー） |\n| 口座区分 | NISAつみたて投資枠 |\n|---|---|\n| 購入金額 | 12,345円 |\n| 注文日 | 2026年5月1日 |';
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g('parseNisaOrders')(g('toLines')(md)))), [{ date: '2026-05-01', fund: NISA_FUND, amount: 12345, account: 'NISAつみたて投資枠' }]);
  assert.strictEqual(g('parseNisaOrders')(g('htmlToLines')(html.replace('2026年5月1日', ''))), null);
  assert.strictEqual(g('parseNisaOrders')(g('htmlToLines')(html.replace('12,345円', '未定'))), null);
  assert.strictEqual(g('parseNisaOrders')(g('htmlToLines')(html.replace('5月7日に完了（約定）した注文', 'お知らせ'))), null);
});

test('楽天証券：積立設定のメールを分解する。毎月でない積立は null', () => {
  const lines = g('htmlToLines')(fixture('nisa_setting.html'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g('parseNisaSetting')(lines))),
    [{ fund: NISA_FUND, day: 1, amount: 12345, account: 'NISAつみたて投資枠', first: '2026-03-02' }]);
  assert.strictEqual(g('parseNisaSetting')(g('htmlToLines')(fixture('nisa_setting.html').replace('毎月1日', '毎日'))), null);
  assert.strictEqual(g('parseNisaSetting')(g('htmlToLines')(fixture('nisa_setting.html').replace('毎月1日', '毎月1日・15日'))), null); // 形の分からない積立は推測しない
});

test('楽天証券：指定日が休みなら次の営業日（土日・祝日・年末年始。月末にそろえる）', () => {
  const b = g('secBusinessDay');
  assert.deepStrictEqual(['2026-03', '2026-05', '2026-08', '2027-01', '2026-02', '2026-04'].map((m, i) => b(m, [1, 1, 1, 1, 31, 29][i])),
    ['2026-03-02', '2026-05-01', '2026-08-03', '2027-01-04', '2026-03-02', '2026-04-30']); // 2/31 → 2/28（土）→ 3/2、4/29 は昭和の日
});

test('楽天証券：約定のメールの行（出どころ＝楽天証券・支払月なし・対応表のカテゴリ）。同じメールは二重にしない', () => {
  const rows = [];
  const e = { kind: 'nisa', id: 'm_X1_1', date: '2026-05-01', fund: NISA_FUND, amount: 12345, account: 'NISAつみたて投資枠' };
  const st = g('mergeNisa')(rows, [e, { ...e }], nisaRuleMap(), '2026-10-07 10:00');
  assert.deepStrictEqual([st.added, st.skipped], [1, 1]);
  const r = rows[0];
  assert.deepStrictEqual([r['種類'], r['利用日'], r['利用先'], r['金額'], r['支払月'], r['状態'], r['出どころ'], r['カテゴリ'], r['カテゴリの決め方']],
    ['支出', '2026-05-01', NISA_FUND, 12345, '', '確定', '楽天証券', '積立・投資', '対応表']);
  assert.ok(g('knownMessageIds')(rows).has('X1'), '次からはメールを読みにいかない');
});

test('楽天証券：設定から、メールのない月（初回の月〜先月）を埋める。何回動かしても増えない。あとからメールが来たら置き換える', () => {
  const ruleMap = nisaRuleMap();
  const rows = [];
  g('mergeNisa')(rows, [{ kind: 'nisa', id: 'm_APR_1', date: '2026-04-01', fund: NISA_FUND, amount: 12345, account: 'NISAつみたて投資枠' }], ruleMap, 'now');
  const settings = [{ messageId: 'SET', fund: NISA_FUND, day: 1, amount: 12345, account: 'NISAつみたて投資枠', first: '2026-03-10' }];
  const today = new Date(2026, 9, 7);
  assert.strictEqual(g('fillNisaFromSettings')(rows, settings, today, ruleMap, 'now'), 6); // 3・5・6・7・8・9月（4月はメールの行、10月はメールを待つ）
  // 初回の月は初回購入日（月の途中に設定したとき）、そのあとは指定日（休みなら次の営業日）
  assert.deepStrictEqual(rows.filter(r => r['状態'] === '設定から').map(r => r['利用日']), ['2026-03-10', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01']);
  assert.ok(rows.every(r => r['カテゴリ'] === '積立・投資' && r['出どころ'] === '楽天証券' && r['支払月'] === ''));
  assert.strictEqual(g('fillNisaFromSettings')(rows, settings, today, ruleMap, 'now'), 0);
  // 8月のメールがあとから見つかった：設定から の行を、メールの行（確定・メールの注文日）に置き換える
  const st = g('mergeNisa')(rows, [{ kind: 'nisa', id: 'm_AUG_1', date: '2026-08-03', fund: NISA_FUND, amount: 12345, account: 'NISAつみたて投資枠' }], ruleMap, 'now');
  assert.deepStrictEqual([st.added, st.replaced, rows.length], [0, 1, 7]);
  assert.deepStrictEqual([rows.find(r => r['id'] === 'm_AUG_1')['状態'], rows.filter(r => r['状態'] === '設定から').length], ['確定', 5]);
  // 取消にした月は、設定から埋め直す（取消は「その月はなかった」ではなく、本人が消した行）→ 埋めない
  rows.find(r => r['利用日'] === '2026-06-01')['状態'] = '取消';
  assert.strictEqual(g('fillNisaFromSettings')(rows, settings, today, ruleMap, 'now'), 0);
});

test('楽天証券：カードの速報・確定は、同じ日・同じ金額の積立の行に結びつけない', () => {
  const rows = [];
  g('mergeNisa')(rows, [{ kind: 'nisa', id: 'm_X1_1', date: '2026-05-01', fund: NISA_FUND, amount: 12345, account: 'NISAつみたて投資枠' }], nisaRuleMap(), 'now');
  const st = g('mergeEntries')(rows, [{ kind: 'sokuho', id: 'm_C1_1', date: '2026-05-01', amount: 12345 }, { kind: 'kakutei', id: 'm_C2_1', date: '2026-05-01', merchant: 'SHOP', amount: 12345, payMonth: '2026-06' }], {}, 'now');
  assert.deepStrictEqual([st.added, st.replaced, st.linked, rows.length], [1, 1, 0, 2]);
  assert.strictEqual(rows[0]['id'], 'm_X1_1');
});

test('楽天証券：対応表とカテゴリがなければ足す行を返す（本人が変えた対応表はそのまま）', () => {
  const ruleMap = {};
  const add = g('nisaRuleRows')(ruleMap, [{ fund: NISA_FUND, account: 'NISAつみたて投資枠' }, { fund: NISA_FUND, account: 'NISAつみたて投資枠' }], '2026-10-07');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(add)), [{ '利用先': NISA_FUND, 'カテゴリ': '積立・投資', '決めた日': '2026-10-07', '表示名': '積立NISA' }]);
  assert.strictEqual(ruleMap[g('normalizeMerchant')(NISA_FUND)], '積立・投資');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g('nisaRuleRows')({ [g('normalizeMerchant')(NISA_FUND)]: 'その他' }, [{ fund: NISA_FUND, account: '' }], 'x'))), []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g('nisaCategoryRow')([{ 'カテゴリ': '食費', '並び順': 1 }, { 'カテゴリ': '通信費', '並び順': 6 }]))), { 'カテゴリ': '積立・投資', 'グループ': '固定費', '並び順': 7 });
  assert.strictEqual(g('nisaCategoryRow')([{ 'カテゴリ': '積立・投資', '並び順': 7 }]), null);
});

(async () => {
  // 営業日の決まりが、PWA の calc.js（内閣府の祝日の一覧と照らし合わせ済み・10/6）と全部の日で同じか
  const calc = await import(require('url').pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'calc.js')).href);
  test('楽天証券：休みの日の決まりが、PWA の calc.js と 2020〜2035年の全部の日で同じ', () => {
    const diff = [];
    for (let d = new Date(2020, 0, 1); d.getFullYear() <= 2035; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      if (g('isMarketHoliday')(d) !== calc.isBankHoliday(d)) diff.push(calc.ymd(d));
    }
    assert.deepStrictEqual(diff, []);
  });

  let failed = 0;
  for (const [name, fn] of tests) {
    try { fn(); console.log('  ok  ' + name); }
    catch (e) { failed++; console.log('  NG  ' + name + '\n      ' + e.message.split('\n').join('\n      ')); }
  }
  console.log(`\n${tests.length - failed} / ${tests.length} 通過`);
  process.exit(failed ? 1 : 0);
})();
