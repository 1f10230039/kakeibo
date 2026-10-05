// 家計簿 PWA の入口。画面の切り替え（#/home など）と、データの取り直しをまとめる。
// 画面ごとの中身は views/ にある。各画面は render(ctx) で HTML を返し、mount(root, ctx) でボタンに動きを付ける。

import * as api from './api.js';
import { lookOf } from './theme.js';
import { toast, closeSheet, icon } from './ui.js';
import * as home from './views/home.js';
import * as stats from './views/stats.js';
import { openDetail, openManual } from './views/sheets.js';
import * as pages from './views/pages.js';

const ROUTES = {
  home, stats,
  budget: pages.soon('予算', '②'),
  assets: pages.soon('資産', '③'),
  menu: pages.menu, rules: pages.rules, unclassified: pages.unclassified, stale: pages.stale, key: pages.key,
};
const TABS = [['home', 'ホーム'], ['stats', '統計'], ['budget', '予算'], ['assets', '資産']];

const state = { data: null, fetchedAt: 0, hidden: readHidden(), loading: false };
const root = document.getElementById('app');
const nav = document.getElementById('tabbar');

function readHidden() {
  try { return localStorage.getItem('kakeibo.hidden') === '1'; } catch (_) { return false; }
}

function route() {
  const [path, q] = location.hash.replace(/^#\/?/, '').split('?');
  return { name: ROUTES[path] ? path : 'home', query: new URLSearchParams(q || '') };
}

function context() {
  const today = new Date();
  return {
    data: state.data, fetchedAt: state.fetchedAt, hidden: state.hidden, today, look: lookOf(today),
    rerender: render,
    refresh,
    write,
    openDetail: id => openDetail(context(), id),
    openManual: () => openManual(context()),
    toggleHidden() {
      state.hidden = !state.hidden;
      try { localStorage.setItem('kakeibo.hidden', state.hidden ? '1' : '0'); } catch (_) { /* 保存できなくても動く */ }
      render();
    },
  };
}

/** 季節と時間帯で、色（テーマ）と写真を変える。 */
function applyLook(look) {
  document.documentElement.dataset.theme = look.theme;
  document.documentElement.style.setProperty('--hero-img', `url("${look.hero}")`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
}

function render() {
  const ctx = context();
  applyLook(ctx.look);
  let { name } = route();
  if (!api.hasCredentials()) name = 'key';
  const view = ROUTES[name];

  nav.innerHTML = TABS.map(([r, label]) => `<a class="tab${r === name ? ' on' : ''}" href="#/${r}">${icon(r)}<span>${label}</span></a>`).join('')
    + `<a class="tab side-only${name === 'menu' ? ' on' : ''}" href="#/menu">${icon('menu')}<span>メニュー</span></a>`;
  nav.hidden = name === 'key';
  document.body.dataset.page = name;

  if (name !== 'key' && !state.data) {
    root.innerHTML = `<div class="loading"><div class="spinner"></div><p>データを取っています…</p></div>`;
    return;
  }
  root.innerHTML = view.render(ctx);
  view.mount(root, ctx);
}

/** データを取り直す。失敗しても、前に取れたデータがあればそれで表示を続ける。 */
async function refresh(announce = false) {
  if (state.loading) return;
  state.loading = true;
  try {
    const { data, fetchedAt } = await api.fetchData();
    Object.assign(state, { data, fetchedAt });
    if (announce) toast('取り直しました');
  } catch (e) {
    if (e instanceof api.AuthError) {
      toast(e.message, 'warn');
      if (!state.data) location.hash = '#/key';
    } else {
      toast(state.data ? 'オフラインです。前に取れたデータを表示しています' : e.message, 'warn');
    }
  } finally {
    state.loading = false;
    render();
  }
}

/** 書き込み（カテゴリの変更・手入力など）をして、終わったら取り直す。 */
async function write(promise, doneText) {
  try {
    await promise;
    toast(doneText);
  } catch (e) {
    toast(e instanceof api.NetworkError ? '送れませんでした。電波のあるところでもう一度' : e.message, 'warn');
    return;
  }
  await refresh();
}

// ---- 起動 ----

window.addEventListener('hashchange', () => {
  closeSheet();
  const { name, query } = route();
  if (name === 'stats') stats.enter(query);
  render();
  window.scrollTo(0, 0);
});

const cached = api.cachedData();
if (cached) Object.assign(state, { data: cached.data, fetchedAt: cached.fetchedAt });
if (route().name === 'stats') stats.enter(route().query);
render();
if (api.hasCredentials()) refresh();

// 時間帯が変わったら（開きっぱなしでも）写真と色を変える
setInterval(() => applyLook(lookOf(new Date())), 60 * 1000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* なくても動く */ });
}
