/* =====================================================================
 * HFPC 網頁傳輸轉接層（5.0 W5-W，K06-02）
 * ---------------------------------------------------------------------
 * 1. HFPC_WEB.post(action, data, cred)：fetch(API_URL, POST, Content-Type text/plain;charset=utf-8, redirect follow)，
 *    不帶任何自訂標頭（避免跨來源預檢）、不帶 cookie（credentials omit）。只看回應內容的 ok／code。
 *    網路錯誤、讀不到回應（opaque）、不是 JSON、要求編號對不上 → 一律當成「暫時無法連線」（不假裝成功）。
 *    嚴禁 no-cors、JSONP、隱藏 iframe 或單向 POST（5.1 第 3 節）。
 * 2. google.script.run 相容墊片：withSuccessHandler／withFailureHandler／withUserObject／任意函式名
 *    → 轉成單一路由請求 { v:'1', action, req_id, client_ver, session|ptoken, data:[參數] }。
 *    成功處理函式收到的就是伺服器回應內容（{ok,code,data} 或 {ok:false,code,message,next_step}），
 *    與 HtmlService 收到 API 函式回傳值的形狀相同，所以 clinician.js 與 patient_link.js 幾乎不用改。
 *    另墊片 google.script.url.getLocation（讀網址 # 片段）與 google.script.history.replace（history.replaceState）。
 * 3. 直連判斷 HFPC_WEB.probe()：sys.health 帶隨機要求編號（伺服器原樣回傳）；讀得到正確 JSON 且編號相符 → DIRECT；
 *    否則 → WORKSPACE（改進入 Apps Script HtmlService 工作區）。config.js FORCE_MODE='WORKSPACE' 直接固定走工作區。
 * 4. 身分資料只放 sessionStorage（登出、關閉分頁即清除；不放 localStorage）：
 *    醫療人員登入代碼 → 只放在醫療人員頁的請求；病人連結代碼 → 只放在病人頁請求的 ptoken。兩者不會同時送出。
 * 5. 病人視角預覽（patient.html?preview=1）：完全不連線；病人頁要的資料由外殼從醫療人員頁最近一次
 *    loadPatientRecord 的 plan_patient_view 取得（同一份計畫的病人端內容），送出一律拒絕（唯讀）。
 * 本機測試（tools/devserver.js）只是模擬，不代表真實 Google 的跨來源回應已驗證。
 * ===================================================================== */
(function () {
'use strict';
var CFG = window.HFPC_CONFIG || {};
var REL = window.HFPC_WEB_RELEASE || {};
var PAGE = document.documentElement.getAttribute('data-page') || '';
var PREVIEW = PAGE === 'patient' && /(?:^|[?&])preview=1(?:&|$)/.test(window.location.search);
var K = { session: 'hfpc.session', ptoken: 'hfpc.ptoken', conn: 'hfpc.conn', authmsg: 'hfpc.authmsg' };
var NET_MSG = '暫時無法連線，請稍後再試；若一直失敗請改用 Google 工作區。';
var AUTH_CODES = { AUTH_REQUIRED: 1, AUTH_TOKEN_INVALID: 1, AUTH_NOT_AUTHORIZED: 1, AUTH_SUB_CONFLICT: 1, SESSION_EXPIRED: 1, SESSION_IDLE: 1 };
var PATIENT_FNS = { patientLoad: 1, patientSubmit: 1, patientSubmitStatus: 1 };
var TOKEN_RE = /^[0-9a-f]{48}$/, SESSION_RE = /^[0-9a-f]{64}$/;

function store() { try { return window.sessionStorage; } catch (e) { return null; } }
function sget(k) { var s = store(); try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
function sset(k, v) { var s = store(); try { if (s) s.setItem(k, v); } catch (e) { /* 無法保存時只影響同次使用 */ } }
function sdel(k) { var s = store(); try { if (s) s.removeItem(k); } catch (e) { /* 同上 */ } }
function hex(a) { var o = ''; for (var i = 0; i < a.length; i++) o += ('0' + a[i].toString(16)).slice(-2); return o; }
function reqId() { var a = new Uint8Array(16); window.crypto.getRandomValues(a); return 'w' + hex(a); }
function parentShell() { try { return window.parent !== window && window.parent.HFPC_SHELL && window.parent.location.origin === window.location.origin ? window.parent.HFPC_SHELL : null; } catch (e) { return null; } }
function netError(reason) { var e = new Error(NET_MSG); e.hfpc_message = NET_MSG; e.hfpc_reason = reason; e.code = 'NETWORK'; return e; }
/* 本機測試（LOCAL_TEST）才允許 http://localhost／127.0.0.1；其他一律要 https */
function okUrl(u) { return typeof u === 'string' && (/^https:\/\/[^\s"'<>]+$/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s"'<>]*$/.test(u)); }

/* ---------- 身分資料（sessionStorage） ---------- */
var session = { get: function () { var v = sget(K.session); return v && SESSION_RE.test(v) ? v : null; }, set: function (v) { if (SESSION_RE.test(String(v || ''))) sset(K.session, v); }, clear: function () { sdel(K.session); } };
var ptoken = { get: function () { var v = sget(K.ptoken); return v && TOKEN_RE.test(v) ? v : null; }, set: function (v) { if (TOKEN_RE.test(String(v || ''))) sset(K.ptoken, v); }, clear: function () { sdel(K.ptoken); } };
var conn = {
  get: function () { try { var c = JSON.parse(sget(K.conn) || 'null'); return c && (c.mode === 'DIRECT' || c.mode === 'WORKSPACE') ? c : null; } catch (e) { return null; } },
  set: function (c) { sset(K.conn, JSON.stringify(c)); var sh = parentShell(); if (sh && sh.connChanged) sh.connChanged(); },
  clear: function () { sdel(K.conn); }
};
var authMsg = { take: function () { var v = sget(K.authmsg); sdel(K.authmsg); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } }, put: function (o) { sset(K.authmsg, JSON.stringify(o)); } };
/* 網址片段中的病人連結代碼（新格式 #p=，舊格式 #t=） */
function hashToken(h) { var m = /(?:^|[#&?])[pt]=([0-9a-f]{48})(?:&|$)/.exec(h || ''); return m ? m[1] : null; }
function cleanUrl() { try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* 舊瀏覽器：代碼仍留在網址列，畫面已提醒不要轉傳 */ } }

/* ---------- 單一路由請求 ---------- */
function post(action, data, cred, timeoutMs) {
  if (PREVIEW) return Promise.reject(netError('PREVIEW_NO_NETWORK'));
  if (!okUrl(CFG.API_URL)) return Promise.reject(netError('NO_API_URL'));
  cred = cred || {};
  var id = reqId(), body = { v: '1', action: action, req_id: id, client_ver: String(REL.client_ver || ''), data: data || [] };
  if (cred.session && cred.ptoken) return Promise.reject(netError('MIXED_IDENTITY'));
  if (cred.session) body.session = cred.session;
  if (cred.ptoken) body.ptoken = cred.ptoken;
  var ctl = typeof AbortController === 'function' ? new AbortController() : null, timer = null;
  if (ctl) timer = setTimeout(function () { ctl.abort(); }, timeoutMs || 180000);   /* Apps Script 單次執行可能較久（儀表板）；逾時才當成無法連線【工程預設】 */
  return window.fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow',
    credentials: 'omit', cache: 'no-store', mode: 'cors', signal: ctl ? ctl.signal : undefined })
    .then(function (r) {
      if (r.type === 'opaque' || r.type === 'opaqueredirect') throw netError('OPAQUE');
      return r.text();
    }, function (e) { throw netError(e && e.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_FAILED'); })
    .then(function (t) {
      var j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
      if (!j || typeof j !== 'object' || typeof j.ok !== 'boolean' || typeof j.code !== 'string') throw netError('NOT_JSON');
      if (j.req_id !== id && !(j.ok === false && j.req_id === '')) throw netError('REQ_ID_MISMATCH');
      return j;
    })
    .then(function (j) { if (timer) clearTimeout(timer); return j; }, function (e) { if (timer) clearTimeout(timer); throw e && e.hfpc_reason ? e : netError('UNKNOWN'); });
}

/* ---------- 直連判斷（sys.health） ---------- */
function probe() {
  if (String(CFG.FORCE_MODE || 'AUTO').toUpperCase() === 'WORKSPACE') return Promise.resolve({ mode: 'WORKSPACE', reason: 'FORCED', at: Date.now() });
  if (!okUrl(CFG.API_URL)) return Promise.resolve({ mode: 'WORKSPACE', reason: 'NO_API_URL', at: Date.now() });
  return post('sys.health', [], {}, 15000).then(function (j) {   /* 15 秒：含 Apps Script 冷啟動與轉址【工程預設】 */
    var d = j.data || {};
    if (j.ok !== true || typeof d.server_ver !== 'string') return { mode: 'WORKSPACE', reason: 'BAD_HEALTH', at: Date.now() };
    return { mode: 'DIRECT', reason: 'HEALTH_OK', at: Date.now(), server_ver: d.server_ver, client_id: String(d.google_client_id || ''),
      google_login: d.id_verify ? !!d.id_verify.google_login_available : null, maintenance: !!d.maintenance };
  }, function (e) { return { mode: 'WORKSPACE', reason: (e && e.hfpc_reason) || 'FETCH_FAILED', at: Date.now() }; });
}
function ensureConn() { var c = conn.get(); if (c) return Promise.resolve(c); return probe().then(function (x) { conn.set(x); return x; }); }

/* ---------- 頁面提示（版本太舊） ---------- */
function banner(kind, msg) {
  var sh = parentShell(); if (sh && sh.banner) { sh.banner(kind, msg); return; }
  var b = document.getElementById('web_banner');
  if (!b) { b = document.createElement('div'); b.id = 'web_banner'; b.className = 'web-banner'; b.setAttribute('role', 'alert'); (document.body || document.documentElement).insertBefore(b, (document.body || document.documentElement).firstChild); }
  b.textContent = msg;
  if (kind === 'OUTDATED') { var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.textContent = '重新整理頁面'; btn.addEventListener('click', function () { window.location.reload(); }); b.appendChild(btn); }
}

/* ---------- 醫療人員：登入失效 → 回到登入畫面（顯示錯誤碼表的白話訊息與下一步） ---------- */
function authLost(j) {
  session.clear();
  authMsg.put({ code: j.code, message: j.message || '', next_step: j.next_step || '' });
  var sh = parentShell(); if (sh && sh.identityChanged) sh.identityChanged('AUTH_LOST');
  window.location.reload();
}

/* ---------- 病人視角預覽：只讀資料，由外殼從醫療人員頁取得 ---------- */
var LAST = null;
function previewFrom(rec, pk) {
  return { projection: 'PATIENT_SAFE_V1', preview: true, snapshot_version: 0, fields: {}, care_events: [], team_records: [], recent_changes: [], home_weights: [],
    plan: rec.plan_patient_view || null, plan_error: rec.plan_patient_view ? undefined : (rec.plan_error || 'PLAN_FAILED'),
    synthetic: rec.synthetic === true, trial: false, respondent: 'SELF', education_self: {}, last_submission: null, release: { ok: true }, patient_ref: String(pk || '').slice(0, 8) };
}
function previewAnswer(fn) {
  if (fn === 'patientLoad') {
    var sh = parentShell(), r = sh && sh.previewRecord ? sh.previewRecord() : null;
    if (!r) return { ok: false, code: 'PREVIEW', message: '請先在「醫療人員」開啟一位病人，再切換到病人視角。' };
    return { ok: true, code: 'OK', data: r.view };
  }
  return { ok: false, code: 'PREVIEW', message: '這是病人視角預覽（唯讀），不會送出任何資料。' };
}

/* ---------- google.script.run 相容墊片 ---------- */
function invoke(fn, args, ok, fail, uo) {
  function done(j) { setTimeout(function () { if (ok) ok(j, uo); }, 0); }
  function bad(e) { setTimeout(function () { if (fail) fail(e, uo); }, 0); }
  if (PREVIEW) { done(previewAnswer(fn)); return; }
  if (fn === 'appMode') { done({ ok: true, code: 'OK', data: { staff_auth: 'GOOGLE_SIGN_IN', trial: false } }); return; }   /* 網頁直連：登入方式固定為 Google 登入；伺服器不另提供此動作 */
  var cred = {}, data = args.slice();
  if (PAGE === 'staff') {
    cred.session = session.get();
    if (!cred.session) { authLost({ code: 'AUTH_REQUIRED', message: '需要先登入才能使用這個功能。', next_step: '請登入後再操作。' }); return; }
  } else if (PAGE === 'patient') {
    cred.ptoken = ptoken.get();
    if (PATIENT_FNS[fn] && cred.ptoken && data[0] === cred.ptoken) data = data.slice(1);   /* 病人連結代碼只放在 ptoken，不重複放在參數 */
  }
  post(fn, data, cred).then(function (j) {
    if (j.code === 'CLIENT_OUTDATED') banner('OUTDATED', '這個頁面的版本太舊，請重新整理頁面。');
    if (PAGE === 'staff' && !j.ok && AUTH_CODES[j.code]) { authLost(j); return; }
    if (fn === 'loadPatientRecord') {
      if (j.ok && j.data) LAST = { pk: String(args[0] || ''), at: Date.now(), stamp: reqId().slice(1, 13), view: previewFrom(j.data, args[0]) };
      else if (LAST && LAST.pk === String(args[0] || '')) LAST = null;
    }
    done(j);
  }, bad);
}
function runner(ok, fail, uo) {
  var base = {
    withSuccessHandler: function (f) { return runner(f, fail, uo); },
    withFailureHandler: function (f) { return runner(ok, f, uo); },
    withUserObject: function (o) { return runner(ok, fail, o); }
  };
  return new Proxy(base, { get: function (t, name) {
    if (Object.prototype.hasOwnProperty.call(t, name)) return t[name];
    if (typeof name !== 'string' || name === 'then' || name === 'toJSON' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) return undefined;
    return function () { invoke(name, Array.prototype.slice.call(arguments), ok, fail, uo); };
  } });
}
function paramsOf(search) { var o = {}; String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='), k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i)); if (k !== 'p' && k !== 't') o[k] = decodeURIComponent(i < 0 ? '' : kv.slice(i + 1)); }); return o; }

/* 病人頁：讀網址片段的連結代碼 → 放進 sessionStorage → 立刻清掉網址列 */
if (PAGE === 'patient' && !PREVIEW) { var ht = hashToken(window.location.hash); if (ht) { ptoken.set(ht); cleanUrl(); } }

if (PAGE === 'staff' || PAGE === 'patient') {
  window.google = window.google || {};
  window.google.script = {
    run: runner(null, null, undefined),
    url: { getLocation: function (cb) {
      var h = PAGE === 'patient' ? (PREVIEW ? 'p=' + '0'.repeat(48) : (ptoken.get() ? 'p=' + ptoken.get() : '')) : String(window.location.hash || '').replace(/^#/, '');
      setTimeout(function () { cb({ hash: h, parameter: paramsOf(window.location.search), parameters: {} }); }, 0);
    } },
    history: { replace: function (state, params, hash) { try { window.history.replaceState(null, '', window.location.pathname + window.location.search + (hash ? '#' + hash : '')); } catch (e) { /* 無法改網址時不影響功能 */ } } }
  };
}
if (PREVIEW) {
  var addPv = function () {
    if (document.getElementById('web_preview_note')) return;
    var n = document.createElement('div'); n.id = 'web_preview_note'; n.className = 'web-preview-note'; n.setAttribute('role', 'note');
    n.textContent = '病人視角預覽（唯讀）：這是這位病人用個人連結會看到的同一份計畫與單張內容；在這裡的操作不會送出任何資料。';
    document.body.insertBefore(n, document.body.firstChild);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addPv); else addPv();
}

window.HFPC_WEB = {
  page: PAGE, preview: PREVIEW, cfg: CFG, release: REL, NET_MSG: NET_MSG, AUTH_CODES: AUTH_CODES,
  post: post, probe: probe, ensureConn: ensureConn, okUrl: okUrl, hashToken: hashToken, cleanUrl: cleanUrl,
  session: session, ptoken: ptoken, conn: conn, authMsg: authMsg, banner: banner,
  lastRecord: function () { return LAST; }
};
})();
