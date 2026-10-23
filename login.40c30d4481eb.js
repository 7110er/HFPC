/* =====================================================================
 * HFPC 網頁：醫療人員登入（5.0 W5-W，K06-02 直連模式）
 * 流程：auth.nonce（一次性亂數）→ Google Identity Services 按鈕（accounts.google.com/gsi/client）取得 ID token
 *      → auth.login(id_token, nonce) → 登入代碼只放 sessionStorage → 載入醫療人員畫面（clinician.js，原封不動）。
 * 直連判斷為「使用 Google 工作區」時，不顯示 Google 登入按鈕，改給「前往 Google 工作區」（GAS_URL；那裡沿用個人連結登入）。
 * 登入失效（SESSION_EXPIRED／SESSION_IDLE／AUTH_*）由 transport.js 清掉登入代碼並重新載入本頁，本頁顯示錯誤碼表的白話訊息與下一步。
 * ===================================================================== */
(function () {
'use strict';
if (!window.HFPC_FRAME_OK) return;
var W = window.HFPC_WEB, CFG = W.cfg, NONCE = null, NONCE_TIMER = null, GIS_LOADING = null;
var SHIM = window.google && window.google.script;   /* Google 登入程式庫載入後若覆蓋 window.google，把轉接層接回去 */
var APP_SRC = (document.currentScript && document.currentScript.getAttribute('data-app')) || '';
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function shell() { try { return window.parent !== window && window.parent.HFPC_SHELL && window.parent.location.origin === window.location.origin ? window.parent.HFPC_SHELL : null; } catch (e) { return null; } }
function wsLink() { return W.okUrl(CFG.GAS_URL) ? '<p><a class="btn primary" id="ws_go" href="' + esc(CFG.GAS_URL) + '" target="_top" rel="noopener">前往 Google 工作區</a></p>' : '<p class="notice err">Google 工作區的網址尚未設定，請通知系統管理者。</p>'; }
function view() { return $('view_patients'); }
function setWho(t) { if ($('who')) $('who').textContent = t; }

function renderWorkspace(c) {
  setWho('');
  view().innerHTML = '<section class="panel" id="web_ws"><h2>請改用 Google 工作區</h2><p>這個網頁目前無法直接連到醫療團隊的系統' + (c && c.reason === 'FORCED' ? '（管理者已設定固定使用 Google 工作區）' : '') + '。請按下面的按鈕，到 Google 工作區用您的個人連結登入；病人的資料與紀錄都是同一份。</p>' + wsLink() + '</section>';
}
function renderLogin(msg) {
  setWho('尚未登入');
  var m = msg ? '<div class="notice err" id="login_msg" role="alert"><strong>' + esc(msg.message || '') + '</strong>' + (msg.next_step ? ' ' + esc(msg.next_step) : '') + '</div>' : '<div id="login_msg" role="alert"></div>';
  view().innerHTML = '<section class="panel" id="web_login"><h2>醫療人員登入</h2>' + m +
    '<p>請用已由管理者加入授權名單的 Google 帳號登入。登入只在這個分頁有效：按「登出」或關閉分頁就會結束。</p>' +
    '<div id="gsi_btn" class="gsi-btn" aria-live="polite"><p class="muted small">正在準備 Google 登入按鈕…</p></div>' +
    '<p class="small muted">共用電腦用完請按「登出」並關閉分頁。不要在任何欄位輸入姓名、身分證字號或電話。</p>' +
    '<details class="small"><summary>無法登入？</summary><p>若一直無法登入，可以改到 Google 工作區用個人連結登入。</p>' + wsLink() + '</details></section>';
}
function loginErr(j) { var el = $('login_msg'); if (!el) return; el.className = 'notice err'; el.innerHTML = '<strong>' + esc(j.message || W.NET_MSG) + '</strong>' + (j.next_step ? ' ' + esc(j.next_step) : '') + (j.retry ? ' <button class="btn small" type="button" id="login_retry">再試一次</button>' : ''); if ($('login_retry')) $('login_retry').addEventListener('click', function () { start(); }); }

function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (GIS_LOADING) return GIS_LOADING;
  GIS_LOADING = new Promise(function (res, rej) {
    var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.addEventListener('load', function () { if (window.google && !window.google.script && SHIM) window.google.script = SHIM; res(); }); s.addEventListener('error', function () { GIS_LOADING = null; rej(new Error('GIS')); });
    document.head.appendChild(s);
  });
  return GIS_LOADING;
}
function newNonce() {
  return W.post('auth.nonce', [], {}).then(function (j) {
    if (!j.ok || !j.data || !/^[0-9a-f]{32}$/.test(String(j.data.nonce || ''))) throw j;
    NONCE = j.data.nonce; return NONCE;
  });
}
function initButton(clientId) {
  var g = window.google.accounts.id;
  g.initialize({ client_id: clientId, callback: onCredential, nonce: NONCE, auto_select: false, cancel_on_tap_outside: true, context: 'signin', ux_mode: 'popup', itp_support: true });
  var box = $('gsi_btn'); box.innerHTML = '';
  g.renderButton(box, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'zh-TW', width: 280 });
}
function start() {
  var msg = W.authMsg.take();
  if (W.session.get()) { loadApp(); return; }
  W.ensureConn().then(function (c) {
    if (c.mode !== 'DIRECT') { renderWorkspace(c); return; }
    renderLogin(msg);
    var clientId = String(CFG.GOOGLE_OAUTH_CLIENT_ID || c.client_id || '');
    if (c.google_login === false) { loginErr({ message: 'Google 登入目前無法使用。', next_step: '請改到 Google 工作區登入，或通知系統管理者。' }); $('gsi_btn').innerHTML = ''; return; }
    if (!clientId) { loginErr({ message: 'Google 登入尚未設定完成（缺少用戶端 ID）。', next_step: '請通知系統管理者；需要時可先改到 Google 工作區登入。' }); $('gsi_btn').innerHTML = ''; return; }
    Promise.all([newNonce(), loadGis()]).then(function () {
      initButton(clientId);
      /* 一次性亂數 120 秒內有效：畫面停在登入頁時每 100 秒換一次 */
      clearInterval(NONCE_TIMER); NONCE_TIMER = setInterval(function () { if (!$('gsi_btn')) { clearInterval(NONCE_TIMER); return; } newNonce().then(function () { initButton(clientId); }, function () { /* 下次再換 */ }); }, 100000);
    }, function (e) {
      $('gsi_btn').innerHTML = '';
      if (e && e.code && e.ok === false) loginErr(e);
      else loginErr({ message: W.NET_MSG, retry: true });
    });
  });
}
function onCredential(resp) {
  var cred = resp && resp.credential, n = NONCE;
  if (!cred || !n) { loginErr({ message: '沒有取得 Google 登入資料。', next_step: '請再按一次登入按鈕。' }); return; }
  NONCE = null;
  W.post('auth.login', [cred, n], {}).then(function (j) {
    if (j.ok && j.data && j.data.session) {
      clearInterval(NONCE_TIMER); W.session.set(j.data.session);
      var sh = shell(); if (sh && sh.identityChanged) sh.identityChanged('LOGIN');
      loadApp(); return;
    }
    loginErr(j); newNonce().then(function () { initButton(String(CFG.GOOGLE_OAUTH_CLIENT_ID || (W.conn.get() || {}).client_id || '')); }, function () { /* 使用者可按再試一次 */ });
  }, function () { loginErr({ message: W.NET_MSG, retry: true }); });
}
function logout() {
  var s = W.session.get(), b = $('web_logout'); if (b) { b.disabled = true; b.textContent = '登出中…'; }
  var fin = function () { W.session.clear(); W.authMsg.put({ code: 'LOGGED_OUT', message: '已登出。', next_step: '共用電腦請關閉這個分頁。' }); var sh = shell(); if (sh && sh.identityChanged) sh.identityChanged('LOGOUT'); window.location.reload(); };
  if (!s) { fin(); return; }
  W.post('auth.logout', [], { session: s }).then(fin, fin);   /* 伺服器沒有回應也清掉這個分頁的登入；伺服器端的登入會在閒置時限後失效 */
}
function loadApp() {
  var bar = document.querySelector('header.top .bar');
  if (bar && !$('web_logout')) { var b = document.createElement('button'); b.type = 'button'; b.id = 'web_logout'; b.className = 'btn small'; b.textContent = '登出'; b.addEventListener('click', logout); bar.appendChild(b); }
  if (!APP_SRC || document.querySelector('script[data-hfpc-app]')) return;
  var s = document.createElement('script'); s.src = APP_SRC; s.setAttribute('data-hfpc-app', '1'); document.body.appendChild(s);
}
window.HFPC_LOGIN = { logout: logout, start: start };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
