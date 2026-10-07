// 特別な日（10/7 本人：クリスマス・誕生日・行事の日・イベントの日などに、決まった挨拶と写真を出したい）。
// 選んだもの：季節の行事・イベント・祝日・家族の日・誕生日と記念日（記念日はアプリで入れる。シートの「記念日」）。
// 1日に2つ重なったら、この順で先のもの：誕生日 → 記念日 → 行事・イベント（EVENTS の順） → 祝日 → 月の1日。
// 挨拶はどれも14文字まで（写真の上に 21px で1行。テストで確かめる）。記念日の名前は8文字まで（「今日は◯◯ですね」）。

import { holidayName } from './calc.js';

// ---- 年によって日が変わるもの（2026年から。表の先の年は、その行事を出さない） ----
const TABLE_FROM = 2026;
// 立春の日（2月◯日）。節分はその前の日。2026〜2059年。
// 2026・2027 は国立天文台の暦要項、2028 年からは Wikipedia「立春」の表（UT。国立天文台の 2020〜2027 年と1分以内で一致を確かめた・10/7）。
// 日付の境目に近いのは 2054年の 0:06 だけ（1分のずれでは変わらない）
const RISSHUN = '4443444344434443444344434443444334';
// 冬至の日（12月2◯日の◯）。2026〜2059年。出どころは立春と同じ（Wikipedia「冬至」）
const TOJI = '2211221122112211221122112211221122';
// 中秋の名月（十五夜＝旧暦8月15日）。2026〜2050年。国立天文台 暦Wiki「中秋の名月とは」の表。
// 2033年は旧暦の決まりで日が定まらない年（2033年問題）。国立天文台の挙げる3つの案のうち2つが 9/8 なので 9/8 にした
const JUGOYA = ['09-25', '09-15', '10-03', '09-22', '09-12', '10-01', '09-19', '09-08', '09-27', '09-16', '10-04', '09-24', '09-13',
  '10-02', '09-21', '09-10', '09-28', '09-17', '10-05', '09-25', '09-15', '10-04', '09-22', '09-11', '09-30'];

const fromTable = (table, y) => (y >= TABLE_FROM && y - TABLE_FROM < table.length ? table[y - TABLE_FROM] : null);
const night = slot => slot === 'night' || slot === 'late';

/** その月の第 n 日曜の日付。 */
function nthSunday(y, m0, n) {
  return 1 + ((7 - new Date(y, m0, 1).getDay()) % 7) + (n - 1) * 7;
}

/**
 * 行事・イベント・家族の日。when(y, m, d) で当たる日、text(slot) が挨拶、photo が写真（images/hero/event-◯◯.webp。なければ月の写真）。
 * 敬老の日は祝日なので、下の祝日の挨拶（「今日は敬老の日ですね」）で出る。
 */
export const EVENTS = [
  { key: 'newyear', when: (y, m, d) => m === 1 && d <= 3, text: () => '新年おめでとうございます', photo: 'newyear' },
  { key: 'omisoka', when: (y, m, d) => m === 12 && d === 31, text: s => (night(s) ? '今年もおつかれさまでした' : 'よいお年を'), photo: 'omisoka' },
  { key: 'christmas-eve', when: (y, m, d) => m === 12 && d === 24, text: s => (night(s) ? 'メリークリスマス' : 'クリスマスイブですね'), photo: 'christmas' },
  { key: 'christmas', when: (y, m, d) => m === 12 && d === 25, text: () => 'メリークリスマス', photo: 'christmas' },
  { key: 'setsubun', when: (y, m, d) => m === 2 && Number(fromTable(RISSHUN, y)) - 1 === d, text: s => (night(s) ? '鬼は外、福は内' : '今日は節分ですね'), photo: 'setsubun' },
  { key: 'valentine', when: (y, m, d) => m === 2 && d === 14, text: () => 'ハッピーバレンタイン', photo: 'valentine' },
  { key: 'hinamatsuri', when: (y, m, d) => m === 3 && d === 3, text: () => '今日はひなまつりですね', photo: 'hinamatsuri' },
  { key: 'whiteday', when: (y, m, d) => m === 3 && d === 14, text: () => '今日はホワイトデーですね', photo: 'whiteday' },
  { key: 'aprilfool', when: (y, m, d) => m === 4 && d === 1, text: () => 'エイプリルフールですね', photo: 'aprilfool' },
  { key: 'kodomo', when: (y, m, d) => m === 5 && d === 5, text: () => '今日はこどもの日ですね', photo: 'kodomo' },
  { key: 'mothers', when: (y, m, d) => m === 5 && d === nthSunday(y, 4, 2), text: () => '今日は母の日ですね', photo: 'mothers' },
  { key: 'fathers', when: (y, m, d) => m === 6 && d === nthSunday(y, 5, 3), text: () => '今日は父の日ですね', photo: 'fathers' },
  { key: 'tanabata', when: (y, m, d) => m === 7 && d === 7, text: s => (night(s) ? '願いごと、しましたか？' : '今日は七夕ですね'), photo: 'tanabata' },
  { key: 'obon', when: (y, m, d) => m === 8 && d >= 13 && d <= 16, text: () => 'お盆の時期ですね', photo: 'obon' },
  { key: 'jugoya', when: (y, m, d) => fromTable(JUGOYA, y) === `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, text: () => '今夜は十五夜ですね', photo: 'jugoya' },
  { key: 'halloween', when: (y, m, d) => m === 10 && d === 31, text: () => 'ハッピーハロウィン', photo: 'halloween' },
  { key: 'toji', when: (y, m, d) => m === 12 && 20 + Number(fromTable(TOJI, y)) === d, text: s => (night(s) ? 'ゆず湯で温まりましょう' : '今日は冬至ですね'), photo: 'toji' },
];

export const BIRTHDAY_TEXT = 'お誕生日おめでとうございます';
export const ANNIVERSARY_NAME_MAX = 8;
export const anniversaryText = name => `今日は${name}ですね`;

const mdOf = (m, d) => `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** 誕生日・記念日がその日か。2/29 の日は、うるう年でない年は 2/28 に出す。 */
function onDay(md, y, m, d) {
  return md === mdOf(m, d) || (md === '02-29' && !isLeap(y) && m === 2 && d === 28);
}

/**
 * その日の特別な日。{ key, text, photo } か null。
 * now は日付そのもので見る（0〜5時でも、その日の日付）。slot は挨拶の時間帯（theme.js の greetSlot）。
 * days はシートの「記念日」（{ kind: '誕生日'|'記念日', name, md: 'MM-DD' }）。
 */
export function specialDay(now, slot, days = []) {
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  const birthday = days.find(x => x.kind === '誕生日' && onDay(x.md, y, m, d));
  if (birthday) return { key: 'birthday', text: BIRTHDAY_TEXT, photo: 'birthday' };
  const anniversary = days.find(x => x.kind === '記念日' && x.name && onDay(x.md, y, m, d));
  if (anniversary) return { key: 'anniversary', text: anniversaryText(anniversary.name), photo: null };
  const ev = EVENTS.find(e => e.when(y, m, d));
  if (ev) return { key: ev.key, text: ev.text(slot), photo: ev.photo };
  const holiday = holidayName(now);
  if (holiday) return { key: 'holiday', text: `今日は${holiday}ですね`, photo: null };
  if (d === 1 && (slot === 'morning' || slot === 'day')) return { key: 'month-start', text: '新しい月のはじまりです', photo: null };
  return null;
}
