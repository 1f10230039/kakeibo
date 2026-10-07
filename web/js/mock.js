// 見本のデータ（?mock=1 を付けたときだけ使う）。金額・店名はすべてダミー。
// 本物の API と同じ形で返し、書き込みはこのページを開いている間だけメモリ上で反映する。
import { UserError } from './api.js';

const today = new Date();
const d = (offset) => {
  const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const nextMonth = (date) => {
  const [y, m] = date.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

// 月末（back か月前）。資産の見本の記録日
const monthEnd = back => {
  const x = new Date(today.getFullYear(), today.getMonth() - back + 1, 0);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const assetRows = (back, bank, nisa, principal) => [
  { date: monthEnd(back), item: '楽天銀行', amount: bank, principal: null },
  { date: monthEnd(back), item: '楽天証券 NISA', amount: nisa, principal },
];

// 毎月の固定費の見本（back か月前の day 日。今日より後は入れない）。固定費の画面（S-12）の確認用
const monthly = (back, day) => {
  const last = new Date(today.getFullYear(), today.getMonth() - back + 1, 0).getDate();
  const x = new Date(today.getFullYear(), today.getMonth() - back, Math.min(day, last));
  return x > today ? null : Math.round((x - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
};
const fixedRows = () => [
  ...[0, 1, 2, 3, 4, 5].map(b => [monthly(b, 5), 'APPLE COM BILL', 1200, 'サブスク']),
  ...[1, 2, 3, 4, 5].map(b => [monthly(b, 26), 'MOBILE CARRIER', b >= 4 ? 3270 : 2970, '通信費']), // 3か月前に安いプランへ
  ...[0, 1, 2, 3, 4].map(b => [monthly(b, 11), 'VIDEO SERVICE', b === 0 ? 1590 : 1490, 'サブスク']), // 今月から値上げ
  ...[2, 3, 4, 5].map(b => [monthly(b, 3), 'MUSIC APP', 980, 'サブスク']), // 2か月前で解約
].filter(([o]) => o !== null).map(([o, m, a, c]) => tx(o, m, a, c));
// 積立NISA の見本（楽天証券のメール・積立の設定から。カードではないので支払月なし）
const nisaRows = () => [0, 1, 2, 3, 4, 5].map(b => [monthly(b, 1), b]).filter(([o]) => o !== null)
  .map(([o, b]) => tx(o, 'SAMPLE FUND', 10000, '積立・投資', { source: '楽天証券', payMonth: '', status: b >= 4 ? '設定から' : '確定' }));

let seq = 0;
function tx(offset, merchant, amount, category, extra = {}) {
  const date = d(offset);
  return {
    id: `m_mock${++seq}_1`, type: '支出', date, merchant, amount, payMonth: nextMonth(date),
    status: '確定', category, categoryBy: category ? '対応表' : '未分類', source: 'メール', memo: '', ...extra,
  };
}

const DB = {
  transactions: [
    tx(0, '', 680, '', { status: '速報' }),
    tx(-1, 'SAMPLE MART', 1520, '食費'),
    tx(-1, 'JR EAST', 1240, '交通費'),
    tx(-3, 'RECORD SHOP', 2400, '趣味・娯楽'),
    tx(-4, 'CAFE EXAMPLE', 860, ''),
    tx(-5, 'DRUG STORE', 1980, '日用品'),
    tx(-6, 'SAMPLE MART', 2310, '食費'),
    tx(-8, 'CLOTHING CO', 5900, '衣服'),
    tx(-9, 'IZAKAYA', 4200, '交際費'),
    tx(-12, 'SAMPLE MART', 1890, '食費'),
    tx(-15, 'BOOKSTORE', 1650, ''),
    tx(-16, '', 3200, '', { status: '速報' }),
    tx(-20, 'JR EAST', 2480, '交通費'),
    tx(-24, 'SALON', 4400, '美容'),
    tx(-27, 'SAMPLE MART', 2750, '食費'),
    tx(-31, 'CLINIC', 1500, '健康・医療'),
    tx(-34, 'SAMPLE MART', 3120, '食費'),
    tx(-38, 'GAME STORE', 6800, '趣味・娯楽'),
    tx(-52, 'IZAKAYA', 3800, '交際費'),
    tx(-60, 'SAMPLE MART', 2600, '食費'),
    tx(-90, 'SAMPLE MART', 2900, '食費'),
    ...fixedRows(),
    ...nisaRows(),
    { id: 'h_mock1', type: '支出', date: d(-2), merchant: '', amount: 300, payMonth: '', status: '手入力', category: '食費', categoryBy: '個別', source: '手入力', memo: 'コンビニ' },
    ...[[-3, 5000, 'お小遣い'], [-11, 52000, 'バイト代'], [-41, 48000, 'バイト代']].map(([o, amount, memo], i) => (
      { id: `h_inc${i}`, type: '収入', date: d(o), merchant: '', amount, payMonth: '', status: '手入力', category: '', categoryBy: '', source: '手入力', memo })),
  ],
  categories: [
    ['食費', '暮らし'], ['日用品', '暮らし'], ['交通費', '暮らし'], ['健康・医療', '暮らし'],
    ['サブスク', '固定費'], ['通信費', '固定費'], ['積立・投資', '固定費'],
    ['趣味・娯楽', 'たのしみ'], ['衣服', 'たのしみ'], ['美容', 'たのしみ'], ['交際費', 'たのしみ'],
    ['その他', 'その他'],
  ].map(([name, group], i) => ({ name, group, order: i + 1 })),
  rules: [
    { merchant: 'SAMPLE MART', category: '食費', displayName: '' }, { merchant: 'JR EAST', category: '交通費', displayName: '' },
    { merchant: 'APPLE COM BILL', category: 'サブスク', displayName: 'Apple One' }, { merchant: 'VIDEO SERVICE', category: 'サブスク', displayName: '動画サービス' },
    { merchant: 'SAMPLE FUND', category: '積立・投資', displayName: '積立NISA' },
  ],
  budgets: [{ month: '', target: '全体', amount: 50000 }],
  assets: [...assetRows(3, 182000, 61200, 60000), ...assetRows(2, 176500, 70300, 70000), ...assetRows(1, 190300, 81900, 80000)],
  settings: { weekStart: '月', lastIngest: `${d(0)} 06:12`, unreadableMails: 0 },
  days: [{ kind: '誕生日', name: '誕生日', md: '03-15' }, { kind: '記念日', name: 'はじめた日', md: '10-06' }], // 見本（本物の誕生日ではない）
};

const norm = s => String(s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
// 本物っぽく少し待つ。?mock=slow なら本物の GAS くらい（2.5秒）待ち、?mock=fail なら書き込みを失敗させる（保存中の表示・元に戻すの確認用）
// ?mock=old は、10/7 より前の GAS ②（saveDetail がなく、返事に新しいデータを入れない）のふり
const MODE = new URLSearchParams(location.search).get('mock');
const wait = () => new Promise(r => setTimeout(r, MODE === 'slow' || MODE === 'fail' || MODE === 'old' ? 2500 : 250));

/** 書き込みのあとの新しいデータ（本物の API の fresh の代わり）。古い GAS のふりのときは返さない。 */
export function mockData() {
  return MODE === 'old' ? null : JSON.parse(JSON.stringify(DB));
}

export async function mockCall(action, p) {
  await wait();
  if (MODE === 'fail' && action !== 'getData') throw new Error('mock：わざと失敗させました');
  if (MODE === 'old' && ['saveDetail', 'setDays', 'addPointPayment'].includes(action)) throw new UserError('知らない action です');
  return run(action, p);
}

function run(action, p) {
  const find = id => DB.transactions.find(t => t.id === id);
  switch (action) {
    case 'getData': return JSON.parse(JSON.stringify(DB));
    case 'saveDetail': {
      const t = find(p.id);
      if (p.always) {
        const was = { ...t };
        run('setRule', { merchant: t.merchant, category: p.category, displayName: p.name });
        if (was.categoryBy === '個別' && was.category !== p.category) Object.assign(t, { category: p.category });
        t.memo = '';
      } else {
        if ((p.category || '') !== (t.category || '')) Object.assign(t, { category: p.category, categoryBy: p.category ? '個別' : '未分類' });
        t.memo = p.name;
      }
      return { id: p.id };
    }
    case 'setCategory': { const t = find(p.id); t.category = p.category; t.categoryBy = p.category ? '個別' : '未分類'; return { id: p.id }; }
    case 'setRule': {
      const r = DB.rules.find(r => norm(r.merchant) === norm(p.merchant));
      if (r) { r.category = p.category; if (p.displayName !== undefined) r.displayName = p.displayName; }
      else DB.rules.push({ merchant: p.merchant, category: p.category, displayName: p.displayName || '' });
      let updated = 0;
      DB.transactions.filter(t => t.categoryBy !== '個別' && t.status !== '取消' && norm(t.merchant) === norm(p.merchant))
        .forEach(t => { t.category = p.category; t.categoryBy = '対応表'; updated++; });
      return { updated };
    }
    case 'addManual': {
      const id = 'h_mock' + Date.now();
      DB.transactions.push({ id, type: '支出', date: p.date, merchant: '', amount: p.amount, payMonth: '', status: '手入力',
        category: p.category || '', categoryBy: p.category ? '個別' : '未分類', source: '手入力', memo: p.memo || '' });
      return { id };
    }
    case 'importCsv': {
      p.add.forEach((a, i) => DB.transactions.push({ id: `c_mock${Date.now()}_${i}`, type: '支出', date: a.date, merchant: a.merchant, amount: a.amount,
        payMonth: a.payMonth, status: '確定', category: '', categoryBy: '未分類', source: 'CSV', memo: '' }));
      p.cancel.forEach(id => { find(id).status = '取消'; });
      return { added: p.add.length, cancelled: p.cancel.length };
    }
    case 'addPointPayment': {
      const id = 'h_pt' + Date.now();
      DB.transactions.push({ id, type: '収入', date: p.date, merchant: '', amount: p.amount, payMonth: p.date.slice(0, 7), status: 'ポイント払い', category: '', categoryBy: '', source: '手入力', memo: 'ポイント' });
      return { id };
    }
    case 'addIncome': {
      const id = 'h_inc' + Date.now();
      DB.transactions.push({ id, type: '収入', date: p.date, merchant: '', amount: p.amount, payMonth: '', status: '手入力', category: '', categoryBy: '', source: '手入力', memo: p.memo || '' });
      return { id };
    }
    case 'setMemo': find(p.id).memo = p.memo; return { id: p.id };
    case 'deleteManual': case 'resolveSokuho': find(p.id).status = '取消'; return { id: p.id };
    case 'setSetting': DB.settings.weekStart = p.value; return p;
    case 'setDays':
      DB.days = [...(p.birthday ? [{ kind: '誕生日', name: '誕生日', md: p.birthday }] : []), ...p.anniversaries.map(a => ({ kind: '記念日', name: a.name, md: a.md }))];
      return p;
    case 'setAssetRecord': {
      const put = (item, amount, principal) => {
        DB.assets = DB.assets.filter(a => !(a.date === p.date && a.item === item));
        if (amount !== null) DB.assets.push({ date: p.date, item, amount, principal });
      };
      put('楽天銀行', p.bank, null);
      put('楽天証券 NISA', p.nisa, p.nisaPrincipal);
      return { date: p.date };
    }
    case 'setBudget': {
      DB.budgets = DB.budgets.filter(b => !(b.target === '全体' && b.month === p.month));
      if (p.amount !== null) DB.budgets.push({ month: p.month, target: '全体', amount: p.amount });
      return p;
    }
    default: throw new Error('mock: ' + action);
  }
}
