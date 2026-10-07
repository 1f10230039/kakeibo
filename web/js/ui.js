// 画面づくりの小さな道具。
// 画面の文字はすべて esc() を通してから HTML に入れる（店名などに < や " が入っていても、HTML として動かないように）。

import { yen } from './calc.js';
import { categoryIcon, GROUP_CLASS, UI_ICON } from './icons.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 金額。「金額を隠す」（F-10）がオンなら伏せる。
 *  count を渡すと、前に出していた値から数字が動いて変わる（countUp）。data-key は隠す／出すの切り替えで入れ替えるため。 */
export function money(n, hidden, count = '') {
  if (hidden) return `<span class="money" data-key="h">¥ ••••</span>`;
  return `<span class="money" data-key="v"${count ? ` data-count="${esc(count)}" data-n="${Number(n) || 0}"` : ''}>${esc(yen(n))}</span>`;
}

/** マイナスもありうる金額（残高など）。マイナスは「−¥1,234」を注意の色で。 */
export function signedMoney(n, hidden) {
  return n < 0 && !hidden ? `<span class="neg">−${money(-n, hidden)}</span>` : money(n, hidden);
}

/** 切り替えボタン（白い背景が、選んだほうへすべって動く）。items：[[値, 表示], …]。押すと data-<attr> の値が分かる。 */
export function seg(attr, items, current, label) {
  const i = Math.max(0, items.findIndex(([v]) => v === current));
  return `<div class="seg" role="group" aria-label="${esc(label)}" data-vars="--i:${i};--n:${items.length}">${items.map(([v, text]) =>
    `<button class="${v === current ? 'on' : ''}" data-${attr}="${esc(v)}" aria-pressed="${v === current}">${esc(text)}</button>`).join('')}</div>`;
}

/** 切り替えボタンの見た目だけ先に変える（保存の返事を待たずに背景を動かす）。 */
export function selectSeg(btn) {
  const box = btn.closest('.seg');
  const all = [...box.querySelectorAll('button')];
  all.forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
  box.style.setProperty('--i', all.indexOf(btn));
}

export function iconMark(category, group) {
  return `<span class="mark ${GROUP_CLASS[group] || 'g4'}">${categoryIcon(category || '未分類')}</span>`;
}

/** 収入の行の印（入金のアイコン）。 */
export function incomeMark() {
  return `<span class="mark g1 income-mark">${UI_ICON.income}</span>`;
}

export function icon(name) {
  return UI_ICON[name] || '';
}

// ---- 下から出るシート（S-05 利用の詳細・S-07 手入力） ----

let sheetCloser = null;

export function openSheet(innerHtml, onMount) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-dim"></div><div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-bar"><span class="grab"></span><button class="sheet-close" aria-label="閉じる">${UI_ICON.close}</button></div>${innerHtml}</div>`;
  document.body.appendChild(wrap);
  void wrap.offsetHeight; // 閉じた位置をいったん描いてから開く（そうしないと、すべり出す動きにならない）
  wrap.classList.add('open');
  const sheet = wrap.querySelector('.sheet');
  const close = () => {
    if (sheetCloser !== close) return;
    wrap.classList.add('closing');
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 320);
    document.removeEventListener('keydown', onKey);
    sheetCloser = null;
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('.sheet-dim').addEventListener('click', close);
  wrap.querySelector('.sheet-close').addEventListener('click', close);
  dragToClose(sheet, close);
  sheetCloser = close;
  addClearButtons(wrap);
  applyVars(wrap); // シートの中の切り替えボタンの背景の位置
  onMount(sheet, close);
  // 画面いっぱいまで伸びたシートは、ガラスを不透明に近づける（Apple の決まり。.sheet.tall）
  requestAnimationFrame(() => sheet.classList.toggle('tall', sheet.offsetHeight > window.innerHeight * 0.8));
}

// ---- リキッドグラスの見た目（10/7 本人：iOS 27 の設定のスライダーのように、とても透明 〜 しっかり色付き） ----
// 0〜100 をこの端末に保存し、CSS の --glass（0〜1）にする。初めは 40（iOS 27 の標準に近い濃さ）
const KEY_GLASS = 'kakeibo.glass';
export const GLASS_DEFAULT = 40;

export function readGlass() {
  try {
    const raw = localStorage.getItem(KEY_GLASS);
    const v = Number(raw);
    return raw !== null && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : GLASS_DEFAULT;
  } catch (_) { return GLASS_DEFAULT; }
}
export function applyGlass(v) {
  document.documentElement.style.setProperty('--glass', String(v / 100));
}
export function saveGlass(v) {
  applyGlass(v);
  try { localStorage.setItem(KEY_GLASS, String(v)); } catch (_) { /* 保存できなくても、いま開いている間は効く */ }
}

/** 上の取っ手のあたりを下へなぞると、指についてきて、80px より下で離すと閉じる。 */
function dragToClose(sheet, close) {
  const bar = sheet.querySelector('.sheet-bar');
  let y0 = null, dy = 0;
  bar.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; dy = 0; sheet.classList.add('dragging'); }, { passive: true });
  bar.addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  const end = () => {
    if (y0 === null) return;
    y0 = null;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    if (dy > 80) close();
  };
  bar.addEventListener('touchend', end);
  bar.addEventListener('touchcancel', end);
}

export function closeSheet() {
  if (sheetCloser) sheetCloser();
}

/** 金額の欄（「¥」の横の大きな数字）：数字だけにして 3けたごとに区切り、幅を中身に合わせる。読むときは amountOf。 */
export function bindAmountInput(el) {
  const format = () => {
    const digits = el.value.replace(/[^0-9０-９]/g, '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    el.value = digits ? Number(digits).toLocaleString('ja-JP') : '';
    el.style.width = `${Math.max(2, el.value.length) + 1}ch`; // 「¥」のすぐ横に数字が並ぶように
  };
  el.addEventListener('input', format);
  format();
}
export const amountOf = el => Number(el.value.replace(/,/g, ''));

/** data-clear の付いた文字の欄に、中身を消す × を付ける。 */
export function addClearButtons(root) {
  root.querySelectorAll('input[data-clear]').forEach(input => {
    if (input.parentElement.classList.contains('clear-wrap')) return;
    const wrap = document.createElement('span');
    wrap.className = 'clear-wrap';
    input.replaceWith(wrap);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clear-btn';
    btn.setAttribute('aria-label', '消す');
    btn.innerHTML = UI_ICON.close;
    wrap.appendChild(btn);
    const sync = () => wrap.classList.toggle('has-value', input.value !== '');
    input.addEventListener('input', sync);
    btn.addEventListener('click', () => { input.value = ''; sync(); input.focus(); });
    sync();
  });
}

// ---- ⓘ（説明の吹き出し） ----
// 画面にはパッと見て分かることだけを置き、出し方などの説明は ⓘ を押したときだけ出す（10/7 本人）。
// 吹き出しは #app の外（body）に出すので、画面を書き換えても消えない。シートの中でも使える（シートは閉じない）。

/** ⓘ のボタン。text は押したときに出す説明。 */
export function info(text, label = '説明を見る') {
  return `<button type="button" class="info" data-info="${esc(text)}" aria-label="${esc(label)}" aria-expanded="false">${UI_ICON.info}</button>`;
}

let tipEl = null, tipFor = null;

function closeTip() {
  if (!tipEl) return;
  const el = tipEl;
  tipFor?.setAttribute('aria-expanded', 'false');
  tipEl = tipFor = null;
  el.classList.remove('show');
  setTimeout(() => el.remove(), 200);
}

/** ボタンのすぐ下（下に場所がなければ上）に置き、画面の左右からはみ出さないようにする。 */
function placeTip(el, btn) {
  const r = btn.getBoundingClientRect(), w = Math.min(280, window.innerWidth - 32);
  el.style.width = w + 'px';
  const left = Math.min(window.innerWidth - 16 - w, Math.max(16, r.left + r.width / 2 - w / 2));
  el.style.left = left + 'px';
  el.style.setProperty('--arrow', `${Math.round(r.left + r.width / 2 - left)}px`);
  const h = el.offsetHeight;
  const below = r.bottom + 8 + h < window.innerHeight - 100; // 下のタブバーにかからないか
  el.classList.toggle('above', !below);
  el.style.top = (below ? r.bottom + 8 : r.top - 8 - h) + 'px';
}

// 押したところで受け取る（カードのリンクや行のボタンより先に。ⓘ を押してもそちらは動かない）
document.addEventListener('click', e => {
  const btn = e.target.closest?.('[data-info]');
  if (!btn) {
    if (tipEl && !e.target.closest?.('.info-tip')) closeTip();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (tipFor === btn) { closeTip(); return; }
  closeTip();
  const el = document.createElement('div');
  el.className = 'info-tip';
  el.setAttribute('role', 'tooltip');
  el.textContent = btn.dataset.info;
  document.body.appendChild(el);
  placeTip(el, btn);
  void el.offsetHeight;
  el.classList.add('show');
  btn.setAttribute('aria-expanded', 'true');
  tipEl = el;
  tipFor = btn;
}, true);
window.addEventListener('scroll', closeTip, { capture: true, passive: true }); // シートの中のスクロールでも閉じる
window.addEventListener('resize', closeTip);
window.addEventListener('hashchange', closeTip);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTip(); });

// ---- お知らせ（画面の下に少し出る） ----

export function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
}

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
let statusEl = null, savingCount = 0, savedCount = 0, statusTimer = 0;

/**
 * 裏で保存しているあいだ、画面の下に「ぐるぐる＋保存しています…」を出す（10/7 本人）。押した直後に出る。
 * いくつか続けて保存したときは、全部終わるまで出しておき、最後に「✓ 保存しました」（2件からは「✓ 2件 保存しました」）に変えて消す。
 * 返すもの：{ done(文), fail(文) }。fail は赤いお知らせを出す。
 */
export function saving() {
  savingCount++;
  clearTimeout(statusTimer);
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.className = 'toast status';
    statusEl.setAttribute('role', 'status');
    document.body.appendChild(statusEl);
    void statusEl.offsetHeight; // 出る前の位置をいったん描いてから、ふわっと出す
  }
  statusEl.classList.add('show');
  statusEl.innerHTML = '<span class="spin" aria-hidden="true"></span>保存しています…';
  let ended = false;
  const end = (text, failed) => {
    if (ended) return;
    ended = true;
    savingCount--;
    if (failed) toast(text, 'warn'); else savedCount++;
    if (savingCount > 0) return; // まだ保存しているものがある
    const el = statusEl, n = savedCount; // n：この続けての保存で、うまくいった数（全部失敗なら 0）
    savedCount = 0;
    if (n) el.innerHTML = `${CHECK}${esc(n > 1 ? `${n}件 保存しました` : text)}`;
    statusTimer = setTimeout(() => { el.classList.remove('show'); statusTimer = setTimeout(() => { el.remove(); if (statusEl === el) statusEl = null; }, 300); }, n ? 1600 : 0);
  };
  return { done: text => end(text, false), fail: text => end(text, true) };
}

/** 押したボタンを「ぐるぐる＋文」にして押せなくする（返事を待つ保存・削除のとき）。戻す関数を返す。 */
export function busy(btn, text = '保存しています…') {
  if (!btn) return () => {};
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('busy');
  btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(text)}`;
  return () => { btn.disabled = false; btn.classList.remove('busy'); btn.innerHTML = html; };
}

const placed = new WeakSet(); // もう位置を決めた金額の札

/**
 * 棒グラフ（統計・固定費）で選んだ棒の札：棒より横に広いので、となりの棒のほうが高いと隠れる（10/7 本人）。
 * 札が横に重なる棒のうち、いちばん高い棒（伸び縮みし終わったときの高さ）より上に出す。初めて出たときは、動かさずにその場所に置く。
 */
export function liftValue(root) {
  const val = root.querySelector('.bar .val');
  if (!val) return;
  const cols = [...root.querySelectorAll('.bar .col')];
  const own = val.parentElement, i = cols.indexOf(own), w = val.offsetWidth, r = own.getBoundingClientRect();
  const left = i === 0 ? r.left : i === cols.length - 1 ? r.right - w : (r.left + r.right - w) / 2; // CSS と同じ寄せ方（端の棒は内側へ）
  const heightOf = c => Number(/--h:([\d.]+)/.exec(c.dataset.vars || '')?.[1] || 0);
  const lift = Math.max(0, ...cols.filter(c => {
    const b = c.getBoundingClientRect();
    return b.right > left + 2 && b.left < left + w - 2; // 角の丸みにかするだけなら数えない
  }).map(heightOf));
  if (placed.has(val)) { val.style.setProperty('--lift', lift); return; }
  placed.add(val);
  val.style.transition = 'none';
  val.style.setProperty('--lift', lift);
  void val.offsetWidth; // いまの位置で一度描いてから、動きを戻す
  val.style.transition = '';
}

/** 横スワイプ（前後の期間へ）。dir：-1＝右へなぞった（前へ）、+1＝左へなぞった（次へ）。 */
export function onSwipe(el, handler) {
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) handler(dx < 0 ? 1 : -1);
  });
}

// ---- 動き ----
// 画面を丸ごと作り直すと、CSS の動き（transition）は始まらない。ホームと統計は morph で変わったところだけ書き換えて、
// 棒の高さ・切り替えボタンの背景・色などが、前の状態から次の状態へなめらかに動くようにする。

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** target の中身を html に合わせる。同じ場所の同じ種類の要素は使い回し、data-key のある要素は key で見分ける。
 *  style は JS（applyVars・ドラッグなど）だけが書くので、ここでは触らない。 */
export function morph(target, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(target, tpl.content);
}

const keyOf = n => (n.nodeType === 1 ? n.getAttribute('data-key') : null);

function patchChildren(parent, next) {
  const olds = [...parent.childNodes];
  const keyed = new Map();
  olds.forEach(n => { const k = keyOf(n); if (k !== null) keyed.set(k, n); });
  const plain = olds.filter(n => keyOf(n) === null);
  const used = new Set();
  let p = 0;
  const result = [...next.childNodes].map(nn => {
    const k = keyOf(nn);
    let on = null;
    if (k !== null) on = keyed.get(k) || null;
    else if (plain[p] && plain[p].nodeName === nn.nodeName) on = plain[p++];
    if (!on || on.nodeName !== nn.nodeName || used.has(on)) return nn; // 新しく出てきた要素（CSS の @keyframes が始まる）
    used.add(on);
    patchNode(on, nn);
    return on;
  });
  olds.forEach(n => { if (!used.has(n)) n.remove(); });
  result.forEach((n, i) => { if (parent.childNodes[i] !== n) parent.insertBefore(n, parent.childNodes[i] || null); });
}

function patchNode(on, nn) {
  if (on.nodeType !== 1) { if (on.nodeValue !== nn.nodeValue) on.nodeValue = nn.nodeValue; return; }
  for (const { name } of [...on.attributes]) if (name !== 'style' && !nn.hasAttribute(name)) on.removeAttribute(name);
  for (const { name, value } of [...nn.attributes]) if (on.getAttribute(name) !== value) on.setAttribute(name, value);
  if (on.tagName === 'INPUT') { on.value = nn.getAttribute('value') ?? ''; on.checked = nn.hasAttribute('checked'); }
  patchChildren(on, nn);
}

/** data-vars="--h:.5;--i:2" を CSS の変数にする（CSP で style="" は使えないので、JS から入れる）。
 *  data-from があって初めて出た要素は、いったん data-from の値で描いてから data-vars へ動かす（棒が 0 から伸びる）。 */
export function applyVars(root) {
  const parse = s => s.split(';').filter(Boolean).map(kv => kv.split(':'));
  const fresh = [];
  root.querySelectorAll('[data-vars]').forEach(el => {
    if (el.dataset.from && !el._varsShown && !reduceMotion()) {
      parse(el.dataset.from).forEach(([k, v]) => el.style.setProperty(k, v));
      fresh.push(el);
    } else {
      parse(el.dataset.vars).forEach(([k, v]) => el.style.setProperty(k, v));
    }
    el._varsShown = true;
  });
  if (!fresh.length) return;
  void document.body.offsetHeight; // 始まりの値をいったん描く
  fresh.forEach(el => parse(el.dataset.vars).forEach(([k, v]) => el.style.setProperty(k, v)));
}

const tweens = new Map();
const easeOut = p => 1 - Math.pow(1 - p, 3);

/** ms かけて fn(0〜1) を呼ぶ（最後はゆっくり止まる）。同じ key で新しく始めたら、前のは止める。 */
export function tween(key, ms, fn) {
  const token = {};
  tweens.set(key, token);
  if (reduceMotion()) { fn(1); return; }
  fn(0);
  const t0 = performance.now();
  const frame = now => {
    if (tweens.get(key) !== token) return;
    const p = Math.min(1, (now - t0) / ms);
    fn(easeOut(p));
    if (p < 1) requestAnimationFrame(frame); else tweens.delete(key);
  };
  requestAnimationFrame(frame);
}

const shownNumbers = new Map(); // data-count ごとに、いま画面に出ている金額

/** data-count の付いた金額を、いま出ている値から新しい値まで数字を動かして見せる（初めては 0 から）。 */
export function countUp(root) {
  root.querySelectorAll('[data-count]').forEach(el => {
    const key = el.dataset.count, to = Number(el.dataset.n);
    const from = shownNumbers.has(key) ? shownNumbers.get(key) : 0;
    if (from === to) { tweens.delete('count:' + key); el.textContent = yen(to); return; }
    tween('count:' + key, 800, p => {
      const now = Math.round(from + (to - from) * p);
      shownNumbers.set(key, now);
      el.textContent = yen(now);
    });
  });
}
