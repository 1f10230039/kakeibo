// 画面づくりの小さな道具。
// 画面の文字はすべて esc() を通してから HTML に入れる（店名などに < や " が入っていても、HTML として動かないように）。

import { yen } from './calc.js';
import { categoryIcon, GROUP_CLASS, UI_ICON } from './icons.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 金額。「金額を隠す」（F-10）がオンなら伏せる。 */
export function money(n, hidden) {
  return `<span class="money">${hidden ? '¥ ••••' : esc(yen(n))}</span>`;
}

export function iconMark(category, group) {
  return `<span class="mark ${GROUP_CLASS[group] || 'g4'}">${categoryIcon(category || '未分類')}</span>`;
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
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => {
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
    document.removeEventListener('keydown', onKey);
    sheetCloser = null;
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('.sheet-dim').addEventListener('click', close);
  wrap.querySelector('.sheet-close').addEventListener('click', close);
  sheetCloser = close;
  addClearButtons(wrap);
  onMount(wrap.querySelector('.sheet'), close);
}

export function closeSheet() {
  if (sheetCloser) sheetCloser();
}

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

// ---- お知らせ（画面の下に少し出る） ----

export function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
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
