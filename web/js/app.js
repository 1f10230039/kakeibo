// 家計簿 PWA の入口。画面の切り替え（#/home など）と、データの取り直しをまとめる。
// 画面ごとの中身は views/ にある。各画面は render(ctx) で HTML を返し、mount(root, ctx) でボタンに動きを付ける。

import * as api from './api.js';
import { lookOf } from './theme.js';
import { toast, saving, closeSheet, icon, addClearButtons, morph, applyVars, countUp, reduceMotion } from './ui.js';
import * as home from './views/home.js';
import * as stats from './views/stats.js';
import * as budget from './views/budget.js';
import * as assets from './views/assets.js';
import * as income from './views/income.js';
import * as fixed from './views/fixed.js';
import * as csvimport from './views/csvimport.js';
import { openDetail, openManual } from './views/sheets.js';
import * as pages from './views/pages.js';

const ROUTES = {
  home, stats,
  budget,
  assets, income, fixed, csv: csvimport,
  menu: pages.menu, rules: pages.rules, days: pages.days, unclassified: pages.unclassified, stale: pages.stale, key: pages.key,
};
const TABS = [['home', 'ホーム'], ['stats', '統計'], ['budget', '予算'], ['assets', '資産']];
// 画面の深さ。深いほうへ進むときは右から、戻るときは左から入ってくる。同じ深さ（タブどうし）は下からふわっと
const DEPTH = { menu: 1, unclassified: 1, stale: 1, income: 1, fixed: 1, rules: 2, days: 2, csv: 2 };
// 画面に入ったとき、上から順に少しずつ遅らせて出す部分
const RISE = '.spend, .income-main, .fixed-main, .fixed-chart, .fixed-mini, .csv-summary, .budget-main, .budget-empty, .asset-main, .asset-chart, .asset-spend, .asset-empty, .pair, .due, .todo, .home-side > *, .page-head, .controls, .period, .chart, .tx-list > *, .lead, .menu-group-label, .list, .progress, .sort-card, .switch-row, .field, .picker-group, .btn.wide, .note, .credit, .empty';

const state = { data: null, fetchedAt: 0, hidden: readHidden(), loading: false };
// 画面に出すデータ（state.data）＝ サーバーから最後に取れたデータ（server）＋ まだ返事の来ていない保存（pending）
let server = null;
const pending = new Set(); // { apply(data) }：data をその保存のあとの形に書き換える（何度当てても同じになる書き方にする）
let appliedAt = 0;         // いまの server を取りに行った（送った）時刻。これより前に送った返事では上書きしない
let freshCount = 0;        // 書き込みの返事で新しいデータを受け取った回数
const root = document.getElementById('app');
const nav = document.getElementById('tabbar');
let shown = null; // いま #app に出している画面（読み込み中は 'loading'）

function readHidden() {
  try { return localStorage.getItem('kakeibo.hidden') === '1'; } catch (_) { return false; }
}

function route() {
  const [path, q] = location.hash.replace(/^#\/?/, '').split('?');
  return { name: ROUTES[path] ? path : 'home', query: new URLSearchParams(q || '') };
}

function context(entering = false) {
  const today = new Date();
  return {
    data: state.data, fetchedAt: state.fetchedAt, hidden: state.hidden, today, look: lookOf(today, state.data?.days), entering,
    rerender: render,
    refresh,
    write,
    saveSoon,
    openDetail: id => openDetail(context(), id),
    openManual: kind => openManual(context(), kind),
    openAsset: date => assets.openAssetSheet(context(), { date }),
    toggleHidden() {
      state.hidden = !state.hidden;
      try { localStorage.setItem('kakeibo.hidden', state.hidden ? '1' : '0'); } catch (_) { /* 保存できなくても動く */ }
      document.documentElement.classList.add('money-swap'); // 金額がふわっと入れ替わる
      render();
      setTimeout(() => document.documentElement.classList.remove('money-swap'), 450);
    },
  };
}

/** 季節と時間帯で、色（テーマ）と写真を変える。 */
function applyLook(look) {
  document.documentElement.dataset.theme = look.theme;
  document.documentElement.style.setProperty('--hero-img', `url("${look.hero}")`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
}

/** タブバーは最初に一度だけ作り、あとは選んでいるタブの印（すべる丸い背景）だけ動かす。 */
function renderNav(name) {
  if (!nav.firstChild) {
    nav.innerHTML = '<span class="tab-pill" aria-hidden="true"></span>'
      + TABS.map(([r, label]) => `<a class="tab" data-tab="${r}" href="#/${r}">${icon(r)}<span>${label}</span></a>`).join('')
      + `<a class="tab side-only" data-tab="menu" href="#/menu">${icon('menu')}<span>メニュー</span></a>`;
  }
  nav.querySelectorAll('.tab').forEach(a => {
    const on = a.dataset.tab === name;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const i = TABS.findIndex(([r]) => r === name);
  if (i >= 0) nav.style.setProperty('--tab-i', i);
  nav.classList.toggle('no-pill', i < 0);
  nav.hidden = name === 'key';
}

function render() {
  let { name } = route();
  if (!api.hasCredentials()) name = 'key';
  const view = ROUTES[name];
  const entering = shown !== name;
  const ctx = context(entering);
  applyLook(ctx.look);
  renderNav(name);
  document.body.dataset.page = name;

  if (name !== 'key' && !state.data) {
    root.innerHTML = `<div class="loading"><div class="spinner"></div><p>データを取っています…</p></div>`;
    shown = 'loading';
    return;
  }
  if (!entering && view.morphable) {
    // 同じ画面のまま（切り替えボタン・取り直しなど）：変わったところだけ書き換えて、動きを途切れさせない
    morph(root, view.render(ctx));
  } else {
    root.innerHTML = view.render(ctx);
    addClearButtons(root);
    view.mount(root, ctx);
  }
  applyVars(root);
  countUp(root);
  view.after?.(root, ctx);
  if (entering) playEnter(shown, name);
  shown = name;
}

/** 画面に入ってくる動き。 */
function playEnter(from, to) {
  const page = root.firstElementChild;
  if (!page || reduceMotion()) return;
  const d = (DEPTH[to] || 0) - (DEPTH[from] || 0);
  if (d) { page.classList.add(d > 0 ? 'push-in' : 'pop-in'); return; }
  root.querySelectorAll(RISE).forEach((el, i) => {
    el.classList.add('rise');
    el.style.setProperty('--d', Math.min(i, 8));
  });
}

/** 画面に出すデータを作り直す（サーバーのデータに、返事待ちの保存を当てる）。中身が変わったら true。 */
function rebuild() {
  if (!server) return false;
  const data = structuredClone(server);
  pending.forEach(p => p.apply(data));
  const changed = !state.data || JSON.stringify(data) !== JSON.stringify(state.data);
  state.data = data;
  return changed;
}

/** サーバーから取れたデータを使う。sentAt より後に送った返事をもう使っていたら、古いので捨てる。 */
function applyData(wrapped, sentAt) {
  if (sentAt < appliedAt) return false;
  appliedAt = sentAt;
  server = wrapped.data;
  state.fetchedAt = wrapped.fetchedAt;
  return rebuild();
}

// 書き込みの返事に新しいデータが入っていたら、取り直さずにそれを使う（10/7）
api.onFresh((wrapped, sentAt) => {
  freshCount++;
  if (applyData(wrapped, sentAt)) render();
});

let refreshAgain = false; // 取り直している最中に、もう一度取り直したくなった

/** データを取り直す。失敗しても、前に取れたデータがあればそれで表示を続ける。 */
async function refresh(announce = false) {
  if (state.loading) { refreshAgain = true; return; }
  state.loading = true;
  let changed = true;
  try {
    const sentAt = Date.now();
    changed = applyData(await api.fetchData(), sentAt);
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
    // 中身が前と同じなら描き直さない（開いた直後の動きを止めないため）。「取り直す」を押したときは時刻を出し直す
    if (changed || announce) render();
    if (refreshAgain) { refreshAgain = false; refresh(); }
  }
}

const failText = e => (e instanceof api.NetworkError ? '送れませんでした。電波のあるところでもう一度' : e.message);

/**
 * 書き込み（手入力・予算など）をして、返事を待つ。うまくいったら true。
 * 返事に新しいデータが入っていればそれを使い、入っていなければ（GAS ② が古い）取り直す。
 */
async function write(promise, doneText) {
  const n = freshCount;
  try {
    await promise;
  } catch (e) {
    toast(failText(e), 'warn');
    return false;
  }
  if (freshCount === n) await refresh();
  toast(doneText);
  return true;
}

/**
 * 先に画面へ出してから、裏で保存する（10/7 本人：押したらすぐ反映。待っているあいだは「保存しています…」）。
 * patch(data)：保存したあとの形に data を書き換える関数。run()：保存の通信（Promise を返す）。
 * 失敗したら、画面を元に戻して知らせる。
 */
function saveSoon(patch, run, doneText = '保存しました') {
  const p = { apply: patch };
  pending.add(p);
  rebuild();
  render();
  const note = saving();
  const n = freshCount;
  run().then(async () => {
    if (freshCount === n) await refresh(); // 返事に新しいデータがなかった（GAS ② が古い）
    pending.delete(p);
    if (rebuild()) render();
    note.done(doneText);
  }, e => {
    pending.delete(p);
    if (rebuild()) render();
    note.fail(`${failText(e)}（元に戻しました）`);
  });
}

// ---- 起動 ----

// iPhone では、指で触れている間の見た目（:active）は、どこかで touchstart を受けていないと出ない
document.addEventListener('touchstart', () => {}, { passive: true });

window.addEventListener('hashchange', () => {
  closeSheet();
  const { name, query } = route();
  if (name === 'stats') stats.enter(query);
  render();
  window.scrollTo(0, 0);
});

const cached = api.cachedData();
if (cached) { server = cached.data; Object.assign(state, { data: structuredClone(cached.data), fetchedAt: cached.fetchedAt }); }
if (route().name === 'stats') stats.enter(route().query);
render();
if (api.hasCredentials()) refresh();

// 時間帯が変わったら（開きっぱなしでも）写真と色を変える
setInterval(() => applyLook(lookOf(new Date(), state.data?.days)), 60 * 1000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* なくても動く */ });
}
