// GAS ②「家計簿 API」とのやりとり。仕様は docs/03_システム設計.md の5章。
// API の URL と合言葉はリポジトリに書かず、最初の画面（S-00）で入れて端末にだけ保存する。
// URL ⇒ 公開リポジトリにあると、誰でもわざと間違え続けて本人を締め出せてしまうため。

const KEY_URL = 'kakeibo.url';
const KEY_SECRET = 'kakeibo.key';
const KEY_CACHE = 'kakeibo.data';
const API_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

export class AuthError extends Error {}    // 合言葉が違う・締め出し中（API は理由を返さない）
export class UserError extends Error {}    // 合言葉は通ったが、送った中身がおかしい
export class NetworkError extends Error {} // 電波がない・API に届かない

const isMock = () => new URLSearchParams(location.search).has('mock');

function load(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function save(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (_) { /* 保存できない端末でも動く */ }
}

export function hasCredentials() {
  return isMock() || (!!load(KEY_URL) && !!load(KEY_SECRET));
}

/** S-00 で入れた URL と合言葉を確かめてから保存する。間違っていたら保存しない。 */
export async function setCredentials(url, secret) {
  url = url.trim();
  secret = secret.trim();
  if (!API_URL_PATTERN.test(url)) throw new UserError('URL は https://script.google.com/macros/s/…/exec の形で入れてください');
  if (secret.length < 32) throw new UserError('合言葉が短すぎます（64文字のはずです）');
  await post(url, secret, 'getData', monthRange(), null); // 通るかどうかだけ試す
  save(KEY_URL, url);
  save(KEY_SECRET, secret);
}

export function forgetCredentials() {
  save(KEY_URL, null);
  save(KEY_SECRET, null);
  save(KEY_CACHE, null);
}

/** 全期間を取る（データは年に千数百件ほどの見込みなので、まとめて取っても軽い）。 */
function monthRange() {
  const now = new Date();
  return { from: '2000-01', to: `${now.getFullYear() + 1}-12` };
}

/** 返事の本文（{ ok, data, fresh? }）を返す。fresh：書き込みのあとの新しいデータを同じ返事に入れてもらう期間。 */
async function post(url, secret, action, params, fresh) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      // application/json だとブラウザが事前の確認（preflight）をし、GAS はそれに答えられない
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(fresh ? { key: secret, action, params, fresh } : { key: secret, action, params }),
      redirect: 'follow',
    });
  } catch (_) {
    throw new NetworkError('API に届きませんでした');
  }
  let body;
  try { body = await res.json(); } catch (_) { throw new NetworkError('API の返事が読めませんでした'); }
  if (body.ok) return body;
  if (!body.error) throw new AuthError('合言葉が違うか、間違いが多すぎて1時間締め出されています');
  throw new UserError(body.error);
}

let freshHandler = null;
/** 書き込みの返事に入っていた新しいデータを受け取る関数（app.js）。fn({ fetchedAt, data }, 送った時刻) */
export function onFresh(fn) { freshHandler = fn; }

function deliver(data, sentAt) {
  const wrapped = { fetchedAt: Date.now(), data };
  if (!isMock()) save(KEY_CACHE, JSON.stringify(wrapped));
  freshHandler?.(wrapped, sentAt);
}

// 書き込みは1つずつ順に送る（10/7）。続けて保存しても、返事の新しいデータが古いものに戻らないように
let writes = Promise.resolve();

function call(action, params = {}) {
  if (action === 'getData') return send(action, params, false);
  const job = writes.then(() => send(action, params, true));
  writes = job.catch(() => {});
  return job;
}

async function send(action, params, withFresh) {
  const sentAt = Date.now();
  if (isMock()) {
    const mock = await import('./mock.js');
    const data = await mock.mockCall(action, params);
    const fresh = withFresh && mock.mockData();
    if (fresh) deliver(fresh, sentAt);
    return data;
  }
  const body = await post(load(KEY_URL), load(KEY_SECRET), action, params, withFresh ? monthRange() : null);
  if (body.fresh) deliver(body.fresh, sentAt); // GAS ② が古い（10/7 より前）と fresh は来ない。そのときは app.js が取り直す
  return body.data;
}

// ---- データ ----

/** 最後に取れたデータ（オフライン用）。なければ null。 */
export function cachedData() {
  if (isMock()) return null;
  try { return JSON.parse(load(KEY_CACHE)); } catch (_) { return null; }
}

export async function fetchData() {
  const data = await call('getData', monthRange());
  const wrapped = { fetchedAt: Date.now(), data };
  if (!isMock()) save(KEY_CACHE, JSON.stringify(wrapped));
  return wrapped;
}

export const setCategory = (id, category) => call('setCategory', { id, category });
export const setRule = (merchant, category, displayName) => call('setRule', displayName === undefined ? { merchant, category } : { merchant, category, displayName });
export const setMemo = (id, memo) => call('setMemo', { id, memo });

/**
 * 利用の詳細の「保存」：カテゴリ・「この店はいつもこの内容」・名前を1回の通信で（10/7）。p：{ id, category, name, always }
 * GAS ② をまだ貼り直していない（「知らない action」）ときは、今までの手続きを順に呼ぶ。t：保存する前の利用（その順番を決めるため）
 */
let oldServer = false; // 一度「知らない action」と言われたら、開いている間は初めから今までの手続きを使う

export async function saveDetail(p, t) {
  if (!oldServer) {
    try {
      return await call('saveDetail', p);
    } catch (e) {
      if (!(e instanceof UserError) || e.message !== '知らない action です') throw e;
      oldServer = true;
    }
  }
  if (p.always) {
    await setRule(t.merchant, p.category, p.name);
    if (t.categoryBy === '個別' && t.category !== p.category) await setCategory(t.id, p.category);
    if (t.memo) await setMemo(t.id, '');
  } else {
    if ((p.category || '') !== (t.category || '')) await setCategory(t.id, p.category);
    if (p.name !== (t.memo || '')) await setMemo(t.id, p.name);
  }
  return { id: t.id };
}
export const addManual = (entry) => call('addManual', entry);
/** 収入を手で足す。entry：{ date, amount, memo（名前） } */
export const addIncome = (entry) => call('addIncome', entry);
export const deleteManual = (id) => call('deleteManual', { id });
export const resolveSokuho = (id) => call('resolveSokuho', { id });
export const setSetting = (key, value) => call('setSetting', { key, value });
/** CSV の照合の結果を反映する（S-09）。add：[{ date, merchant, amount, payMonth }]、cancel：[id] */
export const importCsv = (add, cancel) => call('importCsv', { add, cancel });
/** 予算。month：'' なら毎月、'YYYY-MM' ならその月だけ。amount：null ならやめる。 */
export const setBudget = (month, amount) => call('setBudget', { month, amount });
/** 資産の記録。金額は整数か null（その項目は記録しない／やめる）。3つとも null ならその日の記録をやめる。 */
export const setAssetRecord = (date, bank, nisa, nisaPrincipal) => call('setAssetRecord', { date, bank, nisa, nisaPrincipal });
