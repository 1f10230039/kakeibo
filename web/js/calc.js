// 集計の計算。画面にも API にも触らない関数だけを置く（Node.js でテストできる：web/test/）。
// 決まりは docs/03_システム設計.md の7章。日付はすべて端末の時刻（日本時間の想定）で扱う。

export const GROUPS = ['暮らし', '固定費', 'たのしみ', 'その他', '未分類'];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ---- 日付 ----

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function ym(d) {
  return ymd(d).slice(0, 7);
}
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
export function lastDayOfMonth(y, m0) {
  return new Date(y, m0 + 1, 0).getDate();
}
export function weekdayName(d) {
  return WEEKDAYS[d.getDay()];
}
/** M/D（曜） */
export function mdw(d) {
  return `${d.getMonth() + 1}/${d.getDate()}（${weekdayName(d)}）`;
}

/** その日を含む週の最初の日。weekStart は '月' か '日'（設定の「週の始まり」）。 */
export function startOfWeek(d, weekStart) {
  const first = weekStart === '日' ? 0 : 1;
  const back = (d.getDay() - first + 7) % 7;
  return addDays(d, -back);
}

// ---- 取引 ----

/** 支出として数える行：種類＝支出、状態≠取消（速報も含む）。 */
export function isSpend(t) {
  return t.type === '支出' && t.status !== '取消';
}
export function groupOf(t, categories) {
  if (!t.category) return '未分類';
  const c = categories.find(c => c.name === t.category);
  return c ? c.group : 'その他';
}
export function sum(txs) {
  return txs.reduce((a, t) => a + t.amount, 0);
}
function between(t, start, end) {
  const s = ymd(start), e = ymd(end);
  return t.date >= s && t.date <= e;
}
export function spendBetween(txs, start, end) {
  return txs.filter(t => isSpend(t) && between(t, start, end));
}

/** 今月の支出（1日〜今日）。 */
export function monthToDate(txs, today) {
  return sum(spendBetween(txs, new Date(today.getFullYear(), today.getMonth(), 1), today));
}

/**
 * 先月の同じ日まで（先月1日〜先月の「今日と同じ日」）。
 * 先月にその日がなければ（3/31 に対する 2/31 など）先月末まで。
 */
export function lastMonthToSameDay(txs, today) {
  const y = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
  const m0 = (today.getMonth() + 11) % 12;
  const day = Math.min(today.getDate(), lastDayOfMonth(y, m0));
  return sum(spendBetween(txs, new Date(y, m0, 1), new Date(y, m0, day)));
}

/**
 * その月の楽天カードの引き落とし日：27日。土日なら次の月曜。
 * ⚠️ 祝日は数えていない（祝日の一覧を持っていないため）。
 */
export function debitDate(y, m0) {
  const d = new Date(y, m0, 27);
  if (d.getDay() === 6) return addDays(d, 2);
  if (d.getDay() === 0) return addDays(d, 1);
  return d;
}

/**
 * 次の引き落とし：今月の引き落とし日を過ぎていなければ今月、過ぎていたら来月。
 * 金額は「支払月＝その月」のカードの利用（速報は仮の支払月）の合計。手入力（現金など）は入れない。
 */
export function nextDebit(txs, today) {
  let d = debitDate(today.getFullYear(), today.getMonth());
  if (ymd(today) > ymd(d)) d = debitDate(today.getFullYear(), today.getMonth() + 1);
  const payMonth = ym(new Date(d.getFullYear(), d.getMonth(), 1));
  const amount = sum(txs.filter(t => isSpend(t) && t.source === 'メール' && t.payMonth === payMonth));
  return { date: d, payMonth, amount };
}

/** カテゴリごとの合計（多い順、0円は出さない）。 */
export function categoryTotals(txs) {
  const map = new Map();
  txs.filter(isSpend).forEach(t => map.set(t.category || '未分類', (map.get(t.category || '未分類') || 0) + t.amount));
  return [...map].map(([name, total]) => ({ name, total })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);
}

/** グループごとの合計と、その中のカテゴリの内訳（円グラフ用）。グループの並びは GROUPS の順。 */
export function groupTotals(txs, categories) {
  const byCat = categoryTotals(txs);
  return GROUPS.map(group => {
    const cats = byCat.filter(c => (c.name === '未分類' ? '未分類' : (categories.find(x => x.name === c.name) || { group: 'その他' }).group) === group);
    return { group, total: cats.reduce((a, c) => a + c.total, 0), categories: cats };
  }).filter(g => g.total > 0);
}

/** 振り分けを待っている行：確定か手入力で、カテゴリが空のもの（速報は店名がまだないので入れない）。 */
export function unclassified(txs) {
  return txs.filter(t => t.status !== '取消' && t.status !== '速報' && !t.category);
}

/** 確定にならないまま days 日（初期値14日）たった速報。 */
export function staleSokuho(txs, today, days = 14) {
  const limit = ymd(addDays(today, -days));
  return txs.filter(t => t.status === '速報' && t.date <= limit);
}

/** 新しい順。同じ日なら id の逆順（あとに取り込んだものが上）。 */
export function newestFirst(txs) {
  return [...txs].sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
}

// ---- 統計の期間 ----

/**
 * 統計の期間と、棒グラフの棒（buckets）。
 * unit：'week'（棒は1日ずつ）／'month'（1週ずつ）／'year'（1か月ずつ）。offset は今の期間から何個前後か。
 */
export function period(unit, offset, today, weekStart) {
  if (unit === 'week') {
    const start = addDays(startOfWeek(today, weekStart), offset * 7);
    const end = addDays(start, 6);
    const buckets = [...Array(7)].map((_, i) => {
      const d = addDays(start, i);
      return { start: d, end: d, label: weekdayName(d), sub: `${d.getMonth() + 1}/${d.getDate()}` };
    });
    return { unit, start, end, label: `${start.getMonth() + 1}/${start.getDate()}〜${end.getMonth() + 1}/${end.getDate()}`, buckets };
  }
  if (unit === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const buckets = [];
    let s = start;
    while (s <= end) {
      let e = addDays(startOfWeek(s, weekStart), 6);
      if (e > end) e = end;
      buckets.push({ start: s, end: e, label: `${buckets.length + 1}週`, sub: `${s.getDate()}〜${e.getDate()}日` });
      s = addDays(e, 1);
    }
    return { unit, start, end, label: `${start.getFullYear()}年${start.getMonth() + 1}月`, buckets };
  }
  const y = today.getFullYear() + offset;
  const buckets = [...Array(12)].map((_, i) => ({ start: new Date(y, i, 1), end: new Date(y, i + 1, 0), label: `${i + 1}月`, sub: '' }));
  return { unit, start: new Date(y, 0, 1), end: new Date(y, 11, 31), label: `${y}年`, buckets };
}

export function bucketTotals(txs, p) {
  return p.buckets.map(b => ({ ...b, total: sum(spendBetween(txs, b.start, b.end)) }));
}

// ---- 名前（サブタイトル） ----

/** 利用先をくらべやすい形にそろえる（GAS の normalizeMerchant と同じ決まり）。 */
export function normalizeMerchant(name) {
  return String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** 対応表から「そろえた利用先 → 表示名」の表を作る。 */
export function displayNames(rules) {
  const map = new Map();
  rules.forEach(r => { if (r.displayName) map.set(normalizeMerchant(r.merchant), r.displayName); });
  return map;
}

/** 一覧で用途の横に出す名前：この利用だけの名前（メモ）があればそれ、なければ店の表示名、どちらもなければ空。 */
export function subtitleOf(t, names) {
  return t.memo || (t.merchant && names.get(normalizeMerchant(t.merchant))) || '';
}

// ---- 表示 ----

export function yen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}
