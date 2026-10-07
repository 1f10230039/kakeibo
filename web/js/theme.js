// 季節と時間帯で、ホームの写真・挨拶・色を決める（10/6 決定。docs/design/home_3案.html と同じ決まり）。
// 季節：春 3〜5月／夏 6〜8月／秋 9〜11月／冬 12〜2月
// 時間帯：朝 5〜10時／昼 10〜16時／夕方 16〜19時／夜 19〜5時
// 色：朝・夕方＝A（アイボリー×紺）、昼＝B（白×緑）、夜＝C（紺×金）

import { isHoliday } from './calc.js';
import { specialDay } from './days.js';

export function seasonOf(month) {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

export function slotOf(hour) {
  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 16) return 'day';
  if (hour >= 16 && hour < 19) return 'evening';
  return 'night';
}

// ---- 挨拶（10/7 本人：バリエーションを増やしたい） ----
// 時間帯ごとの候補から1つ選ぶ。挨拶の時間帯は写真より細かい（夜のうち 23〜5時は「深夜」）。
// 同じ日の同じ時間帯なら、何度開いても同じ挨拶（開くたびに変わると落ち着かないので）。日が変わると、候補の次のものになる。
// 0〜5時は前の日の夜の続きとして数える（金曜の深夜は、まだ金曜の夜）。特別な日（誕生日・行事・祝日・月の1日など。days.js）は決まった挨拶。
// 写真の上に1行で収まるように、ふだんの挨拶は12文字まで、特別な日は14文字まで（テストで確かめる）。

export const GREETINGS = {
  morning: ['おはようございます', '今日もいい一日を', '朝ごはん、食べましたか？', '今日もがんばりましょう'],
  day: ['こんにちは', 'ひと息つきませんか', '調子はどうですか'],
  evening: ['おつかれさまです', '今日もおつかれさまでした', '夕ごはん、何にしますか？'],
  night: ['こんばんは', '今日もおつかれさまでした', 'ゆっくり休んでくださいね'],
  late: ['遅くまでおつかれさまです', 'そろそろ休みませんか', '夜ふかしはほどほどに'],
};

/** その日だけ候補に足すもの。d は数える日（0〜5時なら前の日）、h は時刻、slot は挨拶の時間帯。 */
export const EXTRA_GREETINGS = [
  { text: 'お昼、食べましたか？', when: (d, h) => h >= 11 && h < 14 },
  { text: '午後もマイペースで', when: (d, h, slot) => slot === 'day' && h >= 13 },
  { text: '今週もはじまりましたね', when: (d, h, slot) => slot === 'morning' && d.getDay() === 1 && !isOffDay(d) },
  { text: 'よい休日を', when: (d, h, slot) => (slot === 'morning' || slot === 'day') && isOffDay(d) },
  { text: 'のんびり過ごせていますか', when: (d, h, slot) => slot === 'day' && isOffDay(d) },
  { text: '今週もおつかれさまでした', when: (d, h, slot) => (slot === 'evening' || slot === 'night') && d.getDay() === 5 && !isOffDay(d) },
  { text: 'よい週末を', when: (d, h, slot) => slot === 'night' && d.getDay() === 5 },
  { text: '明日から平日ですね', when: (d, h, slot) => (slot === 'evening' || slot === 'night') && isOffDay(d) && !isOffDay(addDay(d, 1)) },
  { text: '過ごしやすい季節ですね', when: (d, h, slot) => slot === 'day' && [4, 5, 10, 11].includes(d.getMonth() + 1) },
  { text: '水分とってくださいね', when: (d, h, slot) => slot === 'day' && seasonOf(d.getMonth() + 1) === 'summer' },
  { text: '秋の夜長ですね', when: (d, h, slot) => (slot === 'night' || slot === 'late') && seasonOf(d.getMonth() + 1) === 'autumn' },
  { text: '暖かくしてくださいね', when: (d, h, slot) => slot !== 'day' && seasonOf(d.getMonth() + 1) === 'winter' },
];

/** 休みの日：土日と祝日（振替休日も）。 */
function isOffDay(d) {
  return d.getDay() === 0 || d.getDay() === 6 || isHoliday(d);
}

function addDay(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 挨拶の時間帯：写真の時間帯（slotOf）の夜のうち、23〜5時を 'late'（深夜）にしたもの。 */
export function greetSlot(hour) {
  const slot = slotOf(hour);
  return slot === 'night' && (hour >= 23 || hour < 5) ? 'late' : slot;
}

/** 数える日：0〜5時は前の日。 */
function countDay(now) {
  return addDay(now, now.getHours() < 5 ? -1 : 0);
}

/** その日・その時間帯に出しうる挨拶（特別な日（days.js）なら、その挨拶だけ）。days はシートの「記念日」。 */
export function greetingCandidates(now, days = []) {
  const h = now.getHours();
  const slot = greetSlot(h);
  const special = specialDay(now, slot, days);
  if (special) return [special.text];
  const d = countDay(now);
  return [...GREETINGS[slot], ...EXTRA_GREETINGS.filter(g => g.when(d, h, slot)).map(g => g.text)];
}

/** いまの挨拶。候補を、数える日の通し番号で順に回す（候補が同じなら、次の日には必ず別のものになる）。 */
export function greetingOf(now, days = []) {
  const list = greetingCandidates(now, days);
  const d = countDay(now);
  const dayNo = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  return list[dayNo % list.length];
}

const THEME_BY_SLOT = { morning: 'a', day: 'b', evening: 'a', night: 'c' };

// ---- 写真（10/7 本人：月ごとに変える＋行事の日は専用の写真） ----
// 1. 特別な日に写真があれば event-◯◯.webp（時間帯は共通）
// 2. 月と時間帯の写真 m01-morning.webp 〜 m12-night.webp
// 3. なければ、季節と時間帯の写真（10/6 の16枚）
// あるファイルだけをここに並べる（写真を足したらここにも足す。テストでフォルダの中身と同じか確かめる）
export const HERO_FILES = new Set([
  ...['spring', 'summer', 'autumn', 'winter'].flatMap(s => ['morning', 'day', 'evening', 'night'].map(t => `${s}-${t}.webp`)),
]);

export function heroOf(now, special, files = HERO_FILES) {
  const slot = slotOf(now.getHours());
  const candidates = [
    special?.photo && `event-${special.photo}.webp`,
    `m${String(now.getMonth() + 1).padStart(2, '0')}-${slot}.webp`,
    `${seasonOf(now.getMonth() + 1)}-${slot}.webp`,
  ];
  return `images/hero/${candidates.find(f => f && files.has(f))}`;
}

/** いまの見た目。写真の上の文字はどれも白（上をうっすら暗くして読みやすくする）。days はシートの「記念日」。 */
export function lookOf(now, days = []) {
  const season = seasonOf(now.getMonth() + 1);
  const slot = slotOf(now.getHours());
  const special = specialDay(now, greetSlot(now.getHours()), days);
  return {
    season, slot,
    theme: THEME_BY_SLOT[slot],
    hero: heroOf(now, special),
    greeting: greetingOf(now, days),
    special: special?.key || null,
  };
}
