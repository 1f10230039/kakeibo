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

// ---- 祝日（いまの祝日法の決まりで計算する。毎年データを入れ直さなくてよいように） ----
// 内閣府の「国民の祝日」の一覧（syukujitsu.csv）と、2022〜2027年の全部の日で一致を確かめた（10/6）。
// ⚠️ 特別な年だけの祝日（2019年の即位の日など）や、法律が変わったときは合わなくなる。
// ⚠️ 春分の日・秋分の日は、天文の計算から出した近い式（1980〜2099年）。正式には前の年の2月に官報で決まる。

const FIXED_HOLIDAYS = new Set(['1-1', '2-11', '2-23', '4-29', '5-3', '5-4', '5-5', '8-11', '11-3', '11-23']);

/** その月の第 n 月曜の日付。 */
function nthMonday(y, m0, n) {
  return 1 + ((8 - new Date(y, m0, 1).getDay()) % 7) + (n - 1) * 7;
}

/** 国民の祝日そのもの（振替休日・国民の休日は入れない）。 */
function isNationalHoliday(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  if (FIXED_HOLIDAYS.has(`${m}-${day}`)) return true;
  if ((m === 1 && day === nthMonday(y, 0, 2)) || (m === 7 && day === nthMonday(y, 6, 3))      // 成人の日・海の日
    || (m === 9 && day === nthMonday(y, 8, 3)) || (m === 10 && day === nthMonday(y, 9, 2))) { // 敬老の日・スポーツの日
    return true;
  }
  const k = y - 1980, leap = Math.floor(k / 4);
  if (m === 3 && day === Math.floor(20.8431 + 0.242194 * k - leap)) return true; // 春分の日
  if (m === 9 && day === Math.floor(23.2488 + 0.242194 * k - leap)) return true; // 秋分の日
  return false;
}

/** 祝日・振替休日・国民の休日。 */
export function isHoliday(d) {
  if (isNationalHoliday(d)) return true;
  // 振替休日：日曜の祝日のあと、いちばん近い祝日でない日（祝日が続くときは、続いた先の日）
  for (let back = 1, p = addDays(d, -1); isNationalHoliday(p); back++, p = addDays(d, -back)) {
    if (p.getDay() === 0) return true;
  }
  // 国民の休日：前の日と次の日がどちらも祝日の日
  return isNationalHoliday(addDays(d, -1)) && isNationalHoliday(addDays(d, 1));
}

/** 銀行の休み：土日・祝日・年末年始（12/31〜1/3）。 */
export function isBankHoliday(d) {
  const m = d.getMonth() + 1, day = d.getDate();
  return d.getDay() === 0 || d.getDay() === 6 || isHoliday(d) || (m === 12 && day === 31) || (m === 1 && day <= 3);
}

/**
 * その月の楽天カードの引き落とし日：27日。金融機関の休業日なら翌営業日
 * （楽天カードのよくある質問「翌月27日（金融機関が休業日の場合は、翌営業日）」で確認・10/6）。
 * いまの祝日の決まりで 27日から先に祝日に当たるのは、27日が土曜で 29日（月）が昭和の日のときだけ（→ 30日）。
 */
export function debitDate(y, m0) {
  let d = new Date(y, m0, 27);
  while (isBankHoliday(d)) d = addDays(d, 1);
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
      // 「第◯週」は分かりにくいので日付で出す（10/7 本人）：label は始まりの日、sub は期間（例：9/8〜9/14）
      const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
      buckets.push({ start: s, end: e, label: md(s), sub: `${md(s)}〜${md(e)}` });
      s = addDays(e, 1);
    }
    return { unit, start, end, label: `${start.getFullYear()}年${start.getMonth() + 1}月`, buckets };
  }
  const y = today.getFullYear() + offset;
  const buckets = [...Array(12)].map((_, i) => ({ start: new Date(y, i, 1), end: new Date(y, i + 1, 0), label: `${i + 1}月`, sub: '' }));
  return { unit, start: new Date(y, 0, 1), end: new Date(y, 11, 31), label: `${y}年`, buckets };
}

/**
 * 棒グラフの縦の目盛り（10/7 本人）：いちばん高い棒が入る、きりのいい金額の線を4本まで。
 * 間隔は 1・2・2.5・5 ×10ⁿ 円から選ぶ（1円より細かくはしない）。棒の高さは top を 1 として描く。
 */
export function niceAxis(max) {
  if (!(max > 0)) return { top: 1, ticks: [] };
  const raw = max / 4, pow = Math.max(1, 10 ** Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw);
  const n = Math.ceil(max / step);
  return { top: n * step, ticks: [...Array(n)].map((_, i) => (i + 1) * step) };
}

/** 目盛りの金額：1万円からは「◯万」（例：2.5万）、それより下は「5,000」。 */
export function axisYen(v) {
  return v >= 10000 ? `${+(v / 10000).toFixed(2)}万` : v.toLocaleString('ja-JP');
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

// ---- 固定費（S-12。10/7 本人：毎月いくらか・推移・サブスクごと・今月まだ来ていないもの） ----

export const FIXED_GROUP = '固定費';

/** 固定費のカテゴリ：グループが「固定費」のもの（いまはサブスク・通信費）。カテゴリの並び順。 */
export function fixedCategories(categories) {
  return categories.filter(c => c.group === FIXED_GROUP).map(c => c.name);
}

/** 固定費を店ごとにまとめるときの鍵：利用先（表記ゆれはそろえる）。利用先のない手入力は名前（メモ）かカテゴリ。 */
export function fixedKey(t) {
  return t.merchant ? 'm:' + normalizeMerchant(t.merchant) : 'h:' + (t.memo || t.category);
}

/** 固定費の1件の名前：店の表示名 → この行の名前 → 利用先 → カテゴリ。 */
export function fixedName(t, names) {
  return (t.merchant && names.get(normalizeMerchant(t.merchant))) || t.memo || t.merchant || t.category;
}

/** 'YYYY-MM' を n か月ずらす。 */
export function addMonths(month, n) {
  return ym(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
}

/**
 * 固定費のまとめ。月は利用日で数える（ほかの画面と同じ）。今日より後の日付の行は入れない。
 * - months：[{ month, total, byCat: { カテゴリ: 円 }, expected }] 古い順、今月まで最大 n か月（データのある月から）。expected は今月だけ（まだ来ていない分）
 * - thisMonth：今月（1日〜今日）の合計、lastMonth：先月まるごとの合計、forecast：今月の見込み（thisMonth＋まだ来ていない分）
 * - pending：今月まだ来ていないもの [{ key, name, category, amount, day, late }]
 *     先月あったのに今月まだのもの。同じ店で先月より回数が少ないときは、金額の合わない分（例：APPLE が先月2回・今月1回）
 *     day は先月来た日（今月にその日がなければ月末）、late はその日を過ぎてもまだのもの
 * - items：いまの固定費（今月か先月に来た店）[{ key, name, category, amount, days, change, arrived, lastId }] 金額の多い順
 *     amount は今月分がそろっていれば今月、まだなら先月の合計。change は、その前の月から回数が同じで金額が変わったときの差
 * 店は利用先（表記ゆれはそろえる）でまとめ、名前は 店の表示名 → この行の名前 → 利用先 の順。利用先のない手入力は名前かカテゴリでまとめる。
 */
export function fixedSummary(txs, categories, rules, today, n = 12) {
  const cats = fixedCategories(categories);
  const names = displayNames(rules);
  const cur = ym(today), prev = addMonths(cur, -1), todayStr = ymd(today);
  const list = txs.filter(t => isSpend(t) && cats.includes(t.category) && t.date <= todayStr);

  // 店ごとにまとめる
  const byItem = new Map();
  list.forEach(t => {
    const key = fixedKey(t);
    if (!byItem.has(key)) byItem.set(key, { key, merchant: t.merchant || '', charges: [] });
    byItem.get(key).charges.push(t);
  });
  const inMonth = (it, m) => it.charges.filter(t => t.date.slice(0, 7) === m).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const lastDay = lastDayOfMonth(today.getFullYear(), today.getMonth());

  const pending = [], items = [];
  byItem.forEach(it => {
    const newest = [...it.charges].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const name = (it.merchant && names.get(normalizeMerchant(it.merchant))) || newest.memo || it.merchant || newest.category;
    const base = { key: it.key, name, category: newest.category, lastId: newest.id };
    const now = inMonth(it, cur), before = inMonth(it, prev);
    // 今月まだ来ていない分：先月の利用から、今月と同じ金額のものを消していき、残ったもの（回数の差の分だけ、遅い日のほう）
    if (before.length > now.length) {
      const left = now.map(t => t.amount);
      const rest = before.filter(t => { const i = left.indexOf(t.amount); if (i < 0) return true; left.splice(i, 1); return false; });
      rest.slice(-(before.length - now.length)).forEach(t => {
        const day = Math.min(Number(t.date.slice(8, 10)), lastDay);
        pending.push({ ...base, amount: t.amount, day, late: day < today.getDate() });
      });
    }
    if (!now.length && !before.length) return; // 先月も今月も来ていない＝もう止めたもの（推移には残る）
    const arrived = now.length > 0 && now.length >= before.length;
    const shownMonth = arrived ? cur : prev;
    const shown = arrived ? now : before;
    const prior = inMonth(it, addMonths(shownMonth, -1));
    const amount = sum(shown);
    items.push({
      ...base, amount, arrived,
      days: [...new Set(shown.map(t => Number(t.date.slice(8, 10))))],
      change: prior.length === shown.length && prior.length ? amount - sum(prior) : 0,
    });
  });
  items.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ja'));
  pending.sort((a, b) => a.day - b.day);

  // 月ごとの推移：データのある最初の月（固定費に限らず）から、今月まで
  const firstSeen = txs.filter(isSpend).map(t => t.date.slice(0, 7)).sort()[0] || cur;
  const first = firstSeen < cur ? firstSeen : cur;
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = addMonths(cur, -i);
    if (m < first) continue;
    const inM = list.filter(t => t.date.slice(0, 7) === m);
    const byCat = Object.fromEntries(cats.map(c => [c, sum(inM.filter(t => t.category === c))]));
    months.push({ month: m, total: sum(inM), byCat, expected: m === cur ? sum(pending) : 0 });
  }
  const thisMonth = months.at(-1).total;
  const lastMonth = months.length > 1 ? months.at(-2).total : 0;
  return { cats, months, thisMonth, lastMonth, forecast: thisMonth + sum(pending), pending, items };
}

// ---- 表示 ----

export function yen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}
