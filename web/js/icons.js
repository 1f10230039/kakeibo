// カテゴリのアイコン（線の絵、24×24）と、支出トップのタイルの写真。10/6 に本人が確認した絵。

const CATEGORY_ICON = {
  '食費': '<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M14 3l-3 6M19 3l-4 6"/>',
  '日用品': '<path d="M5.5 8h13l-1 12h-11z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  '交通費': '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14"/><path d="M9 13.5h.01M15 13.5h.01"/><path d="M8.5 21l2-4M15.5 21l-2-4"/>',
  '健康・医療': '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M12 8v8M8 12h8"/>',
  'サブスク': '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9"/><path d="M19.5 4.5V9H15"/><path d="M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15"/><path d="M4.5 19.5V15H9"/>',
  '通信費': '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  '趣味・娯楽': '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M4 15h3v5H5.5A1.5 1.5 0 0 1 4 18.5zM20 15h-3v5h1.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
  '衣服': '<path d="M9 3.5L4 6.5l2 4 2-1V20h8V9.5l2 1 2-4-5-3a3 3 0 0 1-6 0z"/>',
  '美容': '<path d="M11 3l1.7 4.8L17.5 9.5l-4.8 1.7L11 16l-1.7-4.8L4.5 9.5l4.8-1.7z"/><path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  '交際費': '<circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M14.5 20a4.5 4.5 0 0 1 6-4.2"/>',
  'その他': '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  '未分類': '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.5"/><path d="M10 9.8a2.1 2.1 0 1 1 3 1.9c-.7.4-1 .9-1 1.6"/><path d="M12 16.2h.01"/>',
};

/** タイルの写真（images/category/）。未分類は写真なし。 */
export const CATEGORY_PHOTO = {
  '食費': 'food', '日用品': 'daily', '交通費': 'transport', '健康・医療': 'health', 'サブスク': 'subscription',
  '通信費': 'telecom', '趣味・娯楽': 'hobby', '衣服': 'clothes', '美容': 'beauty', '交際費': 'social', 'その他': 'other',
};

export const GROUP_CLASS = { '暮らし': 'g1', '固定費': 'g2', 'たのしみ': 'g3', 'その他': 'g4', '未分類': 'g0' };

/** カテゴリのアイコンの SVG。色は CSS の .g1〜.g4 / .g0（グループの色）で付ける。 */
export function categoryIcon(name) {
  const body = CATEGORY_ICON[name] || CATEGORY_ICON['その他'];
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

// 画面の小さなアイコン
export const UI_ICON = {
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/></svg>',
  stats: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M10 20V5M15 20v-7M20 20V9"/></svg>',
  budget: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4v8l5.5 5.5"/></svg>',
  assets: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6l6 6-6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  income: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10M8 10l4 4 4-4"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>',
};
