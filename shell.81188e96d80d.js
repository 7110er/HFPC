/* =====================================================================
 * HFPC 網頁外殼：模式列與同頁切換（5.0 W5-W，K06-03）
 * 三個應用（醫療人員 staff.html、病人 patient.html、公開衛教 public.html）各在同源 iframe 裡執行，
 * 互不影響 CSS 與程式；切換模式只顯示／隱藏 iframe，不重新載入外殼。
 * 誰看得到哪些模式：
 *   未登入            → 公開衛教、醫療人員登入
 *   持病人連結         → 我的照護、公開衛教
 *   醫療人員已登入     → 醫療人員、病人視角（唯讀預覽目前這位病人在病人頁看到的同一份計畫）、公開衛教
 * 連線方式（DIRECT 已直接連線／WORKSPACE 使用 Google 工作區）由 transport.js 的 sys.health 判斷，記在 sessionStorage 供同次使用。
 * 只看公開衛教的訪客不送出任何請求（5.1 K06-05）：判斷只在需要時（醫療人員登入、病人連結）才進行。
 * ===================================================================== */
(function () {
'use strict';
if (!window.HFPC_FRAME_OK) return;
var W = window.HFPC_WEB, CFG = W.cfg;
var FRAMES = { staff: 'staff.html', patient: 'patient.html', public: 'public.html', preview: 'patient.html?preview=1' };
var TITLES = { staff: '醫療人員', patient: '我的照護', public: '公開衛教', preview: '病人視角（唯讀預覽）' };
var MODE = null, PV_STAMP = null, WS_NOTE = false;
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function identity() { return W.ptoken.get() ? 'PATIENT' : (W.session.get() ? 'STAFF' : 'ANON'); }

/* ---------- 模式列 ---------- */
function modesFor(id) {
  if (id === 'PATIENT') return [['patient', '我的照護'], ['public', '公開衛教']];
  if (id === 'STAFF') return [['staff', '醫療人員'], ['preview', '病人視角'], ['public', '公開衛教']];
  return [['public', '公開衛教'], ['staff', '醫療人員登入']];
}
function renderBar() {
  var id = identity(), c = W.conn.get(), ws = c && c.mode === 'WORKSPACE';
  $('modes').innerHTML = modesFor(id).map(function (m) {
    if (m[0] === 'staff' && id === 'ANON' && ws) return '<a class="mode ws" id="mode_ws" href="' + esc(W.okUrl(CFG.GAS_URL) ? CFG.GAS_URL : '#') + '" rel="noopener" data-mode-link="workspace">前往 Google 工作區</a>';
    return '<button type="button" class="mode" data-mode="' + m[0] + '" aria-pressed="' + (MODE === m[0] ? 'true' : 'false') + '">' + m[1] + '</button>';
  }).join('');
  $('modes').setAttribute('data-identity', id);
  renderConn();
}
function renderConn() {
  var c = W.conn.get(), el = $('conn_status');
  var t = !c ? '連線方式：尚未連線（公開衛教不需要連線）' : (c.mode === 'DIRECT' ? '連線方式：已直接連線' : '連線方式：使用 Google 工作區');
  el.textContent = t; el.setAttribute('data-conn', c ? c.mode : 'NONE');
}

/* ---------- iframe ---------- */
function frame(name) {
  var f = $('f_' + name);
  if (f) return f;
  f = document.createElement('iframe'); f.id = 'f_' + name; f.className = 'app-frame'; f.title = TITLES[name];
  f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  if (name === 'staff') f.setAttribute('allow', 'identity-credentials-get');   /* Google 登入在 iframe 內使用瀏覽器帳號登入介面【未經查證：需真實環境確認】 */
  f.hidden = true; f.src = name === 'preview' ? FRAMES.preview + '&r=' + encodeURIComponent(PV_STAMP || '') : FRAMES[name];
  $('frames').appendChild(f);
  return f;
}
function drop(name) { var f = $('f_' + name); if (f) f.parentNode.removeChild(f); }
function note(html) { var n = $('shell_note'); n.innerHTML = html || ''; n.hidden = !html; }
function show(name) {
  MODE = name; note('');
  ['staff', 'patient', 'public', 'preview'].forEach(function (k) { var f = $('f_' + k); if (f) f.hidden = k !== name; });
  if (name === 'preview') {
    var r = previewRecord();
    if (!r) { MODE = 'preview'; note('<section class="panel" id="pv_empty"><h2>病人視角</h2><p>請先在「醫療人員」開啟一位病人，再切換到這裡；這裡會顯示這位病人用個人連結看到的同一份計畫（唯讀）。</p></section>'); renderBar(); return; }
    if (PV_STAMP !== r.stamp) { drop('preview'); PV_STAMP = r.stamp; }
  }
  frame(name).hidden = false;
  document.title = '心衰竭照護對話｜' + TITLES[name];
  renderBar();
}
function previewRecord() {
  var f = $('f_staff');
  try { return f && f.contentWindow && f.contentWindow.HFPC_WEB ? f.contentWindow.HFPC_WEB.lastRecord() : null; } catch (e) { return null; }
}

/* ---------- 連線方式與各身分的進入點 ---------- */
function wsNote(c) {
  WS_NOTE = true;
  note('<section class="panel" id="ws_note"><h2>請改用 Google 工作區</h2><p>這個網頁目前無法直接連到醫療團隊的系統' + (c && c.reason === 'FORCED' ? '（管理者已設定固定使用 Google 工作區）' : '') + '。醫療人員請按上方「前往 Google 工作區」，用個人連結登入；病人的資料與紀錄都是同一份。</p></section>');
}
function goPatientWorkspace() {
  var tok = W.ptoken.get(), url = CFG.GAS_URL;
  if (!W.okUrl(url) || !tok) { note('<section class="panel" id="pt_ws_err"><h2>暫時無法開啟您的照護頁面</h2><p>連線設定不完整。請聯絡醫療團隊；有緊急狀況請直接撥打 119。</p></section>'); show('public'); return; }
  W.ptoken.clear();
  window.location.replace(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=p#t=' + tok);
}
function staffClick() {
  if (identity() === 'STAFF') { show('staff'); return; }
  $('modes').setAttribute('aria-busy', 'true');
  W.ensureConn().then(function (c) {
    $('modes').removeAttribute('aria-busy');
    if (c.mode === 'DIRECT') show('staff');
    else { renderBar(); wsNote(c); }
  });
}
function onClick(ev) {
  var b = ev.target.closest('[data-mode]'); if (!b) return;
  var m = b.getAttribute('data-mode');
  if (m === 'staff') staffClick(); else show(m);
}

/* ---------- 子頁回呼 ---------- */
window.HFPC_SHELL = {
  previewRecord: previewRecord,
  connChanged: function () { renderBar(); },
  identityChanged: function (why) {
    if (why === 'LOGIN') { renderBar(); return; }
    /* 登出或登入失效：病人視角預覽一併關閉；醫療人員頁自己重新載入成登入畫面 */
    drop('preview'); PV_STAMP = null; renderBar();
  },
  banner: function (kind, msg) {
    var b = $('shell_banner'); b.hidden = false; b.textContent = msg;
    if (kind === 'OUTDATED') { var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.id = 'shell_reload'; btn.textContent = '重新整理頁面'; btn.addEventListener('click', function () { window.location.reload(); }); b.appendChild(btn); }
  },
  mode: function () { return MODE; }
};

function init() {
  document.addEventListener('click', onClick);
  var tok = W.hashToken(window.location.hash);
  if (tok) {
    /* 持病人連結開啟：同一分頁裡的醫療人員登入一併結束（共用裝置時病人不能切到醫療人員畫面） */
    var s = W.session.get(); if (s) { W.session.clear(); W.post('auth.logout', [], { session: s }).then(function () {}, function () {}); }
    W.ptoken.set(tok); W.cleanUrl();
  }
  var id = identity();
  if (id === 'ANON') { show('public'); return; }
  renderBar();
  W.ensureConn().then(function (c) {
    if (id === 'PATIENT') { if (c.mode === 'DIRECT') show('patient'); else goPatientWorkspace(); return; }
    if (c.mode === 'DIRECT') show('staff');
    else { W.session.clear(); show('public'); wsNote(c); }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
