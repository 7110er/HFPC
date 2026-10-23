/* =====================================================================
 * 病人連結轉接層（只存在於 patient-linked 建置；公開版沒有這個檔）
 * - 從網址 # 片段讀 token，向伺服器載入「病人可看的簡化版紀錄」與可帶入的歷史答案
 * - 有上次紀錄時，在第 2 步前加一頁「和上次比」追蹤（急診住院、上次的困擾與準備做的事）
 * - 結果頁加「儲存給醫療團隊」：三態顯示「正在儲存／已儲存／尚未儲存」，失敗絕不顯示已儲存
 * ===================================================================== */
(function () {
'use strict';
var C = window.HFPC_CONTENT, E = window.HFPC_ENGINE;
var DICT = window.HFPC_LINK_DICT || { fields: {} };
var TOKEN = null, LOADED = null, API = null, FATAL = '', STALE = false;
var LK = { self_harm: null, rc_prev: null, interval: null, interval_hf: null, interval_date: '', concern_fu: {}, action_fu: {}, barrier: {}, med_same: null, pre_done: false, from_clinician: {}, prefilled: {}, weight: null, weight_err: '' };
var ROLE_PT = { PHYSICIAN_IN_TRAINING: '醫師', CASE_MANAGER: '個案管理師', CARDIOLOGIST: '心臟科醫師', CARDIAC_SURGEON: '心臟外科醫師', NURSE: '護理師', PHARMACIST: '藥師', PHYSIOTHERAPIST: '物理治療師',
  OCCUPATIONAL_THERAPIST: '職能治療師', DIETITIAN: '營養師', SOCIAL_WORKER: '社工師', CLINICAL_PSYCHOLOGIST: '心理師', PALLIATIVE_TEAM: '安寧緩和團隊', GENERAL_PHYSICIAN: '醫師', HOME_CARE_NURSE: '護理師', PATIENT: '您自己', CAREGIVER: '家人' };
var SAVE = { state: 'IDLE', message: '', key: null, sent: null, sent_obs: {}, base: 0, polls: 0, committed_once: false, timer: null, done_at: '' };
/* 3.0.0 版本相容：這個頁面的版本（伺服器會和自己、和院內版比對） */
var REL = (window.HFPC_BUILD && window.HFPC_BUILD.release) || null;
var LEGACY = { recognized_ingredients: 1, ingredient_exposure_mode: 1, stopped_ingredients: 1 };
var PATIENT_ONLY_TOKEN_STATUS = { COMPLETED: '做到了', IN_PROGRESS: '還在做', NOT_DONE: '沒有做', BARRIER_REPORTED: '遇到困難', UNKNOWN: '不確定' };
var CONCERN_FU = [['RESOLVED', '已經解決'], ['IMPROVED', '好一些'], ['SAME', '差不多'], ['WORSE', '更困擾'], ['UNSURE', '說不上來']];
var RC_PREV = [['MUCH_BETTER', '好很多'], ['BETTER', '好一些'], ['SAME', '差不多'], ['WORSE', '差一些'], ['MUCH_WORSE', '差很多'], ['UNSURE', '說不上來']];
var INTERVAL = [['NONE', '都沒有'], ['ED_NO_ADMISSION', '看過急診，沒有住院'], ['HOSPITALIZED', '住過院'], ['BOTH', '急診和住院都有'], ['UNSURE', '不確定']];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function cgMode(st) { return st && st.mode === 'CAREGIVER'; }
function run(fn, args, ok, fail) {
  if (!(window.google && google.script && google.script.run)) { fail({ code: 'NO_BACKEND', message: '目前無法連線到醫療團隊的系統。' }); return; }
  var r = google.script.run.withSuccessHandler(function (res) { if (res && res.ok) ok(res.data); else fail(res || {}); })
    .withFailureHandler(function () { fail({ code: 'NETWORK', message: '網路連線中斷。' }); });
  r[fn].apply(r, args);
}
function readToken(cb) {
  /* W5-R1（5.0 K02-05）：新連結用 #p=，舊連結 #t= 照樣可用 */
  function parse(h) { var m = /(?:^|[#&?])[tp]=([0-9a-f]{48})(?:&|$)/.exec(h || ''); return m ? m[1] : null; }
  if (window.google && google.script && google.script.url) google.script.url.getLocation(function (loc) { cb(parse(loc.hash)); });
  else cb(parse(window.location.hash));
}
/* 只送字典允許的值；不合法的值略過並告知（不讓一個奇怪的值擋掉整批） */
function validValue(fid, v) {
  var f = DICT.fields[fid]; if (!f) return false;
  if (v === 'DECLINED') return false;
  if (f.t === 'ENUM') return f.v.indexOf(v) >= 0;
  if (f.t === 'LIST_ENUM') return Array.isArray(v) && v.every(function (x) { return f.v.indexOf(x) >= 0; });
  if (f.t === 'NUMBER') return typeof v === 'number' && isFinite(v) && v >= f.r[0] && v <= f.r[1];
  if (f.t === 'LIST_OBJECT') return Array.isArray(v);
  return false;
}
function cardAction(ref) {
  var p = String(ref || '').split('#'), c = C.cards[p[0]];
  return c && c.actions && c.actions[Number(p[1])] ? c.actions[Number(p[1])] : '';
}
/* 行動的病人版文字：範本 → 公開版卡片的行動 → 類型 */
function actionText(a) {
  var ref = String(a.action_ref || '');
  if (ref.indexOf('TPL:') === 0 && (DICT.templates || {})[ref.slice(4)]) return DICT.templates[ref.slice(4)];
  return cardAction(ref) || (DICT.action_type_labels || {})[a.action_type] || '醫療團隊安排的事項';
}
/* 日期寫成「9月1日」，比 2026-09-01 好讀 */
/* 4.9.3 WP-A（W2-9）：年份和今天不同時加年份（同年仍只寫「9月1日」） */
function md(iso, ref) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return ''; var y = String(ref || today()).slice(0, 4); return (m[1] !== y ? m[1] + '年' : '') + Number(m[2]) + '月' + Number(m[3]) + '日'; }
function routeRank(r) { var o = DICT.route_order || C.route_order || []; var i = o.indexOf(r); return i < 0 ? 99 : i; }
function fieldText(fid, v) {
  var f = (DICT.visible || {})[fid] || {};
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(function (x) { return (f.labels && f.labels[x]) || (typeof x === 'object' ? '' : x); }).filter(Boolean).join('、');
  if (typeof v === 'number') return v + (f.unit ? ' ' + (f.unit === 'kg' ? '公斤' : f.unit) : '');
  return (f.labels && f.labels[v]) || String(v);
}
function fieldLabel(fid) { return ((DICT.visible || {})[fid] || {}).label || fid; }
function F(fid) { return LOADED && LOADED.fields ? LOADED.fields[fid] : null; }
/* 和伺服器相同的體重判斷（伺服器會再算一次；這裡只是讓病人當場知道） */
function weightCheck(kg, dateIso) {
  var th = F('weight_alert_kg'), dd = F('weight_alert_days'), dry = F('dry_weight_kg');
  if (!th || !dd || typeof th.value !== 'number' || typeof dd.value !== 'number') return null;
  /* 基準：這次之前 N 天內（以日期計）最低的居家體重；沒有才用平常體重（伺服器同樣算法） */
  var day = Date.parse(dateIso), win = (LOADED.home_weights || []).filter(function (h) { var d = Math.round((day - Date.parse(h.date)) / 86400000); return d >= 1 && d <= dd.value; });
  var ref = null;
  if (win.length) { var lo = win.reduce(function (m, h) { return h.value < m.value ? h : m; }, win[0]); ref = { v: lo.value, basis: md(lo.date) + '在家量的' }; }
  else if (dry && typeof dry.value === 'number') ref = { v: dry.value, basis: '醫療團隊訂的平常體重' };
  if (!ref) return null;
  var gain = Math.round((kg - ref.v) * 10) / 10;
  return { gain: gain, reached: gain >= th.value, th: th.value, days: dd.value, basis: ref.basis };
}
/* 3.3（ZT-D12-001）：聯絡路徑唯一來源＝伺服器的 contact_route；版本不符或缺 → 視為沒有設定（不顯示號碼、不顯示服務資訊） */
function contactRoute() {
  var CR = LOADED && LOADED.contact_route;
  return CR && CR.version === 'CONTACT_ROUTE_v1' ? CR : { version: null, emergency_number: '119', team_phone: null, service_info: null, status: 'NOT_CONFIGURED' };
}
function phoneHtml() {
  var ph = contactRoute().team_phone;
  /* 撥號連結：主號碼只留數字；分機用逗號（撥通後暫停再撥） */
  var parts = ph ? ph.split(/轉|分機|ext\.?|#/i) : [], href = ph ? parts[0].replace(/[^0-9+]/g, '') + (parts[1] ? ',' + parts[1].replace(/[^0-9]/g, '') : '') : '';
  return ph ? '<p><a class="btn primary tel" href="tel:' + esc(href) + '">打電話給醫療團隊：' + esc(ph) + '</a></p>'
    : '<p>請打您平常聯絡醫療團隊的電話（例如門診預約單、藥袋或出院單上的電話）。</p>';
}
/* 送出不等於通知：今天就要處理的狀況，一律請病人自己打電話或就醫，不能等系統 */
function notNotifyHtml(route) {
  if (routeRank(route) > routeRank('SAME_DAY')) return '';
  var now = routeRank(route) <= routeRank('URGENT_NOW');
  return '<section class="panel lk-notice" role="note"><h2>按「儲存」不等於通知醫療團隊</h2>' +
    '<p>存下來的資料，醫療團隊不一定會馬上看到。' + (now ? '請先照上面的步驟打 119 或去急診。' : '今天請自己打電話給醫療團隊，說明這次的狀況。') + '</p>' + (now ? '' : phoneHtml()) + '</section>';
}
function concernText(code) { var x = C.primary_concerns.filter(function (o) { return o[0] === code; })[0]; return x ? x[1] : code; }
/* 3.0.0：日期、時間一律台灣時間（伺服器存 UTC） */
function fmtDate(iso) { var s = String(iso || ''); if (s.length <= 10 || isNaN(Date.parse(s))) return s.slice(0, 10); return new Date(Date.parse(s) + 8 * 3600000).toISOString().slice(0, 10); }
function hm(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? '' : new Date(t + 8 * 3600000).toISOString().slice(11, 16); }
function H() { return (LOADED && LOADED.hydrate) || { prefill: {}, confirm_needed: [], previous: {}, open_concerns: [], open_actions: [], clinician_results: {} }; }

/* ---------- 帶入上次的答案 ---------- */
function initialState(st) {
  if (!LOADED) return st;
  var h = H();
  if (LOADED.respondent === 'CAREGIVER') st.mode = 'CAREGIVER';
  Object.keys(h.prefill).forEach(function (k) {
    var v = h.prefill[k];
    if (Object.prototype.hasOwnProperty.call(st.facts, k) && !LEGACY[k]) { st.facts[k] = v; st.field_meta[k] = 'ASKED'; LK.prefilled[k] = v; }
    else if (k === 'what_matters_improve') st.what_matters.improve = v;
    else if (k === 'what_matters_worry') st.what_matters.worry = v;
    else if (k === 'what_matters_source_role' && st.mode === 'CAREGIVER') { st.preference_source = v; LK.prefilled[k] = v; }
    else if (k === 'feasibility_barrier') { st.feasibility_barrier = v; LK.prefilled[k] = v; }
  });
  /* 醫療團隊已確認且仍有效的 LVEF：病人自己沒有有效答案時才用，並標示來源 */
  var cr = h.clinician_results || {};
  if (cr.lvef_percent && st.facts.lvef_band === null && st.facts.lvef_value === null) {
    var v = cr.lvef_percent.value;
    st.facts.lvef_value = v; st.facts.lvef_band = E.bandOf('lvef_value', v);
    st.facts.lvef_source = 'REPORT'; st.facts.lvef_when = cr.lvef_percent.days_old <= 183 ? 'WITHIN_6M' : 'M6_12';
    ['lvef_value', 'lvef_band', 'lvef_source', 'lvef_when'].forEach(function (k) { st.field_meta[k] = 'ASKED'; LK.from_clinician[k] = st.facts[k]; });
  }
  if (cr.tsat_percent && st.facts.tsat_band === null && st.facts.tsat_value === null) {
    st.facts.tsat_value = cr.tsat_percent.value; st.facts.tsat_band = E.bandOf('tsat_value', cr.tsat_percent.value); st.facts.tsat_when = 'WITHIN_12M';
    ['tsat_value', 'tsat_band', 'tsat_when'].forEach(function (k) { st.field_meta[k] = 'ASKED'; LK.from_clinician[k] = st.facts[k]; });
  }
  return st;
}

/* ---------- 「和上次比」追蹤頁 ---------- */
function followupScreen() {
  var st = API.state(), h = H(), cg = cgMode(st), who = cg ? '病人' : '您';
  var last = md(fmtDate(h.last_assessment_at));
  var html = '<p class="progress">和上次比｜知道的再答，不確定就選「說不上來」</p>' +
    '<section class="panel"><h2>和上次（' + esc(last) + '）比，' + who + '整體覺得？</h2><div class="choices">' +
    RC_PREV.map(function (o) { return API.choiceBtn('lk_rc', o[0], o[1], LK.rc_prev === o[0]); }).join('') + '</div></section>' +
    '<section class="panel"><h2>上次之後，' + who + '有沒有去急診或住院？</h2><div class="choices">' +
    INTERVAL.map(function (o) { return API.choiceBtn('lk_iv', o[0], o[1], LK.interval === o[0]); }).join('') + '</div>';
  if (['ED_NO_ADMISSION', 'HOSPITALIZED', 'BOTH'].indexOf(LK.interval) >= 0) {
    html += '<fieldset><legend>和心臟有關嗎？（例如喘、水腫）</legend><div class="choices two">' +
      [['YES', '有關'], ['NO', '無關'], ['UNSURE', '不確定']].map(function (o) { return API.choiceBtn('lk_ivhf', o[0], o[1], LK.interval_hf === o[0]); }).join('') + '</div></fieldset>' +
      '<label class="lk-date">大約是哪一天？（' + (LK.interval === 'ED_NO_ADMISSION' ? '看急診' : '出院') + '的日子；不記得可以空白）<input type="date" id="lk_date" max="' + today() + '" value="' + esc(LK.interval_date) + '"></label>';
  }
  html += '</section>';
  if (h.confirm_needed.indexOf('med_instances') >= 0 && Array.isArray(st.facts.med_instances) && st.facts.med_instances.length) {
    var ing = {}; C.ingredients.forEach(function (i) { ing[i.id] = i; });
    var list = st.facts.med_instances.filter(function (m) { return m.status === 'CURRENT'; }).map(function (m) { var i = ing[m.ingredient]; return ptIngName(i, m.ingredient); });
    html += '<section class="panel"><h2>上次記下的藥，現在還是一樣嗎？</h2>' + (list.length ? '<ul class="lk-list">' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="choices two">' + API.choiceBtn('lk_med', 'SAME', '一樣', LK.med_same === 'SAME') + API.choiceBtn('lk_med', 'CHANGED', '有換藥或不確定（等一下重新選）', LK.med_same === 'CHANGED') + '</div></section>';
  }
  h.open_concerns.slice(0, 3).forEach(function (c) {
    html += '<section class="panel"><h2>上次' + who + '提到「' + esc(concernText(c.concern_code)) + '」，現在？</h2><div class="choices">' +
      CONCERN_FU.map(function (o) { return API.choiceBtn('lk_cf', c.concern_id + '|' + o[0], o[1], LK.concern_fu[c.concern_id] === o[0]); }).join('') + '</div></section>';
  });
  h.open_actions.slice(0, 4).forEach(function (a) {
    var who = a.by_team ? '醫療團隊安排' : '上次準備做';
    html += '<section class="panel"><h2>' + who + '：「' + esc(actionText(a)) + '」' + (a.due_at ? '<span class="small muted">（' + esc(md(a.due_at)) + '前）</span>' : '') + '</h2><div class="choices">' +
      Object.keys(PATIENT_ONLY_TOKEN_STATUS).filter(function (k) { return !(a.by_team && k === 'NOT_DONE'); }).map(function (k) { return API.choiceBtn('lk_af', a.action_id + '|' + k, PATIENT_ONLY_TOKEN_STATUS[k], LK.action_fu[a.action_id] === k); }).join('') + '</div>';
    if (LK.action_fu[a.action_id] === 'BARRIER_REPORTED') html += '<fieldset><legend>遇到的困難比較像？（醫療團隊會依這個來幫忙）</legend><div class="choices two">' +
      (DICT.barrier_codes || []).map(function (b) { return API.choiceBtn('lk_bar', a.action_id + '|' + b[0], b[1], LK.barrier[a.action_id] === b[0]); }).join('') + '</div></fieldset>';
    html += '</section>';
  });
  html += weightHtml();
  html += '<div class="row"><button class="btn primary" type="button" data-act="lk_next">下一步</button></div>';
  return html;
}
function onClick(ev) {
  var t = ev.target.closest ? ev.target.closest('[data-act]') : null; if (!t) return;
  var act = t.getAttribute('data-act'), val = t.getAttribute('data-val');
  if (act.indexOf('lk_') !== 0) return;
  ev.stopImmediatePropagation();
  if (act === 'lk_reload') { try { window.location.reload(); } catch (e) { /* 無法重新載入時，畫面上的文字已說明 */ } return; }
  var d = document.getElementById('lk_date'); if (d) LK.interval_date = d.value || '';
  if (act !== 'lk_weight' && document.getElementById('lk_weight')) { readWeight(); syncTeamFloor(); }
  switch (act) {
    case 'lk_rc': LK.rc_prev = val; break;
    case 'lk_iv': LK.interval = val; if (['ED_NO_ADMISSION', 'HOSPITALIZED', 'BOTH'].indexOf(val) < 0) { LK.interval_hf = null; LK.interval_date = ''; } break;
    case 'lk_ivhf': LK.interval_hf = val; break;
    case 'lk_med': LK.med_same = val; if (val === 'CHANGED') { var st = API.state(); st.facts.med_instances = null; delete st.field_meta.med_instances; } break;
    case 'lk_cf': LK.concern_fu[val.split('|')[0]] = val.split('|')[1]; break;
    case 'lk_af': LK.action_fu[val.split('|')[0]] = val.split('|')[1]; break;
    case 'lk_bar': LK.barrier[val.split('|')[0]] = val.split('|')[1]; break;
    case 'lk_sh': if (SH_OPTS.some(function (o) { return o[0] === val; })) LK.self_harm = val; break;   /* W5-L（K11-06） */
    case 'lk_weight': readWeight(); syncTeamFloor(); break;
    case 'lk_next': LK.pre_done = true; syncTeamFloor(); API.advance(); return;   /* 3.3：體重達標升到 SAME_DAY 時，先到「今天聯絡」安全結果頁 */
    case 'lk_save': save(); return;
    case 'lk_retry': SAVE.state = 'IDLE'; save(); return;
    default: return;
  }
  API.rerender();
}

/* ---------- 在家量的體重（可不填；有醫療團隊的標準才判斷） ---------- */
function weightHtml() {
  var th = F('weight_alert_kg'), dd = F('weight_alert_days'), dry = F('dry_weight_kg'), prev = F('home_weight_kg');
  var h = '<section class="panel"><h2>今天早上在家量的體重（可以不填）</h2>' +
    '<p class="small">起床、上完廁所、吃早餐前量，穿差不多的衣服。</p>' +
    '<label class="lk-weight">體重（公斤）<input type="number" id="lk_weight" inputmode="decimal" min="20" max="300" step="0.1" value="' + (LK.weight === null ? '' : esc(LK.weight)) + '" aria-describedby="lk_weight_msg"></label>' +
    '<div class="row"><button class="btn secondary" type="button" data-act="lk_weight">記下這個體重</button></div><p id="lk_weight_msg" role="status" aria-live="polite">' + esc(LK.weight_err) + '</p>';
  if (prev && typeof prev.value === 'number') h += '<p class="small">上次記錄：' + esc(md(prev.date)) + ' ' + esc(prev.value) + ' 公斤。</p>';
  if (th && dd && typeof th.value === 'number' && typeof dd.value === 'number') h += '<p class="small">醫療團隊給您的標準：' + esc(dd.value) + ' 天內增加 ' + esc(th.value) + ' 公斤以上，要打電話告訴醫療團隊' + (dry && typeof dry.value === 'number' ? '（平常體重 ' + esc(dry.value) + ' 公斤）' : '') + '。</p>';
  else if (C.weight_reference) h += '<p class="small">' + esc(C.weight_reference.text) + '</p>';
  if (LK.weight !== null) {
    var w = weightCheck(LK.weight, today());
    if (w && w.reached) h += '<div class="lk-notice" role="alert"><p><strong>比' + esc(w.basis) + '多了 ' + esc(w.gain) + ' 公斤，已經達到醫療團隊給您的標準。</strong>今天請打電話告訴醫療團隊；如果同時很喘、躺不平，請打 119。</p>' + phoneHtml() + '</div>';
    else if (w) h += '<p class="small">和' + esc(w.basis) + '相比：' + (w.gain > 0 ? '多了 ' : '差 ') + esc(Math.abs(w.gain)) + ' 公斤，還沒有到醫療團隊的標準。</p>';
  }
  return h + '</section>';
}
function readWeight() {
  var el = document.getElementById('lk_weight'); if (!el) return;
  var raw = String(el.value || '').trim();
  if (!raw) { LK.weight = null; LK.weight_err = ''; return; }
  var v = Math.round(Number(raw) * 10) / 10;
  if (!isFinite(v) || v < 20 || v > 300) { LK.weight_err = '請輸入 20 到 300 之間的數字（公斤）。'; return; }
  LK.weight = v; LK.weight_err = '已記下，按「儲存給醫療團隊」才會送出。';
}
/* 3.3（ZT-D12-002）：體重達到醫療團隊標準 → 本次路徑、摘要、列印預覽一起升到「今天聯絡」（與伺服器存檔後的判定一致） */
function syncTeamFloor() {
  var st = API && API.state(); if (!st) return;
  var w = LK.weight !== null ? weightCheck(LK.weight, today()) : null;
  if (w && w.reached && Math.floor(w.days) === w.days) st.team_floor = { code: 'TEAM_WEIGHT_THRESHOLD', gain: w.gain, th: w.th, days: w.days };
  else delete st.team_floor;
}

/* 4.9.3 WP-A（CARE-NURSE-02／CARE-NEW-01）：病人連結首頁的個人體重計畫——句型與院內列印單張相同（同一組數值：警戒天數、公斤、乾體重）。
   新文字只對模擬病人顯示（LOADED.synthetic）；真實病人在臨床雙審前看不到這一段 */
var PL_GATE = { PL_WEIGHT_PLAN: 'PENDING', PL_WEIGHT_PLAN_UNSET: 'PENDING', PL_DRY_WEIGHT: 'PENDING',
  PL_SELF_HARM: 'PENDING' };   /* W5-L（5.0 K11-06）：自傷選項與 1925／119 求助文字（待臨床雙審，只對模擬病人） */
Object.assign(PL_GATE, { /* 5.1 W51-RXB 新代碼只加在這一行（PENDING） */ });
Object.assign(PL_GATE, { /* 5.1 W51-PSY 新代碼只加在這一行（PENDING） */ PL_SH_HELP_V51: 'PENDING' });
Object.assign(PL_GATE, { /* 5.1 W51-LEAF 新代碼只加在這一行（PENDING） */ });
Object.assign(PL_GATE, { /* 5.1 W51-NUR 新代碼只加在這一行（PENDING） */ });
Object.assign(PL_GATE, { /* 5.1 W51-DPT 新代碼只加在這一行（PENDING） */ });
Object.assign(PL_GATE, { /* 5.1 W51-ASK 新代碼只加在這一行（PENDING） */ });
function plGate(id) { var st = Object.prototype.hasOwnProperty.call(PL_GATE, id) ? PL_GATE[id] : ''; return !!st && (st === 'APPROVED' || !!(LOADED && LOADED.synthetic)); }
/* ==================== W5-L begin（5.0 K11-06）：病人連結的自傷選項 ====================
   只對模擬病人顯示；選「有念頭」或「有計畫」→ 當下顯示 1925 安心專線與 119，按儲存後伺服器依院內流程政策建立當日／緊急警訊，醫療端當日處理（R-SELF-HARM）。
   這一題可以不答；不答就不送。 */
var SH_OPTS = [['NO', '沒有'], ['THOUGHTS', '有這樣的念頭'], ['PLAN_OR_ACT', '有計畫，或最近傷害過自己'], ['PREFER_NOT', '不想回答']];
function selfHarmHtml() {
  if (!plGate('PL_SELF_HARM')) return '';
  var st = API ? API.state() : null, cg = cgMode(st), who = cg ? '病人' : '您';
  var h = '<section class="panel lk-sh" id="lk_self_harm" data-review="L1"><h2>最近有沒有' + (cg ? '聽病人說過' : '') + '想傷害自己，或不想活的念頭？</h2><p class="small">這一題可以不回答。照實說，醫療團隊才能幫忙。</p><div class="choices two">' +
    SH_OPTS.map(function (o) { return API.choiceBtn('lk_sh', o[0], o[1], LK.self_harm === o[0]); }).join('') + '</div>';
  if ((LK.self_harm === 'THOUGHTS' || LK.self_harm === 'PLAN_OR_ACT') && plGate('PL_SH_HELP_V51')) h += psy_shHelpHtml(LK.self_harm, cg, who);   /* 5.1 W51-PSY（PS-02）：新版求助文字（待臨床雙審，只對模擬病人）；下方原文字保留不刪 */
  else if (LK.self_harm === 'THOUGHTS' || LK.self_harm === 'PLAN_OR_ACT') h += '<div class="lk-notice" role="alert" id="lk_sh_help"><p><strong>謝謝您說出來，' + esc(who) + '不用一個人面對。</strong></p>' +
    '<p>現在就可以打 <a class="btn primary tel" href="tel:1925">1925 安心專線</a>（24 小時、免付費），有人會聽' + esc(who) + '說。</p>' +
    '<p>如果現在就有傷害自己的危險，請立刻打 <a class="btn primary tel" href="tel:119">119</a>，或請身邊的人陪' + esc(who) + '去急診。</p>' +
    '<p class="small">按「儲存給醫療團隊」後，醫療團隊會收到需要當天處理的提醒；但存下來不等於馬上有人看到，有危險時請不要等。</p></div>';
  return h + '</section>';
}
/* ==================== W5-L end ==================== */
/* ==== 5.1 W51-PSY begin（PS-02）：病人連結自傷求助文字（新文字；PL_GATE PL_SH_HELP_V51＝PENDING，只對模擬病人）====
   有計畫或已傷害 → 先列 119／急診與「請身邊的人陪著，不要讓自己獨處」；兩種情況都說明存下來不等於馬上有人看到（與 notNotifyHtml 一致）並附團隊電話；照顧者版加陪伴句。不含任何方法內容 */
function psy_shHelpHtml(v, cg, who) {
  var t119 = '<a class="btn primary tel" href="tel:119">119</a>', t1925 = '<a class="btn primary tel" href="tel:1925">1925 安心專線</a>';
  var h = '<div class="lk-notice" role="alert" id="lk_sh_help" data-review="L1" data-gate="PL_SH_HELP_V51"><p><strong>謝謝您說出來，' + esc(who) + '不用一個人面對。</strong></p>';
  if (v === 'PLAN_OR_ACT') {
    h += '<p id="lk_sh_now">' + (cg ? '病人現在就有傷害自己的危險：請立刻打 ' + t119 + '，或陪病人去急診。' : '現在就有傷害自己的危險：請立刻打 ' + t119 + '，或請身邊的人陪您去急診。') + '</p>' +
      '<p id="lk_sh_company"><strong>' + (cg ? '請陪在病人身邊，不要讓病人獨處。' : '請身邊的人陪著您，不要讓自己獨處。') + '</strong></p>' +
      '<p>也可以打 ' + t1925 + '（24 小時、免付費），有人會聽' + esc(who) + '說。</p>' +
      '<p class="small" id="lk_sh_notnotify">按「儲存」不等於通知醫療團隊：存下來不等於馬上有人看到，晚上、假日可能要到上班時間才有人看。有危險時請不要等，先打 119 或去急診，之後再打電話告訴醫療團隊。</p>';
  } else {
    h += '<p>現在就可以打 ' + t1925 + '（24 小時、免付費），有人會聽' + esc(who) + '說。</p>' +
      '<p id="lk_sh_now">如果現在就有傷害自己的危險，請立刻打 ' + t119 + '，或請身邊的人陪' + esc(who) + '去急診。</p>' +
      (cg ? '<p id="lk_sh_company"><strong>請多陪在病人身邊；病人說有計畫或想馬上傷害自己時，請立刻打 119，不要讓病人獨處。</strong></p>' : '') +
      '<p class="small" id="lk_sh_notnotify">按「儲存」不等於通知醫療團隊：存下來不等於馬上有人看到，晚上、假日可能要到上班時間才有人看。今天請自己打電話告訴醫療團隊。</p>';
  }
  return h + phoneHtml() + '</div>';
}
/* ==== 5.1 W51-PSY end ==== */
function weightPlanHtml() {
  var th = F('weight_alert_kg'), dd = F('weight_alert_days'), dry = F('dry_weight_kg'), set = th && dd && typeof th.value === 'number' && typeof dd.value === 'number';
  if (set && plGate('PL_WEIGHT_PLAN')) return '<h3>在家量體重</h3><p id="lk_wplan" data-review="L1">' + esc(dd.value) + ' 天內增加 ' + esc(th.value) + ' 公斤以上，請打電話給醫療團隊。每天早上起床、上完廁所、吃早餐前量。' +
    (dry && typeof dry.value === 'number' && plGate('PL_DRY_WEIGHT') ? '醫療團隊記錄的乾體重（身體沒有多餘積水時的體重）約 ' + esc(dry.value) + ' 公斤。' : '') + '</p>';
  if (!set && plGate('PL_WEIGHT_PLAN_UNSET')) return '<h3>在家量體重</h3><p id="lk_wplan" data-review="L1">體重要增加多少要打電話，還沒有設定；請醫療團隊幫您填。</p>';
  return '';
}
/* ---------- 醫療團隊的計畫、最近的紀錄、和上次比（可列印） ---------- */
function teamHtml() {
  if (!LOADED) return '';
  var h = H(), out = '';
  var acts = (h.open_actions || []).filter(function (a) { return a.by_team; });
  if (acts.length) out += '<h3>醫療團隊安排的事</h3><ul class="lk-list">' + acts.slice(0, 8).map(function (a) {
    return '<li>' + esc(actionText(a)) + (a.due_at ? '｜' + esc(md(a.due_at)) + '前' : '') + (a.owner_role && ROLE_PT[a.owner_role] ? '｜負責：' + esc(ROLE_PT[a.owner_role]) : '') + (a.action_status === 'BARRIER_REPORTED' ? '｜已回報困難' : '') + '</li>'; }).join('') + '</ul>';
  var rec = LOADED.team_records || [];
  if (rec.length) out += '<h3>醫療團隊最近的紀錄</h3><ul class="lk-list">' + rec.map(function (r) {
    return '<li>' + esc(fieldLabel(r.field_id)) + '：' + esc(fieldText(r.field_id, r.value)) + '<span class="small muted">（' + esc(r.source) + (r.date ? '，' + esc(md(r.date)) : '') + '）</span></li>'; }).join('') + '</ul>';
  var ch = LOADED.recent_changes || [];
  if (ch.length) out += '<h3>和上次的紀錄比</h3><p class="small muted">只列出不一樣的地方，不代表變好或變差；看不懂可以問醫療團隊。</p><ul class="lk-list">' + ch.map(function (c) {
    return '<li>' + esc(fieldLabel(c.field_id)) + '：' + esc(fieldText(c.field_id, c.before)) + (c.before_date ? '（' + esc(md(c.before_date)) + '）' : '') + ' → ' + esc(fieldText(c.field_id, c.now)) + (c.date ? '（' + esc(md(c.date)) + '）' : '') + '</li>'; }).join('') + '</ul>';
  return out ? '<section class="panel lk-team"><h2>您的醫療團隊</h2>' + out + '</section>' : '';
}

/* ---------- 接續上次：伺服器的精準照護計畫（PATIENT_PLAN_V1）；卡片文字用同一份已審核的公開版內容 ---------- */
var CARD_IX = null;
function cardById(id) {
  if (!CARD_IX) { CARD_IX = {}; Object.keys(C.cards || {}).forEach(function (k) { CARD_IX[k] = C.cards[k]; }); (C.rules || []).forEach(function (r) { if (r.card) CARD_IX[r.id] = r.card; }); }
  return CARD_IX[id] || null;
}
var TIMING_PT = { NOW: '現在', TODAY: '今天', THIS_WEEK: '這星期', NEXT_VISIT: '下次看診', ONGOING: '每天', AS_NEEDED: '需要時' };
function planHtml(after) {
  var pv = LOADED && LOADED.plan;
  if (!pv || pv.projection !== 'PATIENT_PLAN_V1') {
    /* 計畫整理失敗：不假裝沒事；最近有警訊時照樣提醒 */
    if (LOADED && LOADED.plan_error) return '<section class="panel lk-plan" id="lk_plan"><p class="small">' + (LOADED.plan_error === 'PAGE_OUTDATED' ? '系統剛更新，這個頁面是舊版本：請關閉後重新開啟這個連結（或重新整理）。' : (LOADED.plan_error === 'VERSION_MISMATCH' ? '醫療團隊的系統正在更新，這次先不顯示整理好的重點；您仍然可以回答並儲存，醫療團隊的系統會用最新版本整理。' : '這次的重點暫時無法整理，請照下面的問題回答；需要時請直接聯絡醫療團隊。')) + '</p>' +
      (LOADED.safety_recent ? '<p class="notice warn"><strong>最近幾天的紀錄裡有警訊。請先在下面的問卷重新勾選「現在」的狀況；現在情況緊急請直接撥 119。</strong></p>' : '') + '</section>';
    return '';
  }
  var cg = pv.communication && pv.communication.caregiver_variant, who = cg ? '病人' : '您', out = '';
  /* v4.8 WP-5（H14）：照顧者填寫時，卡片換成已審核的照顧者版本（與列印、公開版 applyCaregiver 同一份 caregiver_variants；只換文字與行動） */
  var cardCg = function (id) { var c = cardById(id); if (!c || !cg) return c; var v = (C.caregiver_variants || {})[id]; if (!v) return c; var x = Object.assign({}, c); if (v.title) x.title = v.title; if (v.actions) { x.actions = v.actions.slice(); x.summary_action = v.actions[0]; } return x; };
  /* 最近幾天記下過警訊：先提醒今天重新確認，不沿用舊的判斷 */
  if (pv.journey && pv.journey.stage && ['EARLY_POST_DISCHARGE', 'INPATIENT', 'CHANGING'].indexOf(pv.journey.stage.code) >= 0) out += '<p class="lk-stage"><strong>目前：</strong>' + esc(pv.journey.stage.pt) + '</p>';
  if (pv.safety_current) out += '<p class="notice warn"><strong>最近幾天的紀錄裡有需要盡快處理的警訊。請先在下面的問卷重新勾選「現在」的狀況；現在情況緊急請直接撥 119。</strong></p>';
  if (!pv.first_encounter) {
    var cont = '';
    if (pv.done.length) cont += '<h3>上次到現在，已經完成</h3><ul class="lk-list lk-done">' + pv.done.map(function (t) { return '<li>✓ ' + esc(t) + '</li>'; }).join('') + '</ul>';
    if (pv.changes.length) cont += '<h3>和上次比，紀錄有變的地方</h3><ul class="lk-list">' + pv.changes.map(function (c) { return '<li>' + esc(c.label) + '：' + esc(c.before || '（沒有紀錄）') + ' → ' + esc(c.after || '（沒有紀錄）') + '</li>'; }).join('') + '</ul>';
    if (cont) out += '<h2>接續上次' + (pv.last_encounter_date ? '（' + esc(md(pv.last_encounter_date)) + '）' : '') + '</h2>' + cont;
  }
  var acts = (pv.today_actions || []).map(function (a) {
    var c = cardCg(a.card_id); if (!c) return '';
    var t = TIMING_PT[c.timing] || '';
    var FZ = { ACTION: '要做什麼', WHEN_HELP: '什麼情況要提早求助', DO_NOT: '什麼不要自己做' };
    var rf = (a.reteach_facets || []).map(function (f) { return FZ[f] || ''; }).filter(Boolean);
    return '<li class="lk-act" data-card="' + esc(a.card_id) + '" data-tier="' + esc(a.tier) + '"><strong>' + esc(c.title) + '</strong>' +
      (a.reteach ? ' <span class="lk-chip">上次' + (rf.length ? '「' + esc(rf.join('」「')) + '」' : '') + '還不太確定，再看一次</span>' : (a.reassess ? ' <span class="lk-chip">上次已經會了，這次再說一次看看</span>' : (a.reinforce ? ' <span class="lk-chip">已說明過，提醒重點</span>' : ''))) +
      (a.gap ? ' <span class="lk-chip">先說說卡在哪裡</span>' : '') +
      '<br>' + esc(c.summary_action || (c.actions || [''])[0]) + (t ? '（' + esc(t) + '）' : '') +
      (a.why && a.why.length ? '<br><span class="small muted">為什麼：' + esc(a.why.join('；')) + '</span>' : '') + '</li>';
  }).filter(Boolean);
  /* 3.0.0 共同照護承諾：分成「您可以做」「醫療團隊正在處理」「下次一起確認」，責任不混在一起 */
  if (acts.length) out += '<h2>① ' + esc(who) + '這次可以先做（' + acts.length + ' 件）</h2><ol class="lk-acts">' + acts.join('') + '</ol>';
  /* v4.8 WP-5（H12）：溝通需要「寫下步驟」→ 列出今天主題的全部步驟（已審核的 actions，不新增內容）；「需要唸給我聽」→ 瀏覽器朗讀，不支援時請照護人員唸 */
  var cmx = pv.communication || {};
  if (cmx.written_steps) out += '<details class="lk-steps" id="lk_steps" open><summary>每一件事的完整步驟</summary>' + (pv.today_actions || []).map(function (a) { var c = cardCg(a.card_id); return c && (c.actions || []).length ? '<p><strong>' + esc(c.title) + '</strong></p><ol>' + c.actions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : ''; }).join('') + '</details>';
  if (cmx.read_aloud) out += (typeof window !== 'undefined' && window.speechSynthesis && window.SpeechSynthesisUtterance) ? '<p><button class="btn" type="button" data-act="lk_read" id="lk_read">唸給我聽</button></p>' : '<p class="small" id="lk_read_na">這個瀏覽器不能朗讀，請由照護人員唸給' + esc(who) + '聽。</p>';
  /* v4.6 WP-B2：超過「一次幾件」的主題不丟棄——收在「其他主題（點開）」，與列印同一份清單 */
  var more = (pv.more || []).map(function (m) { var c = cardCg(m.card_id); return c ? '<li data-card="' + esc(m.card_id) + '"><strong>' + esc(c.title) + '</strong><br>' + esc(c.summary_action || (c.actions || [''])[0]) + '</li>' : ''; }).filter(Boolean);
  if (more.length) out += '<details class="lk-more" id="lk_more"><summary>其他主題（' + more.length + ' 個，點開）</summary><ul class="lk-list">' + more.join('') + '</ul></details>';
  var team = (pv.open || []).filter(function (o) { return o.by_team; }), mine = (pv.open || []).filter(function (o) { return !o.by_team; });
  var TS = { ACCEPTED: '已有人接手', WAITING: '等待安排' };
  if (team.length) out += '<h2>② 醫療團隊正在處理</h2><p class="small muted">這些是醫療團隊要做的事，不用' + esc(who) + '自己安排；有問題可以問醫療團隊。</p><ul class="lk-list">' + team.map(function (o) {
    return '<li>' + esc(o.text) + (o.owner_role && ROLE_PT[o.owner_role] ? '｜' + esc(ROLE_PT[o.owner_role]) : '') + (o.team_status ? '｜' + esc(TS[o.team_status]) : '') + (o.due ? '（' + esc(md(o.due)) + (o.overdue ? '，已超過' : '') + '）' : '') + '</li>'; }).join('') + '</ul>';
  var qs = (pv.questions || []).map(function (id) { var c = cardCg(id); return c && c.ask ? c.ask : ''; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).slice(0, 3);
  var j = pv.journey;
  if (mine.length || qs.length || (j && j.next_contact)) {
    out += '<h2>③ 下次一起確認</h2><ul class="lk-list">';
    if (j && j.next_contact) out += '<li><strong>下次聯絡：</strong>' + (j.next_contact.status === 'SCHEDULED' ? esc(j.next_contact.pt) + '（' + esc(md(j.next_contact.due_at)) + (j.next_contact.overdue ? '，已超過，請聯絡醫療團隊' : '') + '）' : esc(j.next_contact.pt)) + '</li>';
    /* v4.9 S5（H14）：伺服器已依到期日排序；前 4 項直接列出，其餘點開（全部列出，不丟棄） */
    var mineLi = mine.map(function (o) { return '<li>' + esc(o.text) + (o.status === 'PATIENT_REPORTED_DONE' ? '（已回報，待確認）' : '') + (o.due ? '（' + esc(md(o.due)) + (o.overdue ? '，已超過' : '') + '）' : '') + '</li>'; });
    out += mineLi.slice(0, 4).join('') + (mineLi.length > 4 ? '<li><details id="lk_open_more"><summary>還有 ' + (mineLi.length - 4) + ' 件（點開）</summary><ul class="lk-list">' + mineLi.slice(4).join('') + '</ul></details></li>' : '');
    out += qs.map(function (q) { return '<li>可以問：' + esc(q) + '</li>'; }).join('') + '</ul>';
  }
  var cmh = pv.communication || {};
  if (cmh.use_med_bags) out += '<p class="small"><strong>小提醒：</strong>看用藥內容時，把家裡的藥袋拿出來一個一個對照，比只看名字容易。</p>';
  if (pv.selected && pv.selected.text) out += '<p><strong>' + esc(who) + '最在意的事：' + esc(pv.selected.label) + '</strong><br>' + esc(pv.selected.text) + '</p>';
  if (pv.medication && pv.medication.text) {
    var MS = { CHANGED: '最近有改變，留意身體的變化', MONITOR_DUE: '需要抽血追蹤（例如血鉀、腎功能），請問醫療團隊什麼時候抽', DISCREPANCY: '處方和您實際在吃的不一樣，請帶藥袋核對', HELD: '醫療團隊請您先暫停這類藥；請不要自己恢復，等醫療團隊通知' };
    var mlab = {}; (C.medications || []).forEach(function (m) { mlab[m.id] = m.label; });
    var items = (pv.medication.items || []).filter(function (i) { return mlab[i.med_class]; }).map(function (i) {
      return '<li><strong>' + esc(mlab[i.med_class]) + '</strong>：' + esc(i.statuses.map(function (x) { return MS[x] || ''; }).filter(Boolean).join('；')) + '</li>'; });
    var CK = { STARTED: '開始使用', STOPPED: '停用', ADJUSTED: '調整劑量或用法', HELD: '暫停', RESUMED: '恢復使用' }, ing = {}; (C.ingredients || []).forEach(function (i) { ing[i.id] = i; });
    var chg = (pv.medication.changes || []).map(function (c) { var i = ing[c.ingredient]; return '<li data-ing="' + esc(c.ingredient) + '">' + esc(md(c.date)) + ' ' + esc(ptIngName(i, c.ingredient)) + '：' + esc(CK[c.kind] || '') + '</li>'; });
    out += '<h3>用藥重點</h3><p>' + esc(pv.medication.text) + '</p>' + (items.length ? '<ul class="lk-list">' + items.join('') + '</ul>' : '') +
      (chg.length ? '<p class="small"><strong>最近處方的改變（醫療團隊的紀錄）：</strong></p><ul class="lk-list small">' + chg.join('') + '</ul>' : '') +
      (/不要自己停藥/.test(pv.medication.text) ? '' : '<p class="small muted">不要自己停藥、換藥或改劑量；有疑問先問醫師或藥師。</p>');
  }
  out += weightPlanHtml();   /* 4.9.3 WP-A（CARE-NURSE-02）：個人體重計畫（只對模擬病人；待臨床雙審） */
  if ((pv.safety_floor || []).length) out += '<details class="lk-floor"><summary><strong>什麼情況要提早求助</strong>（醫療團隊和' + esc(who) + '看的是同一份）</summary>' + pv.safety_floor.map(function (r) { return '<p><strong>' + esc(r.headline) + '</strong>：' + esc((r.signals || []).join('；')) + '</p>'; }).join('') + '</details>';
  /* 3.3（ZT-A-016）：各職類評估後的結論（營養、運動、長照、照護目標），只列醫療團隊已記下的 */
  if ((pv.care_plan_results || []).length) out += '<h3>醫療團隊各職類給' + esc(who) + '的結論</h3><ul class="lk-list" id="lk_allied">' + pv.care_plan_results.map(function (a) { return '<li>' + esc(a.text) + '</li>'; }).join('') + '</ul>';
  if (pv.limiters.length) out += '<h3>這次還沒辦法幫' + esc(who) + '個別判斷的地方</h3><ul class="lk-list">' + pv.limiters.map(function (l) { return '<li>' + esc(l.text) + '</li>'; }).join('') + '</ul>';
  if (!out) return '';
  return '<section class="panel lk-plan' + ((pv.communication || {}).large_print ? ' lk-large' : '') + '" id="' + (after ? 'lk_plan2' : 'lk_plan') + '"><p class="small muted">以下是醫療團隊系統依' + esc(who) + (after ? '剛剛儲存的內容' : '之前的紀錄') + '整理的重點，不是醫師的新醫囑' + (after ? '；醫療人員看到的是同一份。' : '；按上面的「開始」作答，就能更新這些內容。') + '</p>' + out + '</section>';
}

/* ---------- 衛教與理解確認（EducationTruth）：病人端只能記「看過」「自己確認」「還不太確定」 ---------- */
var EDU_SENT = {};
function educationPayload() {
  var st = API.state(), meta = DICT.cards || {}, out = [], ph = (LOADED && LOADED.plan && LOADED.plan.plan_hash) || '';
  var todayIds = ((LOADED && LOADED.plan && LOADED.plan.today_actions) || []).map(function (a) { return a.card_id; });
  var ids = {}; Object.keys(st.teach || {}).concat(Object.keys(st.learning || {})).forEach(function (k) { ids[k] = 1; });
  Object.keys(ids).sort().forEach(function (cid) {
    if (!meta[cid]) return;
    var t = (st.teach || {})[cid], l = (st.learning || {})[cid], e = null;
    if (t === 'NEED_HELP') e = ['TEACH_BACK', 'NEEDS_HELP', 'SELF_REPORT'];
    else if (t === 'OBJECTIVE_INCORRECT' || l === 'UNDERSTANDING_NOT_YET') e = ['TEACH_BACK', 'NEEDS_HELP', 'CHECK_QUESTION'];
    else if (t === 'OBJECTIVE_CORRECT' || t === 'RETEST_CORRECT' || l === 'UNDERSTANDING_CHECKED') e = ['TEACH_BACK', 'SELF_CHECKED', 'CHECK_QUESTION'];
    else if (t === 'OWN_WORDS_DONE') e = ['TEACH_BACK', 'SELF_CHECKED', 'SELF_REPORT'];
    else if (l === 'ACTION_PLANNED' || (l === 'SHOWN' && todayIds.indexOf(cid) >= 0)) e = ['DELIVERED', 'NOT_ASSESSED', 'NONE'];
    if (!e) return;
    var key = e.join('|');
    var vo = !!(st.verify_only || {})[cid] && e[2] === 'CHECK_QUESTION';
    if (vo) key += '|VO';
    if (EDU_SENT[cid] === key) return;
    var x = { card_id: cid, kind: e[0], understanding: e[1], method: e[2], channel: 'PATIENT_LINK' };
    if (vo) x.trigger_codes = ['PATIENT_VERIFY_ONLY'];   /* 病人選「我記得，直接確認」：沒有重看內容，只答確認題 */
    if (ph && /^[0-9a-f]{8,64}$/.test(ph)) x.plan_hash = ph;
    out.push(x);
  });
  /* 理解狀態優先（還不太確定＞自己確認＞看過），超過上限時先送重要的 */
  var rank = { NEEDS_HELP: 0, SELF_CHECKED: 1, NOT_ASSESSED: 2 };
  return out.sort(function (a, b) { return rank[a.understanding] - rank[b.understanding]; }).slice(0, 30);
}

/* ---------- 組成要送出的資料 ---------- */
function buildPayload(first) {
  var st = API.state(), h = H(), r = API.analyze(), src = st.mode === 'CAREGIVER' ? 'CAREGIVER_REPORTED' : 'PATIENT_REPORTED';
  var obs = [], skipped = [];
  function put(fid, v) {
    if (v === null || v === undefined) return;
    if (!validValue(fid, v)) { skipped.push(fid); return; }
    if (LK.from_clinician[fid] !== undefined && same(LK.from_clinician[fid], v)) return;      /* 醫療團隊的紀錄不冒充病人自述 */
    if (!first && SAVE.sent_obs[fid] !== undefined && same(SAVE.sent_obs[fid], v)) return;
    if (LK.prefilled[fid] !== undefined && same(LK.prefilled[fid], v)) {
      if (first && fid === 'med_instances' && LK.med_same === 'SAME') obs.push({ field_id: fid, action_type: 'CONFIRM', source_type: src });
      return;
    }
    if (fid === 'med_instances') {
      /* v4.3 X05：病人從候選清單選的藥名一律「病人自選、未核對」；只有上次已由藥師核對（或醫療團隊記錄）的成分沿用原狀態——伺服器會再把關 */
      var preMs = {}; (LK.prefilled.med_instances || []).forEach(function (m) { if (m && m.ingredient) preMs[m.ingredient] = m.match_status || 'TEAM_RECORDED'; });
      v = v.map(function (m) { var o = {}; Object.keys(m).forEach(function (k) { if (m[k] !== null && m[k] !== undefined && k !== 'confirmed_by_role') o[k] = m[k]; }); o.source = 'PATIENT_REPORTED';
        var ps = preMs[o.ingredient]; if (ps === 'PHARMACIST_CONFIRMED') o.match_status = ps; else if (ps === 'TEAM_RECORDED') delete o.match_status; else o.match_status = 'PATIENT_SELECTED_UNCONFIRMED'; return o; });
    }
    obs.push({ field_id: fid, action_type: 'UPDATE', value: v, source_type: src });
  }
  E.FACT_KEYS.forEach(function (k) { if (!LEGACY[k]) put(k, st.facts[k]); });
  if (st.safety && st.safety.status && st.safety.status !== 'NOT_ASSESSED') put('safety_signals', (st.safety.signals || []).slice());
  put('recent_change_usual', st.recent_change);
  put('primary_concern', st.primary_concern);
  put('self_management_readiness', st.self_management_readiness);
  put('goals_discussion_readiness', st.goals_discussion_readiness);
  put('feasibility', st.feasibility);
  put('feasibility_barrier', st.feasibility === 'HARD' ? st.feasibility_barrier : null);   /* 3.1.0（HFPC-AUD-0029） */
  if (st.what_matters) { put('what_matters_improve', st.what_matters.improve); put('what_matters_worry', st.what_matters.worry); }
  if (st.what_matters && (st.what_matters.improve || st.what_matters.worry)) put('what_matters_source_role', st.mode === 'CAREGIVER' ? st.preference_source : 'PATIENT');   /* 3.1.0（HFPC-AUD-0028）：照顧者推測要分開 */
  if (Array.isArray(st.whole_person) && st.whole_person.length) put('whole_person_needs', st.whole_person.slice());   /* 3.1.0（HFPC-AUD-0030） */
  var tv = Object.keys(st.teach || {}).map(function (k) { return st.teach[k]; });
  put('teach_back_outcome', tv.indexOf('NEED_HELP') >= 0 ? 'NEED_HELP' : (tv.indexOf('OWN_WORDS_DONE') >= 0 ? 'OWN_WORDS_DONE' : null));
  put('recent_change_previous', LK.rc_prev);
  put('interval_acute_care', LK.interval);
  put('interval_acute_hf_related', LK.interval_hf);
  if (LK.self_harm && plGate('PL_SELF_HARM')) put('pt_self_harm_screen', LK.self_harm);   /* W5-L（K11-06）：只有模擬病人會送；伺服器另有程式層把關 */
  /* 全人照護：心情、照顧負擔、日常需要幫忙的程度、心臟電擊器／節律器（公開版問卷的答案） */
  ['mood_screen', 'caregiver_strain', 'care_dependency', 'device', 'cost_skip', 'nutrition_risk'].forEach(function (k) { put(k, st[k]); });
  if (LK.weight !== null && validValue('home_weight_kg', LK.weight) && !(SAVE.sent_obs.home_weight_kg === LK.weight && !first))
    obs.push({ field_id: 'home_weight_kg', action_type: 'UPDATE', value: LK.weight, source_type: src, effective_at: today() });
  var p = { idempotency_key: '', base_snapshot_version: SAVE.base, observations: obs, care_events: [], actions: [], concerns: [], education: educationPayload() };
  if (first) {
    p.assessment = { route: r && r.route ? String(r.route) : '', respondent: st.mode === 'CAREGIVER' ? 'CAREGIVER' : 'SELF' };
    if (LK.interval_date && ['ED_NO_ADMISSION', 'HOSPITALIZED', 'BOTH'].indexOf(LK.interval) >= 0) {
      var hf = LK.interval_hf === 'YES';
      if (LK.interval === 'ED_NO_ADMISSION' || LK.interval === 'BOTH') p.care_events.push({ event_type: hf ? 'HF_ED_REPORTED' : 'OTHER_ED_REPORTED', occurred_at: LK.interval_date, hf_related: LK.interval_hf || 'UNSURE', source_type: src });
      if (LK.interval === 'HOSPITALIZED' || LK.interval === 'BOTH') p.care_events.push({ event_type: hf ? 'HF_DISCHARGE_REPORTED' : 'OTHER_ADMISSION_REPORTED', occurred_at: LK.interval_date, hf_related: LK.interval_hf || 'UNSURE', source_type: src });
    }
    Object.keys(LK.concern_fu).forEach(function (id) { p.concerns.push({ concern_id: id, status: LK.concern_fu[id], source_type: src }); });
    var openCodes = h.open_concerns.map(function (c) { return c.concern_code; });
    if (st.primary_concern && st.primary_concern !== 'NONE' && openCodes.indexOf(st.primary_concern) < 0 && (DICT.concern_codes || []).indexOf(st.primary_concern) >= 0) p.concerns.push({ concern_code: st.primary_concern, status: 'OPEN', source_type: src });
    Object.keys(LK.action_fu).forEach(function (id) {
      var s = LK.action_fu[id], a = { action_id: id, action_status: s, source_type: src };
      if (s === 'COMPLETED') a.completed_at = today();
      if (s === 'BARRIER_REPORTED') a.barrier_code = LK.barrier[id] || 'OTHER';
      if (s === 'NOT_DONE') a.resolution_code = 'PATIENT_REPORTED_NOT_DONE';
      p.actions.push(a);
    });
    var openRefs = h.open_actions.map(function (a) { return a.action_ref; });
    API.plannedKeys().forEach(function (k) { if (openRefs.indexOf(k) < 0 && /^[A-Za-z0-9_#.:\-]{1,60}$/.test(k)) p.actions.push({ action_type: 'SELF_CARE', action_ref: k, action_status: 'PLANNED', owner_role: st.mode === 'CAREGIVER' ? 'CAREGIVER' : 'PATIENT', source_type: src }); });
  }
  return { payload: p, skipped: skipped };
}

/* ---------- 儲存（三態） ---------- */
var STATE_TEXT = { IDLE: '', SAVING: '正在儲存…', RECEIVED: '已送出，醫療團隊的系統處理中（約 1–2 分鐘）…', SAVED: '這份資料已儲存。這不代表醫療人員正在即時查看', CONFLICT: '已送出，但醫療團隊需要先確認', FAILED: '尚未儲存' };
/* v4.3 X05：儲存狀態代碼（NOT_SAVED／SAVING／SAVED／FAILED／NOT_DELIVERED／ACKNOWLEDGED）。代碼一律放在 data-save-code 供測試與稽核；
   對應的畫面字樣是新文字＝L1（待雙審），只在模擬病人顯示，真實病人仍只看原本的文字。ACKNOWLEDGED（醫療人員已確認）目前病人連結無從得知，保留不用 */
var SAVE_CODE = { IDLE: 'NOT_SAVED', SAVING: 'SAVING', RECEIVED: 'SAVING', SAVED: 'SAVED', FAILED: 'FAILED', CONFLICT: 'NOT_DELIVERED' };
function statusHtml() {
  var cls = { SAVED: 'ok', FAILED: 'err', CONFLICT: 'warn' }[SAVE.state] || '', code = SAVE_CODE[SAVE.state] || 'NOT_SAVED';
  return '<p id="lk_status" class="lk-status ' + cls + '" role="status" aria-live="polite" data-state="' + SAVE.state + '" data-save-code="' + code + '">' + esc(STATE_TEXT[SAVE.state]) + (SAVE.message ? '：' + esc(SAVE.message) : '') +
    (LOADED && LOADED.synthetic ? ' <span id="lk_save_code" class="small muted" data-review="L1">（模擬病人；這段文字尚待兩位臨床人員審核）儲存狀態：' + code + '</span>' : '') + '</p>';
}
/* 3.0.0 送出狀態一直看得到（MS-P0-17）：結果頁最上面固定一條，捲到哪裡都知道「還沒送出／送出中／已存入」；伺服器確認前絕不說完成 */
var TOP_TEXT = { IDLE: '預覽：這是依剛才的回答在這個頁面整理的內容，還沒有送給醫療團隊。', FAILED: '尚未送出：上一次沒有儲存成功，畫面上的內容還在。', SAVING: '正在送出…',
  RECEIVED: '已送出，醫療團隊的系統處理中（這不代表有人正在即時查看）。', SAVED: '已存入醫療團隊的紀錄。請以下方「正式整理」為準，上面的內容是剛才的預覽。', CONFLICT: '已送出，需要醫療團隊確認後才會納入紀錄。' };
function resultTopHtml() {
  var st = SAVE.state, unsent = st === 'IDLE' || st === 'FAILED';
  /* v4.3 X05：119 一律在最上層（與儲存狀態無關；沿用既有字樣）；固定儲存鈕看得到時隱藏跳轉條（第一個螢幕只留一個主要按鈕） */
  return '<div class="lk-sticky ' + (unsent ? 'unsent' : (st === 'SAVED' ? 'ok' : 'pending')) + '" id="lk_top" role="status" aria-live="polite" data-state="' + esc(st) + '"><span class="lk-emergency" id="lk_emergency">有緊急狀況請直接撥打 <a href="tel:119">119</a>。</span><span>' + esc(TOP_TEXT[st] || '') + (st === 'SAVED' && SAVE.done_at ? '（' + esc(hm(SAVE.done_at)) + '）' : '') + '</span>' +
    (unsent ? ' <a class="btn small primary lk-jump" href="#lk_save_panel"' + (dockShown() ? ' style="display:none"' : '') + '>到「儲存給醫療團隊」</a>' : '') + '</div>';
}
function dockShown() { var d = document.getElementById('lk_dock'); if (!d) return false; var r = d.getBoundingClientRect(); return r.height > 0 && r.top < window.innerHeight && getComputedStyle(d).display !== 'none'; }
function syncJump() { var j = document.querySelector('#lk_top .lk-jump'); if (j) j.style.display = dockShown() ? 'none' : ''; }
function refreshStatus() {
  var el = document.getElementById('lk_status'); if (el) el.outerHTML = statusHtml();
  var tp = document.getElementById('lk_top'); if (tp) tp.outerHTML = resultTopHtml();
  var b = document.getElementById('lk_save_btn');
  [b, document.getElementById('lk_dock_btn')].forEach(function (x) { if (x) { x.disabled = SAVE.state === 'SAVING' || SAVE.state === 'RECEIVED'; x.textContent = SAVE.committed_once ? '再儲存一次（只送修改的部分）' : '儲存給醫療團隊'; } });
  var rb = document.getElementById('lk_retry_btn'); if (rb) rb.hidden = SAVE.state !== 'FAILED';
  syncJump();
}
function setState(s, msg) { SAVE.state = s; SAVE.message = msg || ''; refreshStatus(); if (API) API.announce(STATE_TEXT[s] + (msg ? '：' + msg : '')); }
function save() {
  if (SAVE.state === 'SAVING' || SAVE.state === 'RECEIVED') return;
  var first = !SAVE.committed_once, b = buildPayload(first);
  var body = JSON.stringify(b.payload);
  if (!first && !b.payload.observations.length && !b.payload.education.length) { setState('SAVED', '沒有新的修改'); return; }
  /* 同樣內容用同一個儲存代碼：重按或網路重送都不會重複 */
  SAVE.key = 'pt-' + hash(TOKEN.slice(0, 12) + (API.state().session || {}).started) + '-' + hash(body);
  b.payload.idempotency_key = SAVE.key;
  SAVE.sent = b.payload;
  setState('SAVING');
  run('patientSubmit', [TOKEN, b.payload, REL], function () {
    setState('RECEIVED', b.skipped.length ? '有 ' + b.skipped.length + ' 項填寫內容無法使用，沒有送出；重要的事請直接告訴醫療團隊' : '');
    SAVE.polls = 0; poll();
  }, function (e) { setState('FAILED', (e.message || '連線問題') + ' 請再按一次儲存；畫面上的內容還在。'); });
}
function poll() {
  clearTimeout(SAVE.timer);
  SAVE.timer = setTimeout(function () {
    SAVE.polls++;
    run('patientSubmitStatus', [TOKEN, SAVE.key], function (d) {
      if (d.status === 'COMMITTED') {
        SAVE.committed_once = true; if (d.snapshot_version) SAVE.base = d.snapshot_version;
        SAVE.sent.observations.forEach(function (o) { if (o.value !== undefined) SAVE.sent_obs[o.field_id] = o.value; });
        (SAVE.sent.education || []).forEach(function (x) { EDU_SENT[x.card_id] = [x.kind, x.understanding, x.method].join('|') + ((x.trigger_codes || []).indexOf('PATIENT_VERIFY_ONLY') >= 0 ? '|VO' : ''); });
        SAVE.done_at = new Date().toISOString(); LK.dirty = false;
        setState('SAVED', d.dropped ? '有 ' + d.dropped + ' 項醫療團隊已經更新過，這次沒有套用；其他都已儲存' : '緊急時請直接撥 119；下次開啟這個連結時，可以少填一些');
        refreshPlanAfterSave();
      } else if (d.status === 'CONFLICT_REVIEW_REQUIRED') { SAVE.committed_once = true; setState('CONFLICT', '您的回答已保留，醫療團隊確認後會納入紀錄'); }
      else if (d.status === 'QUARANTINED') { LK.dirty = false; setState('CONFLICT', '已收到；醫療團隊會先向您確認是本人送出，確認後才納入紀錄' + (d.safety_saved ? '（您勾的警訊已經另外記下）' : '') + '。緊急時請直接撥 119'); }
      else if (d.status === 'REJECTED') setState('FAILED', (d.safety_saved ? '您勾的警訊已經另外記下，但' : '') + '其他資料沒有存進去；請直接打電話告訴醫療團隊' + (contactRoute().team_phone ? '（' + contactRoute().team_phone + '）' : ''));
      else if (SAVE.polls < 30) poll();
      else setState('RECEIVED', '處理時間比平常久；您不用重按。下次開啟這個連結時，最上面會顯示處理結果');
    }, function () { if (SAVE.polls < 30) poll(); else setState('RECEIVED', '暫時查不到處理結果；資料已送出，不用重按。下次開啟這個連結時會顯示處理結果'); });
  }, SAVE.polls < 3 ? 4000 : 10000);
}
/* 儲存完成後：重新讀取醫療團隊系統依「剛剛儲存的內容」整理的重點（與醫療人員畫面同一份計畫）。
   儲存前不把答案送到伺服器（隱私承諾不變）；儲存後這份才是正式版本。 */
function refreshPlanAfterSave() {
  run('patientLoad', [TOKEN, REL], function (d) {
    LOADED.plan = d.plan; LOADED.last_submission = d.last_submission; LOADED.plan_error = d.plan_error; LOADED.safety_recent = d.safety_recent;
    Object.keys(d.education_self || {}).forEach(function (k) { EDU_SENT[k] = d.education_self[k]; });
    var box = document.getElementById('lk_plan_after'); if (!box) return;
    box.innerHTML = diffHtml(d.plan) + planHtml(true);
  }, function () { /* 讀不到不影響已儲存的結果 */ });
}
/* 3.0.0 預覽 vs 正式整理（MS-P0-18）：伺服器的整理才是正式版；和剛才預覽不同的地方明白寫出來，不悄悄換掉 */
function diffHtml(pv) {
  if (!pv || !pv.today_actions) return '';
  var prev = {}; try { ((API.analyze() || {}).cards || []).forEach(function (c) { prev[c.id] = 1; }); } catch (e) { prev = {}; }
  var srv = pv.today_actions.map(function (a) { return a.card_id; });
  var added = srv.filter(function (id) { return !prev[id] && cardById(id); }).map(function (id) { return cardById(id).title; });
  if (!added.length) return '<p class="small muted" id="lk_diff">正式整理和剛才的預覽一致（「這次先做」都在上面出現過）。</p>';
  return '<div class="notice" id="lk_diff"><p><strong>正式整理和剛才的預覽不一樣的地方：</strong>醫療團隊的系統依您全部的紀錄（不只這次的回答），另外把這些列為這次先做：' + esc(added.join('、')) + '。請以正式整理為準。</p></div>';
}
function resultPanel(r) {
  setTimeout(syncJump, 0);
  return notNotifyHtml(r && r.route) + (LK.pre_done ? '' : weightHtml()) + teamHtml() + selfHarmHtml() + savePanel(r) + '<div id="lk_plan_after" aria-live="polite"></div>' + dockHtml();
}
/* 3.4（T09）：儲存按鈕固定在畫面下方（不必捲到最底）；附上原有的「本工具不是即時監控系統。」一句（文字不變）；
   有 safe-area 留白；手機鍵盤彈出時依 visualViewport 往上移，仍看得到；頁面底部另留同高空間，不會永遠遮住最後的內容 */
function dockHtml() {
  return '<div class="lk-dock no-print" id="lk_dock"><span class="small"><strong>本工具不是即時監控系統。</strong></span>' +
    '<button class="btn primary" type="button" id="lk_dock_btn" data-act="lk_save"' + (SAVE.state === 'SAVING' || SAVE.state === 'RECEIVED' ? ' disabled' : '') + '>' + (SAVE.committed_once ? '再儲存一次（只送修改的部分）' : '儲存給醫療團隊') + '</button></div>';
}
function placeDock() {
  var d = document.getElementById('lk_dock'), vv = window.visualViewport; if (!d) return;
  var kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0; d.style.bottom = kb + 'px'; syncJump();
}
if (window.visualViewport) { window.visualViewport.addEventListener('resize', placeDock); window.visualViewport.addEventListener('scroll', placeDock); }
/* 需要立刻求救的畫面：先求救；存資料只是補充，放在最後 */
function stopPanel(r) {
  return notNotifyHtml(r && r.route) + selfHarmHtml() + '<section class="panel no-print lk-save"><h2>之後方便時，也可以把這次的狀況存給醫療團隊</h2>' +
    '<p class="small">這不能代替打 119 或去急診。</p>' + nonRealtimeHtml() + saveButtons() + statusHtml() + '</section>';
}
function saveButtons() {
  return '<div class="row"><button class="btn primary" type="button" id="lk_save_btn" data-act="lk_save"' + (SAVE.state === 'SAVING' || SAVE.state === 'RECEIVED' ? ' disabled' : '') + '>' + (SAVE.committed_once ? '再儲存一次（只送修改的部分）' : '儲存給醫療團隊') + '</button>' +
    '<button class="btn secondary" type="button" id="lk_retry_btn" data-act="lk_retry"' + (SAVE.state === 'FAILED' ? '' : ' hidden') + '>再試一次</button></div>';
}
/* 本工具不是即時監控（HL-P0-02 / ALERT-NONREALTIME-DISCLOSURE-01）：儲存頁一律說清楚；院方核准的服務資訊四項齊全才顯示，否則 fail-closed */
function nonRealtimeHtml() {
  var si = contactRoute().service_info;
  var h = '<div class="lk-notice small" role="note"><p><strong>本工具不是即時監控系統。</strong>如果現在有喘到講不完一句話、昏倒、持續胸痛，或本頁列出的其他緊急警訊，請依緊急指示直接撥 119 或立即就醫，不要等待醫療團隊看到這份資料。</p>';
  if (si) h += '<dl class="kv"><dt>資料會送到</dt><dd>' + esc(si.owner_role) + '</dd><dt>一般處理時間</dt><dd>' + esc(si.response_time) + '</dd><dt>服務時間</dt><dd>' + esc(si.hours) + '</dd><dt>非服務時間</dt><dd>' + esc(si.after_hours) + '</dd></dl>';
  else h += '<p>本頁無法告訴您醫療人員何時會看到這份資料。需要協助時，請直接使用原照護團隊提供的聯絡方式；緊急狀況依本頁緊急指示處理。</p>';
  return h + '</div>';
}
function savePanel() {
  return '<section class="panel no-print lk-save" id="lk_save_panel"><h2>把這次的回答存給醫療團隊</h2>' +
    '<p class="small">存了以後，醫療團隊之後可以看到這次的變化；下次開啟這個連結時，不會改變的資料不用重填。沒有按儲存就不會送出。</p>' +
    nonRealtimeHtml() + saveButtons() + statusHtml() + '</section>';
}

/* 3.0.0：上一次送出的處理結果（重新開啟連結時看得到；不再只靠當次等待） */
var LS_TEXT = { RECEIVED: '已送出，排隊等系統處理', PROCESSING: '系統處理中', COMMITTED: '已存入醫療團隊的紀錄', CONFLICT_REVIEW_REQUIRED: '已送出，等醫療團隊確認後納入', REJECTED: '這次送出的資料沒有存進去；重要的事請直接打電話告訴醫療團隊', QUARANTINED: '已收到，醫療團隊確認是本人送出後才納入', DISCARDED: '醫療團隊沒有採用這次送出的資料' };
function lastSubmissionHtml() {
  var x = LOADED && LOADED.last_submission; if (!x) return '';
  var bad = x.status === 'REJECTED', wait = x.status === 'RECEIVED' || x.status === 'PROCESSING';
  return '<p class="' + (bad ? 'notice err' : (wait ? 'notice' : 'small')) + '" id="lk_last_sub">上次送出（' + esc(md(fmtDate(x.received_at))) + ' ' + esc(hm(x.received_at)) + '）：' + esc(LS_TEXT[x.status] || x.status) +
    (wait && x.pending_minutes >= 15 ? '；已等 ' + esc(x.pending_minutes) + ' 分鐘，可能是醫療團隊的系統暫停，重要的事請直接打電話' : '') + (bad ? (x.safety_saved ? '；您勾的警訊已經另外記下' : '') + '。請直接打電話告訴醫療團隊' : '') + (x.dropped ? '；其中 ' + esc(x.dropped) + ' 項醫療團隊已經更新過，沒有套用' : '') + '。</p>';
}
/* v4.0 V09（C12-REG-013）：病人端藥名中文優先（有已登錄中文名時「中文（英文學名）」），沒有中文名就顯示英文學名；畫面元素保留標準成分代碼（data-ing） */
function ptIngName(i, id) { return i ? (i.zh ? i.zh + '（' + i.name + '）' : i.name) : id; }
/* 還沒送出就要離開：提醒（答案只在這個頁面的記憶體裡） */
document.addEventListener('click', function (ev) {
  var t = ev.target && ev.target.closest ? ev.target.closest('#screen [data-act]') : null; if (!t) return;
  var a = t.getAttribute('data-act') || '';
  if (a === 'lk_read') { try { var box = t.closest('.lk-plan'), u = new window.SpeechSynthesisUtterance((box ? box.innerText : '').replace(/唸給我聽/g, '')); u.lang = 'zh-TW'; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch (e) { /* 朗讀失敗不影響其他功能 */ } return; }
  if (/^(lk_save|lk_retry|open_print|copy|goto|restart_confirm|ask_start)$/.test(a)) return;
  LK.dirty = true;
  /* 儲存之後又改了答案：狀態回到「還沒送出」（按鈕變成「再儲存一次，只送修改的部分」） */
  if (SAVE.state === 'SAVED' || SAVE.state === 'CONFLICT') { SAVE.state = 'IDLE'; SAVE.message = ''; }
}, true);
window.addEventListener('beforeunload', function (ev) { if (LK.dirty && SAVE.state !== 'SAVED' && SAVE.state !== 'RECEIVED' && SAVE.state !== 'SAVING' && TOKEN) { ev.preventDefault(); ev.returnValue = ''; } });
window.HFPC_LINK = {
  ready: function (done) {
    readToken(function (t) {
      TOKEN = t;
      if (!t) { FATAL = '這個網址缺少個人連結代碼。請使用醫療團隊給您的完整連結，或請他們重新提供。'; done(); return; }
      run('patientLoad', [t, REL], function (d) {
        /* 3.1.0（HFPC-AUD-0802）：頁面是舊版（含警訊判斷規則已更新）→ 不讓舊頁面用舊規則判斷警訊；只給求救指引與重新載入 */
        if (d && d.release && d.release.page_outdated) { STALE = true; FATAL = '系統剛更新，這個頁面是舊版本。為了讓警訊判斷使用最新的規則，請按「重新載入」後再填寫。'; done(); return; }
        LOADED = d; SAVE.base = d.snapshot_version || 0; Object.keys(d.education_self || {}).forEach(function (k) { EDU_SENT[k] = d.education_self[k]; }); done(); },
        function (e) { FATAL = e.message || '目前無法載入您的紀錄。'; done(); });
    });
  },
  attach: function (api) {
    API = api;
    /* v4.3 X05：藥師在別名字典登錄的寫法，只加進找藥的搜尋候選（不自動選取、不猜；病人選了仍是「病人自選、未核對」） */
    (DICT.pharm_aliases || []).forEach(function (a) { (C.ingredients || []).forEach(function (i) { if (i.id === a[1]) { i.aliases = i.aliases || []; if (i.aliases.indexOf(a[0]) < 0) i.aliases.push(a[0]); } }); });
    api.SCREENS.LINK_FOLLOWUP = followupScreen;
    api.SCREENS.LINK_FATAL = function () {
      if (STALE) return '<section class="panel" id="lk_stale"><h1>這個頁面需要更新</h1><p>' + esc(FATAL) + '</p>' +
        '<div class="row"><button class="btn primary" type="button" data-act="lk_reload">重新載入</button></div>' +
        '<p class="notice err"><strong>現在很不舒服</strong>（例如胸痛、很喘、快昏倒、意識改變）：不要等這個頁面，直接撥 119 或到急診。</p></section>';
      return '<section class="panel"><h1>無法開啟個人連結</h1><p>' + esc(FATAL) + '</p><p>有緊急狀況請直接撥打 119。</p>' +
        '<p class="small muted">您仍然可以使用不需要連結的公開版（不會儲存任何資料），網址請向醫療團隊索取。</p></section>';
    };
    document.getElementById('screen').addEventListener('click', onClick, true);
  },
  initialState: initialState,
  /* 「我記得，直接確認」只給：今天清單上、之前已由醫療人員確認理解（reinforce）、不是再教、內容沒有改版的卡 */
  verifyOnly: function (cid) {
    var ta = (LOADED && LOADED.plan && LOADED.plan.today_actions) || [];
    return ta.some(function (a) { return a.card_id === cid && a.reinforce && !a.reteach && a.reassess !== 'CONTENT_CHANGED'; });
  },
  intercept: function (screen) {
    if (FATAL) return 'LINK_FATAL';
    if (screen === 'CHANGE' && !LK.pre_done && LOADED && H().comparison_reference === 'PREVIOUS_ASSESSMENT') return 'LINK_FOLLOWUP';
    return null;
  },
  homeNoteHtml: function () {
    var h = H();
    return (LOADED && LOADED.trial ? '<p class="notice warn"><strong>試用環境（模擬資料）：這是院內人員測試用的頁面，請勿輸入真實的個人或病情資料。</strong></p>' : '') + lastSubmissionHtml() + '<p class="small muted">這是醫療團隊給您的個人連結。' + (h.last_assessment_at ? '上次填寫：' + esc(md(fmtDate(h.last_assessment_at))) + '；沒有改變的資料不用重填。' : '') + '回答完可以選擇儲存給醫療團隊。</p>' + planHtml();
  },
  resultTopHtml: resultTopHtml,
  doneText: function (cg) { return '上面是依' + (cg ? '您幫病人' : '您') + '剛才的回答整理的預覽，還沒有送給醫療團隊。要讓醫療團隊看到，請往下按「儲存給醫療團隊」；有緊急狀況請直接撥 119。'; },
  privacyHtml: function () {
    return '<p>這是醫療團隊為您建立的個人連結，不需要姓名或病歷號。請不要轉傳給別人；連結可能在一段時間後失效，需要時請醫療團隊重新提供。</p>' +
      '<p>您在結果頁按「儲存給醫療團隊」，這次的回答才會送到醫療團隊的紀錄；沒有按就不會送出。您填的內容會標示為「病人自述」或「家人代述」，不會被當成檢查結果。</p>' +
      '<p>畫面上標示「醫療團隊紀錄」的內容，是醫療團隊寫的，不是您填的。</p>';
  },
  comparisonText: function () { return H().comparison_reference === 'PREVIOUS_ASSESSMENT' ? '和平常相比；另外問了和上次（' + fmtDate(H().last_assessment_at) + '）相比' : '和平常相比（這是第一次填寫）'; },
  runtimeText: function () { return '個人連結；按「儲存給醫療團隊」後才會送出，送出前只暫時留在這個頁面上。'; },
  resultPanel: resultPanel,
  stopPanel: stopPanel,
  _debug: { LK: LK, SAVE: SAVE, diffHtml: diffHtml, resultTopHtml: resultTopHtml, EDU_SENT: EDU_SENT, refreshPlanAfterSave: refreshPlanAfterSave, buildPayload: buildPayload, educationPayload: educationPayload, planHtml: planHtml, weightCheck: weightCheck, md: md }
};
})();

