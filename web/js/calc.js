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
  return { date: d, payMonth, amount: debitAmount(txs, payMonth) };
}

/** その支払月（YYYY-MM）の引き落とし額。 */
function debitAmount(txs, payMonth) {
  return sum(txs.filter(t => isSpend(t) && t.source === 'メール' && t.payMonth === payMonth));
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
  return txs.filter(t => t.type === '支出' && t.status !== '取消' && t.status !== '速報' && !t.category);
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

/** 棒ごとの合計。kind：'支出'（初め）か '収入'（統計の切り替え・10/6）。 */
export function bucketTotals(txs, p, kind = '支出') {
  const pick = kind === '収入' ? incomeBetween : spendBetween;
  return p.buckets.map(b => ({ ...b, total: sum(pick(txs, b.start, b.end)) }));
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

// ---- 収入（段階③。いまは手入力。楽天銀行の取引通知メールの形が分かったら自動にする） ----

/** 収入として数える行：種類＝収入、状態≠取消。 */
export function isIncome(t) {
  return t.type === '収入' && t.status !== '取消';
}
export function incomeBetween(txs, start, end) {
  return txs.filter(t => isIncome(t) && between(t, start, end));
}
/** 今月の収入（1日〜今日の入金の合計）。 */
export function monthIncome(txs, today) {
  return sum(incomeBetween(txs, new Date(today.getFullYear(), today.getMonth(), 1), today));
}
/** 収入の名前の候補：前に使った名前（新しい順・重ならない）のあとに「バイト代」「お小遣い」（10/6 本人の例）。 */
export function incomeNames(txs, limit = 6) {
  const names = [];
  newestFirst(txs.filter(isIncome)).forEach(t => {
    const n = (t.memo || '').trim();
    if (n && !names.includes(n)) names.push(n);
  });
  ['バイト代', 'お小遣い'].forEach(n => { if (!names.includes(n)) names.push(n); });
  return names.slice(0, limit);
}

// ---- 予算（段階②。全体の予算だけ） ----

/**
 * その月（YYYY-MM）の予算。その月だけの予算があればそれ、なければ毎月の予算。どちらもなければ null。
 * 返すもの：{ amount, monthly（毎月の予算を使っているか） }
 */
export function budgetFor(budgets, month) {
  const all = (budgets || []).filter(b => b.target === '全体' && b.amount > 0);
  const only = all.find(b => b.month === month);
  if (only) return { amount: only.amount, monthly: false };
  const every = all.find(b => !b.month);
  return every ? { amount: every.amount, monthly: true } : null;
}

/**
 * 今月の予算の様子。
 * - spent：今月使った額（1日〜今日、ホームの「今月の支出」と同じ数え方）
 * - pace：今日の終わりまでに使ってよい目安（予算 × 今日までの日数 ÷ 月の日数）
 * - perDay：月末まで（今日を含む）1日あたりあといくら使えるか。残りがなければ 0
 */
export function budgetStatus(txs, amount, today) {
  const spent = monthToDate(txs, today);
  const days = lastDayOfMonth(today.getFullYear(), today.getMonth());
  const day = today.getDate();
  const daysLeft = days - day + 1;
  const remaining = amount - spent;
  return {
    amount, spent, remaining, daysLeft,
    over: remaining < 0,
    ratio: spent / amount,
    paceRatio: day / days,
    pace: Math.round((amount * day) / days),
    perDay: remaining > 0 ? Math.floor(remaining / daysLeft) : 0,
  };
}

// ---- 資産（段階③。楽天銀行と楽天証券 NISA を月1回手で記録する） ----

export const ASSET = { bank: '楽天銀行', nisa: '楽天証券 NISA' };

/**
 * 記録日ごとの資産。その日に記録しなかった項目は、前に記録した金額をそのまま使う（合計が急に減って見えないように）。
 * 返すもの（古い順）：{ date, bank, nisa, principal（その日に入れた値。入れていなければ null）,
 *                      now: { bank, nisa, principal }（前の記録も使った値）, total }
 */
export function assetHistory(assets) {
  const dates = [...new Set((assets || []).map(a => a.date))].sort();
  const now = { bank: null, nisa: null, principal: null };
  return dates.map(date => {
    const b = assets.find(a => a.date === date && a.item === ASSET.bank);
    const n = assets.find(a => a.date === date && a.item === ASSET.nisa);
    if (b) now.bank = b.amount;
    if (n) { now.nisa = n.amount; now.principal = n.principal; }
    return { date, bank: b ? b.amount : null, nisa: n ? n.amount : null, principal: n ? n.principal : null,
      now: { ...now }, total: (now.bank || 0) + (now.nisa || 0) };
  });
}

/** 月ごとの資産の合計（その月の最後の記録）。グラフ用。 */
export function assetMonthly(history) {
  const byMonth = new Map();
  history.forEach(h => byMonth.set(h.date.slice(0, 7), { month: h.date.slice(0, 7), date: h.date, total: h.total, now: h.now }));
  return [...byMonth.values()];
}

/** NISA の損益（評価額 − 元本）と、元本に対する割合。元本がなければ null。 */
export function nisaGain(nisa, principal) {
  if (nisa === null || principal === null || principal === undefined) return null;
  return { amount: nisa - principal, ratio: principal > 0 ? (nisa - principal) / principal : 0 };
}

/**
 * 残高（ホームの「残高」）：楽天銀行のいちばん新しい記録から、記録した日より後〜次の引き落とし日までの
 * カードの引き落としを引いた額（10/6 本人）。記録した日の引き落としは、もう引かれた金額を記録したとみなす。
 * ⚠️ 記録したあとの入金（バイト代など）や、カード以外の出入りは入らない。
 * 返すもの：{ amount, bankDate, bankAmount, debits: [{ date, payMonth, amount }] }。楽天銀行の記録がなければ null。
 */
export function spendable(txs, assets, today) {
  const bank = (assets || []).filter(a => a.item === ASSET.bank).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!bank) return null;
  const next = nextDebit(txs, today);
  const rec = parseYmd(bank.date);
  const debits = [];
  for (let m = new Date(rec.getFullYear(), rec.getMonth(), 1); ym(m) <= next.payMonth; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const d = debitDate(m.getFullYear(), m.getMonth());
    if (ymd(d) > bank.date && ymd(d) <= ymd(next.date)) debits.push({ date: d, payMonth: ym(m), amount: debitAmount(txs, ym(m)) });
  }
  return { amount: bank.amount - sum(debits), bankDate: bank.date, bankAmount: bank.amount, debits };
}

/**
 * ホームの「やること」に「資産を記録する」を出すか。25日〜月末は今月の分、1〜7日は先月の分。
 * その期間（前の25日から）にもう記録があれば出さない。返すもの：{ label, date（記録日の初期値） } か null。
 */
export function assetDue(assets, today) {
  const day = today.getDate();
  let from, label, date;
  if (day >= 25) {
    from = new Date(today.getFullYear(), today.getMonth(), 25);
    label = '今月の資産を記録する';
    date = today;
  } else if (day <= 7) {
    from = new Date(today.getFullYear(), today.getMonth() - 1, 25);
    label = '先月の資産を記録する';
    date = new Date(today.getFullYear(), today.getMonth(), 0); // 先月の末日
  } else return null;
  return (assets || []).some(a => a.date >= ymd(from)) ? null : { label, date: ymd(date) };
}

// ---- 表示 ----

export function yen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}
