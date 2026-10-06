// 見本のデータ（?mock=1 を付けたときだけ使う）。金額・店名はすべてダミー。
// 本物の API と同じ形で返し、書き込みはこのページを開いている間だけメモリ上で反映する。

const today = new Date();
const d = (offset) => {
  const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const nextMonth = (date) => {
  const [y, m] = date.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

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
    tx(-2, 'APPLE COM BILL', 1200, 'サブスク'),
    tx(-3, 'RECORD SHOP', 2400, '趣味・娯楽'),
    tx(-4, 'CAFE EXAMPLE', 860, ''),
    tx(-5, 'DRUG STORE', 1980, '日用品'),
    tx(-6, 'SAMPLE MART', 2310, '食費'),
    tx(-8, 'CLOTHING CO', 5900, '衣服'),
    tx(-9, 'IZAKAYA', 4200, '交際費'),
    tx(-11, 'MOBILE CARRIER', 2970, '通信費'),
    tx(-12, 'SAMPLE MART', 1890, '食費'),
    tx(-15, 'BOOKSTORE', 1650, ''),
    tx(-16, '', 3200, '', { status: '速報' }),
    tx(-20, 'JR EAST', 2480, '交通費'),
    tx(-24, 'SALON', 4400, '美容'),
    tx(-27, 'SAMPLE MART', 2750, '食費'),
    tx(-31, 'CLINIC', 1500, '健康・医療'),
    tx(-34, 'SAMPLE MART', 3120, '食費'),
    tx(-38, 'GAME STORE', 6800, '趣味・娯楽'),
    tx(-45, 'APPLE COM BILL', 1200, 'サブスク'),
    tx(-52, 'IZAKAYA', 3800, '交際費'),
    tx(-60, 'SAMPLE MART', 2600, '食費'),
    tx(-75, 'APPLE COM BILL', 1200, 'サブスク'),
    tx(-90, 'SAMPLE MART', 2900, '食費'),
    { id: 'h_mock1', type: '支出', date: d(-2), merchant: '', amount: 300, payMonth: '', status: '手入力', category: '食費', categoryBy: '個別', source: '手入力', memo: 'コンビニ' },
  ],
  categories: [
    ['食費', '暮らし'], ['日用品', '暮らし'], ['交通費', '暮らし'], ['健康・医療', '暮らし'],
    ['サブスク', '固定費'], ['通信費', '固定費'],
    ['趣味・娯楽', 'たのしみ'], ['衣服', 'たのしみ'], ['美容', 'たのしみ'], ['交際費', 'たのしみ'],
    ['その他', 'その他'],
  ].map(([name, group], i) => ({ name, group, order: i + 1 })),
  rules: [
    { merchant: 'SAMPLE MART', category: '食費', displayName: '' }, { merchant: 'JR EAST', category: '交通費', displayName: '' },
    { merchant: 'APPLE COM BILL', category: 'サブスク', displayName: 'Apple One' },
  ],
  budgets: [{ month: '', target: '全体', amount: 50000 }], assets: [],
  settings: { weekStart: '月', lastIngest: `${d(0)} 06:12`, unreadableMails: 0 },
};

const norm = s => String(s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
const wait = () => new Promise(r => setTimeout(r, 250)); // 本物っぽく少し待つ

export async function mockCall(action, p) {
  await wait();
  const find = id => DB.transactions.find(t => t.id === id);
  switch (action) {
    case 'getData': return JSON.parse(JSON.stringify(DB));
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
    case 'setMemo': find(p.id).memo = p.memo; return { id: p.id };
    case 'deleteManual': case 'resolveSokuho': find(p.id).status = '取消'; return { id: p.id };
    case 'setSetting': DB.settings.weekStart = p.value; return p;
    case 'setBudget': {
      DB.budgets = DB.budgets.filter(b => !(b.target === '全体' && b.month === p.month));
      if (p.amount !== null) DB.budgets.push({ month: p.month, target: '全体', amount: p.amount });
      return p;
    }
    default: throw new Error('mock: ' + action);
  }
}
