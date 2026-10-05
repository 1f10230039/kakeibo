// 季節と時間帯で、ホームの写真・挨拶・色を決める（10/6 決定。docs/design/home_3案.html と同じ決まり）。
// 季節：春 3〜5月／夏 6〜8月／秋 9〜11月／冬 12〜2月
// 時間帯：朝 5〜10時／昼 10〜16時／夕方 16〜19時／夜 19〜5時
// 色：朝・夕方＝A（アイボリー×紺）、昼＝B（白×緑）、夜＝C（紺×金）

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

/** 挨拶は写真の時間帯より細かい（夜のうち 23〜5時は「深夜」）。 */
export function greetingOf(hour) {
  const slot = slotOf(hour);
  if (slot === 'morning') return 'おはようございます';
  if (slot === 'day') return 'こんにちは';
  if (slot === 'evening') return 'おつかれさまです';
  return hour >= 23 || hour < 5 ? '遅くまでおつかれさまです' : 'こんばんは';
}

const THEME_BY_SLOT = { morning: 'a', day: 'b', evening: 'a', night: 'c' };

/** いまの見た目。写真の上の文字は16枚とも白（上をうっすら暗くして読みやすくする）。 */
export function lookOf(now) {
  const season = seasonOf(now.getMonth() + 1);
  const slot = slotOf(now.getHours());
  return {
    season, slot,
    theme: THEME_BY_SLOT[slot],
    hero: `images/hero/${season}-${slot}.webp`,
    greeting: greetingOf(now.getHours()),
  };
}
