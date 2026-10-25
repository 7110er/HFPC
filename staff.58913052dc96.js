/* =====================================================================
 * 院內縱向照護｜醫療人員畫面
 * 原則：伺服器決定身分、範圍、時間與之前的值；畫面只送「這次改了什麼」（minimal delta）。
 * 儲存三態：正在儲存／已儲存／尚未儲存。失敗或版本衝突時，暫存的變更留在畫面上，不會顯示已儲存。
 * ===================================================================== */
(function () {
'use strict';
var ME = null, DICT = null, CUR = null, TAB = 'patients';
var ST = { obs: {}, ce: [], ac: [], co: [], ed: [], resolves: [], v4: [] };   /* 這次暫存的變更（ed：衛教與理解確認） */
var SESSION = Math.random().toString(36).slice(2, 10);
var SESSION_CTX = { setting: '', facility: '' };   /* 3.0.0：場域、院所這次登入選一次（不預設為門診）；換病人仍沿用、畫面上看得到（REG-A-001 允許保留的只有這兩項） */
/* 3.3（ZT-A-001，P0）：這次接觸的狀態（是否記為評估、接觸方式、是否建立警訊、不建立的理由、衛教方式）只屬於「這位病人的這一次」：
   換病人、儲存成功、全部放棄時一律重設，不會帶到下一位病人 */
var ENC = newEnc(null);
function newEnc(pk) { return { pk: pk, assessment: null, contact: '', raise: false, suppress: '', edu_channel: '', opened_ms: Date.now(), clicks: 0, rv: {} }; }   /* 5.0 W5-C（K07-06）：clicks＝這次接觸在病人頁的點選次數（負擔量測）；rv＝久未聯絡重新檢視「仍適用」的本次確認 */   /* v4.4 WP-A：opened_ms＝開啟病人或上次儲存的時間（量測填寫負擔用） */
function enc() { var pk = CUR ? CUR.pk : null; if (ENC.pk !== pk) ENC = newEnc(pk); return ENC; }
function resetEnc() { var pk = CUR ? CUR.pk : null; ENC = newEnc(pk); if (pk) delete EDU_RESP[pk]; }
var ISSUED = null;                                       /* 剛簽發的病人連結（只顯示這一次） */
var STAFF_TOKEN = null;                                  /* 試用模式：網址 #s= 的專屬連結代碼（只在記憶體） */
var MODE = null;                                         /* appMode：登入方式、是否試用 */

var PROF_ZH = { PHYSICIAN: '醫師', NURSE: '護理師', PHARMACIST: '藥師', DIETITIAN: '營養師', PHYSIOTHERAPIST: '物理治療師', OCCUPATIONAL_THERAPIST: '職能治療師', SOCIAL_WORKER: '社工師', CLINICAL_PSYCHOLOGIST: '臨床心理師', SPEECH_THERAPIST: '語言治療師' };
var ROLE_ZH = { PHYSICIAN_IN_TRAINING: '受訓醫師', CASE_MANAGER: '個案管理師', CARDIOLOGIST: '心臟科醫師', CARDIAC_SURGEON: '心臟外科醫師', NURSE: '護理師', PHARMACIST: '藥師', PHYSIOTHERAPIST: '物理治療師', OCCUPATIONAL_THERAPIST: '職能治療師', DIETITIAN: '營養師', SOCIAL_WORKER: '社工師', CLINICAL_PSYCHOLOGIST: '臨床心理師', PALLIATIVE_TEAM: '安寧團隊', GENERAL_PHYSICIAN: '基層／居家醫療醫師', HOME_CARE_NURSE: '居家護理師', SPEECH_THERAPIST: '語言治療師', ADMIN: '系統管理者', PATIENT: '病人', CAREGIVER: '照顧者' };
var FAC_ZH = { OTHER_UNSPECIFIED: '其他院所' };   /* 院所名稱由伺服器（CONFIG FACILITIES_JSON）提供；核心不寫死任何醫院 */
var SET_ZH = { OUTPATIENT: '門診', INPATIENT: '住院', LTC_COMMUNITY_HOME: '長照／社區／居家' };
var CM_ZH = { FACE_TO_FACE: '面對面', PHONE: '電話', VIDEO: '視訊', PATIENT_LINK: '病人連結' };
var VER_ZH = { VERIFIED: '已確認', OBSERVED: '醫療人員觀察', REPORTED_UNVERIFIED: '自述（未確認）', DERIVED: '系統推導' };
var FRESH_ZH = { FRESH: ['有效', 'ok'], STALE: ['已過期', 'warn'], NO_CLINICAL_DATE: ['沒有檢查日期', 'warn'], REASK_EACH_TIME: ['每次重問', ''], NOT_TIME_LIMITED: ['', ''], NO_VALUE: ['', ''] };
var CE_ZH = { HF_ED_REPORTED: '心衰竭急診（自述）', HF_ED_VERIFIED: '心衰竭急診（已確認）', HF_ADMISSION_REPORTED: '心衰竭住院（自述）', HF_ADMISSION_VERIFIED: '心衰竭入院（已確認）', HF_DISCHARGE_REPORTED: '心衰竭出院（自述）', HF_DISCHARGE_VERIFIED: '心衰竭出院（已確認）', OTHER_ED_REPORTED: '其他原因急診（自述）', OTHER_ADMISSION_REPORTED: '其他原因住院（自述）', PROFESSIONAL_FOLLOWUP_COMPLETED: '已完成專業追蹤', FMT_REVIEW_COMPLETED: '已完成指引藥物檢視', FMT_NONUSE_REASON_DOCUMENTED: '已記錄指引藥物不用的理由', DEATH_REPORTED: '死亡（他人轉述，待核實）', DEATH_VERIFIED: '死亡（已核實）', DEATH_RECORD_RETRACTED: '死亡紀錄撤回（誤註記）' };
/* 5.0 W5-M（K10-10）：死亡來源與撤回理由 */
var DEATH_SRC_ZH = { DEATH_CERTIFICATE: '死亡證明', HOSPITAL_RECORD: '本院或他院病歷', CLINICIAN_PRONOUNCED: '醫師宣告', HOUSEHOLD_REGISTRY: '戶政資料', OTHER_FACILITY_RECORD: '他院正式通知', FAMILY_REPORT: '家屬轉述', CAREGIVER_REPORT: '照顧者轉述', OTHER_FACILITY_CALL: '他院電話告知', COMMUNITY_REPORT: '社區或長照轉述', UNSPECIFIED: '來源未說明' };
var RETRACT_ZH = { ENTERED_IN_ERROR: '誤註記', WRONG_PATIENT: '記錯病人', PATIENT_ALIVE_CONFIRMED: '已確認病人仍在世' };
var ACT_ZH = { SELF_CARE: '自我照顧', MEDICATION_REVIEW: '用藥檢視', REFERRAL_PHARMACIST: '轉介藥師', REFERRAL_DIETITIAN: '轉介營養師', REFERRAL_REHAB: '轉介復健', REFERRAL_SOCIAL: '轉介社工', REFERRAL_PALLIATIVE: '轉介安寧／緩和', REFERRAL_MENTAL: '轉介心理', REFERRAL_OT: '轉介職能治療', REFERRAL_CARDIOLOGY: '轉介心臟科', FOLLOWUP_VISIT: '回診', LAB_CHECK: '抽血／檢查', EDUCATION: '衛教' };
var AST_ZH = { PLANNED: '計畫中', ACCEPTED: '已接受', IN_PROGRESS: '進行中', COMPLETED: '已完成', NOT_DONE: '未執行', CANCELED: '已取消', BARRIER_REPORTED: '遇到障礙', UNKNOWN: '不確定' };
var CST_ZH = { OPEN: '開啟', RESOLVED: '已解決', IMPROVED: '改善', SAME: '差不多', WORSE: '變差', UNSURE: '不確定' };
var JOIN_ZH = { NEW_CONSULT: '新會診', TRANSFER_OF_CARE: '照護轉移', COVERING: '代班', CASE_MANAGEMENT: '個案管理' };
var IDX_ZH = { INDEX_ELIGIBLE: ['可作為指標起點', 'ok'], NOT_INDEX_REPORTED: ['自述，未確認', 'warn'], OPEN_ADMISSION: ['尚未出院', ''], NOT_INDEX_TRANSFER: ['轉出，不作起點', ''], NOT_INDEX_DIED: ['死亡，不作起點', ''], NOT_INDEX_OTHER: ['非心衰竭', ''], MANUAL_REVIEW: ['待人工確認', 'err'] };
var TR_ZH = { MET: ['已達成', 'ok'], NOT_MET: ['未達成', 'err'], NOT_ASSESSABLE_WINDOW_OPEN: ['觀察期未滿', ''], READMISSION_OBSERVED: ['有再住院', 'err'], NO_READMISSION_OBSERVED_IN_SYSTEM: ['本系統未見再住院', 'ok'] };
var CONF_ZH = { VALUE_CONFLICT: '同一天不同數值', SOURCE_CONFLICT: '來源之間不一致', TEMPORAL_CONFLICT: '後補的資料描述更早的時間' };
var DISC_ZH = { PRESCRIBED_REGIMEN_DIFFERS: '處方與病人說的用法不同（劑量、強度、頻次或途徑）', PRESCRIBED_HELD_REPORTED_TAKING: '醫療團隊暫停中，病人說還在吃', PRESCRIBED_REPORTED_STOPPED: '有處方，病人說已停用', PRESCRIBED_USE_UNSURE: '有處方，病人不確定有沒有吃', PRESCRIBED_NOT_REPORTED: '有處方，病人清單沒有（清單自述完整）', PRESCRIBED_NOT_REPORTED_LIST_INCOMPLETE: '有處方，病人清單沒有（清單可能不完整）', REPORTED_NOT_PRESCRIBED: '病人在吃，但目前處方沒有' };
var GROUP_ZH = { QUICK: '本次快速更新', COMMUNICATION: '溝通與學習需要（病人說出或觀察到的）', TODAY: '今天的情況', EXPERIENCE: '病人經驗與目標', SCREENING: '全人照護篩檢（醫療人員判定）', HOME: '居家量測與體重計畫', MEDS: '用藥', OBJECTIVE: '檢查與量測', DIAGNOSIS: '診斷', PATIENT_CLINICAL: '病人記得的臨床資料', CARE: '就醫（自述）', ALLIED: '職類評估結論（寫入照護計畫；只限該職類）' };
var GROUP_ORDER = ['TODAY', 'EXPERIENCE', 'COMMUNICATION', 'SCREENING', 'HOME', 'MEDS', 'OBJECTIVE', 'DIAGNOSIS', 'PATIENT_CLINICAL', 'CARE', 'ALLIED'];
var WL_ZH = { HANDOFF_OUT_OF_SYSTEM: ['系統外通知的交接（系統內沒有人接得到，請自行追蹤）', 'warn'], ACTION_ASSIGNED_TO_MY_ROLE: ['別的職類替我排的工作', ''], HANDOFF_IN_PROGRESS_MINE: ['我接手、進行中的交接', ''], SAFETY_ALERT: ['安全警訊', 'err'], SAFETY_FOLLOWUP: ['警訊已回應，待確認後續', 'warn'], T01_WINDOW_OPEN: ['出院 7 天內尚未完成追蹤', 'warn'], ACTION_OVERDUE: ['行動逾期', 'err'], ACTION_BARRIER: ['行動遇到障礙', 'warn'],
  ACTION_PATIENT_COMPLETED: ['病人自述完成，待確認', ''], CONCERN_WORSE: ['病人說更困擾', 'warn'], NEED_HELP: ['病人說有困難、需要幫忙', 'warn'], PARKED_INPUT: ['資料已被更新而暫時保留的輸入', 'warn'],
  EPISODE_MANUAL_REVIEW: ['住院事件待人工確認', 'err'], INBOX_REJECTED: ['病人送出的資料被系統拒絕', 'warn'], INBOX_QUARANTINED: ['可能外流連結送來的資料（隔離中）', 'err'], DATA_CONFLICT: ['資料衝突', ''], HANDOFF_TO_MY_ROLE: ['交接給我這個職類', 'warn'],
  ALERT_DELIVERY_FAILED: ['⚠ 未送達：警訊通知信沒有送出（寄出不等於有人看到）', 'err'],
  /* 3.0.0：交接閉環與用藥閉環 */
  HANDOFF_UNACCEPTED_LATE: ['交接超過接手期限，還沒有人接手', 'err'], HANDOFF_RETURNED: ['我送出的交接被退回', 'warn'], HANDOFF_REPLIED: ['我送出的交接已完成並回覆', 'ok'],
  MONITOR_DUE: ['用藥改變後的檢驗追蹤', 'warn'], RESULT_TO_REVIEW: ['檢驗結果已出來，待判讀', 'warn'], MED_DISCREPANCY: ['處方與實際使用不一致，待處理', 'warn'], HOLD_REVIEW_DUE: ['暫停中的藥到了重新評估日', 'err'],
  REBASELINE: ['再住院：舊的待辦要決定延續或取代', 'warn'],
  /* 4.9.3 WP-B1：血鉀／腎功能、運動暫停、診斷待確認、病人行動逾期 */
  K_RENAL_THRESHOLD: ['已確認血鉀或肌酸酐超過門檻（今天處理）', 'err'], K_RISING: ['已確認血鉀連續上升', 'warn'], MONITOR_STALE: ['血鉀／腎功能過期（長期用藥）', 'warn'],
  EXERCISE_PAUSE: ['運動訓練暫停：有不穩定訊號', 'err'], DX_UNCONFIRMED: ['心衰竭診斷尚未確認（指標不納入）', ''], PATIENT_ACTION_OVERDUE: ['病人自己的行動逾期（需追蹤）', 'warn'] };
var DLV_ZH = { DELIVERED: '通知信已寄出（不代表有人看過）', FAILED_RETRYABLE: '通知信暫時失敗，系統會再試', FAILED_FINAL: '通知信送不出去（需人工聯絡）', NOT_ATTEMPTED: '尚未嘗試通知', QUEUED: '排隊中', SENDING: '送出中' };
/* F25：病人最在意的事（置頂顯示） */
/* 3.1.0（HFPC-AUD-0605）：信賴決定不是目前有效時，一律標出 */
var DEC_ZH = { EXPIRED: '已過期，需重新決定', FRAMEWORK_CHANGED_REVIEW_REQUIRED: 'EPA 架構已改版，需重新決定' };
function wmText(w) {
  if (!w) return '';
  var L = DICT.what_matters_labels || { improve: {}, worry: {} }, parts = [];
  if (w.improve) parts.push('最想改善：' + (L.improve[w.improve] || w.improve));
  if (w.worry) parts.push('最擔心：' + (L.worry[w.worry] || w.worry));
  /* 3.1.0（HFPC-AUD-0028）：照顧者代為推測的，要跟病人本人確認 */
  var SR = { CAREGIVER_PROXY: '照顧者推測，請向病人確認', SHARED: '病人與照顧者一起討論' };
  return parts.join('；') + (SR[w.source_role] ? '（' + SR[w.source_role] + '）' : '');
}
function wmPanel(v) {
  var w = v.what_matters;
  return '<section class="panel wm-pin" aria-labelledby="wm_h"><h2 id="wm_h">病人最在意的事</h2>' + (w ? '<p><strong>' + esc(wmText(w)) + '</strong></p><p class="small muted">' + esc(srcZh(w.source_type)) + '｜' + esc(d10(w.recorded_at)) + '｜討論治療與行動時，請先回應這一項。</p>' :
    '<p class="small muted">還沒有記錄。可以在下方「評估」的病人經驗欄位記下病人最想改善與最擔心的事，或請病人用病人連結填寫。</p>') + '</section>';
}
/* 3.2（R-A-021）：交接「關於哪一筆」——差異的藥、改藥後的檢驗追蹤、或某一個欄位 */
function aboutText(ref) {
  if (!ref) return '';
  var m = /^(DISC|MON|FIELD):(.+)$/.exec(ref); if (!m) return '';
  if (m[1] === 'DISC') return '關於：' + ingName(m[2]) + ' 的處方與實際使用差異';
  if (m[1] === 'MON') return '關於：用藥改變後的血鉀／腎功能追蹤';
  var f = (DICT.fields || {})[m[2]]; return '關於：' + (f ? (f.label || f.label_clinician || m[2]) : m[2]);
}
function hoText(h) {
  if (!h) return '';
  return '交接：' + codeZh(DICT.handoff_reasons, h.reason) + (h.urgency ? '｜' + codeZh(DICT.handoff_urgency, h.urgency) : '') + (h.needs && h.needs.length ? '｜' + h.needs.map(function (n) { return codeZh(DICT.handoff_needs, n); }).join('、') : '');
}
var FAC_PHONE = {};
var FAC_SVC = {};   /* 5.1 W51-LEAF（NU-06）：院方核准的服務資訊（四項齊全才有；與病人連結同一個來源） */
var CLIN_SRC = ['CLINICIAN_VERIFIED', 'CLINICIAN_OBSERVED', 'PRESCRIPTION_RECORD', 'PATIENT_REPORTED', 'CAREGIVER_REPORTED'];

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
/* 3.0.0：畫面上的日期與時間一律是台灣時間（伺服器存 UTC；只有稽核明細才看 UTC）。只有日期（YYYY-MM-DD）的值照原樣 */
function d10(s) { if (!s) return ''; s = String(s); if (s.length <= 10 || isNaN(Date.parse(s))) return s.slice(0, 10); return new Date(Date.parse(s) + 8 * 3600000).toISOString().slice(0, 10); }
function hm(s) { var t = Date.parse(s); return isNaN(t) ? '' : new Date(t + 8 * 3600000).toISOString().slice(11, 16); }
function todayTW() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function chip(t, cls) { return t ? '<span class="chip ' + (cls || '') + '">' + esc(t) + '</span>' : ''; }
function opt(v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; }
function call(fn, args) {
  return new Promise(function (res, rej) {
    if (!(window.google && google.script && google.script.run)) { rej({ code: 'NO_BACKEND', message: '無法連線到系統。' }); return; }
    var r = google.script.run.withSuccessHandler(function (x) { if (x && x.ok) res(x.data); else rej(x || { code: 'UNKNOWN', message: '系統沒有回應。' }); })
      .withFailureHandler(function (er) { rej({ code: 'NETWORK', message: (er && er.hfpc_message) || '網路中斷或逾時；這次的資料可能沒有儲存，請再按一次（重按不會重複）。' }); });   /* 5.0 W5-W：網頁直連時由傳輸轉接層提供訊息（暫時無法連線、可改用 Google 工作區） */
    if (STAFF_TOKEN && fn !== 'appMode' && fn !== 'trialClaimAdmin') r.staffCall(STAFF_TOKEN, fn, args || []);
    else r[fn].apply(r, args || []);
  });
}
/* 試用模式：從網址片段讀專屬連結代碼（片段不會送到伺服器存取紀錄） */
function readStaffToken(cb) {
  function parse(h) { var m = /(?:^|[#&?])s=([0-9a-f]{48})(?:&|$)/.exec(h || ''); return m ? m[1] : null; }
  try { if (window.google && google.script && google.script.url) { google.script.url.getLocation(function (loc) { cb(parse(loc.hash)); }); return; } } catch (e) { /* 改讀本頁網址 */ }
  cb(parse(window.location.hash));
}
var SYNC_TXT = { IDLE: '', LOADING: '讀取中…', SAVING: '正在儲存…', SAVED: '已儲存', FAILED: '尚未儲存', CONFLICT: '尚未套用' };
function sync(state, msg) { var el = $('sync'); el.setAttribute('data-state', state); el.textContent = SYNC_TXT[state] + (msg ? '：' + msg : ''); }
function errText(e) {
  var m = (e && e.message) || '發生錯誤。';
  if (e && e.detail && e.detail.errors) m += '（' + e.detail.errors.slice(0, 5).join('；') + (e.detail.errors.length > 5 ? '…' : '') + '）';
  return m;
}
function field(fid) { return DICT.fields[fid] || { label: fid, data_type: 'TEXT' }; }
function ingName(id) { var x = DICT.ingredients.filter(function (i) { return i.id === id; })[0]; return x ? x.name + (x.zh ? '（' + x.zh + '）' : '') : id; }
function fmtVal(fid, v) {
  if (v === null || v === undefined || v === '') return '—';
  var f = field(fid), L = f.enum_labels || {};
  if (f.data_type === 'ENUM') return L[v] || v;
  if (f.data_type === 'LIST_ENUM') return v.length ? v.map(function (x) { return L[x] || x; }).join('、') : '（無）';
  if (f.data_type === 'NUMBER') return v + (f.unit ? ' ' + f.unit : '');
  if (f.data_type === 'DATETIME') return md(String(v).slice(0, 10)) + ' ' + String(v).slice(11, 16);   /* 5.2 A-04：台灣時間 */
  if (fid === 'fmt_class_status') return v.length ? v.map(function (o) { return ((DICT.fmt_classes || {})[o['class']] || o['class']) + '：' + codeZh(DICT.fmt_status_options, o.status) + (o.dose_status ? '｜' + codeZh(DICT.fmt_dose_status_options, o.dose_status) : '') + (o.reason_code ? '（' + codeZh(DICT.fmt_reason_codes, o.reason_code) + '）' : ''); }).join('；') : '—';
  if (f.data_type === 'LIST_OBJECT') return v.length ? v.map(function (m) { return ingName(m.ingredient) + (m.status ? '：' + ({ CURRENT: '在吃', STOPPED: '已停', UNSURE: '不確定' }[m.status] || m.status) : '') + (m.rx_status === 'HELD' ? '（暫停中，' + md(m.reassess_on) + ' 重新評估）' : ''); }).join('、') : '（無）';
  return String(v);
}
function srcZh(s) { return (DICT.source_types || {})[s] || s || ''; }
function codeZh(list, c) { var x = (list || []).filter(function (o) { return o[0] === c; })[0]; return x ? x[1] : c; }
function tpl(ref) { return String(ref || '').indexOf('TPL:') === 0 ? (DICT.action_templates || []).filter(function (t) { return t.id === String(ref).slice(4); })[0] || null : null; }
function actName(a) { var t = tpl(a.action_ref), r = String(a.action_ref || ''); if (/^DISC:/.test(r)) return '用藥差異處理：' + ingName(r.slice(5)); if (/^MON:/.test(r)) return '用藥改變後的檢驗判讀'; if (/^TEACH:/.test(r)) return '衛教：' + cardTitle(r.slice(6)); return t ? t.label_clinician : (ACT_ZH[a.action_type] || a.action_type); }
function addDays(iso, n) { var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
/* 4.9.3 WP-A（W2-9）：年份和今天（台北）不同時加年份，避免去年的檢驗看起來像今年；同年仍只寫「M月D日」 */
function md(iso, ref) { iso = String(iso || ''); if (iso.length > 10 && !isNaN(Date.parse(iso))) iso = d10(iso);   /* 5.2 獨立驗證 D6：含時間的值先換成台灣日期 */
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); if (!m) return ''; var y = String(ref || todayTW()).slice(0, 4); return (m[1] !== y ? m[1] + '年' : '') + Number(m[2]) + '月' + Number(m[3]) + '日'; }
/* 4.9.3 WP-A（CARE-NEW-01 內容閘門）：病人會看到或印出的新句子，每句一個代碼登錄在這裡（PENDING＝待臨床雙審）。
   只對模擬病人（建立時病歷號 TEST／E2E 開頭，伺服器 PATIENT_INDEX.synthetic）顯示；雙審通過後把狀態改成 APPROVED 才對真實病人顯示。
   沒有登錄的代碼一律不顯示（fail-closed）；真實病人沿用 4.9.1 的句型 */
var CONTENT_GATE = { PRINT_TITLE_V492: 'PENDING', PRINT_HOWTO_LINE: 'PENDING', PRINT_WHY_LABEL: 'PENDING', PRINT_DUE_PAST: 'PENDING', PRINT_WEIGHT_V492: 'PENDING', PRINT_DRY_WEIGHT: 'PENDING', PRINT_NEXT_CONTACT: 'PENDING', PRINT_NEXT_CONTACT_NONE: 'PENDING', PRINT_TEACHBACK: 'PENDING',
  /* W5-L（5.0 K08-04／K11-01／K11-06）：新版單張（一頁核心＋可選安全附件）的段落標題與句子；全部待臨床雙審（只對模擬病人） */
  PRINT_V5: 'PENDING', PRINT_V5_LEARNED: 'PENDING', PRINT_V5_FOCUS: 'PENDING', PRINT_V5_STAGE: 'PENDING', PRINT_V5_PRACTICE: 'PENDING', PRINT_V5_MED_BASIS: 'PENDING', PRINT_V5_VALUES: 'PENDING',
  PRINT_V5_ZONES: 'PENDING', PRINT_V5_TB_OPEN: 'PENDING', PRINT_V5_APPENDIX: 'PENDING', PRINT_V5_MED_SCHEDULE: 'PENDING' };
Object.assign(CONTENT_GATE, { /* 5.1 W51-RXA 新代碼只加在這一行（PENDING） */ });
Object.assign(CONTENT_GATE, { /* 5.2 新代碼只加在這一行（PENDING） */ PRINT_V52_MY_MEDS: 'PENDING', PRINT_V52_AUDIENCE: 'PENDING', PRINT_V52_FOREIGN_CG: 'PENDING', PRINT_V52_HOME_SAFETY: 'PENDING' });
Object.assign(CONTENT_GATE, { /* 5.1 W51-RXB 新代碼只加在這一行（PENDING） */ });
Object.assign(CONTENT_GATE, { /* 5.1 W51-PSY 新代碼只加在這一行（PENDING） */ });
Object.assign(CONTENT_GATE, { /* 5.1 W51-LEAF 新代碼只加在這一行（PENDING） */ PRINT_V51_ZONES: 'PENDING', PRINT_V51_HINT: 'PENDING', PRINT_V51_PREP: 'PENDING', PRINT_V51_PRACTICE_MORE: 'PENDING', PRINT_V51_DIFF: 'PENDING', PRINT_V51_LEARNED: 'PENDING', PRINT_V51_CONTACT: 'PENDING', PRINT_V51_WEIGHT_BLANK: 'PENDING', PRINT_V51_DRY_DATE: 'PENDING' });
Object.assign(CONTENT_GATE, { /* 5.1 W51-NUR 新代碼只加在這一行（PENDING） */ });
Object.assign(CONTENT_GATE, { /* 5.1 W51-DPT 新代碼只加在這一行（PENDING） */ });
Object.assign(CONTENT_GATE, { /* 5.1 W51-ASK 新代碼只加在這一行（PENDING） */ });
Object.assign(CONTENT_GATE, { /* 5.1 W51-UX 新代碼只加在這一行（PENDING） */ });
function isSyntheticPt() { return !!(CUR && CUR.rec && (CUR.rec.synthetic === true || (CUR.rec.v4 && CUR.rec.v4.synthetic === true))); }
/* 5.3 S1：伺服器送來的已核准代碼（病人紀錄與登入資料都會帶；本檔常數仍是 PENDING） */
function srvOn(id) { var m = (CUR && CUR.rec && CUR.rec.content_gates) || (ME && ME.content_gates); return !!m && Object.prototype.hasOwnProperty.call(m, id) && m[id] === true; }
function contentGate(id) { var st = Object.prototype.hasOwnProperty.call(CONTENT_GATE, id) ? CONTENT_GATE[id] : ''; if (!st) return false; return st === 'APPROVED' || srvOn(id) || isSyntheticPt(); }
/* 5.3 S1：試行規則的標籤——院內兩人核准後改標「院內核准」（核准綁定目前部署內容；內容改變自動回到試行） */
function trialChip(ruleId, txt) { return srvOn(ruleId) ? chip('院內核准（雙審）', 'ok') : chip(txt, 'warn'); }
/* 就地錯誤訊息（取代 alert）：寫在指定元素，並讓螢幕閱讀器讀出 */
function inlineErr(id, msg) { var el = $(id); if (el) { el.textContent = msg; el.setAttribute('role', 'alert'); } else sync('FAILED', msg); }
/* 重新繪製後把焦點放回原本的控制項（鍵盤與螢幕閱讀器使用者不會被丟回頁首） */
function focusKey() { var a = document.activeElement; if (!a || a === document.body) return null; return a.id ? { id: a.id } : (a.getAttribute && a.getAttribute('data-act') ? { act: a.getAttribute('data-act'), val: a.getAttribute('data-val') } : null); }
function restoreFocus(k) {
  if (!k) return; var el = k.id ? $(k.id) : document.querySelector('[data-act="' + k.act + '"]' + (k.val ? '[data-val="' + String(k.val).replace(/"/g, '') + '"]' : ''));
  if (el && el.focus) el.focus();
}

/* ---------- 啟動 ---------- */
function boot() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  readStaffToken(function (tok) {
    STAFF_TOKEN = tok;
    call('appMode').then(function (m) {
      MODE = m;
      if (m.staff_auth === 'LINK' && !STAFF_TOKEN) { renderLinkLanding(); return; }
      start();
    }).catch(function () { start(); });
  });
}
function trialBanner() {
  return '<div class="notice warn" id="trial_banner"><strong>試用環境：只能輸入模擬病人（病歷號以 TEST 開頭），請勿輸入真實病人的任何資料。</strong>專屬連結就是您的登入，請不要轉傳或貼在群組。</div>';
}
/* 試用模式、網址沒有專屬連結：說明＋管理者第一次設定 */
function renderLinkLanding(msg) {
  $('who').textContent = '';
  $('view_patients').innerHTML = trialBanner() + '<section class="panel"><h2>請用專屬連結開啟</h2>' + (msg ? '<p class="notice err">' + esc(msg) + '</p>' : '') +
    '<p>本系統的試用版以「專屬連結」登入：請用管理者發給您的連結開啟（網址最後有 #s= 開頭的一段）。連結遺失或失效時，請向管理者索取新的。</p></section>' +
    '<details class="panel"><summary><strong>管理者第一次設定（只有部署本系統的人需要）</strong></summary><p class="small muted">只有部署本系統的人需要做這一步：貼上部署後取得的網頁應用程式網址（結尾是 /exec），以及在 Apps Script 執行 trialSetup 後，執行記錄裡的「管理者設定碼」。</p>' +
      '<label class="f">本系統網址<input id="cl_url" type="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></label>' +
      '<label class="f">管理者設定碼<input id="cl_code" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"></label>' +
      '<div class="row"><button class="btn primary" type="button" data-act="claim">取得管理者專屬連結</button></div><div id="cl_out" aria-live="polite"></div></details>';
}
function linkBox(link, token) {
  return '<p class="small">請把下面這個網址加入瀏覽器書籤（或存在自己的記事本），之後都用它開啟；不要轉傳給別人。</p>' +
    '<pre class="linkbox" id="lk_text" style="white-space:pre-wrap;word-break:break-all">' + esc(link || ('（尚未設定本系統網址）代碼：' + token)) + '</pre>' +
    '<div class="row"><button class="btn" type="button" data-act="copy_staff_link">複製連結</button></div>';
}
function claim() {
  var url = $('cl_url').value.trim(), code = $('cl_code').value.trim();
  if (!url) { $('cl_url').focus(); return; } if (!code) { $('cl_code').focus(); return; }
  $('cl_out').innerHTML = '<p class="muted">處理中…</p>';
  call('trialClaimAdmin', [code, url]).then(function (r) {
    $('cl_out').innerHTML = '<p class="notice ok">完成。這是您的管理者專屬連結（只顯示這一次）。</p>' + linkBox(r.link, r.token) + '<div class="row"><button class="btn primary" type="button" data-act="claim_start" data-val="' + esc(r.token) + '">用這個連結開始使用</button></div>';
  }).catch(function (e) { $('cl_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
function copyLink() {
  var t = $('lk_text') ? $('lk_text').textContent : '';
  function sel() { var r = document.createRange(); r.selectNodeContents($('lk_text')); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  try { navigator.clipboard.writeText(t).then(function () { sync('SAVED', '已複製'); }, sel); } catch (e) { sel(); }
}
function start() {
  call('whoAmI').then(function (me) {
    ME = me; DICT = me.dict; Object.keys(me.facility_labels || {}).forEach(function (k) { FAC_ZH[k] = me.facility_labels[k]; });
    $('who').textContent = me.display_name + '｜' + (ROLE_ZH[me.role] || me.role) + '｜' + me.facilities.map(function (f) { return FAC_ZH[f] || f; }).join('、');
    $('tabs').hidden = false; $('tab_admin').hidden = !me.is_admin;
    if ($('tab_approve')) $('tab_approve').hidden = !(me.is_admin || (me.approval_roles || []).indexOf(me.role) >= 0);   /* 5.3 S1：可核准的職類與管理者（伺服器逐筆檢查） */
    if (me.dashboard_scope === 'NONE') document.querySelector('[data-tab="team"]').hidden = true;
    document.querySelector('[data-tab="teach"]').hidden = !(me.teaching_roles || []).length;
    FAC_PHONE = me.team_phone || {}; FAC_SVC = me.service_info || {};
    renderSysbar(me.system); renderPatients(); renderAdmin(); if ($('tab_purpose')) $('tab_purpose').textContent = TAB_PURPOSE[TAB] || '';
    /* 5.2 H-05：控制台有未啟用的變更 → 頁首警示（只給管理者）：修改還沒生效，登入仍用舊的設定與職責 */
    if (me.control_pending_since && !$('pending_banner')) $('main').insertAdjacentHTML('afterbegin', '<p class="notice warn" id="pending_banner" role="status">控制台有 ' + esc(d10(me.control_pending_since)) + ' ' + esc(hm(me.control_pending_since)) + ' 起未啟用的變更：修改還沒生效（登入與職責仍是舊的）。請擁有者從控制台選單「HFPC 控制台」→「檢查並啟用」。</p>');
    if (defaultTab() === 'work') switchTab('work');   /* 3.4（T11）：依職責的預設頁（院內流程政策 ROLE_DEFAULT_TAB） */
    if (me.trial) { if (!$('trial_banner')) $('main').insertAdjacentHTML('afterbegin', trialBanner());   /* v4.4 WP-F：start() 可能再執行（管理者第一次設定後），提示只插一次 */
    if ($('find_mrn')) $('find_mrn').placeholder = 'TEST-001'; }
  }).catch(function (e) {
    if (MODE && MODE.staff_auth === 'LINK') { renderLinkLanding(errText(e)); return; }
    $('who').textContent = '';
    $('view_patients').innerHTML = '<section class="panel"><h2>無法使用</h2><p class="notice err">' + esc(errText(e)) + '</p><p class="small muted">請確認您用院內 Google 帳號登入，且已由管理者加入授權名單。</p></section>';
  });
}
/* 系統提示：範圍內待處理的安全警訊、病人收件匣積壓 */
function renderSysbar(sys) {
  var el = $('sysbar'), h = '';
  if (!sys) { el.hidden = true; return; }
  /* 3.0.0 版本相容：這個畫面（Index.html）和伺服器程式（Code.gs）必須是同一版；病人連結版專案也要同一版 */
  var cr = window.HFI_CLIENT_RELEASE || {}, sv = (ME && ME.versions) || {};
  if (cr.server && sv.server && (cr.server !== sv.server || cr.content !== sv.content)) h += '<div class="notice err"><strong>畫面與系統程式的版本不同（畫面 ' + esc(cr.server) + '，系統程式 ' + esc(sv.server) + '）。</strong>請管理者依手冊 E 章把 Code 與 Index 兩個檔案都換成同一版，並「部署新版本」；在這之前請不要輸入資料。</div>';
  if (sys.patient_release && sys.patient_release.mismatch) h += '<div class="notice warn">病人連結版專案的版本（' + esc(sys.patient_release.seen || '未知') + '）和院內版（' + esc(sys.patient_release.expected) + '）不同：病人頁面會暫停顯示整理好的重點，但仍可以送出資料。請管理者依手冊 E 章更新病人連結版。</div>';
  if (sys.safety_open) h += '<div class="notice err"><strong>有 ' + esc(sys.safety_open) + ' 筆病人安全警訊待處理' + (sys.safety_overdue ? '（其中 ' + esc(sys.safety_overdue) + ' 筆已超過時限）' : '') + '</strong><button class="btn small primary" type="button" data-tab="work">到工作清單</button></div>';
  if (sys.inbox && sys.inbox.alert) h += '<div class="notice warn">病人送出的資料有 ' + esc(sys.inbox.pending) + ' 筆還沒處理（最久 ' + esc(sys.inbox.oldest_minutes) + ' 分鐘）。請管理者確認排程是否正常。</div>';
  if (sys.delivery_failed) h += '<div class="notice err">有 ' + esc(sys.delivery_failed) + ' 筆安全警訊的通知信送不出去；工作清單已列為「需人工聯絡」。</div>';
  if (sys.capacity) h += '<div class="notice warn">系統容量：' + esc(sys.capacity.level) + '（' + esc((sys.capacity.reasons || []).join('、')) + '）。請管理者查看營運摘要並依規模門檻評估遷移。</div>';
  el.innerHTML = h; el.hidden = !h;
  var b = $('work_badge'); if (b) { b.textContent = sys.safety_open || ''; b.hidden = !sys.safety_open; }
}
/* 4.9.3 WP-A（移植 4.9.2，BM-19）：每個分頁一句話說明「這頁是做什麼的」；病人子分頁各寫自己獨有的重點（彼此不重複） */
var TAB_PURPOSE = { approve: '由院內指定職類兩人核准試行內容與功能後，才對真實病人生效（核准綁定目前部署的內容）', patients: '找病人、新增病人，開啟您照護中的病人紀錄', work: '輪到您或您的團隊處理的事，依急迫度排序', team: '全團隊的照護品質與成效指標（含分子、分母）', teach: '學員的工作場所觀察評量、回饋與信賴決定', admin: '同仁與專屬連結、系統設定、備份與維運（管理者）' };
var PTAB_PURPOSE = { overview: '今天先處理什麼：安全警訊、資料可信度、上次之後的變化與照護計畫（可列印給病人）', assess: '這次接觸要問、要量的項目（依上次之後的變化挑出）；沒變的不用重填', data: '所有欄位的目前值、來源與日期：查閱或更正，不需要填滿',
  meds: '處方、病人實際使用、檢驗與藥事介入並列核對', care: '住院與出院轉銜、轉介與待辦：追到結案', edu: '每張衛教卡的學習目標：懂了嗎、之後還記得嗎、能自己做嗎', record: '數值趨勢與每一筆修改紀錄（誰、何時、改了什麼）' };
function defaultTab() { return ((ME && ME.role_policy) || {}).default_tab || 'overview'; }
function switchTab(t) {
  TAB = t;
  ['patients', 'work', 'team', 'teach', 'admin', 'approve'].forEach(function (x) { if ($('view_' + x)) $('view_' + x).hidden = x !== t; });
  if (t === 'teach') loadTeaching();
  if (t === 'approve') loadApprovals();   /* 5.3 S1 */
  [].forEach.call(document.querySelectorAll('.tab'), function (b) { if (b.getAttribute('data-tab') === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (t === 'team' && !$('view_team').innerHTML) renderTeamShell();
  if (t === 'work') loadWorklist();
  if ($('tab_purpose')) $('tab_purpose').textContent = TAB_PURPOSE[t] || '';   /* 4.9.3 WP-A：每個功能頁一句話說明 */
  $('main').focus();
}

/* ==== 5.3 S1：內容核准工作台 ====
   列出所有「只對模擬病人」的項目（文字閘門、試行規則、試行功能）：目前狀態、需要的核准職類組、已核准者（職類與時間）、內容雜湊、程式位置與文字摘錄。
   核准：勾選「已逐字閱讀並確認」→ 送出畫面上看到的雜湊（伺服器比對目前部署版本，不同就拒絕）。撤銷：寫理由。 */
var AP_KIND_ZH = { TEXT_GATE: '病人端／單張文字', L2_RULE: '試行規則', FEATURE: '試行功能', POLICY: '院內參數（已生效）' },
  AP_GOV_ZH = { APPROVAL_RECORD_NOT_FOUND: '5.1 以前就有，部署包內查不到核定紀錄', ENGINEERING_DEFAULT_PENDING_CLINICAL_APPROVAL: '工程預設，待臨床核定', ENGINEERING_DEFAULT_PENDING_HOSPITAL_APPROVAL: '工程預設，待院方核定', HOSPITAL_TO_FILL: '院方填寫', TRANSLATION_PENDING_DUAL_REVIEW: '待翻譯與雙審' },
  AP_PK_ZH = { CLINICAL_THRESHOLD: '臨床門檻', WORKFLOW: '流程', ACCESS: '權限與職責', SYSTEM: '系統' }, AP_ST_ZH = { PENDING: '待核准', PARTIAL: '已一人核准', APPROVED: '已核准', NOT_REGISTERED: '未登錄', AWAITING_REVIEWER_POLICY: '已兩人核准，等核准職類組核定', POLICY_NOT_READY: '核准職類組不符最低限制' };
var AP = { data: null, filter: 'MINE' };
function loadApprovals() {
  $('view_approve').innerHTML = '<p class="muted">讀取中…</p>';
  call('approvalList').then(function (d) { AP.data = d; renderApprovals(); }).catch(function (e) { $('view_approve').innerHTML = '<p class="notice err">' + esc((e && e.message) || '讀取失敗') + '</p>'; });
}
function apGroupsZh(g) { return (g || []).map(function (grp) { return grp.map(function (r) { return ROLE_ZH[r] || r; }).join('或'); }).join('＋'); }
function renderApprovals() {
  var d = AP.data; if (!d) return;
  var items = d.items.filter(function (x) { return AP.filter === 'ALL' || (AP.filter === 'MINE' ? x.can_approve && x.kind !== 'POLICY' : AP.filter === 'POLICY' ? x.kind === 'POLICY' : x.status === AP.filter); });
  var nPol = d.items.filter(function (x) { return x.kind === 'POLICY'; }).length, nPolOk = d.items.filter(function (x) { return x.kind === 'POLICY' && x.status === 'APPROVED'; }).length;
  var n = function (st) { return d.items.filter(function (x) { return x.status === st; }).length; };
  var h = '<section class="panel" id="ap_head"><h2>內容核准</h2><p>這些內容與功能目前只對模擬病人顯示。由院內指定職類<strong>兩位不同的人</strong>核准後，才會對真實病人生效。</p>' +
    '<ul class="small"><li>核准綁定目前部署內容的雜湊；之後程式或文字有任何改變，舊核准自動失效，需要重新核准。</li><li>受訓者（含實習學生、二年期學員、住院醫師）不能核准；核准者之後停用、改成受訓或改職類，該筆核准就不算。任何一位可核准該項目的職類或管理者都可以撤銷（撤銷後要重新兩人核准）。</li>' +
    '<li>第一步：「核准職類組」（院內參數 P_APPROVAL_REVIEWERS）要先由心臟科醫師與另一位臨床人員核定，其他項目的核准才會生效。</li>' +
    '<li>摘錄只是輔助閱讀；請在模擬病人上實際看過畫面或單張再核准。</li><li>本系統的 AI 與工程端不會、也不能代為核准。</li>' +
    '<li>「院內參數」（' + nPol + ' 項，已院內核定 ' + nPolOk + ' 項）不一樣：<strong>不論是否核准，目前都已生效</strong>。核准只記錄院內核定；要改值請在控制台修改院內流程政策，改值後舊核准自動失效。</li></ul>' +
    (d.policy_ready ? '' : '<p class="notice err">核准職類組不符最低限制（' + esc((d.policy_floor_errors || []).join('；')) + '）：目前無法核准。</p>') +
    (d.integrity && !d.integrity.ok ? '<p class="notice err">核准紀錄驗證失敗（' + esc(d.integrity.broken) + '）：所有核准暫時不生效，也不能新增核准；請系統管理者依手冊第 7 章 7.5 處理。</p>' +
      (ME.is_admin ? '<div class="row" id="ap_archive"><label class="f small">封存理由（異常通報編號與原因）<input id="ap_archive_why" maxlength="200"></label> <button class="btn small" type="button" data-act="ap_archive">封存核准紀錄並重新開始（所有項目要重新兩人核准）</button><span class="small" id="ap_archive_msg" aria-live="polite"></span></div>' : '') : '') +
    (d.reviewer_policy_approved ? '' : '<p class="notice warn">核准職類組尚未核定：請先核准「院內參數」中的 P_APPROVAL_REVIEWERS。</p>') +
    '<p class="small">共 ' + d.items.length + ' 項：待核准 ' + n('PENDING') + '、已一人核准 ' + n('PARTIAL') + '、已核准 ' + n('APPROVED') + '（伺服器 ' + esc(d.server_version) + '）</p>' +
    '<div class="row" role="group" aria-label="篩選">' + [['MINE', '我可以核准的'], ['PARTIAL', '已一人核准'], ['APPROVED', '已核准'], ['POLICY', '院內參數（已生效）'], ['ALL', '全部']].map(function (f) { return '<button class="btn small' + (AP.filter === f[0] ? ' primary' : '') + '" type="button" data-act="ap_filter" data-val="' + f[0] + '" aria-pressed="' + (AP.filter === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div></section>';
  h += items.length ? items.map(function (x) {
    var who = x.approvers.map(function (a) { return (ROLE_ZH[a.provider_role] || a.provider_role) + (a.me ? '（您）' : '') + ' ' + esc(md(a.at)); }).join('、');
    return '<section class="panel ap-item" id="ap_' + esc(x.id) + '" data-status="' + esc(x.status) + '"><h3>' + esc(x.label) + ' ' + chip(AP_ST_ZH[x.status] || x.status, x.status === 'APPROVED' ? 'ok' : 'warn') + '</h3>' +
      '<p class="small">' + esc(AP_KIND_ZH[x.kind] || x.kind) + '｜代碼 ' + esc(x.id) + '｜需要：' + esc(apGroupsZh(x.groups)) + '｜內容版本 ' + esc(String(x.hash).slice(0, 8)) + '</p>' +
      (x.kind === 'POLICY' ? '<p class="small">' + chip('已生效', 'warn') + ' ' + esc(AP_PK_ZH[x.policy_kind] || x.policy_kind) + '｜參數 ' + esc(x.policy_key) + '｜' + esc(AP_GOV_ZH[x.governance_status] || x.governance_status) + (x.overridden ? '｜<strong>目前值已由控制台覆寫</strong>' : '') + '</p>' : '') +
      (who ? '<p class="small">已核准：' + who + '</p>' : '') + (x.stale_approvals ? '<p class="small muted">另有 ' + esc(x.stale_approvals) + ' 筆舊版本的核准（內容已改變，不算）</p>' : '') +
      (x.ineligible_approvals ? '<p class="small muted">另有 ' + esc(x.ineligible_approvals) + ' 筆核准的核准者目前已停用、改為受訓或職類改變（不算）</p>' : '') +
      ((x.policy_overridden || []).length && x.kind !== 'POLICY' ? '<p class="small">引用的院內參數已由控制台改值：' + esc(x.policy_overridden.join('、')) + '（需要重新核准）</p>' : '') +
      (x.revoked_at ? '<p class="small muted">曾於 ' + esc(md(x.revoked_at)) + ' 撤銷</p>' : '') +
      '<details><summary>文字摘錄與程式位置</summary>' + ((x.excerpt || []).length ? '<ul class="small">' + x.excerpt.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '<p class="small muted">（沒有中文字串；請在模擬病人上看實際畫面）</p>') +
        '<p class="small muted">' + (x.scopes || []).map(function (sc) { return esc(sc.file.replace('src/', '') + ':' + sc.from + '–' + sc.to + (sc.name && sc.name !== 'region' ? '（' + sc.name + '）' : '')); }).join('；') + '</p></details>' +
      (x.can_approve ? '<div class="row"><label class="small"><input type="checkbox" id="ap_ok_' + esc(x.id) + '"> ' + (x.kind === 'POLICY' ? '我已核對這一項目前生效的值，同意記錄為院內核定' : '我已逐字閱讀這一項目前部署的內容，確認可以對真實病人使用') + '</label> <button class="btn primary small" type="button" data-act="ap_approve" data-val="' + esc(x.id) + '">核准</button></div>' : '') +
      (x.can_revoke && (x.status !== 'PENDING' || x.approvers.length) ? '<div class="row"><label class="f small">撤銷理由<input id="ap_why_' + esc(x.id) + '" maxlength="300"></label> <button class="btn small" type="button" data-act="ap_revoke" data-val="' + esc(x.id) + '">撤銷</button></div>' : '') +
      '<p class="small" id="ap_msg_' + esc(x.id) + '" aria-live="polite"></p></section>';
  }).join('') : '<p class="muted">沒有符合的項目。</p>';
  $('view_approve').innerHTML = h;
}
function apAct(act, id) {
  var x = (AP.data && AP.data.items || []).filter(function (i) { return i.id === id; })[0]; if (!x) return;
  var msg = function (t, err) { var el = $('ap_msg_' + id); if (el) { el.textContent = t; el.className = 'small' + (err ? ' notice err' : ''); } };
  if (act === 'ap_approve') {
    if (!($('ap_ok_' + id) || {}).checked) { msg('請先勾選「已逐字閱讀並確認」。', true); return; }
    call('approvalApprove', [id, x.hash, true]).then(function (r) { msg(r.status === 'APPROVED' ? (x.kind === 'POLICY' ? '已核准：記錄為院內核定（參數本來就已生效，行為不變）。' : '已核准：真實病人重新載入畫面後生效。') : '已記錄您的核准；還需要另一位指定職類核准。'); loadApprovals(); }).catch(function (e) { msg((e && e.message) || '核准失敗', true); });
  } else if (act === 'ap_revoke') {
    var why = (($('ap_why_' + id) || {}).value || '').trim(); if (why.length < 4) { msg('請寫撤銷理由（至少 4 個字）。', true); return; }
    call('approvalRevoke', [id, why]).then(function () { msg(x.kind === 'POLICY' ? '已撤銷院內核定紀錄（參數仍生效；要停用或改值請修改院內流程政策）。' : '已撤銷：真實病人重新載入畫面後不再顯示；已列印的單張、已建立的警訊與工作清單不會自動撤回。'); loadApprovals(); }).catch(function (e) { msg((e && e.message) || '撤銷失敗', true); });
  }
}
/* ==== 5.3 S1 end ==== */

/* ---------- 病人：搜尋、新增、加入照護團隊、我的病人 ---------- */
function renderPatients() {
  var facs = ME.facilities.map(function (f) { return opt(f, FAC_ZH[f] || f); }).join('');
  $('view_patients').innerHTML =
    '<section class="panel noprint"><h2>找病人</h2><details class="help"><summary>說明</summary><p class="small muted">系統不存姓名與病歷號；病歷號只轉成單向編碼後比對，查完即從畫面清除。</p></details>' +
    '<form id="find_form" class="row" autocomplete="off"><label class="f">院所<select id="find_fac">' + facs + '</select></label>' +
    '<label class="f">病歷號<input id="find_mrn" inputmode="text" autocomplete="off" spellcheck="false" maxlength="24" required></label>' +
    '<button class="btn primary" type="submit">搜尋</button><button class="btn" type="button" data-act="register">新增病人</button></form>' +
    '<div id="find_out" aria-live="polite"></div></section>' +
    /* 4.9.3 WP-A（移植 4.9.2）：開啟病人後清單收合，紀錄直接出現在第一屏；要換人時點標題展開 */
    '<section class="panel noprint"><details id="mine_box" open><summary><h2 class="inline-h">我的病人</h2> <span class="small muted" id="mine_hint"></span></summary><div id="mine">讀取中…</div></details></section>' +
    '<div id="pt"></div>' + ((ME.role === 'PHARMACIST' || ME.is_admin) ? aliasDictHtml() : '');
  $('find_form').addEventListener('submit', function (ev) { ev.preventDefault(); search(); });
  loadMine();
}
/* v4.3 X05：藥名別名字典（藥師登錄；只讀）。登錄經資料管理者以 gov_import 寫入（不建新表）；病人端只把別名當搜尋候選，選了仍待藥師核對 */
var ALIAS_FLAG_ZH = { HOMONYM: '同名異藥（同一寫法對到不同成分）', BUILTIN_CONFLICT: '與內建名稱相同但成分不同', DUPLICATE_INGREDIENT: '同成分有多個商品名或寫法', UNKNOWN_INGREDIENT: '成分代碼不在清單（不採用）' };
function aliasDictHtml() {
  var A = DICT.drug_aliases || { aliases: [], flags: [], coverage: {} }, c = A.coverage || {}, nm = {};
  (DICT.ingredients || []).forEach(function (i) { nm[i.id] = i.name + (i.zh ? '（' + i.zh + '）' : ''); });
  return '<section class="panel noprint" id="alias_dict"><details><summary><h2 style="display:inline">藥名別名字典（藥師登錄）</h2></summary>' +
    '<p class="small">成分 ' + esc(c.ingredients || 0) + ' 個；內建中文名 ' + esc(c.with_builtin_zh || 0) + ' 個；藥師已登錄別名的成分 ' + esc(c.with_pharmacist_alias || 0) + '個。中文名只由藥師登錄，系統建置人員不代填。</p>' +
    '<p class="small muted">登錄：藥師填登錄頁（tools/drug_alias.py --page 產生）的匯入檔，由資料管理者執行 gov_import drug_alias 檢查後寫入；下次系統更新版本後，這裡與病人端的搜尋選項才會更新。病人選了別名對到的成分，仍標「病人自選，待藥師核對」，核對前不會用於任何規則判斷。</p>' +
    (A.flags.length ? '<h3>需要藥師處理的標記</h3><ul class="small" id="alias_flags">' + A.flags.map(function (f) { return '<li data-flag="' + esc(f.flag) + '">' + esc(ALIAS_FLAG_ZH[f.flag] || f.flag) + '：' + esc(f.alias || '') + ' ' + esc((f.ingredient_ids || [f.ingredient_id]).map(function (x) { return nm[x] || x; }).join('、')) + '</li>'; }).join('') + '</ul>' : '<p class="small muted">沒有需要處理的標記。</p>') +
    (A.aliases.length ? '<div class="table-scroll" tabindex="0" role="region" aria-label="已登錄別名"><table class="small"><thead><tr><th scope="col">寫法</th><th scope="col">成分</th><th scope="col">劑型</th><th scope="col">依據</th><th scope="col">登錄</th></tr></thead><tbody>' +
      A.aliases.map(function (a) { return '<tr><td>' + esc(a.alias) + '</td><td>' + esc(nm[a.ingredient_id] || a.ingredient_id) + '</td><td>' + esc(a.dosage_form || '未填') + '</td><td>' + esc(a.source) + '</td><td>' + esc(a.registered_by) + ' ' + esc(String(a.registered_at || '').slice(0, 10)) + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<p class="muted" id="alias_empty">目前沒有任何藥師登錄的別名。</p>') + '</details></section>';
}
function loadMine() {
  call('listMyPatients').then(function (list) {
    $('mine').innerHTML = list.length ? '<div class="table-scroll"><table><thead><tr><th scope="col">病人代碼</th><th scope="col">院所</th><th scope="col"></th></tr></thead><tbody>' +
      list.map(function (p) { return '<tr><td>#' + esc(p.short_ref) + '</td><td>' + esc(FAC_ZH[p.facility_code] || p.facility_code) + '</td><td><button class="btn small" type="button" data-act="open" data-val="' + esc(p.patient_key) + '">開啟</button></td></tr>'; }).join('') + '</tbody></table></div>'
      : '<p class="muted">您目前不在任何病人的照護團隊。請用病歷號搜尋或新增。</p>';
  }).catch(function (e) { $('mine').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
function mrnVal() { return $('find_mrn').value.trim(); }
function clearMrn() { $('find_mrn').value = ''; }
function search() {
  var fac = $('find_fac').value, mrn = mrnVal(); if (!mrn) return;
  $('find_out').innerHTML = '<p class="muted">搜尋中…</p>';
  call('searchPatient', [fac, mrn]).then(function (r) {
    if (r.found) { clearMrn(); $('find_out').innerHTML = ''; openPatient(r.patient_key); return; }
    if (r.may_join) {
      $('find_out').innerHTML = '<div class="notice warn"><p>這位病人已在系統中，但您不在他的照護團隊。加入需要理由，並會留下稽核紀錄。</p><div class="row"><label class="f">理由<select id="join_reason"><option value="">請選擇</option>' +
        ME.join_reasons.map(function (x) { return opt(x, JOIN_ZH[x] || x); }).join('') + '</select></label><button class="btn primary" type="button" data-act="join">加入照護團隊</button></div></div>';
    } else $('find_out').innerHTML = '<p class="notice warn">找不到這位病人。確認病歷號無誤後，可以按「新增病人」。</p>';
  }).catch(function (e) { $('find_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
function register() {
  var fac = $('find_fac').value, mrn = mrnVal(); if (!mrn) { $('find_mrn').focus(); return; }
  call('registerPatient', [fac, mrn]).then(function (r) {
    if (r.created || r.patient_key) { clearMrn(); $('find_out').innerHTML = ''; loadMine(); openPatient(r.patient_key); }
    else $('find_out').innerHTML = '<p class="notice warn">這位病人已經在系統中，請先加入照護團隊。</p>';
  }).catch(function (e) { $('find_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
function join() {
  var reason = $('join_reason').value; if (!reason) { $('join_reason').focus(); return; }
  call('joinCareTeam', [$('find_fac').value, mrnVal(), reason]).then(function (r) { clearMrn(); $('find_out').innerHTML = ''; loadMine(); openPatient(r.patient_key); })
    .catch(function (e) { $('find_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}

/* ---------- 病人紀錄 ---------- */
function stagedCount() { return Object.keys(ST.obs).length + ST.ce.length + ST.ac.length + ST.co.length + ST.ed.length + (ST.v4 || []).length; }
function takeParked(id) {
  var pk = (CUR.rec.parked || []).filter(function (x) { return x.transaction_id === id; })[0]; if (!pk) return;
  pk.observations.forEach(function (o) {
    if (o.action_type === 'CONFIRM') return;
    var e = CUR.rec.view.fields[o.field_id], x = { field_id: o.field_id, action_type: o.action_type === 'CORRECT' ? 'CORRECT' : 'UPDATE', value: o.value, source_type: o.source_type, label: o.action_type === 'CORRECT' ? 'CORRECT' : 'UPDATE' };
    if (o.action_type === 'CORRECT' && o.supersedes_event_id) x.supersedes_event_id = o.supersedes_event_id;
    if (o.effective_at) x.effective_at = o.effective_at;
    if (e) x.client_observed_old_value = e.value;
    ST.obs[o.field_id] = x;
  });
  pk.care_events.forEach(function (c) { ST.ce.push({ event_type: c.event_type, occurred_at: c.occurred_at, hf_related: c.hf_related, source_type: c.source_type }); });
  /* 3.0.0：行動、關心的問題、衛教也一起帶回——已存在的行動只帶狀態更新，新行動重新建立（伺服器仍會依目前狀態檢查轉換是否合法） */
  (pk.actions || []).forEach(function (a) {
    var exist = CUR.rec.view.actions[a.action_id];
    if (exist) { var u = { action_id: a.action_id, action_status: a.action_status }; ['completed_at', 'barrier_code', 'resolution_code', 'result_code', 'change_reason'].forEach(function (k) { if (a[k]) u[k] = a[k]; }); if (a.change_reason) u.owner_role = a.owner_role; ST.ac.push(u); }
    else { var n = { action_type: a.action_type, action_status: 'PLANNED', owner_role: a.owner_role, patient_visible: a.patient_visible }; if (a.action_ref) n.action_ref = a.action_ref; if (a.due_at) n.due_at = d10(a.due_at); if (a.handoff_reason) { n.handoff_reason = a.handoff_reason; if (a.handoff_urgency) n.handoff_urgency = a.handoff_urgency; if (a.handoff_needs.length) n.handoff_needs = a.handoff_needs; } ST.ac.push(n); }
  });
  (pk.concerns || []).forEach(function (c) { if (CUR.rec.view.concerns[c.concern_id]) { if (c.status !== 'OPEN') ST.co.push({ concern_id: c.concern_id, status: c.status }); } else ST.co.push({ concern_code: c.concern_code, status: 'OPEN' }); });
  (pk.education || []).forEach(function (e) { ST.ed = ST.ed.filter(function (x) { return !(x.card_id === e.card_id && (x.objective || '') === (e.objective || '')); }).concat([Object.assign({}, e)]); });
  ST.resolves.push(id); afterStage();
}
/* 5.2 E-05：重取直到畫面版本號 ≥ 伺服器儲存結果的版本號 */
function reloadUntil(pk, want, tries) {
  var go = function (n) {
    call('loadPatientRecord', [pk]).then(function (rec) {
      if (typeof want === 'number' && rec.base_snapshot_version < want && n > 1) { setTimeout(function () { go(n - 1); }, 1000); return; }
      openPatientWith(pk, rec, true, true);
      if (typeof want === 'number' && rec.base_snapshot_version < want) sync('FAILED', '已儲存（版本 ' + want + '），但畫面讀到的仍是版本 ' + rec.base_snapshot_version + '：請按「重新載入」。');
    }).catch(function (e) { sync('FAILED', errText(e)); });
  };
  go(tries || 3);
}
function openPatientWith(pk, rec, keepStaged, keepSync) {
  Promise.all([call('getPatientDashboard', [pk]), call('listPatientLinks', [pk])]).then(function (x) {
    var keepTab = CUR && CUR.pk === pk ? CUR.tab : 'overview', keepLog = CUR && CUR.pk === pk ? { f: CUR.logFilter, o: CUR.logOpen } : {};
    CUR = { pk: pk, rec: rec, dash: x[0], links: x[1], tab: keepTab, logFilter: keepLog.f, logOpen: keepLog.o, fromWork: !!(CUR && CUR.fromWork) };
    renderPatient();
  }).catch(function (e) { sync('FAILED', errText(e)); });
}
function openPatient(pk, keepStaged, keepSync, target) {
  if (!keepStaged && CUR && CUR.pk === pk) keepStaged = true;   /* v4.8 WP-3（G15）：重開同一位病人（再查一次、從工作清單點進來）保留尚未儲存的變更 */
  if (!keepStaged && CUR && CUR.pk !== pk && stagedCount() && !window.confirm('目前有尚未儲存的變更，換病人會清掉。確定嗎？')) return;
  if (!keepStaged) { ST = { obs: {}, ce: [], ac: [], co: [], ed: [], resolves: [], v4: [] }; ISSUED = null; }
  if (!keepSync) sync('LOADING');
  /* 5.2 H-03：換到另一位病人（或第一次開啟）時，先把舊畫面換成載入中（不能在載入完成前填寫，避免填的內容被重畫清掉） */
  if ((!CUR || CUR.pk !== pk) && $('pt')) $('pt').innerHTML = '<section class="panel" id="pt_loading" aria-busy="true"><p role="status">正在載入病人紀錄…（載入完成前無法填寫，以免內容被清掉）</p></section>';
  Promise.all([call('loadPatientRecord', [pk]), call('getPatientDashboard', [pk]), call('listPatientLinks', [pk])]).then(function (x) {
    var keepTab = target && target.tab ? target.tab : (CUR && CUR.pk === pk ? CUR.tab : (defaultTab() === 'meds' ? 'meds' : defaultTab() === 'assess' ? 'assess' : 'overview')), keepLog = CUR && CUR.pk === pk ? { f: CUR.logFilter, o: CUR.logOpen } : {};
    CUR = { pk: pk, rec: x[0], dash: x[1], links: x[2], tab: keepTab, logFilter: keepLog.f, logOpen: keepLog.o, fromWork: !!target };
    if (stagedCount()) sync('FAILED', '有 ' + stagedCount() + ' 項變更還沒有儲存'); else if (!keepSync) sync('IDLE');
    renderPatient();
    if ($('mine_box')) { $('mine_box').open = false; if ($('mine_hint')) $('mine_hint').textContent = '（目前開啟 #' + CUR.rec.short_ref + '；按這裡展開清單換病人）'; }
    if (target && target.ref) focusTarget(target); else { var h = $('pt_head'); if (h) { h.focus(); if (!keepSync && h.scrollIntoView) { try { h.scrollIntoView({ block: 'start' }); } catch (e) { h.scrollIntoView(); } } } }
  }).catch(function (e) { sync('FAILED', errText(e)); });
}
/* 5.0 W5-M：病人頁橫幅——死亡紀錄（核實／轉述）與診斷待確認（醫療人員畫面） */
function w5mBannerHtml(v) {
  var ce = (v.care_events || []), sup = {}; ce.forEach(function (e) { if (e.supersedes_event_id) sup[e.supersedes_event_id] = 1; });
  var dv = ce.filter(function (e) { return e.event_type === 'DEATH_VERIFIED' && !sup[e.event_id]; })[0], dr = ce.filter(function (e) { return e.event_type === 'DEATH_REPORTED' && !sup[e.event_id]; })[0], h = '';
  if (dv) h += '<p class="notice err" id="death_banner" data-death="VERIFIED">已核實死亡（' + esc(d10(dv.occurred_at)) + '，' + esc(DEATH_SRC_ZH[dv.note_code] || dv.note_code || '') + '）：病人連結已停止，病人自我照顧待辦不再列入工作清單。若是誤註記，請到「就醫與行動」撤回這筆紀錄。</p>';
  else if (dr) h += '<p class="notice warn" id="death_banner" data-death="REPORTED">有死亡轉述（' + esc(d10(dr.occurred_at)) + '，' + esc(DEATH_SRC_ZH[dr.note_code] || '來源未說明') + '），尚未核實：照護與病人連結照常。請依正式來源核實後記錄「死亡（已核實）」，或撤回這筆轉述。</p>';
  var hosp = ce.some(function (e) { return ['HF_DISCHARGE_VERIFIED', 'HF_ADMISSION_VERIFIED'].indexOf(e.event_type) >= 0 && e.verification_state === 'VERIFIED'; }), dx = (v.fields || {}).diagnosis_confirmed;
  if (hosp && !(dx && dx.value === 'CONFIRMED')) h += '<p class="notice warn" id="dx_banner">有已確認的心衰竭住院或出院，但心衰竭診斷尚未由醫師確認（' + esc(dx ? ((DICT.fields.diagnosis_confirmed || {}).enum_labels || {})[dx.value] || dx.value : '未記錄') + '）。請處方者在「所有欄位」確認；工作清單的每週批次也會列出。照護族群指標照常計算，確認診斷與藥物適格指標要等確認。</p>';
  return h;
}
/* 5.0 W5-M（K11-02）：心臟復健只顯示適用性提示與「轉介待評估」，不預先加入；不適合或不穩定時不提示並列出理由 */
var REHAB_ZH = { NO_RECENT_DISCHARGE: '近 30 天沒有已確認的心衰竭出院', NOT_SUITABLE_DOCUMENTED: '運動前評估已記錄「目前不適合」', DEFERRED_RECHECK: '運動前評估記錄「暫緩、再評估」', CURRENTLY_ADMITTED: '目前住院中', DEATH_RECORDED: '有死亡紀錄（含待確認）', OPEN_SAFETY_ALERT: '有尚未結案的安全警訊', INSTABILITY_SIGNALS: '有不穩定訊號（運動訓練暫停條件）', INSTABILITY_CHECK_UNAVAILABLE: '不穩定訊號無法判斷（資料不足）', ALREADY_REFERRED: '已有尚未結案的心臟復健轉介' };
function rehabHintHtml() {
  var r = CUR.rec.rehab_hint; if (!r) return '';
  if (r.show) return '<p class="small" id="rehab_hint" data-rehab="SHOW"' + (r.branch ? ' data-branch="' + esc(r.branch) + '"' : '') + '>心臟復健：' + (r.branch === 'OUTPATIENT' ? '心衰竭診斷已確認、從未轉介，門診可評估是否轉介' : '出院後可評估是否轉介') + '（系統不預先加入，也不代表已完成適應症與安全評估）。<button class="btn small" type="button" data-act="rehab_add">加入「心臟復健轉介（待評估）」</button></p>';
  if (r.reasons && r.reasons.length && r.reasons[0] !== 'NO_RECENT_DISCHARGE') return '<p class="small muted" id="rehab_hint" data-rehab="HIDDEN">這次不提示心臟復健轉介：' + esc(r.reasons.map(function (x) { return REHAB_ZH[x] || x; }).join('、')) + '。</p>';
  return '';
}
function rehabAdd() {
  if (ST.ac.some(function (a) { return a.action_type === 'REFERRAL_REHAB'; })) { inlineErr('pt_msg', '這次變更已經有心臟復健轉介。'); return; }
  ST.ac.push({ action_type: 'REFERRAL_REHAB', action_ref: 'TPL:CARDIAC_REHAB', action_status: 'PLANNED', owner_role: 'PHYSIOTHERAPIST', patient_visible: false, due_at: addDays(today(), 28) }); afterStage();
}
function renderPatient() {
  var fk = focusKey();
  var v = CUR.rec.view, la = v.last_assessment;
  var h = '<section class="panel"><h2 id="pt_head" tabindex="-1">病人 #' + esc(CUR.rec.short_ref) + '</h2><p class="small muted">紀錄版本 ' + esc(CUR.rec.base_snapshot_version) +
    '｜最近一次評估 ' + (la ? esc(d10(la.completed_at)) + '（' + esc(ROLE_ZH[la.provider_role] || la.provider_role) + '，' + esc(SET_ZH[la.care_setting] || la.care_setting || '') + '）' : '尚無') +
    '｜資料時間 ' + esc(d10(v.as_of)) + ' ' + esc(hm(v.as_of)) + '</p><div class="row noprint">' + (CUR.fromWork ? '<button class="btn small" type="button" id="pt_back" data-act="back_to_work">← 回工作清單</button>' : '') + '<button class="btn small" type="button" data-act="reload">重新載入</button><button class="btn small" type="button" data-act="print">列印本頁（醫療人員用）</button>' + uxPrintButtons() + '<button class="btn small" type="button" data-act="print_transition">列印轉銜摘要（給基層／居家團隊）</button></div>' +
    '<details class="small noprint"><summary>離開這位病人的照護團隊</summary><div class="row"><label class="f">理由<select id="leave_reason"><option value="CARE_ENDED">照護已結束</option><option value="COVERING_ENDED">代班結束</option><option value="JOINED_BY_ERROR">誤加入</option></select></label>' +
    '<button class="btn small ghost" type="button" data-act="leave_team">離開</button></div><p class="small muted">離開後這位病人不再出現在「我的病人」；紀錄保留，稽核會記錄。代班加入的會在到期日自動離開。</p></details><p id="pt_msg" class="small" aria-live="polite"></p></section>';
  /* 2.8.0：第一屏是照護計畫（Patient Cockpit）；完整紀錄分頁漸進展開。安全警訊與尚未儲存的變更在每一頁都看得到 */
  var tab = CUR.tab || 'overview';
  h += journeyHtml() + handoffHtml() + w5mBannerHtml(v) + safetyHtml(CUR.rec.safety_alerts || []) + ptabsHtml(tab);   /* 5.0 W5-C（K09-01）接續摘要＋W5-M（K10-07）病人頁橫幅 */
  /* 3.2（R-A-009／R-A-010）：總覽依臨床思考順序——安全（上方）→ 能不能信任這些資料（需要注意）→ 上次之後變了什麼 → 客觀數據一覽 → 照護計畫 */
  if (tab === 'overview') h += (CUR.rec.plan && CUR.rec.plan.journey ? '' : wmPanel(v)) + alertsHtml(v) + changesHtml(CUR.rec.changes_since) + objectiveSnapshotHtml(v) + cockpitHtml(v) + psy_roleConcHtml('overview') + closedAlertsHtml(CUR.rec.safety_alerts_closed) + linksHtml();   /* 5.1 W51-PSY（DP-25）：各職類評估結論 */
  else if (tab === 'assess') h += assessHtml(v) + psy_roleConcHtml('assess');
  else if (tab === 'data') h += dataHtml(v);
  else if (tab === 'meds') h += medTruthHtml(v) + v4MedsHtml() + medGuidanceHtml(true) + medLoopHtml() + rxHtml(v);
  else if (tab === 'care') h += careHtml(v) + v4TransitionHtml() + v4CommunityHtml() + actionsHtml(v) + concernsHtml(v);
  else if (tab === 'edu') h += teachLinkHtml() + eduHtml(v);
  else h += timelineHtml(v) + encounterNotesHtml() + trendsHtml() + changeLogHtml();
  h += stagedHtml();
  $('pt').innerHTML = h;
  restoreFocus(fk);
}
/* 4.9.3 WP-A（CARE-CARD-02／CARE-NURSE-04）：各次評估留下的理由碼（今日警訊未評估、暫不安排下次聯絡）；資料取自稽核（唯讀） */
function encounterNotesHtml() {
  var L = CUR.rec.encounter_notes || []; if (!L.length) return '';
  return '<section class="panel" id="enc_notes"><h2>評估留下的理由</h2><ul class="small">' + L.slice().reverse().map(function (n) {
    var Z = n.kind === 'SAFETY_NOT_ASSESSED' ? SKIP_ZH : DEFER_ZH;
    return '<li data-note="' + esc(n.kind) + '" data-reason="' + esc(n.reason) + '">' + esc(d10(n.at)) + ' ' + esc(hm(n.at)) + '｜' + esc(NOTE_ZH[n.kind] || n.kind) + '：' + esc(codeZh(Z, n.reason)) + '（' + esc(n.actor_id || '') + '）</li>'; }).join('') + '</ul></section>';
}
/* ---------- 安全警訊（這位病人）與上次看之後的變化 ---------- */
/* 5.2 A-02：警訊來源標籤（病人連結／醫療人員記錄的職類與接觸方式／收件匣搶救）；舊警訊沒有 origin 時由伺服器推回 */
function alertOriginZh(a) {
  if (a.origin === 'CLINICIAN_ENTRY') return (ROLE_ZH[a.created_by_role] || '醫療人員') + (a.contact_mode === 'PHONE' ? '電話' : a.contact_mode === 'VIDEO' ? '視訊' : a.care_setting === 'INPATIENT' ? '病房' : a.contact_mode === 'FACE_TO_FACE' ? '當面' : '（未記錄接觸方式）') + '記錄';   /* 5.2 獨立驗證 D3 */
  return a.origin === 'INBOX_SALVAGE' ? '病人連結（送出未能存入，單獨保留警訊）' : '病人連結';
}
function alertCard(a, withPatient) {
  return '<div class="alert-card' + (a.overdue ? ' overdue' : '') + '" id="alert_' + esc(a.alert_id) + '" data-origin="' + esc(a.origin || '') + '"><p><strong>' + esc(a.route_label) + '</strong>（' + esc(a.route) + '）' + (withPatient ? '｜病人 #' + esc(a.short_ref) : '') + '｜' + esc(d10(a.created_at)) + ' ' + esc(hm(a.created_at)) + '｜來源：' + esc(alertOriginZh(a)) + (a.supervision === 'SUPERVISOR_REVIEW' ? ' ' + chip('督導覆核：受訓醫師選「' + (SUPPRESS_ZH.filter(function (x) { return x[0] === a.supervision_reason; }).map(function (x) { return x[1]; })[0] || a.supervision_reason) + '」未建立警訊，請督導覆核', 'warn') : '') +
    (a.overdue ? ' ' + chip('超過首次處理時限', 'err') : '') + (a.attempts ? ' ' + chip('已嘗試聯絡 ' + a.attempts + ' 次', 'warn') : '') +
    (a.working ? ' ' + chip('已接手處理中：' + (ROLE_ZH[a.working.provider_role] || a.working.provider_role || '') + ' ' + (a.working.actor_id || '') + '（' + md(d10(a.working.at)) + ' ' + hm(a.working.at) + '）；仍待結案', 'warn') : '') +
    (a.status === 'RESPONDED' ? ' ' + chip('已回應（' + codeZh(DICT.alert_outcomes, a.responded_outcome) + '）：不代表風險已解決，請在 ' + md(d10(a.followup_due)) + ' ' + hm(a.followup_due) + ' 前確認後續', a.followup_overdue ? 'err' : 'warn') : '') +
    (a.repeats && a.repeats.length ? ' ' + chip('同一事件再回報 ' + a.repeats.length + ' 次' + (a.escalated_from ? '（已改為更緊急的處理方式）' : ''), a.escalated_from ? 'err' : 'warn') : '') + '</p>' +
    '<p class="small">' + (a.signals || []).map(function (x) { return esc(x.label); }).join('；') + '</p>' +
    (a.delivery ? '<p class="small">' + chip(DLV_ZH[a.delivery.status] || a.delivery.status, a.delivery.status === 'DELIVERED' ? 'ok' : 'err') + (a.delivery.failed_reason ? ' <span class="muted">' + esc(a.delivery.failed_reason) + '</span>' : '') + '</p>' : '') +
    '<div class="row noprint"><label class="f">處理結果<select id="ack_' + esc(a.alert_id) + '"><option value="">請選擇</option>' + (DICT.alert_outcomes || []).filter(function (o) { if (a.supervision === 'SUPERVISOR_REVIEW') return ['SUPERVISOR_REVIEWED', 'WORKING'].indexOf(o[0]) >= 0; if (o[0] === 'SUPERVISOR_REVIEWED') return false; return a.status === 'RESPONDED' ? ['RESPONDED', 'WORKING'].indexOf(o[2]) < 0 && o[0] !== 'UNREACHABLE' : o[0].indexOf('FOLLOWUP_') !== 0; }).map(function (o) { return opt(o[0], o[1] + (o[2] === 'ATTEMPT' ? '（仍待處理）' : '')); }).join('') + '</select></label>' +
    '<label class="f">聯絡對象<select id="ackw_' + esc(a.alert_id) + '"><option value="">（聯絡過才填）</option>' + opt('PATIENT', '病人本人') + opt('CAREGIVER', '家屬／照顧者') + opt('OTHER_PROVIDER', '其他醫療人員或機構') + '</select></label>' +
    '<label class="f">方式<select id="ackm_' + esc(a.alert_id) + '"><option value="">—</option>' + opt('PHONE', '電話') + opt('FACE_TO_FACE', '當面') + opt('VIDEO', '視訊') + '</select></label>' +
    '<button class="btn small primary" type="button" data-act="ack" data-val="' + esc(a.alert_id) + '">記錄</button>' + (withPatient ? '<button class="btn small" type="button" data-act="open" data-val="' + esc(a.patient_key) + '">開啟病人</button>' : '') + '</div><p id="ackerr_' + esc(a.alert_id) + '" class="small field-err"></p></div>';
}
/* 3.0.0 照護旅程列（每一頁都在最上面）：目前階段、最近的重大事件、下一個到期的事、下次聯絡；由伺服器的同一份計畫推導 */
var EVT_ZH = { MED_CHANGE: '處方改變' };
function journeyHtml() {
  var P = CUR.rec.plan; if (!P || !P.journey) return '';
  var j = P.journey, le = j.last_event, nc = j.next_contact, nx = j.next;
  var leTxt = le ? (le.kind === 'CARE' ? (CE_ZH[le.code] || le.code) : le.kind === 'ALERT' ? '安全警訊（' + ((DICT.route_labels || {})[le.code] || le.code) + '）' : (EVT_ZH[le.code] || le.code)) + ' ' + md(le.at) : '沒有紀錄';
  var w = CUR.rec.view.what_matters;
  return '<section class="panel journey" aria-label="照護旅程"><div class="wm-pin" id="wm_pin"><span class="small muted">病人最在意的事</span><br>' + (w ? '<strong>' + esc(wmText(w)) + '</strong> <span class="small muted">' + esc(srcZh(w.source_type)) + '｜' + esc(d10(w.recorded_at)) + '｜討論治療與行動時，請先回應這一項</span>' : '<span class="small muted">還沒有記錄（可在「本次評估」的病人經驗欄位記下，或請病人用病人連結填寫）</span>') + '</div><div class="jrow">' +
    '<div><span class="small muted">目前階段</span><br><strong>' + esc(j.stage.clin) + '</strong></div>' +
    '<div><span class="small muted">最近的重大事件</span><br>' + esc(leTxt) + '</div>' +
    '<div><span class="small muted">下一個到期</span><br>' + (nx ? esc(nx.clin) + '｜' + esc(md(nx.due_at)) + (nx.overdue ? ' ' + chip('逾期', 'err') : '') + (nx.owner_role ? '｜' + esc(ROLE_ZH[nx.owner_role] || nx.owner_role) : '') : '<span class="muted">沒有有到期日的待辦</span>') + '</div>' +
    '<div><span class="small muted">下次聯絡</span><br>' + (nc.status === 'SCHEDULED' ? esc(nc.clin) + '｜' + esc(md(nc.due_at)) + (nc.overdue ? ' ' + chip('逾期', 'err') : '') : chip('尚未安排', 'warn') + ' <span class="small">' + esc(nc.clin) + '</span>') + '</div>' +
    '<div><span class="small muted">未完成</span><br>' + esc(j.open_n) + ' 項' + (j.overdue_n ? '（逾期 ' + esc(j.overdue_n) + '）' : '') + (j.safety_open_n ? '｜' + chip('警訊 ' + j.safety_open_n, 'err') : '') + '</div></div></section>';
}
/* 3.0.0：已結案的警訊不會從紀錄消失（最近 90 天）：誰、何時、結果 */
function closedAlertsHtml(list) {
  if (!list || !list.length) return '';
  return '<details class="panel small"><summary>最近 90 天已結案的安全警訊（' + list.length + '）</summary><ul>' + list.map(function (a) {
    return '<li>' + esc(d10(a.created_at)) + ' ' + esc(a.route_label) + '：' + (a.history || []).map(function (h) { return esc(d10(h.at)) + ' ' + esc(hm(h.at)) + ' ' + esc(ROLE_ZH[h.provider_role] || h.provider_role || '') + ' ' + esc(h.actor_id || '') + '「' + esc(h.outcome_label) + '」' + (h.contacted_whom ? '（' + esc(ACKW_ZH[h.contacted_whom] || h.contacted_whom) + (h.contact_mode ? '・' + esc(CM_ZH[h.contact_mode] || h.contact_mode) : '') + '）' : ''); }).join('→ ') + '</li>'; }).join('') + '</ul></details>';
}
function safetyHtml(list) {
  if (!list.length) return '';
  return '<section class="panel" aria-labelledby="sa_h"><h2 id="sa_h">尚未結案的安全警訊（' + list.length + '）</h2><p class="small muted">每筆標明來源（病人連結或哪一位醫療人員記錄）。病人連結送來的：病人頁面已提醒「儲存不等於通知」，請依院內流程聯絡並記錄結果；醫療人員當面記錄的：請記錄處置與後續觀察。「聯絡不上」會保留為待處理。</p>' + list.map(function (a) { return alertCard(a, false); }).join('') + '</section>';
}
var ACKW_ZH = { PATIENT: '病人本人', CAREGIVER: '家屬／照顧者', OTHER_PROVIDER: '其他醫療人員或機構' };
function ackAlert(id, after) {
  var sel = $('ack_' + id), v = sel ? sel.value : '';
  if (!v) { inlineErr('ackerr_' + id, '請先選擇處理結果。'); if (sel) sel.focus(); return; }
  var who = $('ackw_' + id) ? $('ackw_' + id).value : '', how = $('ackm_' + id) ? $('ackm_' + id).value : '';
  if ((v === 'CONTACTED_ADVISED' || v === 'ADVISED_ED') && (!who || !how)) { inlineErr('ackerr_' + id, '已聯絡或請病人就醫時，請選「聯絡對象」與「方式」。'); $(who ? 'ackm_' + id : 'ackw_' + id).focus(); return; }
  if (v === 'ALREADY_HANDLED' && (who || how)) { inlineErr('ackerr_' + id, '「已經處理過（重複）」不用填聯絡對象。'); return; }
  call('ackSafetyAlert', [id, v, { contacted_whom: who, contact_mode: how }]).then(function (r) { sync('SAVED', r.status === 'CLOSED' ? '警訊已結案' : '已記錄，仍待處理'); after(); refreshSys(); })
    .catch(function (e) { inlineErr('ackerr_' + id, errText(e)); });
}
function refreshSys() { call('whoAmI').then(function (me) { renderSysbar(me.system); }).catch(function () {}); }
function changesHtml(c) {
  if (!c || c.first_view) return '';
  var f = Object.keys(c.fields || {});
  var parts = [];
  if (f.length) parts.push('欄位 ' + f.map(function (k) { return esc(field(k).label); }).join('、'));
  if (c.by_patient) parts.push('其中 ' + c.by_patient + ' 項來自病人連結');
  if (c.care_events) parts.push('就醫事件 ' + c.care_events + ' 筆');
  if (c.actions) parts.push('行動更新 ' + c.actions + ' 筆');
  if (c.concerns) parts.push('關心的問題更新 ' + c.concerns + ' 筆');
  if (c.alerts) parts.push('新的安全警訊 ' + c.alerts + ' 筆');
  return '<section class="panel"><h2>您上次開啟（' + esc(d10(c.since)) + ' ' + esc(hm(c.since)) + '）之後的變化</h2>' + (parts.length ? '<p>' + parts.join('；') + '</p>' : '<p class="muted">其他人沒有新的紀錄。</p>') + '</section>';
}
function timelineHtml(v) {
  var t = (v.assessment_timeline || []).slice().reverse().slice(0, 8);
  if (!t.length) return '';
  return '<details class="panel"><summary>評估時間軸（最近 ' + t.length + ' 次）</summary><ul>' + t.map(function (a) {
    var rl = (DICT.route_labels || {})[a.route];
    return '<li>' + esc(d10(a.completed_at)) + '　' + esc(ROLE_ZH[a.provider_role] || a.provider_role || '') + '　' + esc(SET_ZH[a.care_setting] || a.care_setting || '') + '　' + esc(a.respondent === 'CAREGIVER' ? '家人代答' : (a.respondent === 'SELF' ? '病人自填' : '醫療人員')) + (a.route && a.route !== 'ROUTINE' ? ' ' + chip(rl || a.route, 'warn') : '') + '</li>'; }).join('') + '</ul></details>';
}
/* 3.2（R-A-009）：客觀數據一覽——醫師與藥師判斷前先看的數字（值、日期、新鮮度、能不能用）；只顯示，不在這裡編輯 */
var OBJ_FIELDS = ['lvef_percent', 'potassium_mmol_l', 'egfr_ml_min', 'sbp_mmhg', 'heart_rate_bpm', 'weight_kg', 'home_weight_kg', 'tsat_percent'];
function objectiveSnapshotHtml(v) {
  var rows = OBJ_FIELDS.filter(function (fid) { return DICT.fields[fid]; }).map(function (fid) {
    var e = v.fields[fid], f = field(fid);
    if ((!e || e.value === null || e.value === undefined) && !(e && e.usability === 'CONFLICTED')) return '<div class="obj" data-fid="' + esc(fid) + '" data-use="MISSING"><span class="obj-l">' + esc(f.label) + '</span><span class="obj-v muted">沒有紀錄</span></div>';
    var USE = { CONFLICTED: ['衝突', 'err'], NEWER_UNVERIFIED: ['有較新未確認值', 'warn'], FUTURE_PENDING: ['日期在未來', 'err'], STALE: ['已過期', 'warn'] }[e.usability];
    var fr = FRESH_ZH[e.freshness] || ['', ''];
    /* 3.4（T02／REG-A-007）：衝突時不顯示任何一個值；較新未確認值另列；最近 3 筆已確認值與乾體重差距只列事實（不標好壞） */
    var extra = '';
    if (e.usability === 'NEWER_UNVERIFIED' && e.newer_lower_tier) extra += '<span class="obj-x small" data-obj-x="newer">較新未確認：' + esc(fmtVal(fid, e.newer_lower_tier.value)) + '（' + esc(md(d10(e.newer_lower_tier.effective_at || e.newer_lower_tier.recorded_at))) + '，' + esc(srcZh(e.newer_lower_tier.source_type)) + '）</span>';
    var rv = (e.recent_verified || []).slice().reverse();
    if (rv.length >= 2) extra += '<span class="obj-x small" data-obj-x="series">已確認：' + rv.map(function (x) { return x.conflicted ? esc(md(x.date)) + ' 衝突' : esc(md(x.date)) + ' ' + esc(fmtVal(fid, x.value)); }).join(' → ') + '</span>';
    var dry = v.fields.dry_weight_kg;
    if ((fid === 'weight_kg' || fid === 'home_weight_kg') && dry && typeof dry.value === 'number' && typeof e.value === 'number' && e.usability !== 'CONFLICTED') { var dd = Math.round((e.value - dry.value) * 10) / 10; extra += '<span class="obj-x small" data-obj-x="dry">與乾體重 ' + esc(dry.value) + ' kg 相差 ' + (dd > 0 ? '+' : '') + esc(dd) + ' kg</span>'; }
    var wch = (v.derived || {}).weight_change_6m_pct;   /* 4.9.3 WP-B2（CARE-RD-01）：伺服器由已記錄體重計算，不手算 */
    if (fid === 'weight_kg' && wch) extra += '<span class="obj-x small" data-obj-x="wchg">' + esc(md(wch.from_date)) + ' 起體重變化 ' + (wch.value > 0 ? '+' : '') + esc(wch.value) + '%（系統計算）</span>';
    return '<div class="obj' + (USE ? ' obj-bad' : '') + '" data-fid="' + esc(fid) + '" data-use="' + esc(e.usability || '') + '"><span class="obj-l">' + esc(f.label) + '</span><span class="obj-v">' + (e.usability === 'CONFLICTED' ? '— <small>（數值衝突，不採用）</small>' : esc(fmtVal(fid, e.value)) + (f.unit && String(fmtVal(fid, e.value)).indexOf(f.unit) < 0 ? ' <small>' + esc(f.unit) + '</small>' : '')) + '</span>' +
      '<span class="obj-m small">' + esc(md(d10(e.effective_at || e.recorded_at))) + '｜' + esc(VER_ZH[e.verification_state] || '') + (USE ? ' ' + chip(USE[0], USE[1]) : (fr[0] ? ' ' + chip(fr[0], fr[1]) : '')) + '</span>' + extra + '</div>';
  });
  /* v4.4 WP-B：BMI——有量測值顯示量測值；沒有時顯示系統推算（體重 ÷ 身高²，標明依據的體重日期）；身高或體重缺 → 寫明缺什麼，不猜 */
  var bm = v.fields.bmi_kg_m2, bd = (v.derived || {}).bmi;
  if (bm && typeof bm.value === 'number') rows.push('<div class="obj" data-fid="bmi" data-use="MEASURED"><span class="obj-l">BMI（量測）</span><span class="obj-v">' + esc(bm.value) + ' <small>kg/m²</small></span><span class="obj-m small">' + esc(md(d10(bm.effective_at || bm.recorded_at))) + '｜' + esc(VER_ZH[bm.verification_state] || '') + '</span></div>');
  else if (bd) rows.push('<div class="obj" data-fid="bmi" data-use="DERIVED"><span class="obj-l">BMI（系統推算）</span><span class="obj-v">' + esc(bd.value) + ' <small>kg/m²</small></span><span class="obj-m small">依 ' + esc(md(d10(bd.effective_at))) + ' 的體重與身高｜' + esc(VER_ZH[bd.verification_state] || '') + '</span></div>');
  else rows.push('<div class="obj" data-fid="bmi" data-use="MISSING"><span class="obj-l">BMI</span><span class="obj-v muted">' + (v.fields.height_cm ? '缺醫療人員量測的體重' : '缺身高（在「檢查與量測」填一次身高，系統會自動推算）') + '</span></div>');
  return '<section class="panel" id="obj_snap"><h2>客觀數值一覽</h2><div class="objgrid">' + rows.join('') + '</div><p class="small muted">要更新請到「本次評估」；未確認或過期的數值不能當作判斷依據。</p></section>';
}
function alertsHtml(v) {
  var items = [];
  v.conflicts.forEach(function (c) { items.push('<li>' + chip('資料衝突', 'err') + esc(field(c.field_id).label) + '：' + esc(CONF_ZH[c.type] || c.type) + '</li>'); });
  (v.medication_discrepancy.items || []).forEach(function (d) { items.push('<li>' + chip('處方與實際使用', 'warn') + esc(ingName(d.ingredient)) + '：' + esc(DISC_ZH[d.kind] || d.kind) + '</li>'); });
  Object.keys(v.actions).forEach(function (k) { var a = v.actions[k]; if (a.overdue) items.push('<li>' + chip('逾期', 'err') + esc(ACT_ZH[a.action_type] || a.action_type) + '（到期 ' + esc(d10(a.due_at)) + '）</li>'); });
  v.episodes.filter(function (e) { return e.index_status === 'MANUAL_REVIEW'; }).forEach(function (e) { items.push('<li>' + chip('住院待確認', 'err') + esc(d10(e.admission_at)) + '–' + esc(d10(e.discharge_at)) + '</li>'); });
  (CUR.rec.parked || []).forEach(function (pk) {
    var done = ST.resolves.indexOf(pk.transaction_id) >= 0;
    items.push('<li>' + chip('因資料在您編輯時已被更新，暫時保留、尚未套用', 'warn') + esc(d10(pk.started_at)) + '　' + esc(pk.actor_id) + '：' +
      pk.observations.map(function (o) { return esc(field(o.field_id).label) + ' ' + esc(o.action_type === 'CONFIRM' ? '（確認）' : fmtVal(o.field_id, o.value)); }).join('、') +
      (pk.care_events.length ? '；就醫事件 ' + pk.care_events.length + ' 筆' : '') + (pk.actions_n + pk.concerns_n + pk.education_n ? '；行動／問題／衛教 ' + (pk.actions_n + pk.concerns_n + pk.education_n) + ' 筆' : '') +
      (done ? ' <span class="small">（已帶入這次變更）</span>' : ' <button class="btn small noprint" type="button" data-act="parked_take" data-val="' + esc(pk.transaction_id) + '">帶入這次變更</button> <button class="btn small noprint" type="button" data-act="parked_drop" data-val="' + esc(pk.transaction_id) + '">捨棄</button>') + '</li>');
  });
  if (v.parallel_truths.length) items.push('<li class="muted small">病人說法與醫療觀察不同（並存，不算衝突）：' + v.parallel_truths.map(function (p) { return esc(field(p.field_id).label); }).join('、') + '</li>');
  return '<section class="panel" id="parked"><h2 id="conflicts">需要注意</h2>' + (items.length ? '<ul>' + items.join('') + '</ul>' : '<p class="muted">目前沒有衝突、差異或逾期項目。</p>') + '</section>';
}
/* ===== v4.9 S3：本次評估＝四區工作台（安全與本次變化／接續／本次需要／收尾）；98 欄完整資料另開「完整資料」分頁 =====
   要問什麼只讀伺服器的評估需要投影（CUR.rec.ask，67_plan shouldAskNow）；畫面不再自己決定。舊伺服器沒有 ask → 沿用 4.4 快速層（相容） */
var DISP_ZH = { ESCALATE_SAFETY: '先處理安全', ASK_NOW: '本次要問', REVIEW_EXISTING: '今天已有紀錄', RESOLVE_CONFLICT: '紀錄衝突，請釐清', ROLE_TASK: '待其他職類', DISPLAY_HISTORY: '沿用中', DOCUMENT_IF_NEEDED: '有資料再記', NOT_APPLICABLE: '不適用', DEFER_WITH_REASON: '輪替：之後再問' };
var REASON_ZH = { EACH_CONTACT: '每次接觸都問', PLAN_LIMITER_MISSING: '照護計畫缺這項資料', PLAN_MISSING: '照護計畫缺這項資料', PLAN_STALE: '照護計畫用到的資料已過期', PLAN_NO_DATE: '照護計畫用到的資料沒有日期', PLAN_BEFORE_MED_CHANGE: '早於改藥', PLAN_BEFORE_DISCHARGE: '早於出院',
  POST_DISCHARGE: '剛出院', MEDICATION_CHANGE: '用藥有改變', COMMUNICATION_NOT_RECORDED: '溝通需要還沒記錄', REASK_BEFORE_ANCHOR: '舊答案仍在影響計畫，請再確認', IN_USE_BUT_STALE: '計畫用到的值已過期', IN_USE_BUT_UNDATED: '計畫用到的值沒有日期', IN_USE_BUT_CONFLICT: '計畫用到的值互相衝突',
  OPEN_SAFETY_ALERT: '有未結安全警訊', SAME_DAY_REFERENCE: '今天其他醫療人員已記錄（引用，不建立新紀錄）', BASELINE_MISSING: '基線資料', INTAKE_MISSING: '病人自述就醫史', MISSING: '缺資料', V4_PREGNANCY_UNKNOWN: '藥物建議需要（懷孕可能未記錄）', SUGGEST_NA_BY_SEX: '生理性別（依病歷）為男：建議記為不適用，按一下確認', ROLE_DOCUMENTED: '由負責職類評估時記錄（不在每次接觸詢問；未記錄不當作「沒有」）', V4_EGFR_MISSING: '藥物建議需要 eGFR', V4_EGFR_STALE: '藥物建議需要較新的 eGFR', V4_POTASSIUM_MISSING: '藥物建議需要血鉀', V4_POTASSIUM_UNVERIFIED: '藥物建議需要已確認的血鉀', V4_PROFILE_UNKNOWN: '需要確認的 LVEF', V4_PREGNANCY_UNSURE: '藥物建議需要（懷孕可能不確定）', SAFETY_FIELD_MISSING: '安全相關，從沒有回答', FIRST_CONTACT_NO_PREVIOUS: '第一次接觸，沒有「上次」', FOLLOW_UP_USES_PREVIOUS: '追蹤改問「和上次比」', PARENT_NOT_POSITIVE: '前一題的回答不需要這一題', PARENT_UNANSWERED: '前一題還沒回答', RULE_NOT_APPLICABLE: '規則不適用', RECORDED_NOT_APPLICABLE: '已記錄不適用', TEACH_BACK_RECORDED_PER_CARD: '在衛教歷程逐卡記錄', BASELINE_ROTATION: '基線資料（輪替中，之後再補問）', BASELINE_ROTATION_REFRESH: '基線資料需更新（輪替中，之後再補問）', USABLE: '沿用中', HISTORY_ONLY: '只供參考（不再可用）', ANSWERED_AFTER_PARENT: '已回答', RESULT_DOCUMENT_WHEN_AVAILABLE: '有結果再記', ROLE_OWNED_NOT_NEEDED_NOW: '目前不需要', NO_DECISION_READER: '目前沒有決策用到' };
function reasonZh(code) { var c = String(code || ''), m = /^(?:ASK_NOW|RESOLVE_CONFLICT):(.*)$/.exec(c); if (m) c = m[1]; var r = /^ROTATION:(.*)$/.exec(c); if (r) return '輪替補問（' + ({ BASELINE_ROTATION: '基線資料', BASELINE_ROTATION_REFRESH: '基線資料需更新' }[r[1]] || REASON_ZH[r[1]] || '基線') + '）';   /* TX-111／112：延後列顯示「之後再補問」，本次要問列只顯示短標 */ var d = /^DEPENDS_ON_PARENT:(.*)$/.exec(c); if (d) return '因為「' + field(d[1]).label + '」的回答'; var k = /^(SAFETY_)?CONFLICT:(.*)$/.exec(c); if (k) return (k[1] ? '安全相關，' : '') + '紀錄互相衝突'; return REASON_ZH[c] || c; }
/* 體重二擇一：電話、視訊取居家體重；其他取院內量測 */
function wbWeightSkip() { return (enc().contact === 'PHONE' || enc().contact === 'VIDEO') ? 'weight_kg' : 'home_weight_kg'; }
function wbAsk() { return (CUR.rec.ask || []).filter(function (a) { return a.field_id !== wbWeightSkip() && DICT.fields[a.field_id]; }); }
function wbFields() { if (CUR.rec.ask_budget) return budgetFields(); return wbAsk().filter(function (a) { return ['ESCALATE_SAFETY', 'ASK_NOW', 'REVIEW_EXISTING', 'RESOLVE_CONFLICT'].indexOf(a.disposition) >= 0; }).map(function (a) { return a.field_id; }); }
function wbRows(list, v) { return '<div class="table-scroll"><table><thead><tr><th scope="col">項目</th><th scope="col">目前</th><th scope="col">臨床日期</th><th scope="col">記錄</th><th scope="col">來源</th><th scope="col">新鮮度</th><th scope="col">這次</th></tr></thead><tbody>' +
  list.map(function (a) { return fieldRow(a.field_id, v.fields[a.field_id], a.disposition === 'ASK_NOW' && a.reason_code === 'EACH_CONTACT', a); }).join('') + '</tbody></table></div>'; }
function sameDayHtml() {
  var P = CUR.rec.plan, sd = P && P.continuity && P.continuity.same_day_contacts || [];
  return sd.length ? '<p class="small" id="same_day">今天其他接觸：' + sd.map(function (x) { return esc(hm(x.at)) + ' ' + esc(ROLE_ZH[x.role] || x.role || '') + (x.contact_mode && CM_ZH[x.contact_mode] ? '（' + esc(CM_ZH[x.contact_mode]) + '）' : ''); }).join('；') + '。他們今天記的核心項目在下方標「今天已有紀錄」，不需要重問。</p>' : '';
}
function continuityZoneHtml() {
  var P = CUR.rec.plan; if (!P) return '';
  var C = P.continuity.clinician, loops = P.continuity.open_loops || [], h = '<section class="panel wb" id="wb_cont"><h3>2　接續</h3>';
  if (!C.anchor) h += '<p class="small muted">第一次接觸：沒有「上次」可接續。</p>';
  else {
    var acts = loops.filter(function (l) { return l.domain === 'ACTION'; });
    h += '<p class="small">上次約定的行動：' + (acts.length ? acts.slice(0, 3).map(function (l) { return esc(l.clin) + '（' + esc(LOOP_ZH[l.status] || l.status) + '）'; }).join('；') : '沒有') + '</p>';
    var taught = (C.closed_since || []).filter(function (c) { return c.kind === 'EDUCATION'; }).map(function (c) { return esc(c.clin); });
    var lrn = (P.learning || []).filter(function (x) { return x.understanding !== 'UNDERSTOOD' || x.reassess; }).slice(0, 3).map(function (x) { return esc(cardTitle(x.card_id)) + '（' + esc(x.reassess ? '到期再確認' : (EDU_ZH[x.understanding] || x.understanding)) + '）'; });
    h += '<p class="small">上次教的主題與理解：' + (taught.concat(lrn).join('；') || '沒有待接續的衛教') + '</p>';
  }
  h += '<p class="small">未結事項（' + loops.length + '）：' + (loops.length ? loops.slice(0, 4).map(function (l) { return esc(l.clin) + (l.owner_role ? '｜' + esc(ROLE_ZH[l.owner_role] || l.owner_role) : '') + (l.overdue ? ' ' + chip('逾期', 'err') : ''); }).join('；') + (loops.length > 4 ? '；另 ' + (loops.length - 4) + ' 項' : '') : '沒有') +
    (loops.length ? ' <button class="btn small noprint" type="button" data-act="ptab" data-val="care">到「就醫與行動」處理或結案</button>' : '') + '</p>';
  var w = CUR.rec.view.what_matters, wm = w && (w.improve || w.worry) ? whatMattersText(w) : '';
  h += '<p class="small">病人最在意的事：' + (wm ? esc(wm) : '未記錄') + '</p>';
  return h + '</section>';
}
function whatMattersText(w) { var L = DICT.what_matters_labels || { improve: {}, worry: {} }, parts = []; if (w.improve) parts.push('最想改善：' + (L.improve[w.improve] || w.improve)); if (w.worry) parts.push('最擔心：' + (L.worry[w.worry] || w.worry)); return parts.join('；'); }
/* ===== 5.0 W5-C：三層題目預算（K07-01～K07-05）、接續摘要（K09-01）、久未聯絡（K09-02） =====
   要問什麼、幾題都只讀伺服器的題目預算（CUR.rec.ask_budget）；畫面不自行重算題數（K11-03） */
var W5C_EXTRA_ZH = { OPEN_SAFETY_ALERT: '有尚未結案的安全警訊', TODAY_SIGNAL_POSITIVE: '今日警訊有勾選', PATIENT_RAISED: '病人連結最近回報警訊或變差', WORSENING_REPORTED: '最近回報病況變差', RECENT_DISCHARGE: '近期出院或住院中', LAB_ABNORMAL: '檢驗結果超過提示門檻或持續上升', SAFETY_REQUIRED: '安全必要項目' };
var W5C_CHG_ZH = { CHANGED: ['有變化', 'warn'], CONFIRMED_UNCHANGED: ['已確認沒有變', 'ok'], NO_NEW_DATA: ['沒有新資料', ''], NOT_ASKED: ['本次未問', ''] };
var W5C_OTHER_ZH = { DEATH_VERIFIED: '已核實死亡：不列為本次要問', OTHER_ROLE_CORE: '其他職類的本職核心', NO_CONSUMER: '目前沒有規則用到', OVER_BUDGET: '超出這次的題數目標', ROTATION_NEXT_TIME: '輪替：下次再問', DEFERRED_ROTATION: '輪替：之後再問', SAME_DAY_REFERENCE: '今天其他醫療人員已記錄', PARENT_NOT_ASKED: '前一題這次沒有問' };
var W5C_SINCE_ZH = { CARE: '就醫', ALERT: '警訊', MED_CHANGE: '調藥', LAB: '檢驗' };
var W5C_RV_ZH = { LONG_GAP: '距上次醫療人員接觸已超過 ', CROSS_FACILITY: '上次接觸在其他院所（跨院所承接）' };
function budgetItems() { var B = CUR.rec.ask_budget; return [].concat(B.core, B.role, B.dynamic, B.extra); }
function budgetFields() {
  var B = CUR.rec.ask_budget, ws = wbWeightSkip(), out = [];
  budgetItems().forEach(function (it) { it.field_ids.forEach(function (f) { out.push(f); }); });
  (B.conditional || []).forEach(function (c) { out.push(c.field_id); }); (B.other || []).forEach(function (o) { out.push(o.field_id); });
  out = out.concat(ask51Fields());   /* 5.1 W51-ASK：一鍵確認的欄位改填時留在本次評估頁 */
  return out.filter(function (f) { return f !== ws && DICT.fields[f]; });
}
function askOf(fid) { return (CUR.rec.ask || []).filter(function (a) { return a.field_id === fid; })[0] || { field_id: fid, disposition: '', reason_code: '' }; }
function wbRemote() { return ['PHONE', 'VIDEO'].indexOf(enc().contact) >= 0; }   /* 5.2 C-02：電話／視訊接觸 */
function budgetRows(items, v) {
  var ws = wbWeightSkip(), rows = [], rem = wbRemote();
  items.forEach(function (it) {
    if (it.state === 'READONLY_TODAY') return;   /* 5.2 C-02：今天已有醫療人員逐項詢問的今日警訊（唯讀職類）→ 只顯示在預填區 */
    var fids = it.field_ids.length > 1 && it.key === 'WEIGHT' ? it.field_ids.filter(function (f) { return f !== ws; }) : it.field_ids;
    var why = it.why + (rem && it.remote_optional ? '（電話／視訊：只問病人居家量測，可略）' : '');
    fids.forEach(function (f) { if (!DICT.fields[f]) return; rows.push(fieldRow(f, v.fields[f], it.layer === 'core' && !(rem && it.remote_optional), Object.assign({}, askOf(f), { why_budget: why, extra_reason: it.extra_reason || '', layer: it.layer, conditional: it.conditional, suggested: it.suggested, remote_optional: !!(rem && it.remote_optional) }))); });
  });
  return rows.length ? '<div class="table-scroll"><table><thead><tr><th scope="col">項目</th><th scope="col">目前</th><th scope="col">臨床日期</th><th scope="col">記錄</th><th scope="col">來源</th><th scope="col">新鮮度</th><th scope="col">這次</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : '';
}
function condRows(v) {
  var B = CUR.rec.ask_budget, rows = (B.conditional || []).map(function (c) { return fieldRow(c.field_id, v.fields[c.field_id], false, Object.assign({}, askOf(c.field_id), { conditional: { field_id: c.parent, when_any: c.when_any || [] }, layer: 'conditional' })); });
  return rows.length ? '<div class="table-scroll" id="wb_cond"><table><tbody>' + rows.join('') + '</tbody></table></div>' : '';
}
function sinceHtml() {
  var B = CUR.rec.ask_budget, S = B.since || {};
  if (S.first) return '<p class="small muted" id="wb_since">第一次接觸：沒有「上次」可比較。</p>';
  var h = '<div id="wb_since" class="small"><p><strong>' + (S.same_day ? '自今天 ' + esc(hm(S.anchor_at)) + ' ' + esc(ROLE_ZH[S.role] || S.role || '') + '記錄以來的變化：' : '自上次（' + esc(md(S.anchor_day)) + (S.days_ago !== null && S.days_ago !== undefined ? '，' + S.days_ago + ' 天前' : '') + '，' + esc(ROLE_ZH[S.role] || S.role || '') + '）以來的變化：') + '</strong>';
  if (!S.changed_n) h += '<span id="wb_nochange">沒有變化</span></p>';
  else h += '</p><ul id="wb_changed">' + S.changed.map(function (c) { return '<li>' + esc(field(c.field_id).label) + '：' + esc(c.before === null || c.before === undefined ? '（之前沒有紀錄）' : fmtVal(c.field_id, c.before)) + ' → ' + esc(fmtVal(c.field_id, c.after)) + '（' + esc(md(c.day)) + '，' + esc(c.by_patient_link ? '病人連結' : (ROLE_ZH[c.role] || c.role || '')) + '）</li>'; }).join('') + (S.changed_n > S.changed.length ? '<li>另 ' + (S.changed_n - S.changed.length) + ' 項（完整資料分頁）</li>' : '') + '</ul>';
  var st = S.states || {}, chips = budgetItems().map(function (it) { var z = W5C_CHG_ZH[st[it.field_id]] || ['', '']; return esc(field(it.field_id).label) + (z[0] ? ' ' + chip(z[0], z[1]) : ''); });
  h += '<p data-since="ask">本次要問：' + (chips.join('、') || '沒有') + '</p>';
  if ((S.not_asked || []).length) h += '<p class="muted" data-since="not_asked">本次未問（收在「其他」，需要時展開）：' + S.not_asked.slice(0, 8).map(function (f) { return esc(field(f).label); }).join('、') + (S.not_asked.length > 8 ? '等 ' + S.not_asked.length + ' 項' : '') + '</p>';
  return h + '</div>';
}
function prefillHtml() {
  var B = CUR.rec.ask_budget, P = B.prefill || {}, items = (P.items || []).filter(function (x) { return DICT.fields[x.field_id]; }), h = '';
  if (items.length) {
    var pending = items.filter(function (x) { var o = ST.obs[x.field_id]; return !(o && o.qualifiers && o.qualifiers.patient_prefill_of === x.event_id); });
    h += '<div class="notice" id="wb_prefill"><p class="small"><strong>病人先填</strong>（病人連結，' + P.window_days + ' 天內）：' + items.map(function (x) { return esc(field(x.field_id).label) + '：' + esc(fmtVal(x.field_id, x.value)) + '（病人自述 ' + esc(md(x.day)) + '）'; }).join('；') + '</p>' +
      (pending.length ? '<button class="btn small noprint" type="button" data-act="prefill_ok">確認病人自述（' + pending.length + ' 項）</button> <span class="small muted">確認後來源仍記為病人自述，日期為病人填寫的日期。</span>' : '<p class="small">' + chip('已帶入這次變更', 'ok') + '</p>') + '</div>';
  }
  if (P.signals) h += '<p class="small" id="wb_prefill_signals">病人 ' + esc(md(P.signals.day)) + ' 在病人連結勾選的今日警訊：' + esc(Array.isArray(P.signals.value) && P.signals.value.length ? fmtVal('safety_signals', P.signals.value) : '都沒有') + '（只供參考；今日警訊要當次逐項詢問，不能沿用）。</p>';
  return h;
}
function stagePatientPrefill() {
  var B = CUR.rec.ask_budget; if (!B) return;
  ((B.prefill || {}).items || []).forEach(function (x) {
    if (!DICT.fields[x.field_id] || ST.obs[x.field_id] || !fieldAuthorized(x.field_id)) return;
    var e = CUR.rec.view.fields[x.field_id];
    ST.obs[x.field_id] = { field_id: x.field_id, action_type: 'UPDATE', value: x.value, source_type: x.source_type, effective_at: d10(x.effective_at || x.recorded_at), qualifiers: { patient_prefill_of: x.event_id }, label: 'UPDATE', client_observed_old_value: e ? e.value : null };
  });
  afterStage();
}
function bulkHtml() {
  var B = CUR.rec.ask_budget, bc = B.bulk_confirm || { fields: [], excluded: [] };
  var todo = bc.fields.filter(function (f) { return DICT.fields[f] && !ST.obs[f] && fieldAuthorized(f); });
  if (!bc.fields.length) return '';
  return '<div class="row noprint" id="wb_bulk"><button class="btn small" type="button" data-act="bulk_ok"' + (todo.length ? '' : ' disabled') + '>本職欄位沒有變化（確認）</button><span class="small muted">只確認：' + bc.fields.map(function (f) { return esc(field(f).label); }).join('、') +
    (bc.excluded.length ? '。不含（要逐項確認）：' + bc.excluded.map(function (x) { return esc(field(x.field_id).label); }).join('、') : '') + '。</span></div>';
}
function stageBulk() {
  var B = CUR.rec.ask_budget; if (!B) return;
  (B.bulk_confirm.fields || []).forEach(function (fid) {
    if (!DICT.fields[fid] || ST.obs[fid] || !fieldAuthorized(fid)) return;
    var f = field(fid), e = CUR.rec.view.fields[fid]; if (f.reuse_policy === 'ALWAYS_REASSESS' || !e) return;
    var src = allowedSources(f).indexOf(e.source_type) >= 0 ? e.source_type : allowedSources(f)[0];
    ST.obs[fid] = { field_id: fid, action_type: 'CONFIRM', source_type: src, label: 'CONFIRM', qualifiers: { bulk_confirm: true }, client_observed_old_value: e.value };
  });
  afterStage();
}
function reviewHtml() {
  var R = CUR.rec.long_gap_review; if (!R || !R.triggered) return '';
  var why = R.reasons.map(function (r) { return r === 'LONG_GAP' ? W5C_RV_ZH.LONG_GAP + R.limit_days + ' 天（' + R.gap_days + ' 天）' : W5C_RV_ZH[r] || r; }).join('；');
  var F = R.fields || {}, h = '<section class="panel wb" id="wb_review"><h3>完整重新檢視</h3><p class="small">' + chip('請完整重新檢視', 'warn') + ' ' + esc(why) + '。舊結論不自動沿用：下列舊目標與舊待辦請逐項確認仍適用，或記為已不適用並選理由。</p>' +
    '<p class="small muted">欄位依各自的用途時效判斷：每次重問 ' + (F.EXPIRED || []).length + ' 項（失效）、限時資料過期 ' + (F.STALE || []).length + ' 項、長期歷史 ' + (F.LONG_TERM_HISTORY || []).length + ' 項（仍可參考，請確認）。</p><ul>';
  var RES = (DICT.resolution_codes || []).filter(function (c) { return ['NOT_NEEDED', 'DONE_ELSEWHERE', 'TRANSFERRED', 'PATIENT_DECLINED', 'CONTRAINDICATED', 'OTHER'].indexOf(c[0]) >= 0; });
  (R.items || []).forEach(function (it) {
    var key = it.kind + ':' + it.ref, lab = it.kind === 'ACTION' ? actName(CUR.rec.view.actions[it.ref] || it) + '（' + (AST_ZH[it.status] || it.status) + '）' : it.kind === 'CONCERN' ? ((DICT.concern_labels || {})[it.concern_code] || it.concern_code) : '病人最在意的事：' + whatMattersText({ improve: it.improve, worry: it.worry });
    var stagedA = it.kind === 'ACTION' && ST.ac.some(function (a) { return a.action_id === it.ref; }), stagedC = it.kind === 'CONCERN' && ST.co.some(function (c) { return c.concern_id === it.ref; });
    var done = stagedA || stagedC ? chip('已加入這次變更', 'ok') : enc().rv[key] ? chip('本次確認仍適用', 'ok') : '';
    var ctl = done ? done : '<button class="btn small noprint" type="button" data-act="rv_keep" data-val="' + esc(key) + '">仍適用</button> ' +
      (it.kind === 'ACTION' ? '<select id="rvr_' + esc(it.ref) + '" aria-label="已不適用的理由"><option value="">已不適用的理由</option>' + RES.map(function (c) { return opt(c[0], c[1]); }).join('') + '</select> <button class="btn small noprint" type="button" data-act="rv_drop" data-val="' + esc(key) + '">已不適用</button>' :
        it.kind === 'CONCERN' ? '<button class="btn small noprint" type="button" data-act="rv_drop" data-val="' + esc(key) + '">已不適用（記為已解決）</button>' : '<button class="btn small noprint" type="button" data-act="edit" data-val="what_matters_improve">需要更新</button>');
    h += '<li class="small" data-rv="' + esc(key) + '">' + esc(lab) + (it.since_day ? '<span class="muted">（' + esc(md(it.since_day)) + ' 起）</span>' : '') + ' ' + ctl + '<span class="field-err" id="rverr_' + esc(it.ref) + '"></span></li>';
  });
  return h + ((R.items || []).length ? '' : '<li class="small muted">沒有舊目標或未結待辦。</li>') + '</ul></section>';
}
function reviewKeep(key) {
  var i = key.indexOf(':'), kind = key.slice(0, i), ref = key.slice(i + 1);
  if (kind === 'ACTION' && CUR.rec.view.actions[ref]) { ST.ac.push({ action_id: ref, action_status: CUR.rec.view.actions[ref].action_status, change_reason: 'CONTINUE_AFTER_LONG_GAP' }); afterStage(); return; }
  enc().rv[key] = 1; renderPatient();
}
function reviewDrop(key) {
  var i = key.indexOf(':'), kind = key.slice(0, i), ref = key.slice(i + 1);
  if (kind === 'ACTION') { var sel = $('rvr_' + ref); if (!sel || !sel.value) { inlineErr('rverr_' + ref, '請先選已不適用的理由。'); if (sel) sel.focus(); return; } ST.ac.push({ action_id: ref, action_status: 'CANCELED', resolution_code: sel.value }); afterStage(); return; }
  if (kind === 'CONCERN') { ST.co.push({ concern_id: ref, status: 'RESOLVED' }); afterStage(); }
}
/* 5.2 C-01：今日警訊今天稍早已由醫療人員逐項詢問 → 預填＋一鍵確認（寫入新的一筆，值相同，稽核 SAME_DAY_CONFIRMED）；有變化就改填 */
function sameDaySignalHtml(B) {
  var it = (B.core || []).filter(function (x) { return x.key === 'TODAY_SIGNALS' && x.same_day_ref; })[0]; if (!it) return '';
  var r = it.same_day_ref, o = ST.obs.safety_signals, done = o && o.qualifiers && o.qualifiers.same_day_confirm_of === r.event_id;
  return '<div class="notice" id="wb_sd_signals" data-event="' + esc(r.event_id) + '"><p class="small"><strong>今日警訊：今天 ' + esc(hm(r.at)) + ' ' + esc(ROLE_ZH[r.role] || r.role || '醫療人員') + '已逐項詢問</strong>：' + esc(r.value.length ? fmtVal('safety_signals', r.value) : '都沒有') + '。請和病人確認現在是否有新的狀況。</p>' +
    (done ? '<p class="small">' + chip('已確認沒有變化（這次記錄）', 'ok') + ' <button class="btn small noprint" type="button" data-act="sd_sig_undo">取消</button></p>'
      : '<div class="row noprint"><button class="btn small primary" type="button" data-act="sd_sig_ok">確認沒有變化</button><button class="btn small" type="button" data-act="edit" data-val="safety_signals">有變化，改填</button></div>') + '</div>';
}
function sameDaySignalAct(act) {
  var B = CUR && CUR.rec && CUR.rec.ask_budget, it = B ? (B.core || []).filter(function (x) { return x.key === 'TODAY_SIGNALS' && x.same_day_ref; })[0] : null; if (!it) return false;
  var r = it.same_day_ref;
  if (act === 'sd_sig_ok') { ST.obs.safety_signals = { field_id: 'safety_signals', action_type: 'UPDATE', value: r.value.slice(), source_type: 'CLINICIAN_OBSERVED', label: 'UPDATE', qualifiers: r.value.length ? { same_day_confirm_of: r.event_id } : { same_day_confirm_of: r.event_id, none_asked: true } }; afterStage(); return true; }
  if (act === 'sd_sig_undo') { var o = ST.obs.safety_signals; if (o && o.qualifiers && o.qualifiers.same_day_confirm_of) delete ST.obs.safety_signals; afterStage(); return true; }
  return false;
}
function handoffHtml() {
  var S = CUR.rec.handoff_summary; if (!S) return '';
  var h = '<section class="panel" id="handoff" aria-label="接續摘要"><h3>接續摘要</h3>';
  if (S.first || !S.last) return h + '<p class="small muted">還沒有醫療人員接觸紀錄（第一次接觸）。</p></section>';
  /* 5.2 C-01：今天已接觸的職類與時間 */
  if ((S.today || []).length) h += '<p class="small" id="handoff_today"><strong>今天已接觸：</strong>' + S.today.map(function (c) { return esc(hm(c.at)) + ' ' + esc(ROLE_ZH[c.role] || c.role || '') + (c.contact_mode && CM_ZH[c.contact_mode] ? '（' + esc(CM_ZH[c.contact_mode]) + '）' : '') + (c.restricted ? '（內容限該職類查看）' : ''); }).join('、') + '。</p>';
  var cnt = {}; (S.since_events || []).forEach(function (e) { cnt[e.kind] = (cnt[e.kind] || 0) + 1; });
  h += '<p class="small" id="handoff_last">上次醫療人員接觸：' + (S.last.same_day ? '今天 ' + esc(hm(S.last.at)) + '（' + esc(ROLE_ZH[S.last.role] || S.last.role) + '，今天第一位）' : esc(md(S.last.day)) + '（' + S.last.days_ago + ' 天前，' + esc(ROLE_ZH[S.last.role] || S.last.role) + '）') + '。自上次以來：' +
    (S.since_n ? ['CARE', 'ALERT', 'MED_CHANGE', 'LAB'].filter(function (k) { return cnt[k]; }).map(function (k) { return W5C_SINCE_ZH[k] + ' ' + cnt[k] + ' 筆'; }).join('、') : '沒有新的就醫、警訊、調藥或檢驗紀錄') + '。</p>';
  h += '<details class="small" id="handoff_more"><summary>各職類最近一次接觸（' + S.contacts.length + '）與自上次以來的事件</summary><ul id="handoff_roles">' + S.contacts.map(function (c) {
    var head = esc(ROLE_ZH[c.role] || c.role) + '　' + esc(md(c.day)) + '（' + c.days_ago + ' 天前）';
    if (c.restricted) return '<li data-role="' + esc(c.role) + '" data-restricted="1">' + head + '：有紀錄（內容限該職類查看）</li>';
    var did = [c.did.observations ? '記錄 ' + c.did.observations + ' 項' + (c.did.groups.length ? '（' + c.did.groups.map(function (g) { return GROUP_ZH[g] || g; }).join('、') + '）' : '') : '', c.did.education ? '衛教 ' + c.did.education + ' 項' : '', c.did.actions ? '建立待辦 ' + c.did.actions + ' 項' : ''].filter(Boolean).join('、') || '只記錄評估';
    return '<li data-role="' + esc(c.role) + '">' + head + (c.backfilled ? ' ' + chip('補登', '') : '') + '：' + esc(did) + (c.todos.length ? '；留下待辦：' + c.todos.map(function (t) { return esc(ACT_ZH[t.action_type] || t.action_type) + '（' + esc(AST_ZH[t.status] || t.status) + (t.due_at ? '，' + esc(md(t.due_at)) + ' 前' : '') + '）'; }).join('、') : '') + '</li>';
  }).join('') + '</ul>' + (S.since_events.length ? '<p>自上次以來的事件：' + S.since_events.map(function (e) { return esc(W5C_SINCE_ZH[e.kind] || e.kind) + ' ' + esc(md(e.day)) + (e.kind === 'CARE' ? '（' + esc(CE_ZH[e.code] || e.code) + '）' : e.kind === 'LAB' ? '（' + esc(field(e.code).label) + '）' : ''); }).join('、') + '</p>' : '') + '</details>';
  return h + '</section>';
}
function assessHtmlBudget(v) {
  var B = CUR.rec.ask_budget, openN = ((CUR.rec.plan && CUR.rec.plan.continuity.open_loops) || []).length, q = (CUR.otherQ || '').toLowerCase();
  /* 5.2 D-06：本職紀錄區（處置與評估結果；不計題數）——已在安全核心、本職核心、動態、加問的不重複 */
  var shownF = {}; [B.core, B.role, B.dynamic, B.extra].forEach(function (l) { (l || []).forEach(function (it) { (it.field_ids || []).forEach(function (f) { shownF[f] = 1; }); }); });
  var recF = (CUR.rec.role_record || []).filter(function (f) { return DICT.fields[f] && !shownF[f]; }), recSet = {}; recF.forEach(function (f) { recSet[f] = 1; });
  var other = (B.other || []).filter(function (o) { return DICT.fields[o.field_id] && o.field_id !== wbWeightSkip() && !recSet[o.field_id]; });
  var otherShown = other.filter(function (o) { return !q || (field(o.field_id).label + ' ' + o.field_id).toLowerCase().indexOf(q) >= 0; });
  var h = '<section class="panel" id="wb"><h2>本次評估</h2><div class="row" id="ctx_top">' + ctxSelectsHtml() + '</div>' +
    '<p class="small muted" id="wb_counts" data-ask-total="' + (wbRemote() && typeof B.ask_total_remote === 'number' ? B.ask_total_remote : B.ask_total) + '" data-extra-total="' + (wbRemote() && typeof B.extra_total_remote === 'number' ? B.extra_total_remote : B.extra_total) + '">本次需要 ' + (wbRemote() && typeof B.ask_total_remote === 'number' ? B.ask_total_remote + ' 項（電話／視訊：量測項目只問病人居家量測，可略）' : B.ask_total + ' 項') + '（安全核心 ' + B.core.length + '＋本職核心 ' + B.role.length + '＋本次動態 ' + B.dynamic.length + '）' +
    (B.extra_total ? '；另加問 ' + (wbRemote() && typeof B.extra_total_remote === 'number' ? B.extra_total_remote : B.extra_total) + ' 項（安全需要，不受題數目標限制）' : '') + '／未結 ' + openN + ' 項。其他 ' + B.other_count + ' 項收在「其他（按需展開）」，也可到「所有欄位」搜尋。</p>';
  if (B.closed_for && B.closed_for.reason === 'DEATH_VERIFIED') h += '<p class="notice" id="wb_closed">已核實死亡（' + esc(md(B.closed_for.date)) + '）：不再列出一般評估題（今日警訊、和上次比、體重與症狀）。需要時在本職紀錄區記錄去顫器處理或家屬關懷；更正紀錄請用「其他」。</p>';   /* 5.2 獨立驗證（G-01 延伸） */
  h += reviewHtml();
  h += ask51ConfirmHtml(v);   /* 5.1 W51-ASK：一鍵確認（不算在本次需要） */
  h += '<section class="panel wb" id="wb_safety"><h3>安全核心（每次必問）</h3>' + anchorHtml(v) + sameDayHtml() + sinceHtml() + prefillHtml() + sameDaySignalHtml(B) + budgetRows(B.core, v) + '</section>';
  h += '<section class="panel wb" id="wb_role"><h3>本職核心（' + esc(ROLE_ZH[B.role_code] || B.role_code || '') + '）</h3>' + (B.role.length ? bulkHtml() + budgetRows(B.role, v) : '<p class="small muted">這個職類沒有設定本職核心題。</p>') + '</section>';
  h += '<section class="panel wb" id="wb_need"><h3>本次動態（' + B.dynamic.length + '）</h3>' + (B.dynamic.length ? budgetRows(B.dynamic, v) : '<p class="small" id="wb_none">本次沒有其他需要補問的項目（0 項）。</p>') + condRows(v) + '</section>';
  if (recF.length) h += '<details class="panel wb" id="wb_record"' + (recF.some(function (f) { return f === CUR.editing || !!ST.obs[f]; }) || !CUR.recClosed ? ' open' : '') + '><summary>本職紀錄區（' + esc(ROLE_ZH[B.role_code] || B.role_code || '') + '：評估結果與處置，不計題數）' + recF.length + ' 項</summary><div class="table-scroll"><table><tbody>' +
    recF.map(function (f) { return fieldRow(f, v.fields[f], false, Object.assign({}, askOf(f), { layer: 'record' })); }).join('') + '</tbody></table></div></details>';
  if (B.extra.length) h += '<section class="panel wb" id="wb_extra"><h3>加問（安全需要，' + B.extra.length + '）</h3><p class="small">' + esc(Array.from(new Set(B.extra.map(function (x) { return W5C_EXTRA_ZH[x.extra_reason] || x.extra_reason; }))).join('、')) + '：這些題目不受題數目標限制，請逐項確認。</p>' + budgetRows(B.extra, v) + '</section>';
  var openOther = !!q || other.some(function (o) { return o.field_id === CUR.editing || !!ST.obs[o.field_id]; });
  h += '<details id="wb_over"' + (openOther ? ' open' : '') + '><summary>其他（按需展開）' + other.length + ' 項</summary><div class="row noprint"><label class="f">搜尋<input id="wb_other_q" type="search" value="' + esc(CUR.otherQ || '') + '" placeholder="欄位名稱"></label></div>' +
    (otherShown.length ? '<div class="table-scroll"><table><tbody>' + otherShown.map(function (o) { return fieldRow(o.field_id, v.fields[o.field_id], false, Object.assign({}, askOf(o.field_id), { why_budget: W5C_OTHER_ZH[o.other_reason] || '', layer: 'other' })); }).join('') + '</tbody></table></div>' : '<p class="small muted">沒有符合的欄位。</p>') + '</details>';
  if ((B.role_tasks || []).length) h += '<p class="small muted" id="quick_other_role">需由其他職類設定（不佔這裡的題數）：' + B.role_tasks.map(function (a) { return esc(field(a.field_id).label) + '（待' + esc((a.roles || []).map(function (r) { return ROLE_ZH[r] || r; }).join('、')) + '設定）'; }).join('；') + '</p>';
  h += continuityZoneHtml();
  h += closingZoneHtml();
  if (enc().contact === 'PHONE') h += '<div id="phone_handoff"><h3>電話追蹤：需要其他職類接手時，在這裡建立交接</h3>' + newActionHtml(true) + '</div>';
  return h + '</section>';
}
function assessHtml(v) {
  if (!CUR.rec.ask) return assessHtmlLegacy(v);
  if (CUR.rec.ask_budget) return assessHtmlBudget(v);   /* 5.0 W5-C：三層題目預算（伺服器失敗時沿用下方 4.9 工作台） */
  /* 1 區＝安全欄位＋本次變化（和平常比／和上次比／上次之後急診住院），固定順序：警訊 → 變化 → 症狀 → 體重 → 血壓心跳 → NYHA */
  var ask = wbAsk(), safety = ask.filter(function (a) { return ZONE1.indexOf(a.field_id) >= 0 && ['ESCALATE_SAFETY', 'ASK_NOW', 'RESOLVE_CONFLICT', 'REVIEW_EXISTING'].indexOf(a.disposition) >= 0; })
    .sort(function (a, b) { return ZONE1.indexOf(a.field_id) - ZONE1.indexOf(b.field_id); });
  var sIds = safety.map(function (a) { return a.field_id; });
  var need = ask.filter(function (a) { return sIds.indexOf(a.field_id) < 0 && ['ASK_NOW', 'REVIEW_EXISTING', 'RESOLVE_CONFLICT'].indexOf(a.disposition) >= 0 && !a.over_cap; });
  var over = ask.filter(function (a) { return a.disposition === 'ASK_NOW' && a.over_cap; }), roleT = ask.filter(function (a) { return a.disposition === 'ROLE_TASK'; }), defer = ask.filter(function (a) { return a.disposition === 'DEFER_WITH_REASON'; });
  var openN = ((CUR.rec.plan && CUR.rec.plan.continuity.open_loops) || []).length;
  var h = '<section class="panel" id="wb"><h2>本次評估</h2><div class="row" id="ctx_top">' + ctxSelectsHtml() + '</div><p class="small muted" id="wb_counts">本次需要 ' + (safety.length + need.length + over.length) + ' 項／未結 ' + openN + ' 項。其他欄位都在「所有欄位」分頁（可搜尋），沒有變的不用填。</p>';
  h += '<section class="panel wb" id="wb_safety"><h3>1　安全與本次變化</h3>' + anchorHtml(v) + sameDayHtml() + (safety.length ? wbRows(safety, v) : '<p class="small muted">沒有需要處理的安全項目。</p>') + '</section>';
  h += continuityZoneHtml();
  h += '<section class="panel wb" id="wb_need"><h3>3　本次需要（' + (need.length + over.length) + '）</h3>' + (need.length ? wbRows(need, v) : '<p class="small" id="wb_none">本次沒有其他需要補問的項目（0 項）。</p>') +
    (over.length ? '<details id="wb_over"' + (over.some(function (a) { return a.field_id === CUR.editing || !!ST.obs[a.field_id]; }) ? ' open' : '') + '><summary>另有 ' + over.length + ' 項超出這次的名額（原因：' + esc(Array.from(new Set(over.map(function (a) { return reasonZh(a.reason_code); }))).join('、')) + '）</summary>' + wbRows(over, v) + '</details>' : '') +
    (roleT.length ? '<p class="small muted" id="quick_other_role">需由其他職類設定（不佔這裡的名額）：' + roleT.map(function (a) { return esc(field(a.field_id).label) + '（待' + esc((a.roles || []).map(function (r) { return ROLE_ZH[r] || r; }).join('、')) + '設定）'; }).join('；') + '</p>' : '') +
    (defer.length ? '<p class="small muted" id="wb_defer">輪替：另有 ' + defer.length + ' 項基線資料之後的接觸再問（未回答不算「沒有」）。</p>' : '') + '</section>';
  h += closingZoneHtml();
  if (enc().contact === 'PHONE') h += '<div id="phone_handoff"><h3>電話追蹤：需要其他職類接手時，在這裡建立交接</h3>' + newActionHtml(true) + '</div>';
  return h + '</section>';
}
var ZONE1 = ['safety_signals', 'recent_change_usual', 'recent_change_previous', 'interval_acute_care', 'interval_acute_hf_related', 'symptom_status', 'rest_dyspnea', 'orthopnea_status', 'pnd_status', 'home_weight_kg', 'weight_kg', 'sbp_mmhg', 'heart_rate_bpm', 'nyha_class'];
function closingZoneHtml() {
  var P = CUR.rec.plan; if (!P) return '';
  if (leafV5On()) return leafClosingHtml();   /* 5.1 W51-LEAF（NU-17）：用新版單張的病人，收尾區讀單張同一份資料（v5.today） */
  var tt = (P.teach_targets || []).slice(0, 2), nq = (P.next_visit_questions || []).slice(0, 3);
  return '<section class="panel wb" id="wb_close"><h3>4　收尾</h3><p class="small">本次行動：在下方「這次的變更」確認後儲存；需要交接時到「就醫與行動」。</p>' +
    '<p class="small" id="wb_teach">衛教主題（0–2 個）：' + (tt.length ? tt.map(function (id) { return esc(cardTitle(id)); }).join('、') + ' <button class="btn small noprint" type="button" data-act="ptab" data-val="edu">到「衛教歷程」記錄理解程度</button>' : '這次沒有建議新的衛教主題') + '</p>' +
    '<p class="small" id="wb_next">下次確認的事：' + (nq.length ? nq.map(function (id) { return esc(cardTitle(id)); }).join('、') : '沒有') + '</p></section>';
}
/* 完整資料／歷程：98 欄可搜尋、依領域篩選；有權限可編輯或更正，沒有權限唯讀並顯示負責職類 */
function dataHtml(v) {
  var q = CUR.dataQ || '', g0 = CUR.dataG || '', byG = {};
  Object.keys(DICT.fields).forEach(function (fid) { var f = DICT.fields[fid]; if (!f.clinician_editable || fid === 'prescribed_meds') return;
    if (sunsetHidden(fid) && !(v.fields[fid] && v.fields[fid].value !== null && v.fields[fid].value !== undefined)) return;   /* 5.2 D-08：退場欄位沒有舊值就不列 */
    if (q && (f.label + ' ' + fid).toLowerCase().indexOf(q.toLowerCase()) < 0) return; if (g0 && f.group !== g0) return; (byG[f.group] = byG[f.group] || []).push(fid); });
  var ask = {}; (CUR.rec.ask || []).forEach(function (a) { ask[a.field_id] = a; });
  var need = CUR.rec.ask_budget ? CUR.rec.ask_budget.ask_total : (CUR.rec.ask || []).filter(function (a) { return ['ESCALATE_SAFETY', 'ASK_NOW', 'RESOLVE_CONFLICT'].indexOf(a.disposition) >= 0; }).length, openN = ((CUR.rec.plan && CUR.rec.plan.continuity.open_loops) || []).length;
  var h = '<section class="panel" id="data_all"><h2>完整資料（' + Object.keys(DICT.fields).length + ' 欄）</h2><p class="small muted">本次需要 ' + need + ' 項／未結 ' + openN + ' 項。這裡列出所有欄位，用來查閱、補記或更正；不需要填滿。</p>' +
    '<div class="row noprint"><label class="f">搜尋<input id="data_q" type="search" value="' + esc(q) + '" placeholder="欄位名稱"></label><label class="f">領域<select id="data_g"><option value="">全部</option>' + GROUP_ORDER.map(function (g) { return opt(g, GROUP_ZH[g] || g, g === g0); }).join('') + '</select></label></div>';
  var any = false;
  GROUP_ORDER.forEach(function (g) {
    if (!byG[g]) return; any = true;
    var og = (CUR.openGroups || {})[g], mine = byG[g].some(function (fid) { var fa = ((ME.role_policy || {}).field_authority || {})[fid]; return !!fa && fa.indexOf(ME.role) >= 0; });   /* 4.9.3 WP-B2：本人職類負責的欄位所在分組預設展開 */
    var open = !!q || !!g0 || byG[g].indexOf(CUR.editing) >= 0 || byG[g].some(function (fid) { return !!ST.obs[fid]; }) || (og === undefined ? mine : og);
    h += '<details data-group="' + esc(g) + '"' + (open ? ' open' : '') + (mine ? ' data-mine="1"' : '') + '><summary>' + esc(GROUP_ZH[g] || g) + '（' + byG[g].length + '）</summary><div class="table-scroll"><table><thead><tr><th scope="col">項目</th><th scope="col">目前</th><th scope="col">臨床日期</th><th scope="col">記錄</th><th scope="col">來源</th><th scope="col">新鮮度</th><th scope="col">這次</th></tr></thead><tbody>' +
      byG[g].map(function (fid) { return fieldRow(fid, v.fields[fid], false, ask[fid]); }).join('') + '</tbody></table></div></details>';
  });
  return h + (any ? '' : '<p class="muted" id="data_empty">沒有符合的欄位。</p>') + '</section>';
}
/* 4.4 快速層（舊伺服器沒有評估需要投影時沿用） */
function assessHtmlLegacy(v) {

  var byG = {};
  Object.keys(DICT.fields).forEach(function (fid) { var f = DICT.fields[fid]; if (!f.clinician_editable || fid === 'prescribed_meds' || sunsetHidden(fid)) return; (byG[f.group] = byG[f.group] || []).push(fid); });
  /* v4.4 WP-A（B9）：先選這次接觸的情境——接觸方式決定下方快速欄位的排序（電話追蹤），所以放在最上面；仍不預設 */
  var h = '<section class="panel"><h2>本次評估（只記這次有變的）</h2><div class="row" id="ctx_top">' + ctxSelectsHtml() + '</div><p class="small muted">場域、院所每次登入選一次；接觸方式每位病人每次選。「記為一次評估」在下方「這次的變更」。</p>' + anchorHtml(v);
  var quick = quickFields(v), core = coreFields(v), nCore = quick.filter(function (f) { return core.indexOf(f) >= 0; }).length;
  if (quick.length) h += '<details open><summary>' + esc(GROUP_ZH.QUICK) + '（核心 ' + nCore + '＋依計畫 ' + (quick.length - nCore) + ' 項）</summary><details class="help"><summary>說明</summary><p class="small muted">「核心」每次都問（同一份清單也用來計算核心層完整率）；「依計畫」是這位病人的照護計畫缺的資料、過期資料、出院或用藥改變相關欄位。其他欄位在下面分組裡，沒有變的不用填；不知道就按「不知道」。</p></details><div class="table-scroll"><table><thead><tr><th scope="col">項目</th><th scope="col">目前</th><th scope="col">臨床日期</th><th scope="col">記錄</th><th scope="col">來源</th><th scope="col">新鮮度</th><th scope="col">這次</th></tr></thead><tbody>' +
    quick.map(function (fid, i) { var isCore = core.indexOf(fid) >= 0, sep = enc().contact !== 'PHONE' && !isCore && (i === 0 || core.indexOf(quick[i - 1]) >= 0) ? '<tr class="qsep"><th colspan="7" scope="colgroup" class="small muted">依照護計畫補充</th></tr>' : '';
      return sep + fieldRow(fid, v.fields[fid], isCore); }).join('') + '</tbody></table></div>' +
    (QUICK_OTHER_ROLE.length ? '<p class="small muted" id="quick_other_role">照護計畫還缺、需由其他職類設定（不佔這裡的名額）：' + QUICK_OTHER_ROLE.map(function (f) { var fa = ((ME.role_policy || {}).field_authority || {})[f] || []; return esc(field(f).label) + '（待' + esc(fa.map(function (r) { return ROLE_ZH[r] || r; }).join('、')) + '設定）'; }).join('；') + '</p>' : '') + '</details>';
  GROUP_ORDER.forEach(function (g) {
    if (!byG[g]) return;
    byG[g] = byG[g].filter(function (fid) { return quick.indexOf(fid) < 0; }); if (!byG[g].length) return;
    /* 正在編輯或已暫存的欄位所在的分組保持展開（重畫畫面時不會把編輯中的欄位收起來） */
    var open = (!quick.length && (g === 'TODAY' || g === 'EXPERIENCE' || g === 'OBJECTIVE')) || byG[g].indexOf(CUR.editing) >= 0 || byG[g].some(function (fid) { return !!ST.obs[fid]; }) || (CUR.openGroups || {})[g];
    h += '<details data-group="' + esc(g) + '"' + (open ? ' open' : '') + '><summary>' + esc(GROUP_ZH[g] || g) + '</summary><div class="table-scroll"><table><thead><tr><th scope="col">項目</th><th scope="col">目前</th><th scope="col">臨床日期</th><th scope="col">記錄</th><th scope="col">來源</th><th scope="col">新鮮度</th><th scope="col">這次</th></tr></thead><tbody>' +
      byG[g].map(function (fid) { return fieldRow(fid, v.fields[fid]); }).join('') + '</tbody></table></div></details>';
  });
  /* 3.4（T12）：電話追蹤一頁完成——記錄（上方欄位）、建立警訊（下方「這次的變更」）與建立交接（這裡）都在本頁，不跳頁 */
  if (enc().contact === 'PHONE') h += '<div id="phone_handoff"><h3>電話追蹤：需要其他職類接手時，在這裡建立交接</h3>' + newActionHtml(true) + '</div>';
  return h + '</section>';
}
/* 5.2 第 3 波 D-08：退場欄位（字典 sunset.clinician_entry＝HIDDEN）醫療端不輸入；有舊值時唯讀顯示 */
function sunsetHidden(fid) { var f = DICT.fields[fid]; return !!(f && f.sunset && f.sunset.clinician_entry === 'HIDDEN'); }
function fieldRow(fid, e, isCore, a) {
  var f = field(fid), fr = e ? (FRESH_ZH[e.freshness] || ['', '']) : ['', ''], s = ST.obs[fid];
  var USE_ZH = { CONFLICTED: ['紀錄互相衝突：不能用來判斷，請確認', 'err'], NEWER_UNVERIFIED: ['有較新的未確認值：請確認', 'warn'], FUTURE_PENDING: ['日期在今天之後：先不採用', 'err'], STALE: ['已過期', 'warn'] };
  var us = e && USE_ZH[e.usability] ? '<br>' + chip(USE_ZH[e.usability][0], USE_ZH[e.usability][1]) + (e.usability === 'CONFLICTED' && e.candidates ? '<br><span class="small">' + e.candidates.map(function (c) { return esc(fmtVal(fid, c.value)) + '（' + esc(d10(c.effective_at)) + '，' + esc(ROLE_ZH[c.provider_role] || c.provider_role || '') + '）'; }).join('；') + '</span>' : '') : '';
  var cur = e ? (e.usability === 'CONFLICTED' ? '<span class="muted">—</span>' : fmtVal(fid, e.value)) + us + (e.newer_lower_tier ? '<br><span class="small muted">較新的未確認值：' + esc(fmtVal(fid, e.newer_lower_tier.value)) + '（' + esc(d10(e.newer_lower_tier.effective_at)) + '）</span>' : '') +
    (e.by_source && e.by_source.clinician && e.by_source.patient ? '<br><span class="small muted">醫療觀察：' + esc(fmtVal(fid, e.by_source.clinician.value)) + '</span>' : '') : '—';
  var src = e ? esc(srcZh(e.source_type)) + '<br><span class="small muted">' + esc(ROLE_ZH[e.provider_role] || e.provider_role || '') + '｜' + esc(VER_ZH[e.verification_state] || '') + '</span>' : '';
  var act;
  if (s) act = '<div class="staged"><span class="small">' + esc({ CONFIRM: '沿用（確認）', UPDATE: '更新為 ', CORRECT: '更正為 ', UNKNOWN: '不知道' }[s.label] || '') + (s.action_type !== 'CONFIRM' && s.label !== 'UNKNOWN' ? esc(fmtVal(fid, s.value)) : '') + '</span> <button class="btn small" type="button" data-act="unstage" data-val="' + esc(fid) + '">取消</button></div>';
  else if (sunsetHidden(fid)) act = '<span class="small muted" data-sunset="1">舊欄位（病人自述，唯讀）：醫療端請改記「' + esc(field(f.sunset.replaced_by).label) + '」（附檢查日期與來源）</span>';   /* 5.2 第 3 波 D-08 */
  else if (CUR.editing === fid) act = editorHtml(fid, e);
  else if (!fieldAuthorized(fid)) act = '<span class="small muted">由' + esc((((ME.role_policy || {}).field_authority || {})[fid] || []).map(function (r) { return ROLE_ZH[r] || r; }).join('、')) + '設定（院內流程政策）</span>';
  else {
    act = (e && e.value !== null && e.value !== undefined && f.reuse_policy !== 'ALWAYS_REASSESS' ? '<button class="btn small" type="button" data-act="confirm" data-val="' + esc(fid) + '">沿用</button> ' : '') +
      '<button class="btn small" type="button" data-act="edit" data-val="' + esc(fid) + '">' + (f.reuse_policy === 'ALWAYS_REASSESS' ? '本次填寫' : (e ? '更新' : '填寫')) + '</button> ' +
      (hasUnknown(f) ? '<button class="btn small" type="button" data-act="unknown" data-val="' + esc(fid) + '">不知道</button>' : '');
  }
  /* v4.9：本次處置與理由（伺服器評估需要投影）；同日引用只顯示，不建立新紀錄 */
  var why = a && a.why_budget ? '<br><span class="small muted" data-why="1">為什麼這次問：' + esc(a.why_budget) + (a.extra_reason ? '｜加問：' + esc(W5C_EXTRA_ZH[a.extra_reason] || a.extra_reason) : '') + '</span>' : a && a.disposition && ['DISPLAY_HISTORY', 'DOCUMENT_IF_NEEDED'].indexOf(a.disposition) < 0 ? '<br><span class="small muted" data-disp="' + esc(a.disposition) + '">' + esc(DISP_ZH[a.disposition] || a.disposition) + (a.reason_code && a.reason_code !== 'EACH_CONTACT' ? '：' + esc(reasonZh(a.reason_code)) : '') + '</span>' : '';
  if (a && a.conditional) { var pf = field(a.conditional.field_id); cur += '<br><span class="small muted" data-cond="' + esc(a.conditional.field_id) + '">「' + esc(pf.label) + '」回答' + esc(a.conditional.when_any.map(function (x) { return (pf.enum_labels || {})[x] || x; }).join('或')) + '時才需要問</span>'; }   /* v4.9：條件題（前一題本次才問） */
  if (a && a.suggested && !s && fieldAuthorized(fid)) cur += '<br><button class="btn small noprint" type="button" data-act="suggest" data-val="' + esc(fid) + '">建議：' + esc(fmtVal(fid, a.suggested.value)) + '（按一下確認）</button>';   /* 4.9.3 WP-B2：不自動寫入 */
  if (a && a.disposition === 'REVIEW_EXISTING' && a.reference && !s) cur += '<br><span class="small" data-ref="' + esc(a.reference.event_id) + '">今天 ' + esc(hm(a.reference.at)) + ' 由' + esc(ROLE_ZH[a.reference.role] || a.reference.role || '醫療人員') + '記錄（引用）</span>';
  return '<tr data-fid="' + esc(fid) + '"' + (isCore ? ' data-core="1"' : '') + (a && a.layer ? ' data-layer="' + esc(a.layer) + '"' : '') + (a ? ' data-disp="' + esc(a.disposition) + '"' : '') + (a && a.conditional ? ' data-cond="1"' : '') + '><th scope="row">' + esc(f.label) + (isCore ? ' ' + chip('核心', '') : '') + why + '</th><td>' + cur + '</td><td>' + esc(e ? d10(e.effective_at) : '') + '</td><td>' + esc(e ? d10(e.recorded_at) : '') + '</td><td>' + src + '</td><td>' + chip(fr[0], fr[1]) + '</td><td class="noprint">' + act + '</td></tr>';
}
/* 3.3（ZT-B07-001）：與伺服器同一份欄位權責（FIELD_AUTHORITY）；畫面只決定要不要顯示編輯，伺服器逐筆檢查 */
function fieldAuthorized(fid) { var fa = ((ME.role_policy || {}).field_authority || {})[fid]; return !fa || fa.indexOf(ME.role) >= 0; }
function hasUnknown(f) { return f.data_type === 'ENUM' && f.enum_values && (f.enum_values.indexOf('UNKNOWN') >= 0 || f.enum_values.indexOf('UNSURE') >= 0); }
var BEDSIDE_MEASURES = ['sbp_mmhg', 'dbp_mmhg', 'heart_rate_bpm', 'weight_kg', 'six_mwd_m', 'sppb_score', 'gait_speed_m_s', 'sts30_count', 'grip_kg', 'orthostatic_sbp_drop', 'idwg_kg'];   /* 5.2 D-06 */
function allowedSources(f) { return f.allowed_source_types.filter(function (s) { return CLIN_SRC.indexOf(s) >= 0; }); }
/* 4.9.3 WP-A：今日警訊三組標題（醫療人員畫面；與 4.9.2 相同文字） */
var SIG_GROUPS = [['E_', '現在就要打 119'], ['U_', '現在去急診，或今天請人陪同就醫'], ['S_', '今天要聯絡醫療團隊']];
/* 欄位本身已有「沒有」選項（NONE 或 NONE_ 開頭）→ 回傳該代碼；沒有 → ''（畫面才另加「以上都沒有」） */
function listNoneCode(f) { return (f.enum_values || []).filter(function (x) { return x === 'NONE' || /^NONE_/.test(x); })[0] || ''; }
function editorHtml(fid, e) {
  var f = field(fid), input;
  var live = function (x) { return (f.enum_deprecated || []).indexOf(x) < 0; };   /* 3.4.0 T07：停用選項不出現在新紀錄選單 */
  var depWhy = f.enum_deprecated_reason ? '<p class="small muted" id="ed_dep_reason">' + Object.keys(f.enum_deprecated_reason).map(function (x) { return '「' + esc((f.enum_labels || {})[x] || x) + '」已停用於新紀錄：' + esc(f.enum_deprecated_reason[x]); }).join('<br>') + '</p>' : '';   /* 5.2 第 3 波 D-08 */
  if (f.data_type === 'ENUM') input = depWhy + '<select id="ed_val"><option value="">請選擇</option>' + f.enum_values.filter(live).filter(function (x) { return psy_enumOk(fid, x); }).map(function (x) { return opt(x, (f.enum_labels || {})[x] || x, e && e.value === x); }).join('') + '</select>' + psy_editorNote(fid);   /* 5.1 W51-PSY（PS-06）：自傷風險「沒有」限授權職類 */
  else if (f.data_type === 'LIST_ENUM') {
    /* 4.9.3 WP-A（移植 4.9.2，CARE-CARD-02／CARE-NEW-03）：「全部沒勾」不再默默等於「沒有」——沒有內建「沒有」選項的欄位要明確勾「以上都沒有」；
       已有內建「沒有」選項（NONE、NONE_OF_THESE）的欄位沿用原選項，不另加。每次重問的欄位（ALWAYS_REASSESS）不預先勾上次的值。
       今日警訊依處理急迫度分三組（E_／U_／S_，與病人端求助階梯同一套分級） */
    var pre = e && Array.isArray(e.value) && f.reuse_policy !== 'ALWAYS_REASSESS' ? e.value : [];
    var box = function (x) { return '<label class="small"><input type="checkbox" value="' + esc(x) + '"' + (pre.indexOf(x) >= 0 ? ' checked' : '') + '> ' + esc((f.enum_labels || {})[x] || x) + '</label><br>'; };
    var vals = f.enum_values.filter(live), body;
    if (fid === 'safety_signals') body = SIG_GROUPS.map(function (g) { var xs = vals.filter(function (x) { return x.indexOf(g[0]) === 0; }); return xs.length ? '<p class="small sig-group" data-sig-group="' + esc(g[0]) + '"><strong>' + esc(g[1]) + '</strong></p>' + xs.map(box).join('') : ''; }).join('') + vals.filter(function (x) { return !/^[EUS]_/.test(x); }).map(box).join('');
    else body = vals.map(box).join('');
    input = '<fieldset id="ed_val"><legend class="sr-only">' + esc(f.label) + '</legend>' + body +
      (listNoneCode(f) ? '' : '<label class="small"><input type="checkbox" id="ed_none" value=""' + (e && Array.isArray(e.value) && !e.value.length && f.reuse_policy !== 'ALWAYS_REASSESS' ? ' checked' : '') + '> <strong>' + (fid === 'safety_signals' ? '以上都沒有（已逐項詢問）' : '以上都沒有') + '</strong></label>') + '</fieldset>';
  }
  else if (f.data_type === 'NUMBER') input = '<input id="ed_val" type="number" step="any" min="' + f.range[0] + '" max="' + f.range[1] + '" value="' + (e && typeof e.value === 'number' ? e.value : '') + '"> ' + esc(f.unit || '') + ' <span class="small muted">（' + f.range[0] + '–' + f.range[1] + '）</span>';
  else if (f.data_type === 'DATETIME') input = '<input id="ed_val" type="datetime-local" step="60" value="' + esc(e && typeof e.value === 'string' ? e.value : '') + '"> <span class="small muted">（台灣時間，不能在未來）</span>';   /* 5.2 A-04 */
  else if (fid === 'fmt_class_status') input = fmtEditor(e && Array.isArray(e.value) ? e.value : []);
  else if (f.data_type === 'LIST_OBJECT') input = medEditor('ed_val', (e && Array.isArray(e.value) ? e.value : []).concat((e && e.unconfirmed) || []), true);
  else input = '<input id="ed_val">';
  var needDate = f.truth_domain === 'OBJECTIVE_RESULT' || f.reuse_policy === 'TIME_LIMITED' || f.requires_effective_at;
  var srcs = allowedSources(f);
  /* 3.2（R-A-012）：檢查結果的來源不預設——「依病歷或報告確認」必須是看過報告的人主動選 */
  var defSrc = f.truth_domain === 'OBJECTIVE_RESULT' ? '' : (srcs.indexOf('PATIENT_REPORTED') >= 0 && ['EXPERIENCE', 'TODAY', 'PATIENT_CLINICAL', 'CARE'].indexOf(f.group) >= 0 ? 'PATIENT_REPORTED' : srcs[0]);
  /* 5.2 D-06：醫療人員本人在床邊量的（生命徵象、體重、身體功能量測）→ 預設「醫療人員量測」、日期預設今天；檢驗與報告仍不預設（R-A-012） */
  var bedside = BEDSIDE_MEASURES.indexOf(fid) >= 0 && srcs.indexOf('CLINICIAN_OBSERVED') >= 0;
  if (bedside) defSrc = 'CLINICIAN_OBSERVED';
  return '<div class="staged"><label class="f">值' + input + '</label>' +
    (needDate ? '<label class="f">檢查／量測日期' + (f.truth_domain === 'OBJECTIVE_RESULT' || f.requires_effective_at ? '（必填）' : (f.reuse_policy === 'TIME_LIMITED' ? '（醫療人員記錄時必填）' : '')) + '<input type="date" id="ed_date" max="' + today() + '"' + (bedside ? ' value="' + today() + '"' : '') + '></label>' : '') +
    '<label class="f">來源' + (defSrc ? '' : '（必選）') + '<select id="ed_src">' + (defSrc ? '' : opt('', '請選擇來源')) + srcs.map(function (x) { return opt(x, srcZh(x), x === defSrc); }).join('') + '</select></label>' +
    (e && e.event_id ? '<label class="small"><input type="checkbox" id="ed_correct"> 這是更正上一筆錯誤（不是新的變化）</label>' : '') +
    '<div class="row"><button class="btn small primary" type="button" data-act="ed_ok" data-val="' + esc(fid) + '">加入這次變更</button><button class="btn small" type="button" data-act="ed_cancel">取消</button></div><p id="ed_err" class="small" role="alert"></p></div>';
}
/* 指引建議核心藥物：依 LVEF 分類列出應檢視的類別，每類選狀態 */
function fmtEditor(list) {
  var cur = {}; list.forEach(function (o) { cur[o['class']] = o; });
  /* 3.3（ZT-A-002／A-003）：分組由伺服器依 LVEF 歷程判定（改善後仍照降低型；歷程未確認不判定）；每類分開記「有沒有在用」「劑量到哪裡」「為什麼不用／未達目標」 */
  var dv = CUR.rec.view.derived || {}, prof = dv.fmt_profile, tr = dv.lvef_trajectory ? dv.lvef_trajectory.value : '';
  var head = prof === 'REDUCED' ? (tr === 'IMPROVED_FROM_REDUCED' ? 'LVEF 曾經 <50%、現在改善：仍照四類檢視（改善後繼續治療）' : 'LVEF <50%：四類都要檢視') : (prof === 'PRESERVED' ? '至少檢視 ' + (DICT.fmt_profiles.PRESERVED || []).map(function (c) { return DICT.fmt_classes[c]; }).join('、') : (tr === 'TRAJECTORY_UNVERIFIED' ? '過去的 LVEF 只有自述或未確認：請先確認歷程，系統不判定分組（不能記「已完成檢視」）' : '尚無醫療人員確認的 LVEF；可先記錄已知的類別'));
  var classes = Object.keys(DICT.fmt_classes || {});
  return '<div id="ed_val" data-kind="fmt"><p class="small muted">' + esc(head) + '。「使用中／本次開始」必須有對應處方；不用的要選理由；使用中請選劑量狀態。</p>' +
    classes.map(function (c) {
      var o = cur[c] || {};
      return '<fieldset class="fmt-row"><legend>' + esc(DICT.fmt_classes[c]) + '</legend><div class="row">' +
        '<label class="f small">狀態<select class="fmt_st" data-class="' + esc(c) + '"><option value="">不記錄</option>' + (DICT.fmt_status_options || []).map(function (x) { return opt(x[0], x[1], o.status === x[0]); }).join('') + '</select></label>' +
        '<label class="f small">劑量（使用中）<select class="fmt_ds" data-class="' + esc(c) + '"><option value="">—</option>' + (DICT.fmt_dose_status_options || []).map(function (x) { return opt(x[0], x[1], o.dose_status === x[0]); }).join('') + '</select></label>' +
        '<label class="f small">理由（不用或未達目標時必選）<select class="fmt_rc" data-class="' + esc(c) + '"><option value="">—</option>' + (DICT.fmt_reason_codes || []).map(function (x) { return opt(x[0], x[1], o.reason_code === x[0]); }).join('') + '</select></label></div></fieldset>';
    }).join('') + '</div>';
}
function readFmt(root) {
  return [].slice.call(root.querySelectorAll('.fmt_st')).filter(function (s) { return s.value; }).map(function (s) {
    var c = s.getAttribute('data-class'), o = { 'class': c, status: s.value }, ds = root.querySelector('.fmt_ds[data-class="' + c + '"]'), rc = root.querySelector('.fmt_rc[data-class="' + c + '"]');
    if (ds && ds.value && ['ACTIVE', 'INITIATED'].indexOf(s.value) >= 0) o.dose_status = ds.value;
    if (rc && rc.value) o.reason_code = rc.value;
    return o;
  });
}
/* 3.0.0：處方編輯器每一個勾選的成分可標註「暫停中」（原因＋重新評估日，必填）與這次改變的理由；只記錄醫療團隊已做的決定 */
/* 3.2（R-A-001／R-A-016）：處方與實際使用都可以記劑量用法（短文字照藥袋或處方抄錄；系統不換算、不建議劑量）。
   調整劑量時，改這幾格就會被判定為「調整」，並啟動用藥改變後的追蹤 */
function regimenInputs(m, cls) {
  m = m || {};
  return '<span class="reg ' + cls + '"> <input type="text" class="rg_strength" maxlength="40" size="7" placeholder="含量" aria-label="含量（例 25 mg）" value="' + esc(m.strength || '') + '">' +
    '<input type="text" class="rg_dose" maxlength="40" size="6" placeholder="每次" aria-label="每次用量（例 1 顆）" value="' + esc(m.dose || '') + '">' +
    '<input type="text" class="rg_frequency" maxlength="40" size="8" placeholder="頻次" aria-label="頻次（例 早晚各一次）" value="' + esc(m.frequency || '') + '"></span>';
}
function readRegimen(d, o) { ['strength', 'dose', 'frequency'].forEach(function (k) { var x = d.querySelector('.rg_' + k); if (x) { var v = x.value.trim(); if (v) o[k] = v; else delete o[k]; } }); return o; }
function rxExtraHtml(i, m) {
  m = m || {}; var MC = DICT.medication_changes || {};
  return regimenInputs(m, 'small') + '<span class="rx_extra small"> <select class="rx_st" aria-label="' + esc(i.name) + ' 使用狀態">' + (MC.rx_status || [['ACTIVE', '使用中'], ['HELD', '暫停中']]).map(function (x) { return opt(x[0], x[1], (m.rx_status || 'ACTIVE') === x[0]); }).join('') + '</select>' +
    ' <select class="rx_hr" aria-label="暫停原因"><option value="">暫停原因</option>' + (MC.hold_reasons || []).map(function (x) { return opt(x[0], x[1], m.hold_reason === x[0]); }).join('') + '</select>' +
    ' <input type="date" class="rx_ro" aria-label="重新評估日" value="' + esc(m.reassess_on || '') + '">' +
    ' <select class="rx_cr" aria-label="這次改變或停用的理由"><option value="">改變／停用理由（有改變時必選）</option>' + (MC.change_reasons || []).map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></span>' +
    /* schema 5.0：結構化劑量（後端換算每日總量；格式錯誤會被伺服器拒收）、是否已達最大可耐受劑量、未達目標劑量的理由碼。只記錄處方事實 */
    '<span class="rx_struct small"> <input type="text" inputmode="decimal" class="rx_smg" size="5" placeholder="每次 mg" aria-label="' + esc(i.name) + ' 每次含量（mg，數字）" value="' + esc(m.strength_mg || '') + '">' +
    rxUpdSelect(i, m) + rxFreqSelect(i, m) + rxAdminTimes(m) +
    ' <select class="rx_mt" aria-label="是否已達最大可耐受劑量">' + [['', '最大可耐受？'], ['YES', '已達最大可耐受'], ['NO', '未達'], ['UNKNOWN', '不確定']].map(function (x) { return opt(x[0], x[1], (m.max_tolerated || '') === x[0]); }).join('') + '</select>' +
    ' <select class="rx_btr" aria-label="未達目標劑量的理由"><option value="">未達目標劑量理由</option>' + (DICT.fmt_reason_codes || []).map(function (x) { return opt(x[0], x[1], m.below_target_reason === x[0]); }).join('') + '</select></span>';
}
var MED_SAME_SRC = [['PATIENT', '病人說和處方一樣', 'PATIENT_REPORTED'], ['CAREGIVER', '家屬說和處方一樣', 'CAREGIVER_REPORTED'], ['MED_BAG', '和病人一起看藥袋核對', 'PATIENT_REPORTED']];
/* 「與處方相同」：勾選該成分、狀態「在吃」、用法照處方；記下確認來源（病人自述／家屬自述），欄位來源一併切換 */
function medSame(root, ings) {
  var sel = root.querySelector('.med_same_src'), src = sel ? sel.value : '', S = MED_SAME_SRC.filter(function (x) { return x[0] === src; })[0], er = root.querySelector('.med_same_err');
  if (!S) { if (er) er.textContent = '請先選擇是誰確認和處方一樣（病人、家屬或一起看藥袋）。'; if (sel) sel.focus(); return false; }
  if (er) er.textContent = '';
  ((CUR.rec.view.fields.prescribed_meds || {}).value || []).forEach(function (m) {
    if (m.rx_status === 'HELD' || (ings && ings.indexOf(m.ingredient) < 0)) return;
    var box = root.querySelector('.med_item input[type=checkbox][value="' + m.ingredient + '"]'); if (!box) return;
    var row = box.closest('.med_item'); box.checked = true; row.querySelector('.med_st').value = 'CURRENT';
    ['strength', 'dose', 'frequency'].forEach(function (k) { var x = row.querySelector('.rg_' + k); if (x) x.value = m[k] || ''; });
    row.setAttribute('data-same-src', S[1]); if (m.route) row.setAttribute('data-route', m.route); else row.removeAttribute('data-route');
  });
  var es = $('ed_src'); if (es && [].some.call(es.options, function (o) { return o.value === S[2]; })) es.value = S[2];
  return true;
}
/* 4.9.3 WP-B2（CARE-PHARM-01）：顆數與頻次改下拉（伺服器依頻次代碼換算每日次數；每週一次、需要時使用不換算）；服藥時段可複選。含量維持數字輸入 */
var RX_UPD = ['0.25', '0.5', '1', '1.5', '2', '3', '4'], RX_FREQ = [['QD', '每日一次', '1'], ['BID', '每日兩次', '2'], ['TID', '每日三次', '3'], ['QID', '每日四次', '4'], ['QOD', '隔日一次', '0.5'], ['QW', '每週一次（不換算每日量）', ''], ['PRN', '需要時使用（不換算每日量）', '']];
var RX_AT = [['MORNING', '早'], ['NOON', '中'], ['EVENING', '晚'], ['BEDTIME', '睡前']];
function rxUpdSelect(i, m) { var v = String(m.units_per_dose || ''), list = RX_UPD.indexOf(v) < 0 && v ? RX_UPD.concat([v]) : RX_UPD;
  return '<select class="rx_upd" aria-label="' + esc(i.name) + ' 每次顆數"><option value="">顆數</option>' + list.map(function (x) { return opt(x, x + ' 顆', v === x); }).join('') + '</select>'; }
function rxFreqSelect(i, m) { var code = m.frequency_code || (RX_FREQ.filter(function (f) { return f[2] && f[2] === String(m.doses_per_day || ''); })[0] || [''])[0];
  var odd = !code && m.doses_per_day ? '<option value="DPD:' + esc(m.doses_per_day) + '" selected>每日 ' + esc(m.doses_per_day) + ' 次（舊紀錄）</option>' : '';
  return '<select class="rx_dpd" aria-label="' + esc(i.name) + ' 頻次"><option value="">頻次</option>' + RX_FREQ.map(function (f) { return opt(f[0], f[1], code === f[0]); }).join('') + odd + '</select>'; }
function rxAdminTimes(m) { var cur = String(m.admin_times || '').split(',');
  return '<span class="rx_at small" role="group" aria-label="服藥時段">' + RX_AT.map(function (t) { return '<label><input type="checkbox" class="rx_at_c" value="' + t[0] + '"' + (cur.indexOf(t[0]) >= 0 ? ' checked' : '') + '>' + t[1] + '</label>'; }).join('') + '</span>'; }
function readRxStruct(d, o) {
  var u = d.querySelector('.rx_upd'), f = d.querySelector('.rx_dpd');
  if (u && u.value) o.units_per_dose = u.value;
  if (f && f.value) { var x = /^DPD:(.+)$/.exec(f.value); if (x) o.doses_per_day = x[1]; else { o.frequency_code = f.value; var r = RX_FREQ.filter(function (z) { return z[0] === f.value; })[0]; if (r && r[2]) o.doses_per_day = r[2]; } }
  var at = [].slice.call(d.querySelectorAll('.rx_at_c:checked')).map(function (c) { return c.value; }); if (at.length) o.admin_times = at.join(',');
}
function medEditor(id, list, withStatus, rxMode) {
  var cur = {}, byIng = {}; list.forEach(function (m) { cur[m.ingredient] = m.status || 'CURRENT'; byIng[m.ingredient] = m; });
  /* 3.2（R-A-017）：已勾的放最上面；實際使用可「從目前處方開始」一次帶入 */
  var hasRx = withStatus && !rxMode && ((CUR.rec.view.fields.prescribed_meds || {}).value || []).length;
  var ings = DICT.ingredients.slice().sort(function (a, b) { return (cur[b.id] !== undefined) - (cur[a.id] !== undefined); });
  /* 4.9.3 WP-A（CARE-PHARM-02）：病人或家屬逐項確認「和處方一樣」時可一次帶入（狀態「在吃」＋處方用法）；必須先選誰確認的，
     來源存為病人自述或家屬自述（不是藥師或系統確認）；不一樣的仍逐項改 */
  var rxIng = {}; if (hasRx) ((CUR.rec.view.fields.prescribed_meds || {}).value || []).forEach(function (m) { if (m.rx_status !== 'HELD') rxIng[m.ingredient] = 1; });
  return '<div id="' + id + '" data-kind="meds">' + (hasRx ? '<div class="row"><button class="btn small" type="button" data-act="med_from_rx" data-val="' + esc(id) + '">從目前處方開始（逐項改成實際吃法）</button></div>' +
    '<div class="row"><label class="f small">誰確認的（「與處方相同」必選）<select class="med_same_src" aria-label="誰確認與處方相同">' + opt('', '請選擇') + MED_SAME_SRC.map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label><button class="btn small" type="button" data-act="med_all_same" data-val="' + esc(id) + '">全部與處方相同</button></div><p class="small field-err med_same_err" role="alert"></p>' : '') +
    '<input type="search" class="med_q" placeholder="搜尋成分或商品名" aria-label="搜尋藥品"><div class="med_list" style="max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px;margin-top:6px">' +
    ings.map(function (i) {
      var on = cur[i.id] !== undefined;
      return '<div class="med_item" data-name="' + esc((i.name + ' ' + (i.zh || '')).toLowerCase()) + '"><label class="small"><input type="checkbox" value="' + esc(i.id) + '"' + (on ? ' checked' : '') + '> ' + esc(i.name) + (i.zh ? '（' + esc(i.zh) + '）' : '') + '</label>' +
        (withStatus && byIng[i.id] && byIng[i.id].match_status === 'PATIENT_SELECTED_UNCONFIRMED' ? ' ' + chip('病人自選，待藥師核對', 'warn') + (ME.role === 'PHARMACIST' ? ' <label class="small"><input type="checkbox" class="med_conf"> 已核對成分、劑量、劑型、來源</label>' : '') : '') +
        (withStatus && rxIng[i.id] ? ' <button class="btn small" type="button" data-act="med_same_row" data-val="' + esc(i.id) + '">與處方相同</button>' : '') +
        (withStatus ? ' <select class="med_st" aria-label="' + esc(i.name) + ' 狀態">' + opt('', '請選擇（病人實際）') + [['CURRENT', '在吃'], ['STOPPED', '已停'], ['UNSURE', '不確定']].map(function (s) { return opt(s[0], s[1], cur[i.id] === s[0]); }).join('') + '</select>' + regimenInputs(byIng[i.id], 'small') : '') + (rxMode ? rxExtraHtml(i, byIng[i.id]) : '') + '</div>';
    }).join('') + '</div></div>';
}
function readMeds(root, withStatus) {
  var prev = {}; ((CUR.rec.view.fields.prescribed_meds || {}).value || []).forEach(function (m) { prev[m.ingredient] = m; });
  return [].slice.call(root.querySelectorAll('.med_item')).filter(function (d) { return d.querySelector('input[type=checkbox]').checked; }).map(function (d) {
    var o = { ingredient: d.querySelector('input[type=checkbox]').value }; if (withStatus) { o.status = d.querySelector('.med_st').value; readRegimen(d, o); var mc = d.querySelector('.med_conf'); if (mc && mc.checked) o.match_status = 'PHARMACIST_CONFIRMED';
      if (d.getAttribute('data-same-src')) { o.source = d.getAttribute('data-same-src'); if (d.getAttribute('data-route')) o.route = d.getAttribute('data-route'); } }
    if (d.querySelector('.rx_st')) {
      /* 保留原本已記錄的劑量等欄位（畫面沒有編輯的部分不會被清掉） */
      var p = prev[o.ingredient] || {}; ['product', 'route', 'indication', 'prescribed_at'].forEach(function (k) { if (p[k]) o[k] = p[k]; });
      readRegimen(d, o);
      var st = d.querySelector('.rx_st').value, hr = d.querySelector('.rx_hr').value, ro = d.querySelector('.rx_ro').value, cr = d.querySelector('.rx_cr').value;
      if (st === 'HELD') { o.rx_status = 'HELD'; o.hold_reason = hr; o.reassess_on = ro; }
      if (cr) o.change_reason = cr;
      [['rx_smg', 'strength_mg'], ['rx_mt', 'max_tolerated'], ['rx_btr', 'below_target_reason']].forEach(function (k) { var x = d.querySelector('.' + k[0]); if (x && x.value.trim()) o[k[1]] = x.value.trim(); });
      readRxStruct(d, o);
    }
    return o;
  });
}
function stageFromEditor(fid) {
  var f = field(fid), e = CUR.rec.view.fields[fid], el = $('ed_val'), val = null, err = '';
  if (f.data_type === 'ENUM') { val = el.value || null; if (!val) err = '請選擇一個值。'; }
  else if (f.data_type === 'LIST_ENUM') {
    val = [].slice.call(el.querySelectorAll('input:checked')).filter(function (x) { return x.id !== 'ed_none'; }).map(function (x) { return x.value; });
    var none = !!($('ed_none') && $('ed_none').checked), nc = listNoneCode(f), nl = nc ? ((f.enum_labels || {})[nc] || nc) : '以上都沒有';
    if (!val.length && !none) err = '請勾選符合的項目；都沒有時請勾「' + nl + '」。';
    else if (val.length && none) err = '已勾「以上都沒有」，請取消其他勾選（或取消「以上都沒有」）。';
    else if (nc && val.indexOf(nc) >= 0 && val.length > 1) err = '已勾「' + nl + '」，請取消其他勾選（或取消「' + nl + '」）。';
  }
  else if (f.data_type === 'NUMBER') { val = el.value === '' ? null : Number(el.value); if (val === null || !isFinite(val) || val < f.range[0] || val > f.range[1]) err = '請輸入 ' + f.range[0] + '–' + f.range[1] + ' 之間的數值。'; }
  else if (f.data_type === 'DATETIME') { val = String(el.value || '').slice(0, 16) || null; if (!val || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)) err = '請輸入日期與時間（台灣時間）。'; }
  else if (fid === 'fmt_class_status') { val = readFmt(el); if (!val.length) err = '請至少選一類的狀態。'; else { var nr = val.filter(function (o) { return (['CONTRAINDICATED', 'INTOLERANT', 'NOT_INDICATED', 'DECLINED'].indexOf(o.status) >= 0 || o.dose_status === 'BELOW_TARGET_REASON') && !o.reason_code; }); if (nr.length) err = '不用或未達目標劑量的類別請選理由：' + nr.map(function (o) { return DICT.fmt_classes[o['class']]; }).join('、'); } }
  else if (f.data_type === 'LIST_OBJECT') { val = readMeds(el, true); var unk = val.filter(function (m) { return !m.status; }); if (unk.length) err = '請逐項選擇病人實際的狀態（在吃／已停／不確定）：' + unk.map(function (m) { return ingName(m.ingredient); }).join('、'); }
  var date = $('ed_date') ? $('ed_date').value : '';
  if (!err && f.truth_domain === 'OBJECTIVE_RESULT' && !date) err = '檢查結果必須有檢查日期。';
  if (!err && !$('ed_src').value) err = '請選擇來源（看過原始報告才選「依病歷或報告確認」）。';
  if (!err && f.requires_effective_at && !date) err = '這一項必須填量測日期。';
  /* 獨立複核 v4.8 P1-5：醫療人員來源寫入限時欄位，伺服器要求臨床日期（REQUIRED_FOR_TIME_LIMITED）——在暫存時就擋下，避免整批（含危險症狀）儲存被拒 */
  if (!err && f.reuse_policy === 'TIME_LIMITED' && /^CLINICIAN_/.test($('ed_src').value) && !date && val !== null && ['UNKNOWN', 'UNSURE'].indexOf(val) < 0) err = '醫療人員記錄這一項要填日期（今天評估就填今天）。';
  if (!err) err = psy_stageErr(fid, val);   /* 5.1 W51-PSY（PS-06） */
  if (err) { $('ed_err').textContent = err; CUR.edErr = { field_id: fid, err: err }; var sb = $('staged_unadded'); if (sb) sb.innerHTML = unaddedHtml(); return; }
  CUR.edErr = null;
  var correct = $('ed_correct') && $('ed_correct').checked;
  var o = { field_id: fid, action_type: correct ? 'CORRECT' : 'UPDATE', value: val, source_type: $('ed_src').value, label: correct ? 'CORRECT' : 'UPDATE' };
  if (f.data_type === 'LIST_ENUM' && $('ed_none') && $('ed_none').checked && Array.isArray(val) && !val.length) o.qualifiers = { none_asked: true };   /* 5.0 W5-C（K11-03）：明確勾「以上都沒有（已逐項詢問）」（伺服器拒收與其他選項並存） */
  if (correct) o.supersedes_event_id = e.event_id;
  if (date) o.effective_at = date;
  if (e) o.client_observed_old_value = e.value;
  ST.obs[fid] = o; CUR.editing = null; psy_afterStage(fid, val); afterStage(); dirHint();   /* 5.1 W51-PSY（PS-09）：心理追蹤安排 → 預填追蹤行動 */
}
/* 4.9.3 WP-B1（CARE-NURSE-08）：同一次「和平常比」與「和上次比」方向相反 → 非阻擋提示（兩題可以同時成立；不要求更正、不擋儲存） */
function dirHint() {
  var u = ST.obs.recent_change_usual, p = ST.obs.recent_change_previous; if (!u || !p) return;
  var d = function (v) { return /BETTER/.test(v || '') ? 1 : (/WORSE/.test(v || '') ? -1 : 0); };
  if (d(u.value) * d(p.value) < 0) sync('FAILED', '有 ' + stagedCount() + ' 項變更還沒有儲存；提醒：「和平常比」與「和上次比」方向相反，兩題可以同時成立（例如出院後逐漸好轉但仍不如平常），請確認問的是「和上次」與「和平常」（不需更正即可儲存）');
}
function stageConfirm(fid) {
  var f = field(fid), e = CUR.rec.view.fields[fid];
  if (f.reuse_policy === 'ALWAYS_REASSESS') return;   /* v4.6 WP-A1：每次重問的欄位不能沿用（伺服器也會拒收） */
  var src = e && allowedSources(f).indexOf(e.source_type) >= 0 ? e.source_type : allowedSources(f)[0];
  ST.obs[fid] = { field_id: fid, action_type: 'CONFIRM', source_type: src, label: 'CONFIRM', client_observed_old_value: e ? e.value : null }; afterStage();
}
/* 4.9.3 WP-B2：伺服器建議值（例如生理性別為男 → 懷孕可能「不適用」）、計畫訊息的建議帶入（例如照顧者版）：按一下只暫存，儲存時才寫入 */
function stageSuggested(fid) {
  var a = (CUR.rec.ask || []).filter(function (x) { return x.field_id === fid && x.suggested; })[0]; if (!a || !fieldAuthorized(fid)) return;
  ST.obs[fid] = { field_id: fid, action_type: 'UPDATE', value: a.suggested.value, source_type: a.suggested.source_type, label: 'UPDATE' }; var e = CUR.rec.view.fields[fid]; if (e) ST.obs[fid].client_observed_old_value = e.value; afterStage();
}
function stagePrefill(mid) {
  var m = (((CUR.rec.plan || {}).messages) || []).filter(function (x) { return x.id === mid && x.prefill; })[0]; if (!m) return;
  var fid = m.prefill.field_id, f = field(fid), e = CUR.rec.view.fields[fid]; if (!f || !fieldAuthorized(fid)) return;
  var base = ST.obs[fid] && Array.isArray(ST.obs[fid].value) ? ST.obs[fid].value : (e && Array.isArray(e.value) ? e.value : []);
  var v = base.filter(function (x) { return x !== 'NONE'; }); m.prefill.add.forEach(function (x) { if (v.indexOf(x) < 0) v.push(x); });
  ST.obs[fid] = { field_id: fid, action_type: 'UPDATE', value: v, source_type: 'CLINICIAN_OBSERVED', label: 'UPDATE' }; if (e) ST.obs[fid].client_observed_old_value = e.value; afterStage();
}
function stageUnknown(fid) {
  var f = field(fid), v = f.enum_values.indexOf('UNKNOWN') >= 0 ? 'UNKNOWN' : 'UNSURE';
  ST.obs[fid] = { field_id: fid, action_type: 'UPDATE', value: v, source_type: allowedSources(f).indexOf('PATIENT_REPORTED') >= 0 ? 'PATIENT_REPORTED' : allowedSources(f)[0], label: 'UNKNOWN' }; afterStage();
}
function afterStage() { sync('FAILED', '有 ' + stagedCount() + ' 項變更還沒有儲存'); renderPatient(); }
function ctxSelectsHtml() {
  return '<label class="f">場域（必填，不預設）<select id="as_setting">' + opt('', '請選擇') + ME.settings.map(function (x) { return opt(x, SET_ZH[x] || x, SESSION_CTX.setting === x); }).join('') + '</select></label>' +
    '<label class="f">院所<select id="as_fac">' + ME.facilities.map(function (f) { return opt(f, FAC_ZH[f] || f, (SESSION_CTX.facility || CUR.rec.facility_code) === f); }).join('') + '</select></label>' +
    '<label class="f">接觸方式（不預設）<select id="as_contact">' + opt('', '請選擇') + ['FACE_TO_FACE', 'PHONE', 'VIDEO'].map(function (x) { return opt(x, CM_ZH[x], enc().contact === x); }).join('') + '</select></label>' +
    /* 5.2 H-06：接觸日期（預設今天；補登限過去 30 天、要選理由；伺服器同樣檢查） */
    '<label class="f">接觸日期<input type="date" id="as_date" value="' + esc(enc().enc_date || todayTW()) + '" max="' + esc(todayTW()) + '" min="' + esc(addDaysTW(todayTW(), -30)) + '"></label>' +
    ((enc().enc_date && enc().enc_date < todayTW()) ? '<label class="f">補登理由（補登時必選）<select id="as_bf">' + opt('', '請選擇') + BACKFILL_ZH.map(function (x) { return opt(x[0], x[1], enc().bf_reason === x[0]); }).join('') + '</select></label>' : '');
}
var BACKFILL_ZH = [['LATE_DOCUMENTATION', '接觸後補記（例如當班來不及登打）'], ['PAPER_RECORD_TRANSCRIBED', '紙本紀錄轉登'], ['SYSTEM_DOWNTIME', '系統無法使用期間的紀錄'], ['SYNTHETIC_UAT_TIMELINE', '模擬病人測試的病程（只限 TEST／E2E 病歷號）']];
function addDaysTW(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
/* 5.2 D-06：編輯框裡還沒加入（或加入時被擋）的欄位，在暫存區顯示「N 項未加入」，儲存前先擋下，不靜默丟失 */
function editorDirty() {
  if (!CUR || !CUR.editing || CUR.editing === 'prescribed_meds') return false;
  var el = $('ed_val'); if (!el) return false;
  var cur = (CUR.rec.view.fields[CUR.editing] || {}).value;
  if (el.tagName === 'FIELDSET') { var on = [].slice.call(el.querySelectorAll('input:checked')).map(function (x) { return x.value; }).filter(function (x) { return x; }).sort();
    var was = Array.isArray(cur) ? cur.slice().sort() : []; return (on.length || ($('ed_none') && $('ed_none').checked)) && JSON.stringify(on) !== JSON.stringify(was) || (on.length === 0 && $('ed_none') && $('ed_none').checked && !(Array.isArray(cur) && cur.length === 0)); }
  if (el.tagName === 'SELECT' || el.tagName === 'INPUT') return el.value !== '' && String(el.value) !== String(cur === undefined || cur === null ? '' : cur);
  return false;
}
function unaddedHtml() {
  var n = (CUR.edErr ? 1 : 0) || (editorDirty() ? 1 : 0); if (!n) return '';
  var fid = CUR.edErr ? CUR.edErr.field_id : CUR.editing;
  return '<p class="notice warn small" id="unadded_note">1 項未加入：' + esc(field(fid).label) + (CUR.edErr ? '（' + esc(CUR.edErr.err) + '）' : '（還沒按「加入這次變更」）') + '。儲存前請加入或取消。</p>';
}
function stagedHtml() {
  var n = stagedCount();
  var list = Object.keys(ST.obs).map(function (k) { var o = ST.obs[k];
      /* 5.2 A-06：今日警訊勾 2 個以上時逐行列出並標等級（不再用「、」串成一句，避免語意錯接） */
      if (k === 'safety_signals' && o.action_type !== 'CONFIRM' && Array.isArray(o.value) && o.value.length) return '<li>' + esc(field(k).label) + '（' + esc(srcZh(o.source_type)) + '）：<ul class="sig-staged">' +
        o.value.map(function (id) { var g = SIG_GROUPS.filter(function (x) { return id.indexOf(x[0]) === 0; })[0]; return '<li data-sig="' + esc(id) + '">' + chip(g ? ({ E_: '緊急', U_: '緊急', S_: '今天' }[g[0]]) : '觀察', g && g[0] !== 'S_' ? 'err' : 'warn') + ' ' + esc(fmtVal(k, [id])) + (g ? '<span class="small muted">（' + esc(g[1]) + '）</span>' : '') + '</li>'; }).join('') + '</ul></li>';
      return '<li>' + esc(field(k).label) + '：' + esc(o.action_type === 'CONFIRM' ? '沿用（確認）' : fmtVal(k, o.value)) + '（' + esc(srcZh(o.source_type)) + (o.effective_at ? '，' + esc(o.effective_at) : '') + '）</li>'; })
    .concat(ST.ce.map(function (c, i) { return '<li>' + (c.supersedes_event_id ? '更正為：' : '') + esc(CE_ZH[c.event_type]) + ' ' + esc(c.occurred_at) + (c.admission_at ? '（入院 ' + esc(c.admission_at) + '）' : '') + ' <button class="btn small" type="button" data-act="unstage_ce" data-val="' + i + '">移除</button></li>'; }))
    .concat((ST.v4 || []).map(function (r, i) { return '<li>' + esc(r.label || r.table) + ' <button class="btn small" type="button" data-act="unstage_v4" data-val="' + i + '">移除</button></li>'; }))
    .concat(ST.ac.map(function (a, i) { return '<li>行動：' + esc(a.action_id ? (a.change_reason === 'RESCHEDULED' ? '改期到 ' + a.due_at : a.change_reason === 'CONTINUE_AFTER_READMISSION' ? '再住院後確認：延續' : a.change_reason === 'RESULT_ACKNOWLEDGED' ? '已看過回覆' : /^TAKEOVER_/.test(a.change_reason || '') ? '由我接手（' + codeZh(DICT.action_change_reasons, a.change_reason) + '）' : a.change_reason ? '轉給 ' + (ROLE_ZH[a.owner_role] || a.owner_role) + '（' + codeZh(DICT.action_change_reasons, a.change_reason) + '）' : '更新狀態為 ' + (AST_ZH[a.action_status] || a.action_status) + (a.result_code ? '｜結果：' + codeZh(DICT.result_codes, a.result_code) : '')) : '新增 ' + actName(a) + (a.due_at ? '（' + a.due_at + ' 前）' : '') + (a.handoff_reason ? '｜' + hoText({ reason: a.handoff_reason, urgency: a.handoff_urgency, needs: a.handoff_needs || [] }) : '')) + ' <button class="btn small" type="button" data-act="unstage_ac" data-val="' + i + '">移除</button></li>'; }))
    .concat(ST.ed.map(function (e, i) { return '<li>衛教：' + esc(cardTitle(e.card_id)) + (e.objective ? '「' + esc(FACET_ZH[e.objective] || e.objective) + '」' : '') + '｜' + esc(EDU_ZH[e.understanding] || e.understanding) + (e.method !== 'NONE' ? '（' + esc(METHOD_ZH[e.method] || e.method) + '）' : '') + ' <button class="btn small" type="button" data-act="unstage_ed" data-val="' + i + '">移除</button></li>'; }))
    .concat(ST.co.map(function (c, i) { return '<li>關心的問題：' + esc(c.concern_id ? '更新為 ' + (CST_ZH[c.status] || c.status) : '新增 ' + ((DICT.concern_labels || {})[c.concern_code] || c.concern_code)) + ' <button class="btn small" type="button" data-act="unstage_co" data-val="' + i + '">移除</button></li>'; }));
  var onAssess = CUR.tab === 'assess';   /* v4.4 WP-A：在「本次評估」頁，場域、院所、接觸方式已在頁首，這裡不重複 */
  var ctxRow = Object.keys(ST.obs).length ? '<div class="row">' + (onAssess ? '' : ctxSelectsHtml()) +
    '<label class="f"><span>記為一次評估</span><input type="checkbox" id="as_is_assessment"' + (asmDefault() ? ' checked' : '') + '></label></div>' +
    '<p class="small muted">「記為一次評估」＝下次「與上次相比」從這次算起；只更新處方、只補一筆體重或檢驗時通常不勾（3.2 版起這種情況預設不勾）。</p>' :
    /* 3.4（T05／REG-A-005）：只記「完成工作」（例如 7 天追蹤）時也要記怎麼聯絡的，不必另建一次評估 */
    (!onAssess && ST.ac.some(function (a) { return a.action_status === 'COMPLETED'; }) ? '<div class="row"><label class="f">這次完成的工作，接觸方式（不預設；7 天追蹤必填）<select id="as_contact">' + opt('', '請選擇') + ['FACE_TO_FACE', 'PHONE', 'VIDEO'].map(function (x) { return opt(x, CM_ZH[x], enc().contact === x); }).join('') + '</select></label></div>' : '');
  /* 3.3（R-A-007／REG-A-006／ZT-A-001）：這次記了警訊或居家體重——
     需要立刻處理的警訊（119／現在去急診）：伺服器一律建立待處理警訊；不建立只能選理由碼（留稽核），不能用一般勾選關掉；
     其他警訊或體重：記錄者勾選才建立（預設不勾，每位病人每次重設） */
  var lvl = stagedSignalLevel(), raiseRow = '';
  if (lvl === 'HIGH') raiseRow = '<div class="notice err"><p><strong>這次記錄的是需要立刻處理的警訊：儲存時會建立待處理警訊</strong>（團隊工作清單看得到，要有人回應並確認後續）。如果病人現在需要立刻求救，請先依求救階梯處理，再回來儲存。</p>' +
    '<label class="f">不建立的理由（只有符合時才選）<select id="alert_suppress"><option value="">建立待處理警訊</option>' + SUPPRESS_ZH.map(function (x) { return opt(x[0], x[1], enc().suppress === x[0]); }).join('') + '</select></label><p class="small muted">選了理由就不建立，並會留下稽核紀錄。</p></div>';
  else if (lvl === 'LOW') raiseRow = nurSameDayRowHtml();   /* 5.1 W51-NUR（NU-09）：今天聯絡級警訊必選處置；沒選＝建立待處理警訊 */
  return '<section class="panel noprint" id="staged_panel"><h2>這次的變更（' + n + '）</h2><div id="staged_unadded">' + unaddedHtml() + '</div>' + (n ? '<ul>' + list.join('') + '</ul>' : '<p class="muted">還沒有變更。沒有變的資料不用重填。</p>') + raiseRow + ctxRow +
    '<div class="row"><button class="btn primary" type="button" data-act="save"' + (n ? '' : ' disabled') + '>儲存這次變更</button>' + (n ? '<button class="btn" type="button" data-act="discard">全部放棄</button>' : '') + '</div><div id="save_out" aria-live="polite"></div></section>';
}
/* 3.2（R-A-008）：只動了處方、實際用藥或單一檢驗／體重時，不預設記為一次評估（避免成為別人「與上次相比」的起點） */
var SUPPRESS_ZH = [['HANDLED_IN_PERSON_NOW', '我已當面處理（病人在現場）'], ['SENT_TO_ED_OR_119', '已請病人去急診或已撥 119'], ['ALERT_ALREADY_OPEN', '這位病人已有未結案的同一警訊']];
function stagedSignalLevel() {
  var o = ST.obs.safety_signals, w = ST.obs.home_weight_kg, lv = {}; (DICT.safety_signals || []).forEach(function (x) { lv[x.id] = x.level; });
  var ids = o && Array.isArray(o.value) ? o.value : [];
  if (ids.some(function (id) { return ['EMERGENCY', 'URGENT_NOW', 'URGENT_IN_PERSON'].indexOf(lv[id]) >= 0; })) return 'HIGH';
  return ids.length || w ? 'LOW' : '';
}
function asmDefault() {
  if (enc().assessment === false) return false;
  var ks = Object.keys(ST.obs), light = ks.every(function (k) { return k === 'prescribed_meds' || k === 'med_instances' || (field(k).truth_domain === 'OBJECTIVE_RESULT') || k === 'home_weight_kg'; });
  if (ks.length && light && ks.length <= 2 && enc().assessment !== true) return false;
  if (ks.some(function (k) { return ST.obs[k].qualifiers && ST.obs[k].qualifiers.bulk_confirm; })) return true;   /* 5.0 W5-C（K07-04）：整段沿用是本次評估的一部分（伺服器要求同時是一次評估） */
  if (ks.length && ks.every(function (k) { return ST.obs[k].action_type === 'CONFIRM'; }) && enc().assessment !== true) return false;   /* v4.6：只有「沿用」、沒有任何新值 → 不預設記為一次評估（不成為別人「和上次比」的起點） */
  return true;
}
function buildPayload() {
  var obs = Object.keys(ST.obs).map(function (k) { var o = JSON.parse(JSON.stringify(ST.obs[k])); delete o.label; return o; });
  var p = { patient_key: CUR.pk, base_snapshot_version: CUR.rec.base_snapshot_version, observations: obs, care_events: ST.ce, actions: ST.ac, concerns: ST.co, education: ST.ed };
  if (ST.resolves.length) p.resolves_transaction_ids = ST.resolves.slice();
  if ((ST.v4 || []).length) p.v4_records = ST.v4.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (k !== 'label') o[k] = r[k]; }); return o; });
  if ($('raise_alert') && $('raise_alert').checked) p.raise_alert = true;
  if ($('alert_suppress') && $('alert_suppress').value) p.alert_suppress_reason = $('alert_suppress').value;
  nurDispositionPayload(p);   /* 5.1 W51-NUR（NU-09） */
  if (obs.length && $('as_is_assessment') && $('as_is_assessment').checked) { p.assessment = { care_setting: $('as_setting').value, facility_code: $('as_fac').value, respondent: 'CLINICIAN' };
    /* 5.2 H-06：補登接觸——開始時間＝接觸日期中午（台灣時間），這次欄位的檢查日期若是今天改為接觸日期（伺服器另以接觸日期補沒填的欄位） */
    var ed0 = enc().enc_date; if (ed0 && ed0 < todayTW()) { p.assessment.started_at = new Date(Date.parse(ed0 + 'T12:00:00+08:00')).toISOString(); p.assessment.backfill_reason = enc().bf_reason || ''; p.observations = p.observations.map(function (o) { return o.effective_at === todayTW() ? Object.assign({}, o, { effective_at: ed0 }) : o; }); } if ($('as_contact') && $('as_contact').value) p.assessment.contact_mode = $('as_contact').value;
    /* v4.9：這次評估引用今天其他醫療人員已記錄的核心項目（沒有重新填寫的）→ 只送事件代碼，伺服器記 REFERENCE_USED 稽核，不建立新觀察 */
    var refs = wbAsk().filter(function (x) { return x.disposition === 'REVIEW_EXISTING' && x.reference && x.reference.event_id && !ST.obs[x.field_id]; }).map(function (x) { return x.reference.event_id; });
    if (CUR.rec.ask_budget) refs = refs.concat(ask51Refs().filter(function (id) { return refs.indexOf(id) < 0; }));   /* 5.1 W51-ASK：同日承接的確認（只送事件代碼） */
    if (refs.length) p.references = refs;
    /* 4.9.3 WP-A：略過今日警訊、暫不安排下次聯絡的理由碼（只在這次評估適用時送出） */
    if (enc().skip_safety && !ST.obs.safety_signals) p.safety_not_assessed_reason = enc().skip_safety;
    if (enc().next_contact_defer && needNextContact()) p.next_contact_deferred_reason = enc().next_contact_defer; }
  else if ($('as_fac')) p.assessment = null;
  if ($('as_contact') && $('as_contact').value) p.actions = p.actions.map(function (a) { return a.action_status === 'COMPLETED' && !a.contact_mode ? Object.assign({}, a, { contact_mode: $('as_contact').value }) : a; });
  /* 同樣內容用同一個儲存代碼：重按、網路重送都不會重複；內容改了就換代碼 */
  /* 5.0 W5-C（K07-06／K11-03）：本次必問題數與加問數只取伺服器的題目預算（畫面不自行重算） */
  if (p.assessment && CUR.rec.ask_budget) { p.assessment.ask_total = CUR.rec.ask_budget.ask_total; p.assessment.extra_total = CUR.rec.ask_budget.extra_total; }
  var sha = enc().sh_ack; if (sha && sha.outcome && sha.outcome !== 'LATER') p.alert_acks = shOpenAlerts().map(function (a) { return { alert_id: a.alert_id, outcome: sha.outcome, detail: sha.detail }; });   /* 5.2 C-09 */
  p.idempotency_key = 'c-' + SESSION + '-' + hash(JSON.stringify(p));
  /* v4.4 WP-A：開啟到儲存的毫秒數（不進儲存代碼；伺服器用自己的時間回推開始時間） */
  if (p.assessment && enc().opened_ms) p.assessment.elapsed_ms = Math.max(0, Math.round(Date.now() - enc().opened_ms));
  if (p.assessment && CUR.rec.ask_budget) p.assessment.click_count = Math.min(100000, enc().clicks || 0);   /* 量測資料，不進儲存代碼 */
  return p;
}
/* 5.2 C-09：未結案的自傷相關警訊（儲存含 self_harm_risk 的評估時一起記錄處理結果） */
function shOpenAlerts() { return ST.obs.self_harm_risk ? (CUR.rec.safety_alerts || []).filter(function (a) { return a.status === 'OPEN' && !a.grouped_into && /SELF_HARM/.test(JSON.stringify(a.signals || '')); }) : []; }
function shAckHtml(list) {
  var oc = (DICT.alert_outcomes || []).filter(function (o) { return ['SUPERVISOR_REVIEWED', 'FOLLOWUP_CONFIRMED', 'FOLLOWUP_UNREACHABLE'].indexOf(o[0]) < 0; });
  return '<div class="notice warn" id="sh_ack_box"><p><strong>這位病人還有 ' + list.length + ' 筆未結案的自傷相關警訊</strong>（' + esc(list.map(function (a) { return (a.signals || []).map(function (x) { return x.label; }).join('；'); }).join('／')) + '）。請同時記錄警訊處理結果，這次儲存會一起完成評估與警訊回應。</p>' +
    '<div class="row"><label class="f">警訊處理結果<select id="sh_ack_out">' + opt('', '請選擇') + oc.map(function (o) { return opt(o[0], o[1]); }).join('') + opt('LATER', '稍後在警訊卡記錄（這次只存評估）') + '</select></label>' +
    '<label class="f">聯絡對象（已聯絡／請病人就醫時必填）<select id="sh_ack_whom">' + opt('', '—') + [['PATIENT', '病人'], ['CAREGIVER', '家屬或照顧者'], ['OTHER_PROVIDER', '其他醫療人員']].map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label>' +
    '<label class="f">方式<select id="sh_ack_mode">' + opt('', '—') + [['FACE_TO_FACE', '面對面'], ['PHONE', '電話'], ['VIDEO', '視訊']].map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label>' +
    '<button class="btn small primary" type="button" data-act="sh_ack_save">記錄並儲存</button></div><p id="sh_ack_err" class="small field-err" role="alert"></p></div>';
}
/* 3.0.0 欄位層級衝突：列出哪一項被別人改了、改成什麼、是誰；使用者看過後自己決定（不做最後寫入者覆蓋） */
var CK_ZH = { FIELD: '欄位', ACTION: '行動', CONCERN: '關心的問題', CARE: '就醫事件' };
function conflictListHtml(list) {
  if (!list || !list.length) return '';
  return '<ul class="small">' + list.map(function (c) {
    var what = c.kind === 'FIELD' ? field(c.ref).label : (c.kind === 'ACTION' ? actName(CUR.rec.view.actions[c.ref] || {}) : (c.kind === 'CONCERN' ? ((DICT.concern_labels || {})[(CUR.rec.view.concerns[c.ref] || {}).concern_code] || '關心的問題') : '就醫事件'));
    var th = c.theirs || {}, val = c.kind === 'FIELD' ? (th.action_type === 'CONFIRM' ? '沿用（確認）' : fmtVal(c.ref, th.value)) : (c.kind === 'ACTION' ? (AST_ZH[th.status] || th.status || '') : (c.kind === 'CONCERN' ? (CST_ZH[th.status] || th.status || '') : '已被更正'));
    return '<li>' + esc(CK_ZH[c.kind] || c.kind) + '：<strong>' + esc(what) + '</strong> 已被 ' + esc(th.by === 'PATIENT_LINK' ? '病人連結' : (th.by || '')) + ' 於 ' + esc(d10(th.at)) + ' ' + esc(hm(th.at)) + ' 改為「' + esc(val) + '」</li>'; }).join('') + '</ul>';
}
/* 4.9.3 WP-A：理由碼（與伺服器 L.SAFETY_SKIP_REASONS／L.NEXT_CONTACT_DEFER_REASONS 同一份） */
var SKIP_ZH = [['PHONE_UNREACHED', '電話未接通'], ['NON_CLINICAL_CONTACT', '非臨床聯絡（例如行政或排程事項）'], ['PATIENT_DECLINED', '病人拒答'], ['ASKED_TODAY_BY_COLLEAGUE', '今天其他同仁已問過（尚未記錄）'], ['OTHER', '其他']];
var DEFER_ZH = [['RETURNED_TO_PRIMARY_CARE', '已轉回基層或其他院所追蹤'], ['PATIENT_DECLINED', '病人婉拒再追蹤'], ['CARE_CLOSED', '照護已結案'], ['OTHER', '其他']];
var NOTE_ZH = { SAFETY_NOT_ASSESSED: '這次評估未問今日警訊', NEXT_CONTACT_DEFERRED: '這次評估暫不安排下次聯絡' };
function asmOn() { return !!($('as_is_assessment') && $('as_is_assessment').checked && Object.keys(ST.obs).length && $('as_setting') && $('as_setting').value); }
function needNextContact() {
  var nc = CUR.rec.plan && CUR.rec.plan.journey ? CUR.rec.plan.journey.next_contact : null;
  return !!nc && nc.status === 'NOT_SCHEDULED' && !ST.ac.some(function (a) { return !a.action_id && ['FOLLOWUP_VISIT', 'LAB_CHECK'].indexOf(a.action_type) >= 0 && a.due_at; });
}
function nextContactHtml() {
  return '<div class="notice warn" id="next_contact_box"><p>這位病人還沒有排定下次聯絡（回診、電話追蹤或抽血都沒有到期日）。建議在結束這次接觸前排定；不排也可以，請選理由。</p>' +
    '<div class="row"><label class="f">下次聯絡日期<input type="date" id="nc_due" min="' + esc(todayTW()) + '"></label><label class="f">負責職類<select id="nc_owner">' + ME.roles.map(function (r) { return opt(r, ROLE_ZH[r] || r, r === ME.role); }).join('') + '</select></label>' +
    '<button class="btn small" type="button" data-act="nc_create">建立下次聯絡並儲存</button></div>' +
    '<div class="row"><label class="f">暫不安排的理由<select id="nc_defer">' + opt('', '請選擇') + DEFER_ZH.map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label><button class="btn small" type="button" data-act="nc_defer">暫不安排，仍要儲存</button></div><p id="nc_err" class="small field-err" role="alert"></p></div>';
}
function save() {
  if (editorDirty() || (CUR.edErr && CUR.editing === CUR.edErr.field_id)) { var uf = CUR.edErr ? CUR.edErr.field_id : CUR.editing; inlineErr('save_out', '還有 1 項未加入：' + field(uf).label + '。請按「加入這次變更」（或按「取消」放棄這一項）後再儲存；其他已加入的變更都還在。'); var sb0 = $('staged_unadded'); if (sb0) sb0.innerHTML = unaddedHtml(); return; }   /* 5.2 D-06 */
  if (!stagedCount()) return;
  /* 3.0.0：場域不預設——要記成一次評估時，必須明確選擇門診、住院或長照／社區／居家 */
  if ($('as_is_assessment') && $('as_is_assessment').checked && Object.keys(ST.obs).length && $('as_setting') && !$('as_setting').value) { inlineErr('save_out', '請先選擇場域（門診、住院或長照／社區／居家）；不確定時請取消勾選「記為一次評估」。'); var se = $('as_setting'); if (se) se.focus(); return; }
  if (asmOn() && enc().enc_date && enc().enc_date < todayTW() && !enc().bf_reason) { inlineErr('save_out', '接觸日期不是今天：請選補登理由（或把接觸日期改回今天）。'); if ($('as_bf')) $('as_bf').focus(); return; }   /* 5.2 H-06 */
  /* 3.4（T05／REG-A-005）：完成 7 天追蹤要記接觸方式（伺服器同樣檢查） */
  if (ST.ac.some(function (a) { var c = CUR.rec.view.actions[a.action_id] || {}; return a.action_status === 'COMPLETED' && c.action_ref === 'TPL:FOLLOWUP_7D'; }) && !($('as_contact') && $('as_contact').value)) { inlineErr('save_out', '完成 7 天追蹤請選接觸方式（面對面、電話或視訊）。'); if ($('as_contact')) $('as_contact').focus(); return; }
  /* 4.9.3 WP-A（移植 4.9.2，CARE-CARD-02）：記為一次評估時，今日警訊要嘛這次有問、要嘛今天別的同仁已記錄；都沒有 → 先提醒。
     可以略過，但必須選理由（理由隨這次評估送出、寫入稽核，完整紀錄頁看得到）；略過時今日警訊仍是「未評估」 */
  if (asmOn() && !ST.obs.safety_signals && !enc().skip_safety && !wbAsk().some(function (x) { return x.field_id === 'safety_signals' && x.disposition === 'REVIEW_EXISTING'; })) {
    $('save_out').innerHTML = '<div class="notice warn" id="skip_safety_box"><p>這次記為一次評估，但還沒有問「今日警訊」。請到「本次評估」勾選今日警訊（都沒有就勾「以上都沒有（已逐項詢問）」）。</p>' +
      '<div class="row"><label class="f">這次不評估警訊的理由（略過時必選）<select id="skip_safety_reason">' + opt('', '請選擇') + SKIP_ZH.map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label>' +
      '<button class="btn small" type="button" data-act="save_skip_safety">這次不評估警訊，仍要儲存</button></div><p id="skip_safety_err" class="small field-err" role="alert"></p></div>';
    return;
  }
  /* 4.9.3 WP-A（CARE-NURSE-04）：記為一次評估、這位病人還沒有排定下次聯絡、這次也沒有新增回診／抽血 → 儲存前提醒一次（不硬擋）：
     可以當場建立下次聯絡，或選「暫不安排」的理由（隨這次評估寫入稽核） */
  if (asmOn() && needNextContact() && !enc().next_contact_ok) { $('save_out').innerHTML = nextContactHtml(); return; }
  /* 5.2 C-09：這次記錄自傷風險，而這位病人還有未結案的自傷相關警訊 → 儲存前請同時記錄警訊處理結果（一次儲存完成評估與警訊回應），或明確選「稍後在警訊卡記錄」 */
  var shOpen = shOpenAlerts();
  if (shOpen.length && !enc().sh_ack) { $('save_out').innerHTML = shAckHtml(shOpen); return; }
  var p = buildPayload();
  sync('SAVING'); $('save_out').innerHTML = '';
  [].forEach.call(document.querySelectorAll('[data-act="save"]'), function (b) { b.disabled = true; });
  call('saveEvents', [p]).then(function (r) {
    if (r.status === 'COMMITTED') {
      ST = { obs: {}, ce: [], ac: [], co: [], ed: [], resolves: [], v4: [] }; resetEnc();
      var ep = (r.episode_results || []).filter(function (x) { return x.status === 'MANUAL_REVIEW' || x.status === 'DUPLICATE'; });
      if ((r.alert_ack_errors || []).length) setTimeout(function () { inlineErr('save_out', '評估已儲存，但警訊處理結果有 ' + r.alert_ack_errors.length + ' 筆沒有記上：' + r.alert_ack_errors.map(function (x) { return x.message; }).join('；') + '。請到警訊卡再記一次。'); }, 0);   /* 5.2 C-09 */
      sync('SAVED', '紀錄版本 ' + r.snapshot_version + (r.replayed ? '（先前已儲存）' : '') + ((r.alert_acks || []).length ? '；已同時記錄 ' + r.alert_acks.length + ' 筆警訊處理結果' : '') + (r.merged_with_newer ? '；您開啟後別人新增的 ' + r.merged_with_newer + ' 筆紀錄與這次沒有衝突，已一起保留' : '') + (ep.length ? '；住院事件：' + ep.map(function (x) { return x.status === 'DUPLICATE' ? '與既有紀錄重複，已合併' : '需要人工確認'; }).join('、') : ''));
      /* 5.2 E-05：儲存成功後一定以伺服器回傳的版本號重取同一位病人（總覽、用藥與其他分頁共用同一份 CUR.rec）；讀到的版本比儲存結果舊 → 1 秒後再取，最多 3 次，仍不一致就明白標示 */
      reloadUntil(CUR.pk, r.snapshot_version, 3);
    } else if (r.status === 'CONFLICT_REVIEW_REQUIRED') {
      sync('CONFLICT', r.message);
      $('save_out').innerHTML = '<p class="notice warn">' + esc(r.message) + '</p>' + conflictListHtml(r.conflicts) + '<button class="btn primary" type="button" data-act="reload_keep">重新載入（保留我這次的變更）</button>';
    } else {
      /* 5.2 E-05：其他狀態（例如交易中止）不能靜默：明白標示沒有存入，畫面仍保留這次的變更 */
      sync('FAILED', '這次沒有存入（' + (r.status || '未知狀態') + '）' + (r.message ? '：' + r.message : ''));
      [].forEach.call(document.querySelectorAll('[data-act="save"]'), function (b) { b.disabled = false; });
    }
  }).catch(function (e) {
    sync('FAILED', errText(e));
    $('save_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>';
    [].forEach.call(document.querySelectorAll('[data-act="save"]'), function (b) { b.disabled = false; });
  });
}

/* =====================================================================
 * 縱向精準照護計畫（2.8.0）：伺服器產生的同一份計畫（CUR.rec.plan）→ 醫療人員首頁、衛教記錄、列印行動計畫
 * 畫面不重算臨床判斷；衛教卡文字取自畫面內建的公開版內容（window.HFPC_CONTENT，與病人頁同一份）
 * ===================================================================== */
var TIER_CSS = { G0: 'err', G1: 'err', G2: 'warn', G3: 'warn', G4: '', G5: '', G6: '' };
var ACTION_ZH = { SEEK_URGENT_CARE: '立即就醫', SEEK_SAME_DAY_CARE: '今天當面看', CONTACT_TODAY: '今天聯絡團隊', CONTACT_TEAM: '聯絡團隊確認', VERIFY: '核對', BRING_MEDICATIONS: '帶藥袋核對',
  MONITOR: '監測／追蹤', COMPLETE_TASK: '完成待辦', DISCUSS: '討論', LEARN: '衛教', DO_NOT_SELF_CHANGE: '不要自行改變', FOLLOW_VERIFIED_PLAN: '照已確認的計畫', CONTINUE_AS_CONFIRMED: '照已確認的方式使用', REVIEW_RECORD: '確認紀錄' };
var TIMING_ZH = { NOW: '現在', TODAY: '今天', THIS_WEEK: '這週', NEXT_VISIT: '下次看診', ONGOING: '持續', ANYTIME: '有空時' };
var EDU_ZH = { NOT_ASSESSED: '已講解（尚未確認理解）', UNDERSTOOD: '教回通過（已理解）', PARTIAL: '部分理解', NEEDS_RETEACH: '需要再教', DEFERRED: '延後', SELF_CHECKED: '病人自我確認', NEEDS_HELP: '病人說還不太確定' };
var METHOD_ZH = { TEACH_BACK_VERBAL: '請病人用自己的話說', DEMONSTRATION: '請病人示範', CHECK_QUESTION: '確認題', SELF_REPORT: '自評', NONE: '' };
var CHANNEL_ZH = { FACE_TO_FACE: '面對面', PHONE: '電話', VIDEO: '視訊', PRINT: '書面', PATIENT_LINK: '病人連結' };
var SUPP_ZH = { COMFORT_FIRST: '照護目標為舒適優先（5.2 G-03）', EDU_UNDERSTOOD_NO_NEW_TRIGGER: '已確認理解，之後沒有新的相關變化', EDU_SELF_CHECKED_MAINTENANCE: '病人已自我確認（維持類衛教）', CONFLICT_URGENT_PRESENT: '有需要優先處理的事', NOT_STABLE: '目前不是穩定狀態', COVERED_BY_SAME_DAY: '已由「今天聯絡」涵蓋' };
var LOOP_ZH = { MISSED: '未在期限內完成', OPEN: '未完成', IN_PROGRESS: '進行中', BARRIER: '遇到困難', PATIENT_REPORTED_DONE: '病人說完成（待確認）', WORSE: '更困擾', DEFERRED: '延後' };
var DOMAIN_ZH = { ACTION: '行動', CONCERN: '病人關心', TRANSITION: '出院轉銜', MONITORING: '監測', MEDICATION: '用藥', EDUCATION: '理解', SAFETY: '安全', DATA: '資料' };
/* 4.9.3 WP-A（CARE-PCP-02）：「下次看診」帶入照護旅程的下次聯絡日期（醫療人員畫面）；沒有就寫未排定 */
function nextVisitHint() { var nc = CUR && CUR.rec.plan && CUR.rec.plan.journey ? CUR.rec.plan.journey.next_contact : null; return '<span data-next-hint="1">（' + (nc && nc.status === 'SCHEDULED' && nc.due_at ? esc(md(nc.due_at)) + (nc.overdue ? '，已超過' : '') : '下次聯絡未排定') + '）</span>'; }
function catalog() { return window.HFPC_CONTENT || { cards: {}, rules: [], medications: [] }; }
function cardFull(id) { var C = catalog(); if (C.cards && C.cards[id]) return C.cards[id]; var r = (C.rules || []).filter(function (x) { return x.id === id; })[0]; return r ? r.card : null; }
function cardMeta(id) { return (DICT.cards_meta || {})[id] || {}; }
function cardTitle(id) { var m = cardMeta(id); return m.ti || id; }
function medClass(id) { return (catalog().medications || []).filter(function (m) { return m.id === id; })[0] || { id: id, label: (DICT.med_classes[id] || {}).label || id }; }
function roleList(ws) { var R = catalog().roles || {}; return (ws || []).map(function (w) { return ROLE_ZH[w] || ({ DOCTOR: '醫師', HF_TEAM: '心衰竭團隊', PHARMACIST: '藥師' }[w]) || (R[w] && R[w].label) || w; }).join('、'); }
function ptabsHtml(tab) {
  var P = CUR.rec.plan, n = P ? P.messages.filter(function (m) { return Number(m.tier.slice(1)) <= 2; }).length : 0;
  var T = [['overview', '總覽（照護計畫）' + (n ? ' ' + n : '')], ['assess', '本次評估'], ['data', '所有欄位'], ['meds', '用藥'], ['care', '就醫與行動'], ['edu', '衛教歷程'], ['record', '趨勢與異動']];
  /* 3.1.0（HFPC-AUD-0707）：不是完整的 tab 元件，就不宣稱 tablist；用導覽＋aria-current（鍵盤 Tab 依序可達） */
  return '<nav class="ptabs noprint" aria-label="病人紀錄分頁">' + T.map(function (t) { return '<button class="btn small' + (t[0] === tab ? ' primary' : '') + '" type="button"' + (t[0] === tab ? ' aria-current="page"' : '') + ' data-act="ptab" data-val="' + t[0] + '">' + esc(t[1]) + '</button>'; }).join('') + '</nav>' +
    (PTAB_PURPOSE[tab] ? '<p class="tab-purpose small noprint" data-purpose="' + esc(tab) + '">' + esc(PTAB_PURPOSE[tab]) + '</p>' : '');
}
/* 快速更新（v4.4 WP-A）：每次核心（字典 assessment_core，與 HF-DQ11 核心層完整率同一份）＋依照護計畫補充（計畫缺的資料、過期、出院與用藥改變情境、溝通需要未記錄）；
   總數不超過 assessment_core.max_quick_total，核心一定保留。電話追蹤時整份依「安全警訊 → 和上次比 → 症狀 → 體重 → 用藥 → 其他」排列 */
/* v4.6 WP-A3：事件錨點（舊快取沒有這個欄位時沿用最近一次評估，與 4.4 行為相同；讀取時伺服器會依投影版號重建） */
/* v4.9 S1：錨點＝今天之前、具臨床職類的醫療人員評估（與伺服器 PJ.anchorFor 同一規則；「今天」取伺服器資料時間 as_of） */
function anchorOf(v) {
  /* 5.0 W5-C（K09-03／FW-13）：依臨床日期（補登的評估以實際發生日；同日依記錄時間），與伺服器 PJ.anchorFor 同一規則 */
  /* 5.2 C-01：今天已有醫療人員評估 → 今天最早的一次；否則今天之前最近一次（與伺服器 PJ.anchorFor 同一規則） */
  if (v && v.clinician_timeline) { var cd = function (a) { return d10(a.clinical_at || a.completed_at); }, td = d10(v.as_of), srt = function (x, y) { return cd(x) < cd(y) ? -1 : cd(x) > cd(y) ? 1 : (x.completed_at < y.completed_at ? -1 : 1); };
    var sd = v.clinician_timeline.filter(function (a) { return cd(a) === td; }).sort(srt); if (sd.length) return sd[0];
    var b = v.clinician_timeline.filter(function (a) { return cd(a) < td; }).sort(srt); return b.length ? b[b.length - 1] : null; }
  return v && v.last_clinician_assessment !== undefined ? v.last_clinician_assessment : (v ? v.last_assessment : null); }
function anchorHtml(v) {
  var a = anchorOf(v); if (!a) return '<p class="small muted" id="anchor_line">比較基準：還沒有醫療人員評估紀錄（本次為第一次；只有病人連結的回報不算）。</p>';
  var d = d10(a.clinical_at || a.completed_at), n = d ? Math.round((Date.parse(d10(new Date().toISOString())) - Date.parse(d)) / 86400000) : null;
  /* v4.8 WP-2（G22）：錨點之後有出院（住院 episode 或出院事件）→「和上次比」改以出院後到現在回答，並提示重新確認基線 */
  var dis = ((v.episodes || []).map(function (e) { return e.discharge_at; }).concat((v.care_events || []).filter(function (e) { return /DISCHARGE/.test(e.event_type || ''); }).map(function (e) { return e.occurred_at; })))
    .filter(function (x) { return x && d10(x) > d; }).sort().slice(-1)[0];
  if (dis) return '<p class="small" id="anchor_line">' + chip('請重新確認基線', 'warn') + ' 上次醫療人員評估（' + esc(d) + '）之後已出院（' + esc(d10(dis)) + '）：「和上次比」請以<strong>出院後到現在</strong>回答；乾體重、體重警戒與用藥請重新確認。</p>';
  if (n === 0) return '<p class="small" id="anchor_line">比較基準（「和上次比」指這一次）：<strong>今天 ' + esc(hm(a.completed_at)) + ' ' + esc(ROLE_ZH[a.provider_role] || a.provider_role || '') + '</strong>' + (a.contact_mode && CM_ZH[a.contact_mode] ? '｜' + CM_ZH[a.contact_mode] : '') + '：請問病人「和今天 ' + esc(hm(a.completed_at)) + ' 那次相比，有沒有變化」。</p>';   /* 5.2 C-01 */
  return '<p class="small muted" id="anchor_line">比較基準（「和上次比」指這一次）：' + esc(d) + (n !== null && n >= 0 ? '（' + n + ' 天前）' : '') + '｜' + esc(ROLE_ZH[a.provider_role] || a.provider_role || '') + (a.contact_mode && CM_ZH[a.contact_mode] ? '｜' + CM_ZH[a.contact_mode] : '') + '。距今天數只供參考，不做判定。</p>';
}
function coreFields(v) {
  var C = DICT.assessment_core || {}, list = (anchorOf(v) ? C.follow_up : C.first_contact) || [];   /* v4.6 WP-A3：錨點＝最近一次醫療人員評估（只有病人連結紀錄 → 第一次） */
  return list.map(function (it) { if (it && it.any_of) return (enc().contact === 'PHONE' || enc().contact === 'VIDEO') && it.any_of.indexOf('home_weight_kg') >= 0 ? 'home_weight_kg' : it.any_of[0];   /* v4.6：視訊也在家，取居家體重 */ return it; })
    .filter(function (f) { return DICT.fields[f] && DICT.fields[f].clinician_editable; });
}
function quickCap() { var c = (DICT.assessment_core || {}).max_quick_total; return typeof c === 'number' && c > 0 ? c : 12; }
var QUICK_OTHER_ROLE = [];
function quickFields(v) {
  var P = CUR.rec.plan, core = coreFields(v), out = core.slice();
  QUICK_OTHER_ROLE = [];
  /* v4.8 WP-3（G03）：依計畫補充的欄位若不是本人職類可設定（院內流程政策 FIELD_AUTHORITY），不佔快速名額，改列「待○○設定」 */
  function add(f) { if (DICT.fields[f] && DICT.fields[f].clinician_editable && f !== 'prescribed_meds' && !sunsetHidden(f) && out.indexOf(f) < 0) { if (core.indexOf(f) < 0 && !fieldAuthorized(f)) { if (QUICK_OTHER_ROLE.indexOf(f) < 0) QUICK_OTHER_ROLE.push(f); return; } out.push(f); } }
  if (P) {
    P.limiters.forEach(function (l) { (l.missing || []).forEach(add); });
    P.contexts.forEach(function (c) { if (c.code === 'EARLY_POST_DISCHARGE') { add('weight_kg'); add('weight_alert_kg'); add('weight_alert_days'); } if (c.code === 'MEDICATION_CHANGE' || c.code === 'MEDICATION_RECONCILIATION') { add('med_reconciliation'); add('med_change_recent'); } });
    P.messages.forEach(function (m) { (m.basis || []).forEach(function (b) { var x = /^(?:MISSING|STALE|NO_DATE|BEFORE_MED_CHANGE|BEFORE_DISCHARGE):([a-z_]+)$/.exec(b.code); if (x) add(x[1]); }); });
    if (!P.communication.recorded) { add('comm_detail_preference'); add('comm_support_needs'); }
  }
  var ordered = phoneOrder(out), room = quickCap() - core.length, n = 0;
  return ordered.filter(function (f) { if (core.indexOf(f) >= 0) return true; if (n < room) { n++; return true; } return false; });
}
/* 3.4（T12）：電話追蹤時快速欄位依「安全警訊 → 和上次比 → 症狀 → 體重 → 用藥照吃／改變 → 計畫缺的資料」排列（同一份欄位，不新增欄位；總數由 quickFields 控制） */
var PHONE_RANK = [/^safety_signals$/, /^recent_change_/, /^symptom_status$/, /weight/, /^med_/];
function phoneRank(fid) { for (var i = 0; i < PHONE_RANK.length; i++) if (PHONE_RANK[i].test(fid)) return i; return PHONE_RANK.length; }
function phoneOrder(out) {
  if (enc().contact !== 'PHONE') return out;
  var extra = ['weight_kg', 'med_reconciliation', 'med_change_recent'].filter(function (f) { return DICT.fields[f] && DICT.fields[f].clinician_editable && out.indexOf(f) < 0 && !(f === 'weight_kg' && out.indexOf('home_weight_kg') >= 0); });   /* 獨立複核 F8：核心已有居家體重時不再加院內體重 */
  var base = out.filter(function (f) { return phoneRank(f) < PHONE_RANK.length; }), rest = out.filter(function (f) { return phoneRank(f) >= PHONE_RANK.length; });
  return base.concat(extra).map(function (f, i) { return [phoneRank(f), i, f]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (x) { return x[2]; }).concat(rest);
}
function basisHtml(bs) { return (bs || []).length ? '<ul class="small why">' + bs.map(function (b) { return '<li>' + esc(b.clin) + '</li>'; }).join('') + '</ul>' : ''; }
var FACET_ZH = { ACTION: '要做什麼', WHEN_HELP: '什麼情況要提早求助', DO_NOT: '什麼不要自己做' };
var RET_ZH = { NOT_REASSESSED: '之後還沒再確認', RETAINED: '之後再確認仍理解', PARTIAL_LOSS: '再確認只剩部分', LOSS_OBSERVED: '再確認已不記得', RELEARNED: '忘記後重新學會' };
var REASSESS_ZH = { TIME_REVIEW: '時間到了，再確認一次（不是忘記）', CAREGIVER_CHANGED: '照顧者有變動，再確認', CONTENT_CHANGED: '衛教內容已改版，只確認改到的部分' };
function lcodes(k) { return ((DICT.learning || {})[k] || []); }
function lzh(k, c) { var x = lcodes(k).filter(function (y) { return y[0] === c; })[0]; return x ? x[1] : c; }
function eduBadge(m) {
  var h = '';
  if (m.education) { var e = m.education; h += chip((m.reinforce ? '已理解，只提醒重點｜' : (m.reteach ? '再教一次｜' : '')) + (EDU_ZH[e.understanding] || e.understanding) + ' ' + d10(e.at), m.reteach ? 'warn' : (e.understanding === 'UNDERSTOOD' ? 'ok' : '')); }
  if (m.reassess) h += ' ' + chip(REASSESS_ZH[m.reassess] || m.reassess, 'warn');
  if (m.gap) h += ' ' + chip('懂了但還沒做到：先找原因', 'warn');
  if (m.education && (m.education.facets || []).some(function (f) { return f.conflict; })) h += ' ' + chip('評估不一致，待再確認', 'err');
  return h;
}
function teachPrompt(id) {
  var c = cardFull(id); if (!c) return '';
  if (c.teach && c.teach.prompt) return c.teach.prompt;
  if (c.check && c.check.q) return c.check.q;
  var m = cardMeta(id); return '請用自己的話告訴我：' + (m.sa || '這件事') + '，要怎麼做、什麼時候做？';
}
/* 衛教與理解確認（schema 3.8）：每張卡拆成學習目標（要做什麼／什麼情況要提早求助／什麼不要自己做），各自記錄結果；
   預期答案直接引用已審核衛教卡的欄位。另記：確認方式、需要多少協助、這次用的溝通方式、情境。 */
function facetsOf(id) { var m = cardMeta(id); return (m.fa && m.fa.length) ? m.fa : ['ACTION']; }
function facetExpect(id, f) {
  var c = cardFull(id) || {};
  if (f === 'WHEN_HELP') return c.escalate || '';
  if (f === 'DO_NOT') return c.do_not || '';
  return (c.actions || []).join('；') || cardMeta(id).sa || '';
}
/* v4.3 X06：衛教卡可讀性（素材評分；不代表病人已理解）。改版後未重評 → STALE */
function cardRatingHtml(id) {
  var R = ((DICT.card_ratings || {}).cards || {})[id];
  if (!R) return '<p class="small muted" data-rating="NONE">這張衛教卡還沒有可讀性評分（素材評分，不代表病人已理解）。</p>';
  return '<p class="small" data-rating="' + esc(R.state) + '">衛教卡可讀性（素材評分，不代表病人已理解）：可理解 ' + esc(R.u === null ? '—' : R.u) + '／可行動 ' + esc(R.a === null ? '—' : R.a) + '（' + esc(R.tool) + ' ' + esc(R.tool_version) + '，' + esc(R.rated_at) + '）' + (R.state === 'STALE' ? ' ' + chip('衛教卡已改版，評分待重評', 'warn') : '') + '</p>';
}
/* ==================== W5-L begin（5.0 K08-01／K08-03／K08-05）：學習階梯提示、跨職類紀錄、結構化教回 ==================== */
function progressCode(cid) {   /* 5.0 整併（W5-L→W5-M）：計畫給這張卡的進展類型；沒有時不加 */
  var it = (((CUR.rec.plan || {}).education_progress || {}).items || []).filter(function (x) { return x.card_id === cid; })[0];
  return it && /^[A-Z_]{1,30}$/.test(it.progress_type || '') ? ['PROGRESS:' + it.progress_type] : [];
}
function ladderStage(cid) {
  var P = CUR.rec.plan || {}, l = (P.learning || []).filter(function (x) { return x.card_id === cid; })[0];
  if (l && l.ladder) return l.ladder.stage;
  var it = ((P.education_progress || {}).items || []).filter(function (x) { return x.card_id === cid; })[0];
  return it ? it.stage : 'INTRODUCE';
}
function stageZh(code) { var x = lcodes('ladder_stages').filter(function (y) { return y[0] === code; })[0]; return x ? x[1] : code; }
var XROLE_ZH = { RISK_WHEN_HELP: '什麼情況要提早求助（高風險）', CAPABILITY_DIFFERENCE: '能力或回答者不同（家人協助、提示後才做得到）', TIME_PASSED: '距離上次確認已久' };
var PROG_ZH = { NEW_TOPIC: '新主題', NEXT_STAGE: '下一階段', RETEACH: '換方法重教', SAFETY_REVIEW: '安全重述', MAINTAIN: '維持與確認' };
function ladderHintHtml(cid) {
  var P = CUR.rec.plan || {}, l = (P.learning || []).filter(function (x) { return x.card_id === cid; })[0], st = ladderStage(cid), h = '<p class="small" id="lad_' + esc(cid) + '" data-stage="' + esc(st) + '">學習階梯：這次建議「' + esc(stageZh(st)) + '」';
  if (l && l.ladder && (l.ladder.preferred_modalities || []).length) h += '；優先用：' + esc(l.ladder.preferred_modalities.map(function (x) { return lzh('modalities', x); }).join('、'));
  if (l && l.ladder && (l.ladder.avoid_modalities || []).length) h += '；之前沒效的：' + esc(l.ladder.avoid_modalities.map(function (x) { return lzh('modalities', x); }).join('、'));
  h += '</p>';
  var x = l && l.cross_role;
  if (x && x.last_role && x.last_role !== ME.role && x.fresh) h += '<p class="small edu-xrole" id="xrole_' + esc(cid) + '">' + chip('別職類剛教過', 'ok') + ' ' + esc(ROLE_ZH[x.last_role] || x.last_role) + ' ' + esc(md(d10(x.last_at))) + ' 做了「' + esc(stageZh(x.last_stage || 'INTRODUCE')) + '」，結果：' + esc(EDU_ZH[x.last_result] || x.last_result) +
    '。不必重講整張卡，這次做「' + esc(stageZh(x.next_stage)) + '」' + (x.recheck.length ? '；只重問：' + esc(x.recheck.map(function (r) { return XROLE_ZH[r] || r; }).join('、')) : '') + '。</p>';
  return h;
}
function tbFieldsHtml(k) {
  return '<fieldset class="tb5"><legend class="small">結構化教回（建議填；只講解不算教回）</legend>' +
    '<label class="f">方法<select id="etbm_' + k + '">' + opt('', '不填（舊格式）') + lcodes('teachback_methods_v5').map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label>' +
    '<label class="f">示範結果（Show-me 必填）<select id="etbd_' + k + '">' + opt('', '—') + opt('SUCCESS', '示範成功') + opt('FAIL', '示範沒成功') + '</select></label>' +
    '<label class="f">回家實作的佐證（回家實作必填）<select id="etbo_' + k + '">' + opt('', '—') + lcodes('teachback_evidence').map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label>' +
    '<label class="f">當場重新說明<select id="etbx_' + k + '">' + opt('NO', '沒有') + opt('YES', '有') + '</select></label>' +
    '<label class="f">重新說明後，病人的回答<select id="etba_' + k + '">' + opt('', '—') + lcodes('teachback_responses').map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label>' +
    '<p class="small muted">選了方法時，上面每一項的「結果」代表病人的回答：理解＝說對、部分理解＝部分對、需要再教＝說錯；重新說明過，最後的判定以重新說明後的回答為準。</p></fieldset>';
}
var TB_FROM_RESULT = { UNDERSTOOD: 'CORRECT', PARTIAL: 'PARTIAL', NEEDS_RETEACH: 'INCORRECT' }, TB_TO_RESULT = { CORRECT: 'UNDERSTOOD', PARTIAL: 'PARTIAL', INCORRECT: 'NEEDS_RETEACH' };
function tbApply(id, rows, meth) {
  var m = $('etbm_' + id) ? $('etbm_' + id).value : ''; if (!m) return '';
  var demo = $('etbd_' + id).value, evd = $('etbo_' + id).value, rx = $('etbx_' + id).value, after = $('etba_' + id).value, ch = $('ec_' + id).value;
  if (m === 'SHOW_ME' && !demo) return 'Show-me 要記示範有沒有成功。';
  if (m === 'SHOW_ME' && ['PHONE', 'PRINT'].indexOf(ch) >= 0) return '電話或書面看不到示範；請改用教回，或把方式改成面對面／視訊。';
  if (m === 'HOME_PRACTICE' && !evd) return '回家實作要選客觀佐證（看過紀錄表、藥盒，或當場再做一次）。';
  if (rx === 'YES' && !after) return '有重新說明，請記重新說明後病人的回答。';
  var mm = m === 'SHOW_ME' ? 'DEMONSTRATION' : (m === 'HOME_PRACTICE' && meth === 'DEMONSTRATION' ? 'DEMONSTRATION' : 'TEACH_BACK_VERBAL'), cm = cardMeta(id), pv = 'P' + String(cm.ch || '0').toUpperCase().slice(0, 12), ls = ladderStage(id);
  var bad = '';
  rows.forEach(function (e) {
    var resp = TB_FROM_RESULT[e.understanding]; if (!resp) { bad = '結構化教回的每一項都要有病人的回答。'; return; }
    if (m === 'SHOW_ME' && demo === 'FAIL' && resp === 'CORRECT') resp = 'PARTIAL';   /* 說得出來但示範沒成功＝部分對（不能記成理解） */
    var re = rx === 'YES' && resp !== 'CORRECT', fin = re ? after : resp;
    var codes = ['TBI:' + id + '-' + (e.objective || 'ACTION'), 'TBV:' + pv, 'TBM:' + m, 'TBR:' + resp, 'TBX:' + (re ? 'YES' : 'NO')];
    if (m === 'SHOW_ME') codes.push('TBD:' + demo); if (m === 'HOME_PRACTICE') codes.push('TBO:' + evd); if (re) codes.push('TBA:' + after); if (ls) codes.push('LS:' + ls);
    e.method = mm; e.understanding = TB_TO_RESULT[fin]; e.trigger_codes = (e.trigger_codes || []).filter(function (c) { return !/^(TBI|TBV|TBM|TBR|TBD|TBO|TBX|TBA|LS):/.test(c); }).slice(0, 3).concat(codes);   /* 保留規則、分級與 PROGRESS 碼 */
  });
  return bad;
}
/* K08-03：衛教卡顯示「誰、何時、做了哪一階、結果」；K08-05：結構化教回紀錄（只講解不算教回） */
var TBM_ZH = { TEACH_BACK: '教回', SHOW_ME: 'Show-me', HOME_PRACTICE: '回家實作' }, TBR_ZH = { CORRECT: '說對', PARTIAL: '部分對', INCORRECT: '說錯' };
function eduLadderHtml(c) {
  var L = c.ladder; if (!L) return '';
  var h = '<p class="small" data-ladder="' + esc(L.stage) + '">' + chip('學習階梯：' + stageZh(L.stage), L.stage === 'GRADUATED' ? 'ok' : (L.stage === 'RETEACH' ? 'warn' : '')) + (L.previous_stage ? ' <span class="muted">上一次做的：' + esc(stageZh(L.previous_stage)) + '</span>' : '') + '</p>';
  if ((L.by_role || []).length) h += '<p class="small edu-byrole">各職類最近一次：' + L.by_role.map(function (b) { return esc(ROLE_ZH[b.role] || b.role) + ' ' + esc(md(d10(b.at))) + ' ' + esc(b.stage ? stageZh(b.stage) : (TBM_ZH[b.tb_method] || METHOD_ZH[b.method] || '')) + '→' + esc(EDU_ZH[b.result] || b.result); }).join('；') + '</p>';
  if ((c.teachbacks || []).length) h += '<div class="table-scroll"><table class="small tb5-log"><thead><tr><th scope="col">日期</th><th scope="col">評估者</th><th scope="col">題目</th><th scope="col">方法</th><th scope="col">病人回答</th><th scope="col">示範</th><th scope="col">重新說明後</th></tr></thead><tbody>' + c.teachbacks.map(function (t) {
    return '<tr><td>' + esc(d10(t.at)) + '</td><td>' + esc(ROLE_ZH[t.assessor_role] || t.assessor_role || '') + '</td><td>' + esc(FACET_ZH[t.facet] || t.facet) + (t.prompt_version !== 'P' + String(cardMeta(c.card_id).ch || '0').toUpperCase().slice(0, 12) ? '（當時的題目，卡片之後已改版）' : '') + '</td><td>' + esc(TBM_ZH[t.method] || t.method) + '</td><td>' + esc(TBR_ZH[t.patient_response_category] || '') + '</td><td>' + (t.demo_success === null ? '—' : (t.demo_success ? '成功' : '沒成功')) + '</td><td>' + (t.reteach ? esc(TBR_ZH[t.reteach_result] || '') : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  return h;
}
/* K08-06：主題覆蓋地圖（未開始／學習中／已畢業／不適用）；穩定病人的下一個新主題由此依序挑選 */
var COV_ZH = { NOT_STARTED: ['未開始', ''], LEARNING: ['學習中', 'warn'], GRADUATED: ['已畢業', 'ok'], NOT_APPLICABLE: ['不適用', ''] };
function coverageHtml(P) {
  if (!P || !(P.education_coverage || []).length) return '';
  var EP = P.education_progress || {}, h = '<h3>衛教主題覆蓋</h3><p class="small" id="edu_mode" data-mode="' + esc(EP.mode || '') + '">這次：' + esc({ SAFETY_FIRST: '先處理安全', MEANINGFUL_PROGRESS: '有需要往前的項目', MAINTAIN_AND_CONFIRM: '沒有新需求：維持與確認（不扣分）' }[EP.mode] || '') +
    (EP.next_topic ? '；建議下一個新主題：' + esc(cardTitle(EP.next_topic.card_id)) : '') + '</p><ul class="small" id="edu_coverage">' + P.education_coverage.map(function (c) { var z = COV_ZH[c.status] || [c.status, '']; return '<li data-card="' + esc(c.card_id) + '" data-status="' + esc(c.status) + '">' + chip(z[0], z[1]) + ' ' + esc(c.label) + (c.status === 'LEARNING' ? '<span class="muted">（' + esc(stageZh(c.stage)) + '）</span>' : '') + '</li>'; }).join('') + '</ul>';
  if ((EP.items || []).length) h += '<p class="small">這次每一項的進展：' + EP.items.map(function (x) { return esc(cardTitle(x.card_id)) + '＝' + esc(PROG_ZH[x.progress_type] || x.progress_type); }).join('；') + '</p>';
  return h;
}
/* ==================== W5-L end ==================== */
function eduControlHtml(m) {
  var id = m.card_id, staged = ST.ed.some(function (e) { return e.card_id === id; });
  if (staged) return '<p class="small">' + chip('這次會記錄衛教', 'ok') + '</p>';
  var k = esc(id), prev = {};
  ((m.education || {}).facets || []).forEach(function (f) { prev[f.facet] = f; });
  var rows = facetsOf(id).map(function (f) {
    var p = prev[f];
    return '<tr><th scope="row">' + esc(FACET_ZH[f] || f) + (p && p.comprehension !== 'NOT_ASSESSED' ? '<br><span class="small muted">上次：' + esc(EDU_ZH[p.comprehension] || p.comprehension) + (p.retention ? '；' + esc(RET_ZH[p.retention] || p.retention) : '') + '</span>' : '') + '</th>' +
      '<td class="small">' + esc(facetExpect(id, f)) + '</td><td><select id="ef_' + k + '_' + f + '" aria-label="' + esc((FACET_ZH[f] || f) + '結果') + '">' + opt('', '未評估') + [['UNDERSTOOD', '理解'], ['PARTIAL', '部分理解'], ['NEEDS_RETEACH', '需要再教']].map(function (o) { return opt(o[0], o[1]); }).join('') + '</select></td></tr>';
  }).join('');
  return '<details class="noprint edu-rec"><summary>記錄衛教與理解確認（教回，teach-back）</summary>' + cardRatingHtml(id) + '<p class="small">建議問法：「' + esc(m.prompt || teachPrompt(id)) + '」請病人用自己的話回答或實際示範，不要只問「懂了嗎」。逐項判定；沒問到的留「未評估」。</p>' + ladderHintHtml(id) +
    '<label class="f">這次做了什麼<select id="emode_' + k + '">' + opt('CHECK', '確認理解（逐項判定）') + opt('DELIVERED', '只講解，還沒確認') + opt('DEFERRED', '延後（這次不適合）') + '</select></label>' +
    '<div class="table-scroll"><table class="facets"><thead><tr><th scope="col">學習目標</th><th scope="col">預期答案（來自衛教卡）</th><th scope="col">結果</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="row">' +
    '<label class="f">確認方式（逐項判定時必選）<select id="em_' + k + '">' + opt('', '請選擇') + ['TEACH_BACK_VERBAL', 'DEMONSTRATION', 'CHECK_QUESTION', 'NONE'].map(function (x) { return opt(x, METHOD_ZH[x] || '沒有確認'); }).join('') + '</select></label>' +
    '<label class="f">教回形式（可不選；依確認方式帶出）<select id="etb_' + k + '">' + opt('', '依確認方式') + [['SPOKEN', '口述'], ['DEMONSTRATED', '示範'], ['WRITTEN', '寫下來']].map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label>' +
    tbFieldsHtml(k) +
    '<label class="f">需要多少協助<select id="es_' + k + '">' + opt('', '未評估') + lcodes('support_levels').filter(function (x) { return x[0] !== 'NOT_ASSESSED'; }).map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label>' +
    '<label class="f">這次用的溝通方式<select id="eo_' + k + '">' + opt('', '未記錄') + lcodes('modalities').map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label>' +
    '<label class="f">衛教日期（補登才填）<input type="date" id="edt_' + k + '"></label>' +
    '<label class="f">情境<select id="ex_' + k + '">' + opt('', '未記錄') + lcodes('contexts').map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label>' +
    '<label class="f">方式<select id="ec_' + k + '">' + ['FACE_TO_FACE', 'PHONE', 'VIDEO', 'PRINT'].map(function (x) { return opt(x, CHANNEL_ZH[x], (enc().edu_channel || enc().contact || 'FACE_TO_FACE') === x); }).join('') + '</select></label>' +
    '<label class="f">誰回答（逐項判定時必選）<select id="er_' + k + '">' + opt('', '請選擇') + opt('SELF', '病人本人', eduResp() === 'SELF') + opt('CAREGIVER', '家人／照顧者', eduResp() === 'CAREGIVER') + '</select></label>' +
    '<button class="btn small" type="button" data-act="edu_stage" data-val="' + k + '" data-msg="' + esc(m.id) + '">加入這次變更</button></div><p id="eerr_' + k + '" class="small field-err"></p></details>';
}
/* 3.0.0 衛教交接條：這張卡有沒有交給其他職類衛教、誰負責、接手了沒（來自行動紀錄的投影，不另存） */
function eduHandoffStrip(cid) {
  var ref = 'TEACH:' + cid, acts = Object.keys(CUR.rec.view.actions).map(function (k) { return CUR.rec.view.actions[k]; }).filter(function (a) { return a.action_ref === ref && ['COMPLETED', 'NOT_DONE', 'CANCELED'].indexOf(a.action_status) < 0; });
  var staged = ST.ac.some(function (a) { return !a.action_id && a.action_ref === ref; });
  var h = acts.map(function (a) { var ho = isHo(a);
    return '<p class="small edu-ho">' + chip('衛教交接', 'warn') + ' 負責：' + esc(ROLE_ZH[a.owner_role] || a.owner_role || '') + '｜' + esc(ho && a.action_status === 'PLANNED' ? '待接手' : (AST_ZH[a.action_status] || a.action_status)) + (a.due_at ? '｜' + esc(md(a.due_at)) + '前' : '') + (a.overdue ? ' ' + chip('逾期', 'err') : '') +
      ' <button class="btn small" type="button" data-act="goto_action" data-val="' + esc(a.action_id) + '">到行動處理</button></p>'; }).join('');
  if (staged) return h + '<p class="small">' + chip('這次會交給其他職類衛教', 'ok') + '</p>';
  if (acts.length) return h;
  return h + '<details class="noprint small"><summary>交給其他職類衛教（例如請藥師教用藥）</summary><div class="row"><label class="f">交給<select id="eho_role_' + esc(cid) + '">' + opt('', '請選擇') + ME.roles.filter(function (r) { return r !== ME.role; }).map(function (r) { return opt(r, ROLE_ZH[r] || r); }).join('') + '</select></label>' +
    '<label class="f">希望完成日<input type="date" id="eho_due_' + esc(cid) + '"></label><button class="btn small" type="button" data-act="edu_handoff" data-val="' + esc(cid) + '">加入這次變更</button></div><p id="ehoerr_' + esc(cid) + '" class="small field-err"></p></details>';
}
function stageEduHandoff(cid) {
  var r = $('eho_role_' + cid).value, d = $('eho_due_' + cid).value;
  if (!r) { inlineErr('ehoerr_' + cid, '請選要交給哪個職類。'); return; }
  if (d && d < today()) { inlineErr('ehoerr_' + cid, '希望完成日不能是過去。'); return; }
  var a = { action_type: 'EDUCATION', action_ref: 'TEACH:' + cid, action_status: 'PLANNED', owner_role: r, patient_visible: true, handoff_reason: 'EDUCATION' };
  if (!(DICT.handoff_reasons || []).some(function (c) { return c[0] === 'EDUCATION'; })) delete a.handoff_reason;
  if (d) a.due_at = d;
  ST.ac.push(a); afterStage();
}
/* 3.0.0：「誰回答」同一位病人這次登入沿用（不預設為病人本人，避免把照顧者的回答記成病人懂了）；方式沿用這次登入 */
var EDU_RESP = {};
function eduResp() { return CUR ? (EDU_RESP[CUR.pk] || '') : ''; }
function stageEdu(id, msgId) {
  var mode = $('emode_' + id).value, meth = $('em_' + id).value, resp = $('er_' + id).value;
  if (mode === 'CHECK' && !meth) { inlineErr('eerr_' + id, '請選確認方式（請病人用自己的話說、示範、確認題，或「沒有確認」）。'); return; }
  if (meth === 'DEMONSTRATION' && ['PHONE', 'PRINT'].indexOf($('ec_' + id).value) >= 0) { inlineErr('eerr_' + id, '電話或書面看不到病人示範；請改用「請病人用自己的話說」或確認題，或把方式改成面對面／視訊。'); return; }
  if (mode === 'CHECK' && !resp) { inlineErr('eerr_' + id, '請選「誰回答」：病人本人或家人／照顧者。'); return; }
  if (!meth) meth = 'NONE';
  if (resp) EDU_RESP[CUR.pk] = resp; enc().edu_channel = $('ec_' + id).value;
  var m = (CUR.rec.plan ? CUR.rec.plan.messages : []).filter(function (x) { return x.id === msgId; })[0] || {};
  var base = { card_id: id, channel: $('ec_' + id).value, respondent: resp || 'SELF', variant: resp === 'CAREGIVER' ? 'CAREGIVER' : 'STANDARD',
    trigger_codes: [m.rule_id, m.tier].filter(function (x) { return x && /^[A-Z0-9_:\-]{1,60}$/.test(x); }).concat(progressCode(id)) };   /* 5.0 整併：PROGRESS:<進展類型> 供 NEW-E1 指標（W5-L→W5-M） */
  if (CUR.rec.plan) base.plan_hash = CUR.rec.plan.plan_hash;
  var dt = $('edt_' + id).value;
  if (dt) { if (dt > today()) { inlineErr('eerr_' + id, '衛教日期不能是未來。'); return; } if (dt !== today()) base.effective_at = dt; }
  var rows = [];
  if (mode === 'DELIVERED' || mode === 'DEFERRED') rows.push(Object.assign({}, base, { kind: mode, understanding: mode === 'DEFERRED' ? 'DEFERRED' : 'NOT_ASSESSED', method: 'NONE', trigger_codes: base.trigger_codes.concat(ladderStage(id) ? ['LS:' + ladderStage(id)] : []) }));
  else {
    var sup = $('es_' + id).value, mod = $('eo_' + id).value, ctx = $('ex_' + id).value;
    facetsOf(id).forEach(function (f) {
      var r = $('ef_' + id + '_' + f).value; if (!r) return;
      var e = Object.assign({}, base, { kind: 'TEACH_BACK', understanding: r, method: meth, objective: f });
      var tbm = $('etb_' + id) ? $('etb_' + id).value : ''; if (tbm) e.teachback_method = tbm;   /* v4.3 X06：教回形式（沒選時伺服器依確認方式帶出） */
      if (sup) e.support_level = sup; if (mod) e.modality = mod; if (ctx) e.context = ctx;
      rows.push(e);
    });
    /* W5-L（K08-05）：結構化教回——題目代碼、題目版本、方法、病人回答（說對／部分對／說錯）、示範成功與否、是否重教、重教後結果；評估者＝登入者（伺服器記錄） */
    var tbErr = tbApply(id, rows, meth); if (tbErr) { inlineErr('eerr_' + id, tbErr); return; }
    if (!rows.length) { inlineErr('eerr_' + id, '請至少判定一個學習目標；只講解沒有確認請選「只講解，還沒確認」。'); return; }
    if (meth === 'NONE' && rows.some(function (e) { return e.understanding === 'UNDERSTOOD'; })) { inlineErr('eerr_' + id, '「理解」要有確認方式（請病人用自己的話說、示範或確認題）。'); return; }
  }
  ST.ed = ST.ed.filter(function (x) { return x.card_id !== id; }).concat(rows); afterStage();
}
function msgHtml(m, i) {
  var meta = m.card_id ? cardMeta(m.card_id) : {}, full = m.card_id ? cardFull(m.card_id) : null;
  /* 5.2 A-03／E-03：醫療端用第三人稱——伺服器依記錄情境組的句子（clin_title／clin_text）優先，其次衛教卡的醫療端版本（cti／cis／csa），都沒有才用病人版 */
  var title = m.clin_title || (m.card_id ? (meta.cti || meta.ti || m.card_id) : m.system_text);
  var h = '<li class="pmsg" id="msg_' + esc(String(m.id).replace(/[^A-Za-z0-9_\-]/g, '_')) + '"><p>' + chip(((DICT.plan_tiers || {})[m.tier] || m.tier), TIER_CSS[m.tier]) + (m.audience === 'CLINICIAN' ? chip('醫療端') : '') + (m.selected ? chip('病人這次最想談', 'ok') : '') + ' <strong>' + esc(title) + '</strong> ' + eduBadge(m) + '</p>';
  if (m.clin_text) h += '<p class="small">' + esc(m.clin_text) + '</p>';
  else if (m.card_id && (meta.cis || meta.is)) h += '<p class="small">' + esc(meta.cis || meta.is) + '</p>';
  h += basisHtml(m.basis);
  /* 5.2 B-10：沒有衛教卡全文的規則卡（用藥安全核對）→ 直接列出仿單證據（名稱、版本、段落） */
  if (!full && m.evidence_labels && m.evidence_labels.length) h += '<p class="small muted rxsrc">證據（仿單，AI 讀取摘錄，待藥師逐字核對）：' + esc(m.evidence_labels.join('；')) + '</p>';
  h += '<p class="small">' + chip(ACTION_ZH[m.action_code] || m.action_code, 'ok') + ' ' + (m.card_id && !m.clin_text ? esc(meta.csa || meta.sa || '') : '') + '｜負責：' + esc(roleList(m.owner_roles)) + (m.timing ? '｜' + esc(TIMING_ZH[m.timing] || m.timing) + (m.timing === 'NEXT_VISIT' ? nextVisitHint() : '') : '') + (m.due_at ? '｜' + esc(md(m.due_at)) + '前' : '') + '</p>';
  if (full) h += '<details class="small noprint"><summary>衛教卡全文與證據</summary>' + (full.text ? '<p>' + esc(full.text) + '</p>' : '') + ((full.actions || []).length ? '<ul>' + full.actions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' : '') +
    (full.do_not ? '<p><strong>請不要：</strong>' + esc(full.do_not) + '</p>' : '') + (full.escalate ? '<p><strong>什麼情況要馬上處理：</strong>' + esc(full.escalate) + '</p>' : '') + (full.ask ? '<p><strong>可以問：</strong>' + esc(full.ask) + '</p>' : '') +
    '<p class="muted">層級 ' + esc(m.tier) + '｜規則 ' + esc((m.rules || [m.rule_id]).join('、')) + '｜' + esc(m.claim_id) + '｜證據 ' + esc((m.evidence || []).join('、')) + (m.evidence_labels && m.evidence_labels.length ? '｜仿單（AI 讀取摘錄，待藥師逐字核對）：' + esc(m.evidence_labels.join('；')) : '') + '</p></details>';
  var qr = m.quick_ref ? [m.quick_ref.template_id, m.quick_ref.handoff_reason] : QUICK_REF[m.rule_id];   /* 4.9.3 WP-B1（W2-3）：訊息自帶的轉介草稿優先 */
  /* 5.2 C-07：接收職類已處理 → 標示，不再出轉介按鈕；轉介給檢視者自己 → 「我已處理：記錄處置」（帶到本職紀錄欄位），不出自我轉介 */
  var rvSelf = CUR.rec.plan && CUR.rec.plan.role_view ? CUR.rec.plan.role_view.self_ref[m.id] : undefined;
  if (m.handled_by) h += '<p class="small">' + chip('已由' + (ROLE_ZH[m.handled_by.role] || m.handled_by.role) + '處理（' + esc(md(tw(m.handled_by.at))) + '，' + esc(field(m.handled_by.field_id).label) + '）', 'ok') + '</p>';
  else if (rvSelf !== undefined) h += '<p class="noprint"><button class="btn small" type="button" data-act="edit" data-val="' + esc(rvSelf || 'safety_signals') + '" data-selfref="1">我已處理：記錄處置</button></p>';
  else if (qr && TPL_BY_ID(qr[0])) h += '<p class="noprint"><button class="btn small" type="button" data-act="quick_ref" data-val="' + esc(m.quick_ref ? 'Q:' + qr[0] + '|' + qr[1] + psy_qrTail(m.quick_ref) : m.rule_id) + '">帶入轉介：' + esc(TPL_BY_ID(qr[0]).label_clinician) + '</button></p>';
  if (m.prefill && DICT.fields[m.prefill.field_id]) h += '<p class="noprint"><button class="btn small" type="button" data-act="prefill" data-val="' + esc(m.id) + '">帶入建議：' + esc(field(m.prefill.field_id).label) + ' 加「' + esc(m.prefill.add.map(function (x) { return (field(m.prefill.field_id).enum_labels || {})[x] || x; }).join('」「')) + '」</button></p>';   /* 4.9.3 WP-B2：只暫存 */
  if (m.card_id && m.audience === 'BOTH') h += eduHandoffStrip(m.card_id) + eduControlHtml(m);
  return h + '</li>';
}
/* 5.2 E-01／E-02：醫療端計畫的職類檢視——伺服器決定順序與分組（PL.roleView）；這裡只排版。合併的同主題項目收在主卡下「同主題另 N 項」 */
var RV_TOPIC_ZH = { MED_DIFF: '用藥差異', MED_START: '新藥與換藥', NSAID: '止痛消炎藥（NSAID）', HF_HAZARD: '心衰竭可能惡化的藥', DUP: '重複用藥', DOSE_CHECK: '劑量核對', POTASSIUM: '血鉀', WEIGHT: '體重', FALL: '跌倒與姿勢性低血壓', NUTRITION: '營養', SYMPTOM: '症狀', GOC: '照護目標', SCREEN: '全人照護篩檢', SELF_CARE: '自我照顧衛教' };
function roleViewHtml(P) {
  var V = P.role_view, by = {}; P.messages.forEach(function (m) { by[m.id] = m; });
  function one(id) {
    var m = by[id]; if (!m) return '';
    var h = msgHtml(m), more = (V.merged[id] || []).map(function (x) { return by[x]; }).filter(Boolean);
    if (more.length) h = h.replace(/<\/li>$/, '<details class="small rv-merged"><summary>同主題（' + esc(RV_TOPIC_ZH[V.topic[id]] || V.topic[id] || '') + '）另 ' + more.length + ' 項</summary><ol class="plain">' + more.map(msgHtml).join('') + '</ol></details></li>');
    return h;
  }
  function list(ids) { return '<ol class="plain">' + ids.map(one).join('') + '</ol>'; }
  var h = '';
  if (V.mode === 'EMERGENCY') h += '<p class="notice err" id="rv_mode">急診轉送或立即處置中：先處理下面的轉送與通知；其他安全事項仍列出，非安全事項收在下方，處理後再看。</p>';
  if (V.mode === 'COMFORT_FIRST') h += '<p class="notice" id="rv_mode">照護目標：舒適優先（' + esc((P.care_mode || {}).label || '') + '）——照護目標、症狀與舒適照護排在前面；運動訓練、長期自我照顧與一般維持衛教已移除。</p>';
  var WD = P.weight_diary;   /* 5.2 第 3 波 F-07：病人行動的完成證據（模擬病人試行） */
  if (WD) h += '<p class="small" id="rv_weight_diary">居家體重記錄：最近 ' + WD.window_days + ' 天有 ' + WD.days_recorded + ' 天（目標 ' + WD.target_days + ' 天）' + (WD.met ? '｜已達標' : WD.window_complete ? '｜未達標：見「卡住的事」卡' : '｜從 ' + esc(md(WD.first_record)) + ' 開始，尚未滿一週') + ' ' + chip('試行規則（只在模擬病人顯示）', 'warn') + '</p>';
  h += '<h3>今天最需要處理（' + V.today.length + '）</h3>' + (V.today.length ? list(V.today) : '<p class="muted">目前沒有需要本職今天處理的項目。</p>');
  if ((V.safety || []).length) h += '<h3 id="rv_safety_h">其他安全事項（不收合，' + V.safety.length + '）</h3>' + list(V.safety);   /* 5.2 獨立驗證 D1：急診模式下 G0、G1 仍可見 */
  if (V.other.length) h += '<h3>本職其他事項（' + V.other.length + '）</h3>' + list(V.other);
  if (V.deferred.length) h += '<details id="rv_deferred"><summary>轉送與通知處理後再看（' + V.deferred.length + ' 件）</summary>' + list(V.deferred) + '</details>';
  if (V.collapsed.length) h += '<details id="rv_collapsed"><summary>還有 ' + V.collapsed.length + ' 件（超過顯示上限，依嚴重度收合）</summary>' + list(V.collapsed) + '</details>';
  if (V.done.length) h += '<details id="rv_done"><summary>已由接收職類處理（' + V.done.length + ' 件）</summary>' + list(V.done) + '</details>';
  if (V.other_roles.length) {
    var roles = {}; V.other_roles.forEach(function (id) { ((by[id] || {}).owner_roles || []).forEach(function (r) { roles[r] = 1; }); });
    h += '<details id="rv_other_roles"><summary>其他職類待辦 ' + V.other_roles.length + ' 件（' + esc(Object.keys(roles).map(function (r) { return ROLE_ZH[r] || r; }).join('、')) + '）</summary>' + list(V.other_roles) + '</details>';
  }
  return h;
}
function cockpitHtml(v) {
  var P = CUR.rec.plan;
  if (!P) return '<section class="panel"><h2>照護計畫</h2><p class="notice warn">照護計畫暫時無法產生（' + esc(CUR.rec.plan_error || '未知原因') + '）；以下紀錄仍可查看與記錄。請通知系統管理者。</p></section>';
  /* 首頁前 N 項（N 由伺服器參數 CLIN_TOP）；G0–G2 一律在首頁，不收進「其他」 */
  var topN = Math.max((P.params && P.params.CLIN_TOP) || 5, P.messages.filter(function (m) { return Number(m.tier.slice(1)) <= 2; }).length);
  var C = P.continuity.clinician, top = P.messages.slice(0, topN), rest = P.messages.slice(topN);
  var h = '<section class="panel cockpit" aria-labelledby="ck_h"><h2 id="ck_h">照護計畫：從上次接續</h2>';
  h += '<p>' + (P.contexts.length ? P.contexts.map(function (c) { return chip(c.clin, ['WORSENING', 'EARLY_POST_DISCHARGE', 'MEDICATION_RECONCILIATION'].indexOf(c.code) >= 0 ? 'warn' : ''); }).join(' ') : '<span class="muted small">沒有特別的臨床情境</span>') + '</p>';
  /* 與上次相比 */
  h += '<h3>與上次相比</h3>';
  if (!C.anchor) h += '<p class="small muted">照護團隊還沒有做過評估；這是第一次。</p>';
  else {
    var items = C.since_last.map(function (d) { return '<li>' + (d.kind === 'NEW' ? '＋' : (d.kind === 'CLEARED' ? '－' : '±')) + ' ' + esc(field(d.field_id).label) + '：' + esc(d.before === null ? '（無）' : fmtVal(d.field_id, d.before)) + ' → <strong>' + esc(d.after === null ? '（清除）' : fmtVal(d.field_id, d.after)) + '</strong> <span class="muted">' + esc(srcZh(d.source_type)) + '</span></li>'; })
      .concat(C.care_events_since.map(function (e) { return '<li>＋ ' + esc(CE_ZH[e.event_type] || e.event_type) + ' ' + esc(e.occurred_at) + '</li>'; }))
      .concat(C.closed_since.map(function (c) { return '<li>✓ ' + esc(c.clin) + '</li>'; }));
    h += '<p class="small muted">上次照護團隊評估：' + esc(C.anchor.date) + '（' + esc(ROLE_ZH[C.anchor.by_role] || C.anchor.by_role || '') + '）</p>' + (items.length ? '<ul class="small">' + items.join('') + '</ul>' : '<p class="small muted">上次之後沒有新的紀錄。</p>');
    if (C.at_last.length) h += '<details class="small"><summary>上次評估時改了什麼（' + C.at_last.length + '）</summary><ul>' + C.at_last.map(function (d) { return '<li>' + esc(field(d.field_id).label) + '：' + esc(d.before === null ? '（無）' : fmtVal(d.field_id, d.before)) + ' → ' + esc(d.after === null ? '（清除）' : fmtVal(d.field_id, d.after)) + '</li>'; }).join('') + '</ul></details>';
  }
  /* 今天最需要處理 */
  if (P.role_view) h += roleViewHtml(P);   /* 5.2 E-01／E-02：職類檢視（同主題合併、本職優先、急診轉送與舒適優先模式；只對模擬病人試行） */
  else {
  h += '<h3>今天最需要處理（' + top.length + (rest.length ? '／共 ' + P.messages.length : '') + '）</h3>' + (top.length ? '<ol class="plain">' + top.map(msgHtml).join('') + '</ol>' : '<p class="muted">目前沒有需要處理的項目。</p>');
  if (rest.length) h += '<details><summary>其他 ' + rest.length + ' 項</summary><ol class="plain">' + rest.map(msgHtml).join('') + '</ol></details>';
  }
  /* 上次未完成 */
  var loops = P.continuity.open_loops;
  h += '<h3>未完成的事（' + loops.length + '）</h3>' + (loops.length ? '<ul class="small">' + loops.map(function (l) { return '<li>' + chip(DOMAIN_ZH[l.domain] || l.domain) + chip(LOOP_ZH[l.status] || l.status, l.status === 'BARRIER' || l.status === 'WORSE' || l.overdue ? 'err' : (l.status === 'PATIENT_REPORTED_DONE' ? 'warn' : '')) + ' ' + esc(l.clin) + (l.owner_role ? '｜' + esc(ROLE_ZH[l.owner_role] || l.owner_role) : '') + (l.due_at ? '｜' + esc(md(l.due_at)) + '前' + (l.overdue ? ' ' + chip('逾期', 'err') : '') : '') + (l.patient_visible ? '' : ' ' + chip('病人看不到')) + '</li>'; }).join('') + '</ul>' : '<p class="small muted">沒有未完成的事。</p>');
  /* 病人最在意、選的主題 */
  var sc = P.selected_concern;
  h += (sc ? '<h3>病人這次最想談</h3><p class="small">' + esc(sc.label) + '　' + chip({ ACTION: '已列入今天的重點', NO_CHANGE: '目前不需要改變', DATA_INSUFFICIENT: '資料不足', HELD_FOR_SAFETY: '先處理安全問題後接續', NO_CARD: '沒有對應衛教卡，請口頭回應' }[sc.status] || sc.status, sc.status === 'ACTION' ? 'ok' : 'warn') + (sc.clin ? '<br><span id="sc_clin">' + esc(sc.clin) + '</span>' : '') + '</p>' : '');
  h += medGuidanceHtml(false);
  if ((P.allied_results || []).length) h += '<h3>職類評估結論（照護計畫）</h3><ul class="small" id="plan_allied">' + P.allied_results.map(function (a) { return '<li>' + esc(field(a.field).label) + '：' + esc(a.label) + (a.fluid_limit_ml_day ? '（每天 ' + esc(a.fluid_limit_ml_day) + ' mL）' : '') + (a.role ? '｜' + esc(ROLE_ZH[a.role] || a.role) : '') + (a.recorded_at ? '｜' + esc(String(a.recorded_at).slice(0, 10)) : '') + '</li>'; }).join('') + '</ul>';
  if (P.limiters.length) h += '<h3>資料限制（缺資料時只給一般建議，不當成個人化建議）</h3><ul class="small">' + P.limiters.map(function (l) { var m = /^(PERSONALIZATION_(?:BLOCKED|LIMITED))：(.*)$/.exec(l.clin); return '<li>' + (m ? chip(m[1] === 'PERSONALIZATION_BLOCKED' ? '無法個人化' : '個人化受限', m[1] === 'PERSONALIZATION_BLOCKED' ? 'err' : 'warn') + ' ' + esc(m[2]) : esc(l.clin)) + ((l.missing || []).filter(function (f) { return DICT.fields[f]; }).length ? ' ' + (l.missing || []).filter(function (f) { return DICT.fields[f] && DICT.fields[f].clinician_editable; }).map(function (f) { return '<button class="btn small noprint" type="button" data-act="edit" data-val="' + esc(f) + '">填寫' + esc(field(f).label) + '</button>'; }).join(' ') : '') + '</li>'; }).join('') + '</ul>';
  var cm = P.communication;
  h += '<h3>溝通與學習需要</h3><p class="small">' + (cm.recorded ? [cm.detail === 'BRIEF' ? '先講重點' : '', cm.hints.caregiver_variant ? '家人一起參與（用照顧者版）' : '', cm.hints.large_print ? '大字' : '', cm.hints.read_aloud ? '需要唸給他聽' : '', cm.hints.interpreter ? '需要通譯（本系統內容只有華語）' : '', cm.hints.use_med_bags ? '用藥袋或實物說明' : '', cm.hints.written_steps ? '寫下步驟' : '', cm.hints.numbers_with_meaning ? '數字要說明意思' : ''].filter(Boolean).map(function (x) { return chip(x); }).join(' ') || '沒有特別需要' : '還沒有記錄。所有人都先用淺白、一次一件事、請病人用自己的話說一次（健康識能全面預防原則）；需要時在「本次評估」記下病人說出或觀察到的需要。') + '</p>';
  if (P.suppressed.length) h += '<details class="small"><summary>這次沒有列出的衛教（' + P.suppressed.length + '）</summary><ul>' + P.suppressed.map(function (x) { return '<li>' + esc(cardTitle(x.card_id)) + '：' + esc(SUPP_ZH[x.reason] || x.reason) + '</li>'; }).join('') + '</ul></details>';
  h += '<details class="help"><summary>說明</summary><p class="small muted">排序：安全 → 未解決的高風險 → 轉銜與治療改變 → 監測 → 病人在意與困難 → 理解缺口 → 維持（不用加權總分）。</p></details><details class="small muted"><summary>版本資訊</summary>計畫 ' + esc(P.plan_hash.slice(0, 8)) + '｜規則 ' + esc(P.ruleset_version) + '｜內容 ' + esc(P.basis.content_version) + '</details></section>';
  return h;
}
function medGuidanceHtml(full) {
  var P = CUR.rec.plan; if (!P) return '';
  var M = P.medication, h = full ? '<section class="panel"><h2>用藥重點（照護計畫）</h2>' : '<h3>用藥重點</h3>';
  h += '<p class="small">' + chip({ ACTION: '有需要處理的用藥重點', NO_CHANGE: '沒有新的用藥處理重點', DATA_INSUFFICIENT: '資料不足' }[M.status] || M.status, M.status === 'ACTION' ? 'warn' : (M.status === 'NO_CHANGE' ? 'ok' : 'err')) + ' ' + esc(M.clin) + '</p>';
  if (M.items.length) h += '<ul class="small">' + M.items.map(function (i) {
    var mc = medClass(i.med_class), st = i.statuses.map(function (x) { return { CHANGED: '最近調整', MONITOR_DUE: '需要追蹤檢驗', DISCREPANCY: '處方與實際使用不一致' }[x] || x; }).join('、');
    return '<li><strong>' + esc(mc.label || i.med_class) + '</strong>（' + esc(i.ingredients.join('、')) + '）：' + esc(st) + (full ? i.facets.filter(function (f) { return mc[f]; }).map(function (f) { return '<br><span class="muted">' + esc({ notice: '注意', monitor: '監測', bring: '帶去', do_not: '請不要' }[f] || f) + '：' + esc(mc[f]) + '</span>'; }).join('') : '') + '</li>';
  }).join('') + '</ul>';
  if (M.stable_classes.length) h += '<p class="small muted">穩定、這次不需逐類重複衛教：' + esc(M.stable_classes.map(function (c) { return (DICT.med_classes[c] || {}).short || c; }).join('、')) + '</p>';
  return full ? h + '</section>' : h;
}
function eduHtml(v) {
  var P = CUR.rec.plan, L = P ? (P.learning || []) : [];
  var h = '<section class="panel"><h2>衛教歷程：理解、之後還記得嗎、能自己做嗎</h2><details class="help"><summary>說明</summary><p class="small muted">每張衛教卡分成學習目標逐項記錄。「之後還記得嗎」只看另一天真的再確認的結果；時間經過只會提醒「再確認」，不會自動算成忘記。病人連結的自評和醫療人員判定分開記錄；不同醫療人員判定矛盾時取保守結果。</p></details>';
  if (!L.length) h += '<p class="muted">還沒有衛教紀錄。在「總覽」每一項重點下方可以記錄衛教與理解確認（教回）。</p>';
  else h += L.map(function (c) {
    var head = '<h3>' + esc(cardTitle(c.card_id)) + ' ' + chip(EDU_ZH[c.understanding] || c.understanding, c.understanding === 'UNDERSTOOD' ? 'ok' : (['NEEDS_RETEACH', 'NEEDS_HELP', 'PARTIAL'].indexOf(c.understanding) >= 0 ? 'warn' : '')) +
      (c.reassess ? ' ' + chip(REASSESS_ZH[c.reassess] || c.reassess, 'warn') : '') + (c.gap ? ' ' + chip('懂了但還沒做到', 'warn') : '') + (c.conflict ? ' ' + chip('評估不一致', 'err') : '') + (c.self_verify_only ? ' ' + chip('病人選「我記得，直接確認」（自評，未重看內容）') : '') + '</h3>' +
      ((c.content_changed_facets || []).length ? '<p class="small">內容改版後要再確認：' + esc(c.content_changed_facets.map(function (x) { return FACET_ZH[x] || x; }).join('、')) + '（其他目標不必重教）</p>' : '') + eduLadderHtml(c);
    return head + '<div class="table-scroll"><table class="small"><thead><tr><th scope="col">學習目標</th><th scope="col">目前理解</th><th scope="col">之後還記得嗎</th><th scope="col">需要多少協助</th><th scope="col">有效的溝通方式</th><th scope="col">歷程（日期 職類 結果）</th></tr></thead><tbody>' +
      c.facets.map(function (f) {
        return '<tr><th scope="row">' + esc(FACET_ZH[f.facet] || f.facet) + '</th><td>' + esc(EDU_ZH[f.comprehension] || f.comprehension) + (f.conflict ? '<br>' + chip('矛盾：' + (ROLE_ZH[f.conflict.role] || f.conflict.role || '') + ' ' + d10(f.conflict.at) + ' 判定' + (EDU_ZH[f.conflict.result] || f.conflict.result), 'err') : '') + (f.content_changed ? '<br>' + chip('內容已改版', 'warn') : '') + (f.last_pass ? '<br><span class="muted">上次確認：' + esc(d10(f.last_pass.at)) + ' ' + esc(ROLE_ZH[f.last_pass.role] || f.last_pass.role || '') + (f.last_pass.respondent === 'CAREGIVER' ? '（照顧者）' : '') + '</span>' : '') + '</td><td>' + esc(RET_ZH[f.retention] || '—') + '</td><td>' + esc(f.capability ? lzh('support_levels', f.capability) : '—') + '</td><td>' + esc((f.effective_modalities || []).map(function (x) { return lzh('modalities', x); }).join('、') || '—') + '</td><td>' +
          (f.history || []).map(function (x) { return '<span class="tl-item">' + esc(d10(x.at)) + ' ' + esc(x.by === 'PATIENT' ? (x.respondent === 'CAREGIVER' ? '照顧者（連結）' : '病人連結') + (x.verify_only ? '·直接確認' : '') : (ROLE_ZH[x.role] || x.role || '') + (x.respondent === 'CAREGIVER' ? '·照顧者確認' : '')) + ' ' + esc(EDU_ZH[x.result] || x.result) + (x.method && x.method !== 'NONE' ? '（' + esc(METHOD_ZH[x.method] || x.method) + '）' : '') + '</span>'; }).join('→ ') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      /* W5-L（K08-01）：已理解、計畫不再列為重點的主題，仍可在這裡記下一階段（能力確認、回家實作回顧）；總覽已有這張卡時不重複 */
      (c.ladder && c.ladder.stage !== 'GRADUATED' && !(P.messages || []).some(function (m) { return m.card_id === c.card_id && m.audience === 'BOTH'; }) ? eduControlHtml({ card_id: c.card_id, id: '', education: { facets: c.facets } }) : '');
  }).join('');
  if (P && P.communication && P.communication.hints) {
    var hn = P.communication.hints;
    if ((hn.effective_modalities || []).length || (hn.ineffective_modalities || []).length) h += '<p class="small"><strong>這位病人的溝通方式紀錄：</strong>' + ((hn.effective_modalities || []).length ? '之前有效：' + esc(hn.effective_modalities.map(function (x) { return lzh('modalities', x); }).join('、')) + '。' : '') + ((hn.ineffective_modalities || []).length ? '之前沒懂時用的：' + esc(hn.ineffective_modalities.map(function (x) { return lzh('modalities', x); }).join('、')) + '（換個方式）。' : '') + '</p>';
  }
  h += coverageHtml(P);
  if (P && P.teach_targets.length) h += '<h3>這次建議確認理解的</h3><ul>' + P.teach_targets.map(function (id) { return '<li>' + esc(cardTitle(id)) + '：「' + esc(teachPrompt(id)) + '」</li>'; }).join('') + '</ul>';
  return h + '</section>';
}

/* ---------- 就醫事件與住院 ---------- */
function careHtml(v) {
  var trans = {}; (CUR.dash.transitions || []).forEach(function (t) { trans[t.episode_id] = t.status; });
  var h = '<section class="panel"><h2>就醫事件與住院</h2>';
  h += v.episodes.length ? '<h3>住院紀錄</h3><div class="table-scroll"><table><thead><tr><th scope="col">入院</th><th scope="col">出院</th><th scope="col">確認</th><th scope="col">狀態</th><th scope="col">7 天追蹤</th><th scope="col">42 天追蹤</th><th scope="col">42 天藥物檢視</th><th scope="col">30 天再住院</th><th scope="col">90 天再住院</th></tr></thead><tbody>' +
    v.episodes.map(function (e) {
      var ix = IDX_ZH[e.index_status] || [e.index_status, ''], t = trans[e.episode_id] || {};
      function tc(k) { var z = TR_ZH[t[k]]; return z ? chip(z[0], z[1]) : '<span class="muted">—</span>'; }
      return '<tr id="ep_' + esc(e.episode_id) + '"><td>' + esc(d10(e.admission_at)) + '</td><td>' + esc(d10(e.discharge_at)) + '</td><td>' + esc(VER_ZH[e.verification_state] || e.verification_state) + '</td><td>' + chip(ix[0], ix[1]) + '</td><td>' + tc('HF-T01') + '</td><td>' + tc('HF-T02A') + '</td><td>' + tc('HF-T02B') + '</td><td>' + tc('HF-O01') + '</td><td>' + tc('HF-O02') + '</td></tr>';
    }).join('') + '</tbody></table></div><details class="help"><summary>說明</summary><p class="small muted">再住院只含本系統有紀錄的事件；沒有紀錄不代表沒有在其他醫院住院。</p></details>' : '<p class="muted">尚無住院紀錄。</p>';
  h += v.care_events.length ? '<h3>事件時間軸</h3><ul>' + v.care_events.slice().reverse().map(function (c) {
    var linked = !!c.episode_id, live = !linked || v.episodes.some(function (e) { return e.episode_id === c.episode_id; });
    var fixing = CUR.ceFix === c.event_id, staged = ST.ce.some(function (x) { return x.supersedes_event_id === c.event_id; });
    return '<li>' + esc(d10(c.occurred_at)) + '　' + esc(CE_ZH[c.event_type] || c.event_type) + '　' + chip(VER_ZH[c.verification_state] || '', c.verification_state === 'VERIFIED' ? 'ok' : 'warn') + '<span class="small muted">' + esc(ROLE_ZH[c.provider_role] || c.provider_role || '') + '</span>' +
      (staged ? ' ' + chip('這次會更正', 'warn') : (/^DEATH_(REPORTED|VERIFIED)$/.test(c.event_type) ? ' <span class="noprint"><select id="dr_' + esc(c.event_id) + '" aria-label="撤回理由">' + Object.keys(RETRACT_ZH).map(function (k) { return opt(k, RETRACT_ZH[k]); }).join('') + '</select> <button class="btn small" type="button" data-act="death_retract" data-val="' + esc(c.event_id) + '">撤回這筆死亡紀錄</button></span>' : (live ? (fixing ? '' : ' <button class="btn small noprint" type="button" data-act="ce_fix" data-val="' + esc(c.event_id) + '">更正</button>') : ' <span class="small muted noprint">（這次住院已由後續事件合併；要更正請改最新的出院事件）</span>'))) +
      (fixing ? ceFixHtml(c, linked, v) : '') + '</li>'; }).join('') + '</ul><details class="help"><summary>說明</summary><p class="small muted">「更正」會新增一筆取代原事件的紀錄（原紀錄仍保留，可在異動紀錄查到）；不能用較低確認層級（例如自述）更正已確認的事件。</p></details>' : '';
  h += '<details class="noprint"><summary>新增就醫事件</summary><div class="row" style="margin-top:8px"><label class="f">事件<select id="ce_type">' + ME.care_event_types.filter(function (x) { return x !== 'DEATH_RECORD_RETRACTED'; }).map(function (x) { return opt(x, CE_ZH[x] || x); }).join('') + '</select></label>' +
    '<label class="f">日期（出院事件填出院日）<input type="date" id="ce_date" max="' + today() + '"></label><label class="f">入院日（出院事件必填）<input type="date" id="ce_adm" max="' + today() + '"></label>' +
    '<label class="f">和心衰竭有關<select id="ce_hf">' + opt('YES', '是') + opt('NO', '否') + opt('UNSURE', '不確定') + '</select></label>' +
    '<label class="f">轉院<select id="ce_tr">' + opt('NONE', '無') + opt('TRANSFERRED_OUT', '轉出') + opt('TRANSFERRED_IN', '轉入') + opt('UNKNOWN', '不確定') + '</select></label>' +
    '<label class="f">出院去向<select id="ce_disp">' + opt('', '—') + opt('HOME', '回家') + opt('LTC', '長照機構') + opt('DIED', '死亡') + opt('AMA', '自動出院') + opt('OTHER', '其他') + '</select></label>' +
    '<label class="f">來源<select id="ce_src">' + ['CLINICIAN_VERIFIED', 'CLINICIAN_OBSERVED', 'PATIENT_REPORTED', 'CAREGIVER_REPORTED'].map(function (x) { return opt(x, srcZh(x)); }).join('') + '</select></label>' +
    '<label class="f">死亡事件的來源（只用於死亡）<select id="ce_dsrc">' + opt('', '—') + Object.keys(DEATH_SRC_ZH).map(function (k) { return opt(k, DEATH_SRC_ZH[k]); }).join('') + '</select></label>' +
    '<button class="btn" type="button" data-act="ce_add">加入這次變更</button></div><details class="help"><summary>說明</summary><p class="small muted">「已確認」類事件只能用「依病歷或報告確認」來源；自述類事件不進正式指標分母。</p></details><p id="ce_err" class="small" role="alert"></p></details></section>';
  return h;
}
function ceCheck(t, d, adm, src) {
  if (!d) return '請填日期。';
  if (d > today()) return '日期不能晚於今天。';
  if (/DISCHARGE_VERIFIED/.test(t) && !adm) return '已確認的出院必須填入院日。';
  if (adm && adm > d && /DISCHARGE/.test(t)) return '入院日不能晚於出院日。';
  if (/_VERIFIED$|COMPLETED$|DOCUMENTED$/.test(t) && src !== 'CLINICIAN_VERIFIED') return '這類事件必須是「依病歷或報告確認」。';
  if (t === 'DEATH_VERIFIED' && ['DEATH_CERTIFICATE', 'HOSPITAL_RECORD', 'CLINICIAN_PRONOUNCED', 'HOUSEHOLD_REGISTRY', 'OTHER_FACILITY_RECORD'].indexOf(($('ce_dsrc') || {}).value) < 0) return '已核實的死亡要選核實來源（死亡證明、病歷、醫師宣告、戶政資料或他院正式通知）。';
  if (t === 'DEATH_REPORTED' && ['FAMILY_REPORT', 'CAREGIVER_REPORT', 'OTHER_FACILITY_CALL', 'COMMUNITY_REPORT', 'UNSPECIFIED', ''].indexOf(($('ce_dsrc') || {}).value) < 0) return '轉述的死亡請選轉述來源，或留空（來源未說明）。';
  return '';
}
function addCe() {
  var t = $('ce_type').value, d = $('ce_date').value, adm = $('ce_adm').value, src = $('ce_src').value, err = ceCheck(t, d, adm, src);
  if (err) { $('ce_err').textContent = err; return; }
  var e = { event_type: t, occurred_at: d, hf_related: $('ce_hf').value, source_type: src, transfer_status: $('ce_tr').value };
  if (/^DEATH_/.test(t)) { if ($('ce_dsrc').value) e.note_code = $('ce_dsrc').value; e.transfer_status = 'NONE'; ST.ce.push(e); afterStage(); return; }   /* 5.0 W5-M：死亡事件不帶住院欄位 */
  if (adm) e.admission_at = adm; if ($('ce_disp').value) e.discharge_disposition = $('ce_disp').value;
  ST.ce.push(e); afterStage();
}
/* ---------- 更正就醫事件（2026-09-29）：伺服器原本就支援 supersedes_event_id；畫面只列出伺服器會接受的事件類型 ---------- */
function ceFamily(t) { t = String(t).replace(/_(REPORTED|VERIFIED)$/, ''); return /^HF_(ADMISSION|DISCHARGE)$/.test(t) ? 'HF_STAY' : t; }
function ceFixTypes(c, linked) {
  return ME.care_event_types.filter(function (t) {
    if (ceFamily(t) !== ceFamily(c.event_type)) return false;
    if (c.verification_state === 'VERIFIED' && /_REPORTED$/.test(t)) return false;        /* 不能用較低層級更正 */
    if (linked && !(/_VERIFIED$/.test(t) && /ADMISSION|DISCHARGE/.test(t))) return false;   /* 已形成住院紀錄：只能用已確認的入院／出院事件更正 */
    return true;
  });
}
function ceFixHtml(c, linked, v) {
  var types = ceFixTypes(c, linked), ep = linked ? v.episodes.filter(function (e) { return e.episode_id === c.episode_id; })[0] : null;
  if (!types.length) return '<p class="small field-err">這筆事件沒有可用的更正類型。</p>';
  var verified = c.verification_state === 'VERIFIED';
  return '<div class="staged noprint" id="cefix_box"><p class="small"><strong>更正這筆事件</strong>（原：' + esc(d10(c.occurred_at)) + ' ' + esc(CE_ZH[c.event_type] || c.event_type) + '）</p><div class="row">' +
    '<label class="f">正確的事件<select id="cf_type">' + types.map(function (x) { return opt(x, CE_ZH[x] || x, x === c.event_type); }).join('') + '</select></label>' +
    '<label class="f">正確的日期（出院事件填出院日）<input type="date" id="cf_date" max="' + today() + '" value="' + esc(d10(c.occurred_at)) + '"></label>' +
    '<label class="f">入院日（出院事件必填）<input type="date" id="cf_adm" max="' + today() + '" value="' + esc(ep ? d10(ep.admission_at) : '') + '"></label>' +
    '<label class="f">和心衰竭有關<select id="cf_hf">' + ['YES', 'NO', 'UNSURE'].map(function (x) { return opt(x, { YES: '是', NO: '否', UNSURE: '不確定' }[x], x === c.hf_related); }).join('') + '</select></label>' +
    '<label class="f">轉院<select id="cf_tr">' + opt('NONE', '無', !ep || ep.transfer_status === 'NONE') + opt('TRANSFERRED_OUT', '轉出', ep && ep.transfer_status === 'TRANSFERRED_OUT') + opt('TRANSFERRED_IN', '轉入', ep && ep.transfer_status === 'TRANSFERRED_IN') + opt('UNKNOWN', '不確定', ep && ep.transfer_status === 'UNKNOWN') + '</select></label>' +
    '<label class="f">出院去向<select id="cf_disp">' + opt('', '—（沿用原紀錄）') + opt('HOME', '回家') + opt('LTC', '長照機構') + opt('DIED', '死亡', ep && ep.index_status === 'NOT_INDEX_DIED') + opt('AMA', '自動出院') + opt('OTHER', '其他') + '</select></label>' +
    '<label class="f">來源<select id="cf_src">' + (verified ? ['CLINICIAN_VERIFIED'] : ['CLINICIAN_VERIFIED', 'CLINICIAN_OBSERVED', 'PATIENT_REPORTED', 'CAREGIVER_REPORTED']).map(function (x) { return opt(x, srcZh(x), x === c.source_type); }).join('') + '</select></label></div>' +
    '<div class="row"><button class="btn small primary" type="button" data-act="ce_fix_ok" data-val="' + esc(c.event_id) + '">加入這次變更（更正）</button><button class="btn small" type="button" data-act="ce_fix_cancel">取消</button></div><p id="cf_err" class="small field-err" role="alert"></p></div>';
}
function stageCeFix(id) {
  var t = $('cf_type').value, d = $('cf_date').value, adm = $('cf_adm').value, src = $('cf_src').value, err = ceCheck(t, d, adm, src);
  if (err) { $('cf_err').textContent = err; return; }
  var e = { event_type: t, occurred_at: d, hf_related: $('cf_hf').value, source_type: src, transfer_status: $('cf_tr').value, supersedes_event_id: id };
  if (adm && /ADMISSION|DISCHARGE/.test(t)) e.admission_at = adm; if ($('cf_disp').value) e.discharge_disposition = $('cf_disp').value;
  ST.ce = ST.ce.filter(function (x) { return x.supersedes_event_id !== id; });
  ST.ce.push(e); CUR.ceFix = null; afterStage();
}

/* ---------- 行動與關心的問題 ---------- */
var NEXT = { PLANNED: ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'NOT_DONE', 'CANCELED', 'BARRIER_REPORTED', 'UNKNOWN'], ACCEPTED: ['IN_PROGRESS', 'COMPLETED', 'NOT_DONE', 'CANCELED', 'BARRIER_REPORTED', 'UNKNOWN'], IN_PROGRESS: ['COMPLETED', 'NOT_DONE', 'CANCELED', 'BARRIER_REPORTED', 'UNKNOWN'], BARRIER_REPORTED: ['IN_PROGRESS', 'COMPLETED', 'NOT_DONE', 'CANCELED', 'BARRIER_REPORTED', 'UNKNOWN'], UNKNOWN: ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'NOT_DONE', 'CANCELED', 'BARRIER_REPORTED'] };
/* 3.0.0 交接閉環：送出 ≠ 接手 ≠ 完成。接收方（負責職類）接手、完成時回覆結果、或退回／轉給其他職類（附理由）；建立者不能替沒人接手的交接記完成，只能取消並寫原因 */
function isHo(a) { return !!(a.handoff || ((/^REFERRAL_/.test(a.action_type || '') || (a.action_type === 'EDUCATION' && /^TEACH:/.test(a.action_ref || ''))) && a.created_role && a.owner_role && a.owner_role !== a.created_role)); }
function scopeOf(a) { var r = String(a.action_ref || ''); return /^MON:/.test(r) ? 'MONITORING' : (/^DISC:/.test(r) ? 'DISCREPANCY' : 'HANDOFF'); }
/* 3.3（R-A-003）：開立醫師處理用藥差異交接：用解決方式完成（回寫差異），或退回（需要討論／無法完成）；與伺服器 L.DISC_HANDOFF_RESULTS 相同 */
function DISC_HO_OPTS() { var keep = ['PRESCRIPTION_UPDATED', 'INTENTIONAL_CONFIRMED', 'PATIENT_CORRECTED_USE', 'RECORD_ERROR_FIXED', 'NEED_TALK', 'NOT_POSSIBLE']; return (DICT.result_codes || []).filter(function (x) { return keep.indexOf(x[0]) >= 0; }); }
function resultOpts(scope) { return (DICT.result_codes || []).filter(function (x) { return x[2] === scope; }); }
function hoStateHtml(a) {
  if (!isHo(a)) return '';
  var h = '<br><span class="small">交接給 ' + esc(ROLE_ZH[a.owner_role] || a.owner_role) + '｜';
  if (a.accepted_by) h += chip('已接手：' + (ROLE_ZH[a.accepted_by.role] || a.accepted_by.role || '') + ' ' + a.accepted_by.actor_id + '（' + md(d10(a.accepted_by.at)) + '）', 'ok');
  else if (['COMPLETED', 'NOT_DONE', 'CANCELED'].indexOf(a.action_status) < 0) h += chip('待接手' + (a.accept_by ? '（期限 ' + md(a.accept_by) + '）' : ''), a.accept_late ? 'err' : 'warn');
  (a.redirects || []).forEach(function (r) { h += ' ' + chip('轉派：' + (ROLE_ZH[r.from] || r.from) + '→' + (ROLE_ZH[r.to] || r.to) + '（' + codeZh(DICT.action_change_reasons, r.reason) + '）'); });
  if (a.result_code) h += ' ' + chip('結果：' + codeZh(DICT.result_codes, a.result_code), 'ok');
  if (a.resolution_code === 'RECEIVER_DECLINED') h += ' ' + chip('接收方退回', 'err');
  (a.takeovers || []).forEach(function (t) { h += ' ' + chip('接手轉移：' + (t.from || '—') + '→' + t.to + '（' + md(d10(t.at)) + '）'); });
  if (a.result_acknowledged) h += ' ' + chip('建立者已看過回覆（' + md(d10(a.result_acknowledged.at)) + '）', 'ok');
  return h + '</span>';
}
function reschedAction(id) {
  var d = $('resd_' + id).value, a = CUR.rec.view.actions[id];
  if (!d) { inlineErr('aerr_' + id, '請選新的到期日。'); return; }
  if (a && d10(a.due_at) === d) { inlineErr('aerr_' + id, '新的到期日和原本一樣。'); return; }
  ST.ac.push({ action_id: id, action_status: a.action_status, due_at: d, change_reason: 'RESCHEDULED' }); afterStage();
}
function actionsHtml(v) {
  var rebase = {}; ((CUR.rec.plan && CUR.rec.plan.continuity.open_loops) || []).forEach(function (l) { if (l.status === 'REBASELINE') rebase[l.ref] = 1; });
  var list = Object.keys(v.actions).map(function (k) { return v.actions[k]; }).sort(function (a, b) { return a.last_updated_at < b.last_updated_at ? 1 : -1; });
  var h = '<section class="panel"><h2>行動（從指派到完成的追蹤）</h2>';
  h += list.length ? '<div class="table-scroll"><table><thead><tr><th scope="col">行動</th><th scope="col">負責</th><th scope="col">狀態</th><th scope="col">到期</th><th scope="col">最後更新</th><th scope="col" class="noprint">更新狀態</th></tr></thead><tbody>' + list.map(function (a) {
    var terminal = ['COMPLETED', 'NOT_DONE', 'CANCELED'].indexOf(a.action_status) >= 0;
    var patientDone = a.action_status === 'COMPLETED' && (a.last_source_type === 'PATIENT_REPORTED' || a.last_source_type === 'CAREGIVER_REPORTED');
    var ho = isHo(a), creator = ho && ME.actor_id && a.created_by === ME.actor_id;
    var nexts = patientDone ? ['COMPLETED'] : (NEXT[a.action_status] || []);
    /* 建立者：沒人接手前不能自己接受或記完成（只能取消並寫原因、或轉給其他職類） */
    if (ho && creator && !a.accepted_by) nexts = nexts.filter(function (x) { return ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].indexOf(x) < 0; });
    /* 3.1.0：有人接手之後只有接手者能改狀態；同職類或協調者要先「由我接手」 */
    var ownedByOther = ho && a.accepted_by && a.accepted_by.actor_id !== ME.actor_id && !terminal;
    if (ownedByOther) nexts = [];
    var canTake = ownedByOther && (ME.role === a.owner_role || ME.role === 'CASE_MANAGER' || ME.is_admin);
    var needAck = ho && creator && !a.result_acknowledged && ((a.action_status === 'COMPLETED' && a.result_code) || (a.action_status === 'NOT_DONE' && a.resolution_code === 'RECEIVER_DECLINED'));
    var sc = scopeOf(a), ro = (ho || sc !== 'HANDOFF') ? (ho && /^DISC:/.test(a.about_ref || '') ? DISC_HO_OPTS() : resultOpts(sc)) : [];
    var ackHtml = needAck ? ' <button class="btn small" type="button" data-act="ac_ack" data-val="' + esc(a.action_id) + '">' + (a.result_code === 'NEED_TALK' ? '已和接收方討論完成' : '已看過回覆') + '</button>' + (a.result_code === 'NEED_TALK' ? '<span class="small muted">（接收方要求討論：討論完成後再按；看過不算）</span>' : '') : '';
    var ctl = ownedByOther ? '<span class="small">由 ' + esc(ROLE_ZH[a.accepted_by.role] || a.accepted_by.role || '') + ' ' + esc(a.accepted_by.actor_id) + ' 負責' + (canTake ? '' : '（只有接手者能更新）') + '</span>' +
        (canTake ? ' <button class="btn small" type="button" data-act="ac_takeover" data-val="' + esc(a.action_id) + '">由我接手</button><span class="small muted">（原接手者不在時；會留下接手紀錄）</span>' : '') + '<p id="aerr_' + esc(a.action_id) + '" class="small field-err"></p>' :
      (terminal && !patientDone) ? '<span class="muted small">已結案</span>' + ackHtml :
      '<select id="ast_' + esc(a.action_id) + '" aria-label="新狀態"><option value="">—</option>' + nexts.map(function (st) { return opt(st, (patientDone ? '確認已完成' : (ho && st === 'ACCEPTED' ? '接手' : AST_ZH[st]))); }).join('') + '</select> ' +
      '<select id="acode_' + esc(a.action_id) + '" aria-label="障礙或結案原因"><option value="">原因（遇到障礙、未執行、取消時必選）</option><optgroup label="遇到的障礙">' + (DICT.barrier_codes || []).map(function (c) { return opt('B:' + c[0], c[1]); }).join('') + '</optgroup><optgroup label="未執行／取消的原因">' + (DICT.resolution_codes || []).filter(function (c) { return ho || c[0] !== 'RECEIVER_DECLINED'; }).map(function (c) { return opt('R:' + c[0], c[1]); }).join('') + '</optgroup></select> ' +
      (ro.length ? '<select id="ares_' + esc(a.action_id) + '" aria-label="完成結果"><option value="">完成結果' + (sc === 'HANDOFF' ? (a.handoff && a.handoff.needs.indexOf('REPLY_TO_ME') >= 0 ? '（轉介者要求回覆：完成時必選）' : '（選填）') : '（完成時必選）') + '</option>' + ro.map(function (c) { return opt(c[0], c[1]); }).join('') + '</select> ' : '') +
      (CE_OF_TPL[a.action_ref] ? '<label class="small"><input type="checkbox" id="ace_' + esc(a.action_id) + '"> 完成時同時記錄「' + esc(CE_ZH[CE_OF_TPL[a.action_ref]]) + '」（依病歷確認；指標以此事件計算）</label> ' : '') +
      '<button class="btn small" type="button" data-act="ac_upd" data-val="' + esc(a.action_id) + '">加入</button>' +
      (ho ? '<details class="small"><summary>轉給其他職類</summary><div class="row"><label class="f">改由<select id="ared_role_' + esc(a.action_id) + '"><option value="">請選擇職類</option>' + ME.roles.filter(function (r) { return r !== a.owner_role; }).map(function (r) { return opt(r, ROLE_ZH[r] || r); }).join('') + '</select></label>' +
        '<label class="f">理由<select id="ared_rsn_' + esc(a.action_id) + '"><option value="">請選擇</option>' + (DICT.action_change_reasons || []).filter(function (c) { return c[2] === 'REDIRECT'; }).map(function (c) { return opt(c[0], c[1]); }).join('') + '</select></label><button class="btn small" type="button" data-act="ac_redirect" data-val="' + esc(a.action_id) + '">加入這次變更</button></div><details class="help"><summary>說明</summary><p class="small muted">轉派後回到「待接手」，由新的職類接受；原本的接手紀錄保留。</p></details></details>' : '') +
      (a.visibility && !terminal ? '<p class="small" data-vis="' + esc(a.visibility.state) + '">' + chip({ PENDING_DISCUSSION: '待與病人討論（病人端不顯示）', CLINICIAN_ONLY: '只給醫療人員看（已記理由）', DISCUSSED: '已和病人討論（病人端顯示）', VISIBLE: '病人端顯示' }[a.visibility.state] || a.visibility.state, a.visibility.state === 'DISCUSSED' || a.visibility.state === 'VISIBLE' ? '' : 'warn') +
        ' <select id="avis_' + esc(a.action_id) + '"><option value="">可見度</option>' + (DICT.action_change_reasons || []).filter(function (c) { return c[2] === 'VISIBILITY'; }).map(function (c) { return opt(c[0], c[1]); }).join('') + '</select> <button class="btn small" type="button" data-act="ac_vis" data-val="' + esc(a.action_id) + '">加入這次變更</button></p>' : '') +
      (terminal ? '' : '<details class="small"><summary>改期</summary><div class="row"><label class="f">新的到期日<input type="date" id="resd_' + esc(a.action_id) + '"></label><button class="btn small" type="button" data-act="ac_resched" data-val="' + esc(a.action_id) + '">加入這次變更</button></div></details>') +
      (rebase[a.action_id] ? '<p class="small">' + chip('再住院前的待辦：請決定', 'warn') + ' <button class="btn small" type="button" data-act="ac_continue" data-val="' + esc(a.action_id) + '">延續（仍需要）</button> 或改期；不需要了請選「取消」＋原因「再住院後已由新的計畫取代」。</p>' : '') +
      '<p id="aerr_' + esc(a.action_id) + '" class="small field-err"></p>';
    return '<tr id="act_' + esc(a.action_id) + '"><td>' + esc(actName(a)) + (a.action_ref && !tpl(a.action_ref) && sc === 'HANDOFF' && !/^TEACH:/.test(a.action_ref) ? '<br><span class="small muted">' + esc(a.action_ref) + '</span>' : '') + (a.barrier_code && a.action_status === 'BARRIER_REPORTED' ? '<br>' + chip('障礙：' + codeZh(DICT.barrier_codes, a.barrier_code), 'warn') : '') + (a.patient_visible ? '' : ' ' + chip('病人看不到')) + (a.handoff ? '<br><span class="small">' + esc(hoText(a.handoff)) + (a.about_ref ? '｜' + esc(aboutText(a.about_ref)) : '') + '</span>' : '') + hoStateHtml(a) + '</td><td>' + esc(ROLE_ZH[a.owner_role] || a.owner_role || '') + '</td><td>' + chip((ho && a.action_status === 'PLANNED' ? '待接手' : (AST_ZH[a.action_status] || a.action_status)), a.action_status === 'COMPLETED' ? 'ok' : (a.overdue ? 'err' : '')) + (patientDone ? '<br><span class="small muted">病人自述完成，尚未確認</span>' : '') + '</td><td>' + esc(d10(a.due_at)) + (a.overdue ? ' ' + chip('逾期', 'err') : '') + '</td><td>' + esc(d10(a.last_updated_at)) + '</td>' +
      '<td class="noprint">' + ctl + '</td></tr>';
  }).join('') + '</tbody></table></div>' : '<p class="muted">尚無行動。</p>';
  var dcOpen = (v.episodes || []).some(function (e) { return e.index_status === 'INDEX_ELIGIBLE' && e.discharge_at && (Date.now() - Date.parse(e.discharge_at)) / 86400000 <= 14; });
  h += '<details class="noprint"' + (dcOpen ? ' open' : '') + '><summary>出院照護組合' + (dcOpen ? '（最近 14 天內有已確認的心衰竭出院）' : '') + '</summary><p class="small">一次加入：' + (DICT.action_templates || []).filter(function (t) { return t.bundle === 'DISCHARGE'; }).map(function (t) { return esc(t.label_clinician); }).join('、') +
    '。已經有、尚未結案的同一項不會重複加入；到期日依出院日或今天推算，可在儲存前移除。</p><button class="btn" type="button" data-act="bundle_dc">加入出院照護組合</button>' + rehabHintHtml() + '</details>';
  h += newActionHtml(false) + '</section>';
  return h;
}
/* 3.4（T12）：新增行動與交接表單（照護分頁與電話追蹤的本次評估頁共用同一份；兩頁不會同時出現，id 不重複） */
function newActionHtml(open) {
  return '<details class="noprint" id="na_box"' + (open ? ' open' : '') + '><summary>新增行動</summary><div class="row" style="margin-top:8px"><label class="f">常用範本<select id="na_tpl"><option value="">（不用範本）</option>' + (DICT.action_templates || []).map(function (t) { return opt(t.id, t.label_clinician); }).join('') + '</select></label><label class="f">類型<select id="na_type">' + ME.action_types.map(function (x) { return opt(x, ACT_ZH[x] || x); }).join('') + '</select></label>' +
    '<label class="f">負責職類<select id="na_owner">' + ME.roles.map(function (r) { return opt(r, ROLE_ZH[r] || r, r === ME.role); }).join('') + opt('PATIENT', '病人') + opt('CAREGIVER', '照顧者') + '</select></label>' +
    '<label class="f">到期日<input type="date" id="na_due"></label><label class="f"><span>病人看得到</span><input type="checkbox" id="na_vis" checked></label></div>' +
    '<fieldset class="handoff"><legend>交接內容（轉介給其他職類時填；選填）</legend><div class="row"><label class="f">原因<select id="ho_reason"><option value="">不填</option>' + (DICT.handoff_reasons || []).map(function (c) { return opt(c[0], c[1]); }).join('') + '</select></label>' +
    '<label class="f">希望多快處理<select id="ho_urg"><option value="">不填</option>' + (DICT.handoff_urgency || []).map(function (c) { return opt(c[0], c[1]); }).join('') + '</select></label></div>' +
    '<div class="row">' + (DICT.handoff_needs || []).map(function (c) { return '<label class="small"><input type="checkbox" class="ho_need" value="' + esc(c[0]) + '"> ' + esc(c[1]) + '</label>'; }).join(' ') + '</div>' +
    '<p class="small muted">交接只用代碼，不寫自由文字；需要補充請當面或電話說明。病人最在意的事會自動跟著病人顯示。</p></fieldset>' +
    '<div id="na_reach" class="small" role="status"></div>' +
    '<div class="row"><button class="btn" type="button" data-act="ac_new">加入這次變更</button><p id="ho_err" class="small field-err"></p></div><p class="small muted">「計畫中」永遠不算完成；完成要記完成日。</p></details>';
}
function redirectAction(id) {
  var r = $('ared_role_' + id).value, why = $('ared_rsn_' + id).value;
  if (!r) { inlineErr('aerr_' + id, '請選擇要轉給哪個職類。'); return; }
  if (!why) { inlineErr('aerr_' + id, '轉給其他職類要選理由。'); return; }
  ST.ac.push({ action_id: id, action_status: 'PLANNED', owner_role: r, change_reason: why }); afterStage();
}
function updAction(id) {
  var s = $('ast_' + id).value, code = $('acode_' + id).value || '', res = $('ares_' + id) ? $('ares_' + id).value : '';
  if (!s) { inlineErr('aerr_' + id, '請先選新狀態。'); return; }
  var a = { action_id: id, action_status: s }, cur = CUR.rec.view.actions[id] || {};
  if (s === 'COMPLETED') a.completed_at = today();
  if (res && s !== 'COMPLETED') { inlineErr('aerr_' + id, '「完成結果」只在記錄完成時填。'); return; }
  if (s === 'COMPLETED' && res) a.result_code = res;
  if (s === 'COMPLETED' && !res && (scopeOf(cur) !== 'HANDOFF' || (cur.handoff && cur.handoff.needs.indexOf('REPLY_TO_ME') >= 0))) { inlineErr('aerr_' + id, '記錄完成時請選「完成結果」。'); if ($('ares_' + id)) $('ares_' + id).focus(); return; }
  if (s === 'BARRIER_REPORTED') { if (code.indexOf('B:') !== 0) { inlineErr('aerr_' + id, '「遇到障礙」請在原因選一個障礙。'); $('acode_' + id).focus(); return; } a.barrier_code = code.slice(2); }
  if (s === 'NOT_DONE' || s === 'CANCELED') { if (code.indexOf('R:') !== 0) { inlineErr('aerr_' + id, '「未執行／取消」請在原因選一個結案原因。'); $('acode_' + id).focus(); return; } a.resolution_code = code.slice(2); }
  var ce = $('ace_' + id) && $('ace_' + id).checked ? CE_OF_TPL[cur.action_ref] : '';
  if (ce && s !== 'COMPLETED') { inlineErr('aerr_' + id, '「同時記錄就醫事件」只在記錄完成時勾選。'); return; }
  ST.ac.push(a);
  /* R-A-005：工作完成與指標事件是兩筆紀錄；勾選時才同時暫存事件，預設不勾，避免未經病歷確認就計入指標 */
  if (ce) ST.ce.push({ event_type: ce, occurred_at: today(), hf_related: 'YES', source_type: 'CLINICIAN_VERIFIED', transfer_status: 'NONE' });
  afterStage();
}
var CE_OF_TPL = { 'TPL:FOLLOWUP_7D': 'PROFESSIONAL_FOLLOWUP_COMPLETED', 'TPL:FMT_REVIEW': 'FMT_REVIEW_COMPLETED' };
/* 5.2 H-01：工作清單辨識提示（年齡分組、性別、最近場域；不顯示姓名與病歷號） */
function identTxt(x) { return x && x.ident && x.ident.text ? '<span class="small muted wl-ident">（' + esc(x.ident.text) + '）</span>' : ''; }
function TPL_BY_ID(id) { return (DICT.action_templates || []).filter(function (x) { return x.id === id; })[0] || null; }
var TPL_HO = { MED_REVIEW_POSTDC: 'MED_RECON', EDU_SELF_CARE: 'EDUCATION', CARDIAC_REHAB: 'FUNCTION', OT_ADL: 'FUNCTION', DIET_CONSULT: 'NUTRITION', SOCIAL_CONSULT: 'CAREGIVER', MENTAL_CONSULT: 'MOOD_COG', PALLIATIVE_CONSULT: 'ACP', ACP_TALK: 'ACP', CARDIO_CONSULT: 'SYMPTOM_WORSE', VACCINE_REVIEW: 'EDUCATION' };
/* R-B-001：交給「目前沒有人看得到這位病人」的職類（不在照護團隊、也沒有全院所範圍的人員），工作清單不會出現——明說並要求確認另行通知 */
function unreachable(role) { var R = CUR && CUR.rec && CUR.rec.reachable_roles; return !!R && role && role !== ME.role && ['PATIENT', 'CAREGIVER'].indexOf(role) < 0 && R.indexOf(role) < 0; }
function reachNote() {
  var el = $('na_reach'); if (!el) return; var r = $('na_owner').value;
  el.innerHTML = unreachable(r) ? '<p class="notice warn">目前沒有' + esc(ROLE_ZH[r] || r) + '在這位病人的照護團隊，也沒有全院所範圍的' + esc(ROLE_ZH[r] || r) + '：這筆工作不會出現在任何人的工作清單。請先請對方加入照護團隊，或另以院內會診流程通知。</p><label class="small"><input type="checkbox" id="na_ack_unreach"> 我會另以院內會診或電話通知對方</label>' : '';
}
/* R-B-011 等：計畫訊息一鍵帶入轉介表單（只預填，不自動加入；由記錄者確認） */
var QUICK_REF_LEGACY = { 'R-COST-SKIP': ['SOCIAL_CONSULT', 'MED_COST'], 'R-CAREGIVER-STRAIN': ['SOCIAL_CONSULT', 'CAREGIVER'], 'R-GOALS': ['ACP_TALK', 'ACP'], 'R-SYMPTOM-BURDEN': ['CARDIO_CONSULT', 'SYMPTOM_WORSE'] /* 3.3（ZT-B06-001）：症狀負擔高對應的是進階心衰竭評估（卡片 ADV_HF_REFERRAL），不是安寧轉介；安寧另由照護目標討論決定 */, 'R-MED-BURDEN': ['MED_REVIEW_POSTDC', 'MED_RECON'], 'R-FALL-MEDS': ['OT_ADL', 'FUNCTION'],
  /* 4.9.3 WP-B2 */ 'R-SURPRISE-GOC': ['ACP_TALK', 'ACP'], 'R-ADV-HF-SIGNAL': ['CARDIO_CONSULT', 'SYMPTOM_WORSE'], 'R-SYMPTOM-NRS': ['PALLIATIVE_CONSULT', 'ACP'], 'R-WEIGHT-DOWN': ['DIET_CONSULT', 'NUTRITION'] };
/* 5.2 C-07：預設轉介草稿改由伺服器指定（計畫訊息的 quick_ref；PL.QUICK_REF_DEFAULT）；上面的舊對照表只保留作為對照，不再使用 */
var QUICK_REF = {};
function quickRef(rule) {
  var q = /^Q:/.test(String(rule)) ? String(rule).slice(2).split('|') : QUICK_REF[rule]; if (!q) return;
  CUR.tab = 'care'; CUR.editing = null; renderPatient();
  var d = $('na_tpl'); if (!d) return; var det = d.closest ? d.closest('details') : null; if (det) det.open = true;
  d.value = q[0]; $('ho_reason').value = ''; tplPicked(); $('ho_reason').value = q[1];
  psy_qrApply(q);   /* 5.1 W51-PSY（PS-01）：訊息自帶的到期天數與交接緊急度覆寫範本預設（例如自傷念頭＝今天，不用心理評估範本的 28 天） */
  d.focus(); if (d.scrollIntoView) d.scrollIntoView({ block: 'center' });
}
function newAction() {
  var t = (DICT.action_templates || []).filter(function (x) { return x.id === $('na_tpl').value; })[0];
  if (unreachable($('na_owner').value) && !($('na_ack_unreach') && $('na_ack_unreach').checked)) { reachNote(); inlineErr('ho_err', '這個職類目前看不到這位病人：請勾選「我會另以院內會診或電話通知對方」，或先請對方加入照護團隊。'); return; }
  var a = { action_type: t ? t.action_type : $('na_type').value, action_status: 'PLANNED', owner_role: $('na_owner').value, patient_visible: $('na_vis').checked };
  if (t) a.action_ref = 'TPL:' + t.id;
  if (unreachable(a.owner_role)) a.handoff_delivery = 'OUT_OF_SYSTEM_NOTIFIED';   /* 3.3（ZT-A-013）：伺服器端也檢查，並保留為系統外交接 */
  if ($('na_due').value) a.due_at = $('na_due').value;
  var needs = [].slice.call(document.querySelectorAll('.ho_need:checked')).map(function (x) { return x.value; });
  if ($('ho_reason').value) { a.handoff_reason = $('ho_reason').value; if ($('ho_urg').value) a.handoff_urgency = $('ho_urg').value; if (needs.length) a.handoff_needs = needs; }
  else if ($('ho_urg').value || needs.length) { inlineErr('ho_err', '有填交接內容時，請先選交接原因。'); $('ho_reason').focus(); return; }
  ST.ac.push(a); afterStage();
}
/* 選範本時帶入類型、負責職類與到期日（仍可修改） */
function tplPicked() {
  var t = (DICT.action_templates || []).filter(function (x) { return x.id === $('na_tpl').value; })[0]; if (!t) return;
  $('na_type').value = t.action_type; if (t.id === 'FOLLOWUP_7D' && coordRole()) $('na_owner').value = coordRole(); else if (t.owner) $('na_owner').value = t.owner; if (t.due_days) $('na_due').value = addDays(today(), t.due_days);
  /* R-B-015：範本交給別的職類時，預填交接原因並勾「處理後請回覆轉介者」，讓轉介有接手與回覆閉環（仍可修改或清除） */
  if (t.owner && t.owner !== ME.role && ['PATIENT', 'CAREGIVER'].indexOf(t.owner) < 0 && TPL_HO[t.id] && !$('ho_reason').value) {
    $('ho_reason').value = TPL_HO[t.id];
    [].slice.call(document.querySelectorAll('.ho_need')).forEach(function (x) { if (x.value === 'REPLY_TO_ME') x.checked = true; });
  }
  reachNote();
}
/* 3.3（ZT-A-010）：出院後 7 天追蹤交給院內流程政策指定的轉銜協調職類（依院所；沒有設定時伺服器會拒收） */
function coordRole() { var m = ((ME.role_policy || {}).transition_coordinator_roles) || {}, fac = CUR && CUR.rec ? CUR.rec.facility_code : ''; var l = (m[fac] || m.DEFAULT || []); return l.indexOf(ME.role) >= 0 ? ME.role : (l[0] || ''); }
function bundleDischarge() {
  var v = CUR.rec.view, open = {};
  Object.keys(v.actions).forEach(function (k) { var a = v.actions[k]; if (['COMPLETED', 'NOT_DONE', 'CANCELED'].indexOf(a.action_status) < 0) open[a.action_ref] = 1; });
  ST.ac.forEach(function (a) { if (a.action_ref) open[a.action_ref] = 1; });
  var ep = (v.episodes || []).filter(function (e) { return e.index_status === 'INDEX_ELIGIBLE' && e.discharge_at; }).slice(-1)[0];
  /* R-A-015：本次暫存了「已確認出院」時，以該出院日為基準（新一次住院尚未寫入 episodes） */
  var stagedDc = ST.ce.filter(function (c) { return c.event_type === 'HF_DISCHARGE_VERIFIED' && !c.supersedes_event_id; }).map(function (c) { return c.occurred_at; }).sort().slice(-1)[0];
  if (stagedDc && (!ep || stagedDc > d10(ep.discharge_at))) ep = null;
  var base = stagedDc && !ep ? stagedDc : (ep ? d10(ep.discharge_at) : today()), n = 0;
  /* R-A-019：已有用藥監測排程（腎功能／血鉀）時不重複建立抽血工作 */
  var monOpen = ((CUR.rec.plan || {}).medication || {}).monitoring;
  monOpen = (monOpen || []).some(function (m) { return ['DUE', 'OVERDUE', 'RESULTED', 'RESULT_CONFLICTED', 'REPEAT_DUE'].indexOf(m.status) >= 0; });
  if (monOpen) open['TPL:LAB_RENAL_K'] = 1;
  (DICT.action_templates || []).filter(function (t) { return t.bundle === 'DISCHARGE' && !open['TPL:' + t.id]; }).forEach(function (t) {
    /* 3.3（ZT-A-004／REG-A-013）：到期日以真正的出院日計算；補登時已過期就照實顯示逾期（不改成今天） */
    var due = t.due_days ? addDays(base, t.due_days) : '';
    var a = { action_type: t.action_type, action_ref: 'TPL:' + t.id, action_status: 'PLANNED', owner_role: t.id === 'FOLLOWUP_7D' ? coordRole() : (t.owner || ME.role), patient_visible: true };
    if (ep && ep.episode_id) a.episode_id = ep.episode_id; else if (stagedDc && !ep) a.episode_link = 'THIS_TX_DISCHARGE';
    if (due) a.due_at = due;
    ST.ac.push(a); n++;
  });
  if (!n) { inlineErr('pt_msg', '出院照護組合的項目都已經有了（尚未結案）。'); return; }
  afterStage();
  /* R-A-024：出院組合含每日體重紀錄，但個人化警示門檻未設定時提醒（不自動填值：門檻屬醫師判斷） */
  var o = v.fields || {}, w = function (k) { return o[k] && typeof o[k].value === 'number'; };
  if (!(w('weight_alert_kg') || ST.obs.weight_alert_kg) || !(w('weight_alert_days') || ST.obs.weight_alert_days)) inlineErr('pt_msg', '已加入出院照護組合。提醒：尚未設定「幾天內體重增加幾公斤要聯絡」，病人單張與病人連結不會顯示體重警示；請由醫師決定後在評估填入。');
}
function concernsHtml(v) {
  var list = Object.keys(v.concerns).map(function (k) { return v.concerns[k]; });
  var h = '<section class="panel"><h2>病人關心的問題</h2>';
  h += list.length ? '<div class="table-scroll"><table><thead><tr><th scope="col">問題</th><th scope="col">目前</th><th scope="col">開啟</th><th scope="col">歷程</th><th scope="col" class="noprint">更新</th></tr></thead><tbody>' + list.map(function (c) {
    return '<tr><td>' + esc((DICT.concern_labels || {})[c.concern_code] || c.concern_code) + '</td><td>' + chip(CST_ZH[c.status] || c.status, c.status === 'RESOLVED' ? 'ok' : (c.status === 'WORSE' ? 'err' : '')) + '</td><td>' + esc(d10(c.opened_at)) + '</td><td class="small">' + c.status_history.map(function (x) { return esc(d10(x.at)) + ' ' + esc(CST_ZH[x.status] || x.status); }).join('<br>') + '</td>' +
      '<td class="noprint"><select id="cst_' + esc(c.concern_id) + '" aria-label="新狀態"><option value="">—</option>' + ['RESOLVED', 'IMPROVED', 'SAME', 'WORSE', 'UNSURE'].map(function (s) { return opt(s, CST_ZH[s]); }).join('') + '</select> <button class="btn small" type="button" data-act="co_upd" data-val="' + esc(c.concern_id) + '">加入</button></td></tr>';
  }).join('') + '</tbody></table></div>' : '<p class="muted">尚無紀錄。</p>';
  return h + '<details class="noprint"><summary>新增關心的問題</summary><div class="row" style="margin-top:8px"><label class="f">問題<select id="nc_code">' + (DICT.concern_codes || []).map(function (x) { return opt(x, (DICT.concern_labels || {})[x] || x); }).join('') + '</select></label><button class="btn" type="button" data-act="co_new">加入這次變更</button></div></details></section>';
}

/* ---------- 3.0.0 用藥閉環：歷程（入院前／出院後／目前／實際使用）、變更軌跡、監測（待抽血→待判讀→已判讀）、差異處理 ---------- */
var CHG_ZH = { STARTED: '開始', STOPPED: '停用', ADJUSTED: '調整', HELD: '暫停', RESUMED: '恢復' };
var MON_ZH = { DUE: ['待抽血', 'warn'], OVERDUE: ['已過追蹤日，還沒有結果', 'err'], RESULTED: ['結果已出來，待判讀', 'warn'], REVIEWED: ['已判讀', 'ok'], CLOSED_NOT_DONE: ['未執行（已記原因）', ''], RESULT_CONFLICTED: ['同一天結果衝突，請先更正', 'err'], REPEAT_DUE: ['判讀後需要再追蹤一次', 'warn'] };
function mcZh(sec, c) { return codeZh(((DICT.medication_changes || {})[sec]) || [], c); }
/* 3.4（T08／ZT-A-005）：藥師同畫面核對——每個成分一列，五欄並列（只讀既有資料；不新增欄位、不做判斷、不給調整劑量的字樣）。
   病人或家人說的檢驗數值與已依報告確認的值分開標示；本系統沒有 SCr 欄位（腎功能以 eGFR 呈現），欄名寫明。 */
/* schema 5.0（V02）：心腎代謝觀察值（資料：所有病人）＋therapy gap 與監測閉環（L2 規則輸出：只在模擬病人，真實病人整段不出現） */
var GAP_ZH = { CONSIDER_DISCUSSION: '可與開立醫師討論', REASONED_NONUSE: '已記錄理由', CONTRAINDICATED: '已記錄禁忌', DATA_INSUFFICIENT: '資料不足', TEMPORARILY_UNSUITABLE: '暫不適合（需醫療人員先評估）', MONITORING_REQUIRED: '監測未完成' };
var MON4_ZH = { TRIGGERED: '已觸發（尚未到採檢期間）', AWAITING_SAMPLE: '待採檢', SAMPLED_UNVERIFIED: '已有結果、未依報告確認', VERIFIED: '已確認、待判讀', INTERPRETED: '已判讀、需再追蹤', CLOSED: '已結案' };
function v4MedsHtml() {
  var M = CUR.rec.v4 && CUR.rec.v4.sections && CUR.rec.v4.sections.meds; if (!M) return CUR.rec.v4_error ? '<section class="panel" id="v4_meds"><p class="muted">心腎代謝區塊暫時無法顯示（' + esc(CUR.rec.v4_error) + '）。</p></section>' : '';
  var pnl = (M.cardio_renal_panel || []).map(function (x) { var l = x.latest; return '<tr><th scope="row">' + esc(x.label) + '</th><td>' + (l ? esc(l.value) + ' ' + esc(x.unit) + '（' + esc(md(l.date)) + '，' + esc(srcZh(l.source_type)) + '，' + (l.verified ? '已確認' : '未確認') + '）' + (l.stale ? ' ' + chip('已過期', 'warn') : '') : '<span class="muted">沒有紀錄</span>') + (x.latest_verified ? '<br><span class="small muted">最近已確認：' + esc(x.latest_verified.value) + '（' + esc(md(x.latest_verified.date)) + '）</span>' : '') + '</td></tr>'; }).join('');
  var h = '<section class="panel" id="v4_meds"><h2>心腎代謝觀察值</h2><div class="table-scroll" tabindex="0" role="region" aria-label="心腎代謝觀察值"><table class="small"><tbody>' + pnl + '</tbody></table></div>';
  if (M.gaps || M.monitoring) {
    h += '<h3>指引建議核心藥物對照與監測 ' + trialChip('RULE-GAP-FMT-ESC26', '試行規則：真實病人看不到') + '</h3><details class="help"><summary>說明</summary><p class="small muted">只列候選與提示，不建議開立、調整或停用任何藥物；判斷只用醫療人員確認的數值。規則版本與引用文獻記錄在 Evidence_Rule_Version 表。</p></details>';
    if (M.gaps) h += '<ul class="small" id="v4_gaps">' + (M.gaps.items || []).map(rxaGapLi).join('') + '</ul>' + rxaDxNote(M.gaps);   /* 5.1 W51-RXA：每項的標籤、下一步、教學與高齡註記改由 rxaGapLi 組（原有字句不變） */
    if (M.monitoring) h += '<ul class="small" id="v4_mon">' + (M.monitoring.length ? M.monitoring.map(function (m) { return '<li data-state="' + esc(m.state) + '">' + esc(ingName(m.ingredient)) + '｜腎功能與電解質：' + esc(MON4_ZH[m.state] || m.state) + '（採檢期間 ' + esc(md(m.window[0])) + '–' + esc(md(m.window[1])) + '）' + (m.overdue ? ' ' + chip('逾期', 'err') : '') + (m.escalation ? ' ' + chip(m.escalation.text, 'err') : '') + '</li>'; }).join('') : '<li class="muted">沒有進行中的監測</li>') + '</ul>';
  }
  /* V04：鐵缺乏（同日採檢的 TSAT＋ferritin、Hb：資料；定義與 IV iron 討論條件：L2 只在模擬病人） */
  var IR = CUR.rec.v4.sections.iron;
  if (IR) {
    var pr = IR.data && IR.data.pair;
    h += '<h3>鐵狀態</h3><p class="small" id="v4_iron_data">' + (pr ? '同日採檢（' + esc(md(pr.date)) + '）：ferritin ' + esc(pr.ferritin) + ' ng/mL、TSAT ' + esc(pr.tsat) + '%' : '<span class="muted">沒有同日採檢、已確認的 TSAT 與 ferritin</span>') + (IR.data && IR.data.hb ? '｜Hb ' + esc(IR.data.hb.value) + ' g/dL（' + esc(md(IR.data.hb.date)) + '）' : '') + '</p>';
    if (IR.items && IR.items.length) h += '<ul class="small" id="v4_iron">' + IR.items.map(function (x) { return '<li data-code="' + esc(x.code) + '">' + esc(x.text) + (x.rule_version_label ? '（規則版本 ' + esc(x.rule_version_label) + '）' : '') + ' ' + chip('試行規則（只在模擬病人顯示）', 'warn') + '</li>'; }).join('') + '</ul>';
  }
  /* V05：全面藥事照護介入（資料）與生病日個人計畫（只記錄開立職類已下達的）；病人端生病日卡為 L1 草稿（不顯示給病人） */
  var CM = CUR.rec.v4.sections.cmm;
  if (CM) {
    var CAT_ZH = { INDICATION: '適應症', EFFECTIVENESS: '療效', SAFETY: '安全', ADHERENCE: '遵從', PRACTICAL: '實際使用', ACCESS: '取得', MONITORING: '監測', DEPRESCRIBING_CANDIDATE: '減藥候選' };
    var STG_ZH = { DISCREPANCY_IDENTIFIED: '發現差異', INTERVENTION_PROPOSED: '藥師提出介入', PRESCRIBER_RESPONDED: '開立醫師已回覆', PHARMACIST_REVIEWED: '藥師已覆核', FOLLOW_UP_SCHEDULED: '已排追蹤', FOLLOW_UP_DONE: '追蹤完成', CLOSED: '已結案' };
    h += '<h3>藥事介入</h3><ul class="small" id="v4_cmm">' + (CM.interventions.length ? CM.interventions.map(function (x) { return '<li data-stage="' + esc(x.stage) + '">' + esc(CAT_ZH[x.category] || x.category) + '｜' + esc(ingName(x.ingredient)) + '｜' + esc(STG_ZH[x.stage] || x.stage) + (x.prescriber_response ? '（回覆：' + esc(x.prescriber_response) + '）' : '') + cmmNextHtml(x) + '</li>'; }).join('') : '<li class="muted">沒有介入紀錄</li>') + '</ul>';
    /* 5.2 B-11：介入藥品＝處方 ∪ 已確認的實際使用（含病人自購的成藥、保健品） */
    var cmmIngs = []; ((CUR.rec.view.fields.prescribed_meds || {}).value || []).forEach(function (m) { if (cmmIngs.indexOf(m.ingredient) < 0) cmmIngs.push(m.ingredient); });
    ((CUR.rec.view.fields.med_instances || {}).value || []).forEach(function (m) { if (m.status === 'CURRENT' && m.match_status !== 'PATIENT_SELECTED_UNCONFIRMED' && cmmIngs.indexOf(m.ingredient) < 0) cmmIngs.push(m.ingredient); });
    if (ME.role === 'PHARMACIST') h += '<div class="row small"><label>分類 <select id="cmm_cat">' + Object.keys(CAT_ZH).map(function (k) { return opt(k, CAT_ZH[k]); }).join('') + '</select></label> <label>藥品 <select id="cmm_ing">' + cmmIngs.map(function (i) { return opt(i, ingName(i)); }).join('') + '</select></label> <button class="btn small" type="button" data-act="cmm_propose">提出介入（加入這次變更）</button></div>';
    h += '<h3>生病日個人計畫（開立職類已下達）</h3><ul class="small" id="v4_sickday">' + (CM.sick_day_plans.length ? CM.sick_day_plans.map(function (x) { return '<li>' + esc(ingName(x.ingredient)) + '｜暫停條件 ' + esc(x.hold_condition) + rxaHoldNote(x.hold_condition) + '｜恢復條件 ' + esc(x.restart_condition) + '｜' + esc(ROLE_ZH[x.issued_by_role] || x.issued_by_role) + ' ' + esc(md(x.issued_on)) + '</li>'; }).join('') : '<li class="muted">沒有個人生病日計畫（本系統只記錄開立醫師已下達的個人計畫）</li>') + '</ul>';
    if (CM.patient_card_draft) h += '<details class="small"><summary>病人端生病日卡（' + esc(CM.patient_card_draft.status) + '，' + esc(CM.patient_card_draft.review_status) + '：不顯示給病人）</summary><p><b>' + esc(CM.patient_card_draft.title) + '</b></p><ul>' + CM.patient_card_draft.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></details>';
  }
  return h + rxbPanelHtml() + '</section>';   /* 5.1 W51-RXB：心衰竭可能惡化的藥物檢視與醫療端教學註記 */
}
/* V05：介入下一步（伺服器檢查職類與順序：回覆限開立職類、覆核與結案限藥師） */
var CMM_RC_ZH = { ACCEPTED: '同意', ACCEPTED_WITH_MODIFICATION: '修改後同意', DECLINED_WITH_REASON: '不同意（有理由）', NEEDS_DISCUSSION: '需要討論' };
function cmmNextHtml(x) {
  if (!x.open) return '';
  var J = function (st) { return esc(JSON.stringify({ intervention_id: x.intervention_id, category: x.category, ingredient: x.ingredient, stage: st })); };
  if (x.stage === 'INTERVENTION_PROPOSED') return ' <select id="cmm_rc_' + esc(x.intervention_id) + '">' + Object.keys(CMM_RC_ZH).map(function (k) { return opt(k, CMM_RC_ZH[k]); }).join('') + '</select> ' + declineReasonSel('cmm_nc_' + x.intervention_id) + ' <button class="btn small" type="button" data-act="cmm_next" data-val="' + J('PRESCRIBER_RESPONDED') + '">記錄開立醫師回覆</button>';
  if (x.stage === 'PRESCRIBER_RESPONDED') return ' <button class="btn small" type="button" data-act="cmm_next" data-val="' + J('PHARMACIST_REVIEWED') + '">藥師覆核</button>';
  if (x.stage === 'PHARMACIST_REVIEWED' || x.stage === 'FOLLOW_UP_DONE') return ' <button class="btn small" type="button" data-act="cmm_next" data-val="' + J('CLOSED') + '">結案</button>';
  return '';
}
/* schema 5.0（V03）：出院 0–42 天轉銜（STRONG-HF 設計候選：L2 只在模擬病人）＋惡化心衰竭時間軸（資料：所有病人；不計總分） */
var TR_EL_ZH = { ELIGIBLE_PENDING_STABILITY_CONFIRMATION: '符合資料條件，待醫療人員確認血行動力學穩定', ELIGIBLE_STABILITY_CONFIRMED: '符合，已確認穩定', NOT_ELIGIBLE: '不符（沿用既有 7 天追蹤）', DATA_INSUFFICIENT: '資料不足（沿用既有 7 天追蹤）' };
var TR_VS_ZH = { CANDIDATE_EDITABLE_PENDING_CONFIRMATION: '候選（可改，待確認）', SCHEDULED: '已排程（尚未完成）', COMPLETED: '已完成', NOT_PLANNED: '不適用', CANCELLED_READMITTED: '因再入院取消', MISSED_BEFORE_READMISSION: '再入院前未完成' };
var TR_CT_ZH = { REACHED_PATIENT: '聯絡到病人', REACHED_CAREGIVER: '家屬代答', NO_ANSWER: '未接通', VOICEMAIL_LEFT: '已留言', DECLINED: '拒訪' };
/* v4.0 V07–V08：疫苗、量表、轉介與進階心衰竭訊號（醫療人員畫面；L2 提示只在合成病人出現） */
var VAX_ZH = { INFLUENZA: '流感', PNEUMOCOCCAL: '肺炎鏈球菌', COVID19: 'COVID-19', RSV: 'RSV（呼吸道融合病毒）' }, VST_ZH = { VACCINATED: '已接種', NOT_VACCINATED: '未接種', UNSURE: '不確定', NO_RECORD: '沒有紀錄' };
function v4CommunityHtml() {
  var SX = (CUR.rec.v4 && CUR.rec.v4.sections) || {}, VX = SX.vaccination; if (!VX) return '';
  var h = '<section class="panel" id="v4_community"><h2>疫苗接種</h2><table class="small" id="v4_vax"><thead><tr><th scope="col">疫苗</th><th scope="col">狀態</th><th scope="col">接種日</th><th scope="col">來源</th><th scope="col">公費資格</th></tr></thead><tbody>' +
    VX.records.map(function (r, i) { var pf = (VX.public_funding.items || [])[i] || {}; return '<tr data-vaccine="' + esc(r.vaccine) + '"><td>' + esc(VAX_ZH[r.vaccine]) + '</td><td>' + esc(VST_ZH[r.status] || r.status) + '</td><td>' + esc(r.administered_on ? md(r.administered_on) : '') + '</td><td>' + esc(srcZh(r.source_type)) + (r.source_type ? (r.verified ? '（已確認）' : '（未確認）') : '') + '</td><td class="muted">' + esc(pf.text || '') + '</td></tr>'; }).join('') + '</tbody></table>';
  if (VX.prompts) h += VX.prompts.length ? '<ul class="small" id="v4_vax_prompts">' + VX.prompts.map(function (x) { return '<li>' + esc(VAX_ZH[x.vaccine]) + '：' + esc(x.text) + ' ' + trialChip('RULE-VAX-CONSIDER-ESC26', '試行規則（只在模擬病人顯示）') + '</li>'; }).join('') + '</ul>' : '';
  h += '<div class="row small"><label>疫苗 <select id="vx_v">' + Object.keys(VAX_ZH).map(function (k) { return opt(k, VAX_ZH[k]); }).join('') + '</select></label> <label>狀態 <select id="vx_s">' + ['VACCINATED', 'NOT_VACCINATED', 'UNSURE'].map(function (k) { return opt(k, VST_ZH[k]); }).join('') + '</select></label> <label>接種日 <input type="date" id="vx_d"></label> <label>來源 <select id="vx_src">' + opt('CLINICIAN_VERIFIED', '醫療人員確認（接種紀錄）') + opt('PATIENT_REPORTED', '病人自述') + opt('CAREGIVER_REPORTED', '家屬自述') + '</select></label> <button class="btn small" type="button" data-act="vax_stage">加入這次變更</button></div>';
  var IN = SX.instruments, RF = SX.referral;
  if (IN) {
    h += '<h2>量表與評估</h2><p class="small muted">量表題項未取得授權前不顯示；只記專業評估數值或結構化作答，總分由系統計算。</p><ul class="small" id="v4_instr">' + Object.keys(IN.latest).map(function (k) { var x = IN.latest[k]; return '<li>' + esc(k) + '：' + (x.complete ? esc(x.score) : '有缺題，不計總分') + '（' + esc(md(x.on)) + '，' + esc(ROLE_ZH[x.role] || x.role) + '）</li>'; }).join('') + '</ul>';
    if (IN.referral_candidates && IN.referral_candidates.length) h += '<ul class="small">' + IN.referral_candidates.map(function (x) { return '<li>' + esc(x.text) + ' ' + trialChip('RULE-INSTR-REFERRAL-CANDIDATE', '試行規則（只在模擬病人顯示）') + '</li>'; }).join('') + '</ul>';
    h += '<div class="row small"><label>CFS 專業評估（1–9） <input type="number" id="cfs_v" min="1" max="9" step="1"></label> <button class="btn small" type="button" data-act="cfs_stage">加入這次變更</button></div>';
    /* 5.2 D-07：PHQ-9 逐題作答（0–3；題目文字未嵌入，請用院內正式正體中文版紙本施測）；總分由伺服器計算，第 9 題 >0 → 獨立警訊；只限模擬病人（伺服器同樣擋） */
    /* @approval F_INSTR_PHQ begin */
    if (isSyntheticPt() || srvOn('F_INSTR_PHQ')) h += '<fieldset class="small" id="phq9_f"><legend>PHQ-9 逐題作答（0＝完全沒有、1＝幾天、2＝一半以上天數、3＝幾乎每天；題目請用院內正式中文版紙本）' + (srvOn('F_INSTR_PHQ') ? '' : chip('試行：只限模擬病人', 'warn')) + '</legend>' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<label>第 ' + n + ' 題 <select data-phq="' + (n - 1) + '"><option value="">未答</option>' + [0, 1, 2, 3].map(function (v) { return opt(String(v), String(v)); }).join('') + '</select></label>'; }).join(' ') +
      ' <button class="btn small" type="button" data-act="phq9_stage">加入這次變更</button> <span class="small muted">任一題未答不計總分；第 9 題大於 0 會立即產生安全警訊。</span></fieldset>';
    /* @approval F_INSTR_PHQ end */
  }
  if (RF) {
    var INH = RF.inh_items || [], INHL = {}; INH.forEach(function (x) { INHL[x.code] = x.label; });
    h += '<h2>進階心衰竭訊號與轉介</h2>';
    if (RF.glp1) h += '<p class="small" id="v4_glp1">肥胖合併有症狀心衰竭：' + esc(RF.glp1.text) + (RF.glp1.exception_note ? '｜' + esc(RF.glp1.exception_note) : '') + ' ' + trialChip('RULE-GLP1-DISCUSS-ESC26', '試行規則（只在模擬病人顯示）') + '<br><span class="muted">藥證、健保、院內層：' + esc(RF.glp1.layers.map(function (l) { return l.resolve.map(function (y) { return y.layer + ' ' + (y.label || y.status); }).join('、'); })[0] || '') + '</span></p>';
    h += '<p class="small">I-NEED-HELP 訊號（逐項記錄，不判定、不自動轉介）：' + (RF.i_need_help ? esc(md(RF.i_need_help.on)) + ' ' + (RF.i_need_help.signals.length ? RF.i_need_help.signals.map(function (c) { return esc(INHL[c] || c); }).join('、') : '沒有勾選的訊號') : '尚未記錄') + '</p>';
    if (INH.length) h += '<fieldset class="small" id="inh_f"><legend>本次 I-NEED-HELP：勾選有的項目；全部逐項問過才按下方按鈕（沒按＝本次未評估）</legend>' + INH.map(function (x, i) { return '<label><input type="checkbox" data-inh="' + i + '"> ' + esc(x.label) + '</label>'; }).join(' ') + ' <button class="btn small" type="button" data-act="inh_stage">已逐項評估，加入這次變更</button></fieldset>';   /* 4.9.3 WP-A（CARE-CARD-07）：按下＝已逐項評估（未勾＝沒有）；沒按就沒有紀錄（＝未評估） */
    var NX = { CREATED: '已建立', DELIVERED: '已送達', ACCEPTED: '已接受', ASSESSMENT_RECORDED: '已評估', ACTION_COMPLETED: '已完成介入', VERIFIED: '已確認取得資源', CLOSED: '已結案', DECLINED: '退回', FAILED: '未送達' };
    h += RF.referrals.length ? '<ul class="small" id="v4_ref">' + RF.referrals.map(function (r) { return '<li data-ref="' + esc(r.referral_id) + '" data-state="' + esc(r.state) + '">' + esc(ACT_ZH[r.referral_kind] || (r.referral_kind === 'REFERRAL_ADVANCED_HF' ? '轉介進階心衰竭中心' : r.referral_kind)) + '：' + esc(NX[r.state] || r.state) + (r.accepted ? '' : '（尚未被接受）') + (r.state === 'ACTION_COMPLETED' ? '（尚未確認取得資源）' : '') + ' ' + (r.next || []).map(function (n) { return '<button class="btn small" type="button" data-act="ref_stage" data-val="' + esc(JSON.stringify({ referral_id: r.referral_id, referral_kind: r.referral_kind, state: n })) + '">' + esc(NX[n] || n) + '</button>'; }).join(' ') + '</li>'; }).join('') + '</ul>' : '<p class="small muted">沒有轉介紀錄。</p>';
    h += '<div class="row small"><label>新轉介 <select id="ref_k">' + ['REFERRAL_PHARMACIST', 'REFERRAL_DIETITIAN', 'REFERRAL_REHAB', 'REFERRAL_SOCIAL', 'REFERRAL_MENTAL', 'REFERRAL_PALLIATIVE', 'REFERRAL_OT', 'REFERRAL_CARDIOLOGY', 'REFERRAL_ADVANCED_HF'].map(function (k) { return opt(k, ACT_ZH[k] || '轉介進階心衰竭中心'); }).join('') + '</select></label> <button class="btn small" type="button" data-act="ref_new">建立（加入這次變更）</button> <label>退回／未送達理由 <select id="ref_r">' + opt('', '請選擇') + opt('PATIENT_DECLINED', '病人婉拒') + opt('NOT_REACHABLE', '聯絡不上') + opt('RESOURCE_UNAVAILABLE', '資源不可得') + opt('OTHER', '其他') + '</select></label></div><p class="small muted">接受、記錄評估、完成介入只能由接收職類記錄；轉介不改任何診斷，接受不等於已取得資源。</p>';
  }
  return h + '</section>';
}
function v4TransitionHtml() {
  var T4 = CUR.rec.v4 && CUR.rec.v4.sections && CUR.rec.v4.sections.transition; if (!T4) return '';
  var h = '<section class="panel" id="v4_transition"><h2>出院後轉銜與惡化時間軸</h2>';
  if (T4.plans) {
    h += '<h3>出院 0–42 天轉銜 ' + trialChip('RULE-TRANS-STRONGHF-ESC23', '試行規則：真實病人看不到') + '</h3><details class="help"><summary>說明</summary><p class="small muted">2026 ESC 建議心衰竭住院後，出院前及出院後 6 週內頻繁回診，快速啟動並調升核心治療（I B2）：所有已確認的心衰竭出院都列候選訪視（週別為院內參數）。STRONG-HF 試驗條件（篩選時 NT-proBNP >2,500 pg/mL、出院前較篩選值下降 >10% 但仍 >1,500 pg/mL、未達全劑量、血行動力學穩定；1,500 為院內可調參數）只顯示為試驗族群特徵，不決定是否列候選。穩定與否只能由醫療人員確認；確認不穩定就不列候選，沿用既有 7 天追蹤。候選訪視要確認才成為排程；排程不等於完成；是否調整藥物由醫療人員決定。</p></details>';
    h += T4.plans.length ? T4.plans.map(function (pl) {
      var J = function (o) { return esc(JSON.stringify(o)); };
      return '<div class="tr-plan" data-plan="' + esc(pl.plan_id) + '" data-status="' + esc(pl.status) + '"><p><b>' + esc(md(pl.discharge)) + ' 出院</b>（第 ' + esc(pl.day_n) + ' 天）｜' + esc(TR_EL_ZH[pl.eligibility.status] || pl.eligibility.status) + nurTrPathHtml(pl) + (pl.status !== 'ACTIVE' ? '｜' + chip(pl.status === 'CLOSED_READMITTED' ? '再入院，已關閉' : pl.status, 'warn') : '') + '</p>' +
        ((pl.eligibility.status === 'ELIGIBLE_PENDING_STABILITY_CONFIRMATION' || (pl.path === 'ESC26_INTENSIVE_6W_CANDIDATE' && !pl.confirmed)) && pl.status === 'ACTIVE' ? '<div class="row"><button class="btn small" type="button" data-act="tr_stage" data-val="' + J({ event_kind: 'PLAN_CONFIRMED', plan_id: pl.plan_id, outcome_code: 'HAEMODYNAMICALLY_STABLE_CONFIRMED', observed_at: pl.discharge, label: '確認血行動力學穩定（轉銜計畫）' }) + '">確認血行動力學穩定</button> <button class="btn small" type="button" data-act="tr_stage" data-val="' + J({ event_kind: 'PLAN_CONFIRMED', plan_id: pl.plan_id, outcome_code: 'NOT_STABLE', observed_at: pl.discharge, label: '不穩定：改走既有 7 天追蹤' }) + '">不穩定</button></div>' : '') +
        '<ul class="small tr-visits">' + pl.visits.map(function (v) { return '<li data-week="' + v.week + '" data-vs="' + esc(v.status) + '">第 ' + v.week + ' 週：' + esc(TR_VS_ZH[v.status] || v.status) + '｜' + esc(md(v.scheduled_for || v.candidate_date)) + (v.status === 'CANDIDATE_EDITABLE_PENDING_CONFIRMATION' && pl.status === 'ACTIVE' ? ' <button class="btn small" type="button" data-act="tr_stage" data-val="' + J({ event_kind: 'VISIT_SCHEDULED', plan_id: pl.plan_id, visit_week: v.week, scheduled_for: v.candidate_date, label: '排程轉銜第 ' + v.week + ' 週（' + v.candidate_date + '）' }) + '">照候選日排程</button>' : '') + (v.status === 'SCHEDULED' ? ' <button class="btn small" type="button" data-act="tr_stage" data-val="' + J({ event_kind: 'VISIT_COMPLETED', plan_id: pl.plan_id, visit_week: v.week, outcome_code: 'COMPLETED_PHONE', label: '轉銜第 ' + v.week + ' 週已完成（電話）' }) + '">記錄已完成（電話）</button>' : '') + '<br><span class="muted">每次訪視：' + esc(v.checklist.join('；')) + '</span></li>'; }).join('') + '</ul>' +
        (pl.predischarge ? '<p class="small">出院前檢核：' + (pl.predischarge.fmt_classes || []).map(function (c) { return esc((DICT.fmt_classes || {})[c.cls] || c.cls) + (c.started ? ' 已開始' : ' 未開始'); }).join('、') + '｜乾體重' + (pl.predischarge.dry_weight_recorded ? '已記錄' : '未記錄') + '｜求助路徑' + (pl.predischarge.help_path_given ? '已給' : '未記錄') + '｜7 天內追蹤' + (pl.predischarge.followup_7d_scheduled ? '已排' : '未排') + '</p>' + nurPredischargeHtml(pl.predischarge.nur) : '') +   /* 5.3：出院前檢核規則未開啟 → 不顯示 */
        (pl.status === 'ACTIVE' ? '<div class="row small"><label>聯絡結果 <select id="tr_ct_' + esc(pl.plan_id) + '"><option value="">請選擇</option>' + Object.keys(TR_CT_ZH).map(function (k) { return opt(k, TR_CT_ZH[k]); }).join('') + '</select></label> <label>日期 <input type="date" id="tr_cd_' + esc(pl.plan_id) + '" value="' + esc(todayTW()) + '"></label> <button class="btn small" type="button" data-act="tr_contact" data-val="' + esc(pl.plan_id) + '">加入這次變更</button></div>' : '') +
        (pl.contacts.length ? '<p class="small muted">聯絡紀錄：' + pl.contacts.map(function (c) { return '第 ' + c.day_n + ' 天 ' + esc(TR_CT_ZH[c.outcome] || c.outcome) + (c.late_entry ? '（補登）' : ''); }).join('、') + '</p>' : '') + '</div>';
    }).join('<hr class="thin">') : '<p class="muted">沒有已確認的心衰竭出院（索引事件）。</p>';
  }
  var TL = T4.timeline || { items: [] };
  h += '<h3>惡化心衰竭時間軸（自 ' + esc(md(TL.since)) + '；不計總分）</h3><div class="table-scroll" tabindex="0" role="region" aria-label="惡化心衰竭時間軸"><table class="small" id="v4_timeline"><thead><tr><th scope="col">日期</th><th scope="col">項目</th><th scope="col">紀錄</th><th scope="col">來源</th></tr></thead><tbody>' +
    (TL.items.length ? TL.items.map(function (x) { return '<tr data-domain="' + esc(x.domain) + '"><td>' + esc(md(x.date)) + '</td><td>' + esc(x.label) + '</td><td>' + esc(Array.isArray(x.value) ? x.value.join('、') : x.value) + '</td><td>' + esc(srcZh(x.source_type)) + (x.verified ? '（已確認）' : '（未確認）') + '</td></tr>'; }).join('') : '<tr><td colspan="4" class="muted">這段期間沒有紀錄</td></tr>') +
    '</tbody></table></div><p class="small muted">' + esc(TL.triage_note || '') + '</p></section>';
  return h;
}
function medTruthHtml(v) {
  var F = v.fields || {}, rxF = F.prescribed_meds, useF = F.med_instances, fmtF = F.fmt_class_status;
  var rx = rxF && Array.isArray(rxF.value) ? rxF.value : [], use = (useF && Array.isArray(useF.value) ? useF.value : []).concat((useF && useF.unconfirmed) || []), fmt = fmtF && Array.isArray(fmtF.value) ? fmtF.value : [];
  var ings = {}; rx.concat(use).forEach(function (m) { if (m && m.ingredient) ings[m.ingredient] = 1; });
  if (!Object.keys(ings).length) return '';
  var M = (CUR.rec.plan && CUR.rec.plan.medication) || {}, disc = M.discrepancies || [], mon = (M.monitoring || []).filter(function (o) { return ['DUE', 'OVERDUE', 'RESULTED', 'RESULT_CONFLICTED', 'REPEAT_DUE'].indexOf(o.status) >= 0; });
  var CLS = {}; (DICT.ingredients || []).forEach(function (i) { CLS[i.id] = i.cls; });
  var USE_ZH = { CURRENT: '在吃', STOPPED: '已停', UNSURE: '不確定' }, presc = ((ME.role_policy || {}).prescriber_roles) || [];
  var medOwners = ['PHARMACIST'].concat(presc).map(function (r) { return ROLE_ZH[r] || r; }).join('、');
  function lab(fid, short) {
    var e = F[fid]; if (!e || ((e.value === null || e.value === undefined) && e.usability !== 'CONFLICTED')) return '<span class="muted">' + short + ' 沒有紀錄</span>';
    if (e.usability === 'CONFLICTED') return short + ' ' + chip('衝突（同日不同值）', 'err');
    var ver = e.verification_state === 'VERIFIED', st = e.usability === 'STALE' || e.freshness === 'STALE';
    var out = (ver ? '' : '<span data-mt="self">病人或家人說的（未依報告確認）：</span>') + short + ' ' + esc(fmtVal(fid, e.value)) + '（採檢 ' + esc(md(d10(e.effective_at || e.recorded_at))) + '，' + esc(srcZh(e.source_type)) + '，' + (ver ? '已確認' : '未確認') + '）' + (st ? ' ' + chip('已過期', 'warn') : '');
    if (e.newer_lower_tier) out += '<br><span data-mt="self">較新、病人或家人說的（未依報告確認）：</span>' + short + ' ' + esc(fmtVal(fid, e.newer_lower_tier.value)) + '（' + esc(md(d10(e.newer_lower_tier.effective_at || e.newer_lower_tier.recorded_at))) + '）';
    return out;
  }
  var labCell = lab('potassium_mmol_l', '血鉀') + '<br>' + lab('scr_mg_dl', 'SCr') + '<br>' + lab('egfr_ml_min', 'eGFR');
  /* schema 5.0：每日總量由後端換算；目標劑量是 L2 規則輸出，只在模擬病人顯示（真實病人看不到） */
  var V4M = (CUR.rec.v4 && CUR.rec.v4.sections && CUR.rec.v4.sections.meds) || null, D4 = {}; ((V4M && V4M.dose_rows) || []).forEach(function (x) { D4[x.ingredient] = x; });
  function preservedNonCore(ing) {
    var prof = (V4M && V4M.gaps && V4M.gaps.profile) || ((CUR.rec.view.derived || {}).fmt_profile) || '', cl = CLS[ing] || '';
    return prof === 'PRESERVED' && !!(DICT.fmt_classes || {})[cl] && ((DICT.fmt_profiles || {}).PRESERVED || []).indexOf(cl) < 0;
  }
  function tgtCell(ing) {
    var x = D4[ing]; if (!V4M || !V4M.enabled || !V4M.enabled.target) return '<span class="muted small">第 2 級（試行）規則：只在模擬病人顯示</span>';
    if (!x || !x.target) return '<span class="muted">—</span>';
    if (x.target.status !== 'OK') return '<span class="muted">' + (x.target.status === 'NOT_IN_TABLE' ? '不在 ESC 2026 表 11' : '資料不足（需要已確認 eGFR）') + '</span>';
    return esc(x.target.text) + '<br><span class="small muted">每日 ' + esc(x.target.low === x.target.high ? x.target.low : x.target.low + '–' + x.target.high) + ' mg（ESC 2026 表 11；試驗目標劑量，只供對照）</span>' + (x.target.note ? '<br><span class="small muted">' + esc(x.target.note) + '</span>' : '') +
      /* 4.9.3 WP-A（CARE-CARD-03）：LVEF ≥50%（PRESERVED）時，不在該組核心類別的成分（例如 beta-blocker、ACEI／ARB／ARNI）只供對照，不是核心藥物目標（ESC 2026 §6.1.2 p32；p11） */
      (preservedNonCore(ing) ? '<br><span class="small muted" data-hfpef-note="1">此類在 LVEF ≥50% 不屬核心藥物；表 11 劑量只供對照</span>' : '');
  }
  /* 4.9.3 WP-A（移植 4.9.2，CARE-CARD-04）：醫療人員記了「已達目標／可耐受上限／調整中」，但處方沒有可換算的劑量 → 標示無法核對；
     記「已達目標」但換算每日劑量低於表 11 下限（只有啟用目標劑量規則的模擬病人有目標值）→ 提示核對。只加註，不改原紀錄 */
  function doseChip(ing, ds) {
    var x = D4[ing], hasMg = !!x && x.daily_mg !== null && x.daily_mg !== undefined;
    if (['AT_TARGET', 'MAX_TOLERATED', 'TITRATING'].indexOf(ds) >= 0 && !hasMg) return '<br>' + chip('處方沒有記劑量，這個劑量狀態無法核對', 'warn');
    if (ds === 'AT_TARGET' && hasMg && x.target && x.target.status === 'OK' && typeof x.target.low === 'number' && x.daily_mg < x.target.low) return '<br>' + chip('記錄已達目標，但換算每日劑量低於表 11 下限，請核對', 'warn');
    return '';
  }
  var rows = Object.keys(ings).sort().map(function (ing) {
    var r = rx.filter(function (m) { return m.ingredient === ing; })[0], u = use.filter(function (m) { return m.ingredient === ing; })[0], cls = CLS[ing] || '';
    var dd = D4[ing] && D4[ing].daily_mg !== null && D4[ing].daily_mg !== undefined ? '<br><span class="small">每日總量 ' + esc(D4[ing].daily_mg) + ' mg（系統換算）</span>' : (r && (r.strength_mg || r.units_per_dose || r.doses_per_day) ? '<br><span class="small muted">劑量欄位（每次含量、顆數、每日次數）未填完整，無法換算每日總量</span>' : '');
    var c1 = r ? (r.rx_status === 'HELD' ? chip('暫停中', 'warn') + ' ' : '') + esc([r.strength, r.dose, r.frequency].filter(Boolean).join(' ') || '有處方（未記劑量頻次）') + dd + '<br><span class="small muted">醫囑日期 ' + esc(r.prescribed_at ? md(r.prescribed_at) : '未記錄') + '</span>' +
      (r.rx_status === 'HELD' ? '<br><span class="small">暫停原因：' + esc(mcZh('hold_reasons', r.hold_reason)) + '；' + esc(md(r.reassess_on)) + ' 重新評估</span>' : '') : '<span class="muted">沒有處方紀錄</span>';
    var c2 = u ? (u.match_status === 'PATIENT_SELECTED_UNCONFIRMED' ? chip('病人自選藥名，待藥師核對（核對前不納入用藥提示判斷）', 'warn') + '<br>' : (u.match_status === 'PHARMACIST_CONFIRMED' ? chip('藥師已核對', 'ok') + ' ' : '')) + esc(USE_ZH[u.status] || u.status) + '<br><span class="small muted">' + esc(srcZh(useF.source_type)) + (u.source ? '｜' + esc(u.source) : '') + '｜確認日期 ' + esc(md(d10(useF.effective_at || useF.recorded_at))) + '</span>' : '<span class="muted">沒有實際使用紀錄</span>';
    var fc = fmt.filter(function (o) { return o['class'] === cls; })[0];
    var c3 = !(DICT.fmt_classes || {})[cls] ? '<span class="muted">不是核心藥物類別</span>' : (fc && fc.reason_code ? esc(codeZh(DICT.fmt_reason_codes, fc.reason_code)) + ' <span class="small muted">（' + esc(fc.reason_code) + '）</span>' : '<span class="muted">沒有記錄理由代碼</span>') + (fc && fc.dose_status ? '<br><span class="small muted">' + esc(codeZh(DICT.fmt_dose_status_options, fc.dose_status)) + '</span>' + doseChip(ing, fc.dose_status) : '');
    var todo = disc.filter(function (d) { return d.ingredient === ing && !d.resolved; }).map(function (d) { return esc(DISC_ZH[d.kind] || d.kind) + '<br><span class="small muted">負責：' + esc(d.referred && d.referred.handoff ? (ROLE_ZH[d.referred.handoff.owner_role] || d.referred.handoff.owner_role) : '藥師') + '</span>'; })
      .concat(mon.filter(function (o) { return o.items.some(function (i) { return i.ingredient === ing; }); }).map(function (o) { return '血鉀／腎功能追蹤：' + esc((MON_ZH[o.status] || [o.status])[0]) + '（追蹤日 ' + esc(md(o.due_at)) + '）<br><span class="small muted">負責：' + esc(medOwners) + '</span>'; }));
    return '<tr data-ing="' + esc(ing) + '"><th scope="row">' + esc(ingName(ing)) + '</th><td data-col="rx">' + c1 + '</td><td data-col="use">' + c2 + '</td><td data-col="reason">' + c3 + '</td><td data-col="target">' + tgtCell(ing) + '</td><td data-col="lab">' + labCell + '</td><td data-col="todo">' + (todo.length ? todo.join('<hr class="thin">') : '<span class="muted">沒有待處理</span>') + '</td></tr>';
  }).join('');
  return '<section class="panel" id="med_truth"><h2>同畫面核對（唯讀）</h2><details class="help"><summary>說明</summary><p class="small muted">處方、病人實際使用、未調整理由、目標劑量（只在模擬病人顯示）、最近血鉀與腎功能、待處理項目並列；這裡不做判斷，也不改任何紀錄。</p></details>' +
    '<div class="table-scroll" tabindex="0" role="region" aria-label="同畫面核對表（可左右捲動）"><table class="small med-truth"><thead><tr><th scope="col">成分</th><th scope="col">處方（劑量、頻次、醫囑日期）</th><th scope="col">實際使用（狀態、來源、確認日期）</th><th scope="col">未調整理由代碼</th><th scope="col">目標劑量（ESC 2026 表 11）</th><th scope="col">最近血鉀與腎功能（K、SCr、eGFR；採檢日、來源）</th><th scope="col">待處理差異、監測與負責職類</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
}
function medLoopHtml() {
  var P = CUR.rec.plan; if (!P || !P.medication) return '';
  var M = P.medication, J = M.journey || {}, h = '';
  /* 用藥歷程 */
  var ings = {}; ['pre_admission', 'post_discharge', 'current', 'actual'].forEach(function (k) { ((J[k] || {}).meds || []).forEach(function (m) { ings[m.ingredient] = 1; }); });
  function cell(k, ing) { var L = J[k]; if (!L) return '<td class="muted">—</td>'; var m = (L.meds || []).filter(function (x) { return x.ingredient === ing; })[0]; if (!m) return '<td class="muted">沒有</td>';
    if (k === 'actual') return '<td>' + esc({ CURRENT: '在吃', STOPPED: '已停', UNSURE: '不確定' }[m.status] || m.status) + (m.detail && (m.detail.dose || m.detail.frequency) ? ' ' + esc([m.detail.dose, m.detail.frequency].filter(Boolean).join(' ')) : '') + '</td>';
    var d = m.detail || {}; return '<td>' + (d.rx_status === 'HELD' ? chip('暫停中', 'warn') + ' ' : '') + esc([d.dose, d.frequency].filter(Boolean).join(' ') || '有') + '</td>'; }
  if (Object.keys(ings).length) h += '<section class="panel"><h2>用藥歷程（處方紀錄與病人實際使用分開列）</h2><div class="table-scroll"><table class="small"><thead><tr><th scope="col">成分</th><th scope="col">入院前' + (J.admission ? '（' + esc(md(J.admission)) + ' 入院之前）' : '') + '</th><th scope="col">出院後' + (J.discharge ? '（' + esc(md(J.discharge)) + ' 出院之後）' : '') + '</th><th scope="col">目前處方</th><th scope="col">病人說的實際使用' + (J.actual ? '（' + esc(md(d10(J.actual.at))) + '）' : '') + '</th></tr></thead><tbody>' +
    Object.keys(ings).sort().map(function (ing) { return '<tr><th scope="row">' + esc(ingName(ing)) + '</th>' + cell('pre_admission', ing) + cell('post_discharge', ing) + cell('current', ing) + cell('actual', ing) + '</tr>'; }).join('') +
    '</tbody></table></div><details class="help"><summary>說明</summary><p class="small muted">「入院前」「出院後」取自系統裡的處方紀錄（最近一次心衰竭住院前後）；沒有紀錄顯示「—」，不代表沒有用藥。病人說的實際使用不會覆寫處方。</p></details></section>';
  /* 變更軌跡 */
  if ((M.changes || []).length) h += '<section class="panel"><h2>用藥變更軌跡（最近一年）</h2><ul class="small">' + M.changes.map(function (c) {
    return '<li>' + esc(md(c.date)) + '　<strong>' + esc(ingName(c.ingredient)) + '</strong> ' + chip(CHG_ZH[c.kind] || c.kind, c.kind === 'HELD' || c.kind === 'STOPPED' ? 'warn' : '') + (c.from && c.to && c.kind === 'ADJUSTED' ? ' ' + esc([c.from.dose, c.from.frequency].filter(Boolean).join(' ') || '') + ' → ' + esc([c.to.dose, c.to.frequency].filter(Boolean).join(' ') || '') : '') +
      (c.reason ? '｜理由：' + esc(mcZh('change_reasons', c.reason)) : '｜<span class="muted">未記理由</span>') + (c.to && c.to.hold_reason ? '｜暫停原因：' + esc(mcZh('hold_reasons', c.to.hold_reason)) + '，' + esc(md(c.to.reassess_on)) + ' 重新評估' : '') + '｜' + esc(ROLE_ZH[c.role] || c.role || '') + '</li>'; }).join('') + '</ul></section>';
  /* 監測 */
  var mon = M.monitoring || [];
  if (mon.length) h += '<section class="panel"><h2>用藥改變後的檢驗追蹤（每一次改變一筆）</h2><p class="small muted">結果回來不等於已處理：要有人記錄「已判讀」才結案。追蹤日為改變後 ' + esc((P.params || {}).K_MONITOR_DAYS || '') + ' 天（院內流程設定，未經臨床驗證）。</p><ul class="small">' + mon.map(function (o) {
    var z = MON_ZH[o.status] || [o.status, ''], r = o.results || {};
    var ctl = ['DUE', 'OVERDUE', 'RESULTED', 'RESULT_CONFLICTED', 'REPEAT_DUE'].indexOf(o.status) >= 0 && !ST.ac.some(function (a) { return a.action_ref === o.ref; }) ? ' <select id="monr_' + esc(o.id) + '" aria-label="判讀結果"><option value="">記錄判讀結果</option>' + resultOpts('MONITORING').map(function (c) { return opt(c[0], c[1]); }).join('') + '</select> <button class="btn small" type="button" data-act="mon_review" data-val="' + esc(o.id) + '"' + (o.status === 'RESULTED' ? '' : ' disabled title="' + (o.status === 'RESULT_CONFLICTED' ? '同一天有不同的結果，請先更正' : (o.order_unknown ? '改藥當天的檢驗無法確定在改藥之後' : '還沒有改變之後的血鉀與腎功能結果')) + '"') + '>加入這次變更</button><span id="monerr_' + esc(o.id) + '" class="field-err"></span>' : (ST.ac.some(function (a) { return a.action_ref === o.ref; }) ? ' ' + chip('這次會記錄判讀', 'ok') : '');
    return '<li id="mon_' + esc(o.id) + '">' + esc(md(o.trigger_date)) + ' ' + esc(o.items.map(function (i) { return ingName(i.ingredient) + (CHG_ZH[i.kind] || ''); }).join('、')) + '　' + chip(z[0], z[1]) + '　追蹤日 ' + esc(md(o.due_at)) +
      (o.unverified_result ? '｜' + chip('有病人或家人說的數值，尚未依報告確認（不能結案）', 'warn') : '') + (r.potassium ? '｜血鉀 ' + esc(r.potassium.value) + '（' + esc(md(r.potassium.date)) + '）' : '') + (r.egfr ? '｜eGFR ' + esc(r.egfr.value) + '（' + esc(md(r.egfr.date)) + '）' : '') +
      (o.review ? '｜' + esc(codeZh(DICT.result_codes, o.review.result_code) || codeZh(DICT.resolution_codes, o.review.resolution_code)) + '（' + esc(ROLE_ZH[o.review.role] || o.review.role || '') + ' ' + esc(o.review.by) + '，' + esc(md(d10(o.review.at))) + '）' : '') + ctl + '</li>'; }).join('') + '</ul></section>';
  /* 差異處理 */
  var D = M.discrepancies || [];
  if (D.length) h += '<section class="panel" id="disc_panel"><h2>處方與實際使用的差異：處理紀錄</h2><p class="small muted">每一項都要有人記錄怎麼處理（誰、何時、結果）；病人的回報不會自動改處方。</p><ul class="small">' + D.map(function (d) {
    var staged = ST.ac.some(function (a) { return a.action_ref === d.ref; });
    return '<li>' + esc(ingName(d.ingredient)) + '：' + esc(DISC_ZH[d.kind] || d.kind) + '　' + (d.referred && !d.resolved ? chip('已轉給開立醫師（' + md(d10(d.referred.at)) + '），等醫師記錄處理結果', 'warn') + ' ' : '') + (d.resolved ? chip('已處理：' + codeZh(DICT.result_codes, d.resolved.result_code), 'ok') + ' <span class="muted">' + esc(ROLE_ZH[d.resolved.role] || d.resolved.role || '') + ' ' + esc(d.resolved.by) + '，' + esc(md(d10(d.resolved.at))) + '</span>' :
      (d.returned ? chip('開立醫師退回：' + (d.returned.result_code ? codeZh(DICT.result_codes, d.returned.result_code) : (d.returned.status === 'CANCELED' ? '交接已取消' : '未執行')) + '（' + md(d10(d.returned.at)) + '）', 'err') + ' ' : '') +
      (d.referred && d.referred.handoff ? '<span class="small">交給 ' + esc(ROLE_ZH[d.referred.handoff.owner_role] || d.referred.handoff.owner_role) + '｜' + esc(d.referred.handoff.accepted ? '已接手' : '待接手') + '</span> ' : '') +
      (staged ? chip('這次會記錄處理', 'ok') : (d.referred && !d.resolved ? '' : chip('待處理', 'warn') + ' <select id="discr_' + esc(d.ingredient) + '" aria-label="處理結果"><option value="">記錄處理結果</option>' + resultOpts('DISCREPANCY').map(function (c) { return opt(c[0], c[1]); }).join('') + '</select> ' +
        '<select id="discto_' + esc(d.ingredient) + '" aria-label="轉給哪個開立醫師職類（選「已轉給開立醫師」時必選）"><option value="">轉給（選轉開立醫師時）</option>' + (((ME.role_policy || {}).prescriber_roles) || []).map(function (r) { return opt(r, ROLE_ZH[r] || r); }).join('') + '</select> <button class="btn small" type="button" data-act="disc_resolve" data-val="' + esc(d.ingredient) + '">加入這次變更</button><span id="discerr_' + esc(d.ingredient) + '" class="field-err"></span>'))) + '</li>'; }).join('') + '</ul></section>';
  return h;
}
function stageLinked(kind, key) {
  var sel = $(kind === 'MON' ? 'monr_' + key : 'discr_' + key), v = sel ? sel.value : '';
  if (!v) { inlineErr(kind === 'MON' ? 'monerr_' + key : 'discerr_' + key, '請先選結果。'); if (sel) sel.focus(); return; }
  ST.ac.push({ action_type: kind === 'MON' ? 'LAB_CHECK' : 'MEDICATION_REVIEW', action_ref: (kind === 'MON' ? 'MON:' : 'DISC:') + key, action_status: 'COMPLETED', completed_at: today(), result_code: v, owner_role: ME.role, patient_visible: false });
  /* 3.3（R-A-003，P0）：轉給開立醫師時，同時開一筆交給「開立醫師職類」的交接（院內流程政策 PRESCRIBER_ROLES，不寫死心臟科）；
     開立醫師用差異的解決方式完成交接 → 回寫同一筆差異；退回 → 差異回到待處理 */
  if (kind === 'DISC' && v === 'REFERRED_TO_PRESCRIBER') {
    var to = $('discto_' + key) ? $('discto_' + key).value : '';
    if (!to) { ST.ac.pop(); inlineErr('discerr_' + key, '請選要轉給哪一個開立醫師職類。'); if ($('discto_' + key)) $('discto_' + key).focus(); return; }
    ST.ac.push({ action_type: 'MEDICATION_REVIEW', action_status: 'PLANNED', owner_role: to, patient_visible: false, handoff_reason: 'MED_RECON', handoff_urgency: 'WITHIN_3D', handoff_needs: ['REVIEW_MEDS', 'REPLY_TO_ME'], about_ref: 'DISC:' + key });
  }
  afterStage();
}
/* ---------- 處方 ---------- */
function rxHtml(v) {
  var e = v.fields.prescribed_meds, d = v.medication_discrepancy;
  var h = '<section class="panel" id="rx_panel"><h2>目前處方（處方紀錄）</h2>' + (e ? '<p>' + esc(fmtVal('prescribed_meds', e.value)) + '</p><p class="small muted">記錄 ' + esc(d10(e.recorded_at)) + '｜' + esc(srcZh(e.source_type)) + '</p>' : '<p class="muted">尚未記錄處方。</p>');
  h += '<p class="small">處方與病人實際使用：' + ({ MATCH: chip('成分與用法一致', 'ok'), MATCH_INGREDIENT_ONLY: chip('成分一致；用法未比對（病人或處方沒有寫劑量／頻次）'), DIFFERENT: chip('有差異', 'warn'), NOT_ASSESSABLE: chip('資料不足'), NOT_ASSESSABLE_ONE_SIDE_MISSING: chip('只有一邊有資料') }[d.status] || esc(d.status)) + '</p>';
  if (ST.obs.prescribed_meds) h += '<p class="staged small">這次會更新為：' + esc(fmtVal('prescribed_meds', ST.obs.prescribed_meds.value)) + ' <button class="btn small" type="button" data-act="unstage" data-val="prescribed_meds">取消</button></p>';
  else if (CUR.editing === 'prescribed_meds') h += '<div class="staged">' + medEditor('rx_ed', e && Array.isArray(e.value) ? e.value : [], false, true) + '<label class="f">來源<select id="rx_src">' + opt('PRESCRIPTION_RECORD', srcZh('PRESCRIPTION_RECORD')) + opt('CLINICIAN_VERIFIED', srcZh('CLINICIAN_VERIFIED')) + '</select></label><div class="row"><button class="btn small primary" type="button" data-act="rx_ok">加入這次變更</button><button class="btn small" type="button" data-act="ed_cancel">取消</button></div></div>';
  else h += '<div class="row noprint">' + (e ? '<button class="btn small" type="button" data-act="confirm" data-val="prescribed_meds">處方沒變（確認）</button>' : '') + '<button class="btn small" type="button" data-act="rx_edit">' + (e ? '更新處方' : '記錄處方') + '</button></div>';
  return h + '</section>';
}

/* ---------- 趨勢（第一層儀表板） ---------- */
function spark(points) {
  var pts = points.filter(function (p) { return typeof p.value === 'number'; });
  if (pts.length < 2) return '';
  var xs = pts.map(function (p) { return Date.parse(p.effective_at || p.recorded_at); }), ys = pts.map(function (p) { return p.value; });
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  function X(x) { return x1 === x0 ? 90 : 4 + (x - x0) / (x1 - x0) * 172; } function Y(y) { return y1 === y0 ? 20 : 36 - (y - y0) / (y1 - y0) * 32; }
  return '<svg class="spark" viewBox="0 0 180 40" role="img" aria-label="數值趨勢"><polyline points="' + pts.map(function (p, i) { return X(xs[i]).toFixed(1) + ',' + Y(ys[i]).toFixed(1); }).join(' ') + '"/>' + pts.map(function (p, i) { return '<circle r="2.5" cx="' + X(xs[i]).toFixed(1) + '" cy="' + Y(ys[i]).toFixed(1) + '"/>'; }).join('') + '</svg>';
}
function trendsHtml() {
  var d = CUR.dash, h = '<section class="panel"><h2>軌跡</h2>';
  var num = Object.keys(d.numeric_trends || {});
  h += num.length ? '<h3>數值（依檢查日期）</h3><div class="table-scroll"><table><thead><tr><th scope="col">項目</th><th scope="col">趨勢</th><th scope="col">紀錄</th></tr></thead><tbody>' + num.map(function (fid) {
    var s = d.numeric_trends[fid];
    return '<tr><th scope="row">' + esc(field(fid).label) + '</th><td>' + spark(s) + '</td><td class="small">' + s.map(function (p) { return esc(d10(p.effective_at || p.recorded_at)) + '：' + esc(fmtVal(fid, p.value)) + ' ' + chip(VER_ZH[p.verification_state] || '', p.verification_state === 'VERIFIED' ? 'ok' : ''); }).join('<br>') + '</td></tr>';
  }).join('') + '</tbody></table></div>' : '<p class="muted">尚無數值紀錄。</p>';
  var cat = Object.keys(d.categorical_trajectories || {});
  if (cat.length) h += '<h3>類別軌跡（分級資料不換算成數值）</h3><div class="table-scroll"><table><tbody>' + cat.map(function (fid) {
    return '<tr><th scope="row">' + esc(field(fid).label) + '</th><td>' + d.categorical_trajectories[fid].map(function (p) { return '<span class="chip" title="' + esc(srcZh(p.source_type)) + '">' + esc(d10(p.recorded_at).slice(5)) + ' ' + esc(fmtVal(fid, p.value)) + '</span>'; }).join('→') + '</td></tr>';
  }).join('') + '</tbody></table></div>';
  return h + '<p class="small muted">' + (d.notes || []).map(esc).join('<br>') + '</p></section>';
}

/* ---------- 異動紀錄（2026-09-29）：這位病人所有已儲存的變更，誰、何時、從什麼改成什麼、臨床日期、是否為更正 ---------- */
var LOGK_ZH = { FIELD: '欄位', CARE: '就醫事件', ACTION: '行動', CONCERN: '關心的問題', EDUCATION: '衛教與理解' };
var OBSA_ZH = { CREATE: '新增', UPDATE: '更新', CONFIRM: '沿用（確認）', CORRECT: '更正', CLEAR: '清除' };
function tw(iso) { var t = Date.parse(iso); return isNaN(t) ? '' : new Date(t + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' '); }
function logWhat(o) {
  if (o.kind === 'FIELD') return esc(field(o.field_id).label);
  if (o.kind === 'CARE') return esc(CE_ZH[o.event_type] || o.event_type);
  if (o.kind === 'ACTION') return esc(actName(o)) + (o.owner_role ? '<br><span class="small muted">負責：' + esc(ROLE_ZH[o.owner_role] || o.owner_role) + '</span>' : '');
  if (o.kind === 'EDUCATION') return esc(cardTitle(o.card_id)) + (o.objective ? '<br><span class="small muted">' + esc(FACET_ZH[o.objective] || o.objective) + '</span>' : '');
  return esc((DICT.concern_labels || {})[o.concern_code] || o.concern_code);
}
function logChange(o) {
  function v(x) { return x === null || x === undefined ? '（無）' : fmtVal(o.field_id, x); }
  if (o.kind === 'FIELD') {
    if (o.action_type === 'CONFIRM') return '沿用（確認）：' + esc(v(o.value));
    if (o.action_type === 'CLEAR') return esc(v(o.prior)) + ' → （清除）';
    return (o.prior === null ? '<span class="muted">（第一次記錄）</span> → ' : esc(v(o.prior)) + ' → ') + '<strong>' + esc(v(o.value)) + '</strong>';
  }
  if (o.kind === 'CARE') return chip(VER_ZH[o.verification_state] || '', o.verification_state === 'VERIFIED' ? 'ok' : 'warn') + (o.hf_related === 'NO' ? ' 非心衰竭' : '');
  if (o.kind === 'EDUCATION') return '<strong>' + esc(EDU_ZH[o.value] || o.value) + '</strong>' + (o.method && o.method !== 'NONE' ? '（' + esc(METHOD_ZH[o.method] || o.method) + '）' : '') +
    (o.support_level ? '<br><span class="small">' + esc(lzh('support_levels', o.support_level)) + '</span>' : '') + (o.modality ? '<br><span class="small">' + esc(lzh('modalities', o.modality)) + '</span>' : '');
  var Z = o.kind === 'ACTION' ? AST_ZH : CST_ZH;
  var why = o.barrier_code ? '（' + codeZh(DICT.barrier_codes, o.barrier_code) + '）' : (o.resolution_code ? '（' + codeZh(DICT.resolution_codes, o.resolution_code) + '）' : '');
  return (o.prior ? esc(Z[o.prior] || o.prior) + ' → ' : '<span class="muted">（新增）</span> ') + '<strong>' + esc(Z[o.value] || o.value) + '</strong>' + esc(why) + (o.due_at && !o.prior ? '<br><span class="small muted">到期 ' + esc(d10(o.due_at)) + '</span>' : '');
}
function changeLogHtml() {
  var L = CUR.dash.change_log; if (!L) return '';
  var f = CUR.logFilter || '', fids = {};
  L.rows.forEach(function (o) { if (o.kind === 'FIELD') fids[o.field_id] = 1; });
  var rows = L.rows.filter(function (o) {
    if (!f) return true; if (f === 'CORR') return !!(o.corrects || o.corrected_by);
    if (f.indexOf('F:') === 0) return o.kind === 'FIELD' && o.field_id === f.slice(2);
    return o.kind === f;
  });
  var sel = '<label class="f noprint">顯示<select id="log_filter"><option value="">全部（' + L.total + '）</option>' +
    ['FIELD', 'CARE', 'ACTION', 'CONCERN', 'EDUCATION'].map(function (k) { return opt(k, LOGK_ZH[k] + '（' + (L.counts[k] || 0) + '）', f === k); }).join('') + opt('CORR', '更正相關（' + L.counts.corrections + '）', f === 'CORR') +
    '<optgroup label="單一欄位的歷程">' + Object.keys(fids).sort(function (a, b) { return field(a).label < field(b).label ? -1 : 1; }).map(function (k) { return opt('F:' + k, field(k).label, f === 'F:' + k); }).join('') + '</optgroup></select></label>';
  return '<details class="panel" id="log_panel"' + (CUR.logOpen ? ' open' : '') + '><summary>異動紀錄（已儲存的變更共 ' + L.total + ' 筆' + (L.counts.corrections ? '；更正 ' + L.counts.corrections + ' 筆' : '') + '）</summary>' +
    '<details class="help"><summary>說明</summary><p class="small muted">新的在前。「之前」是儲存當時系統裡的值；每一筆都會保留，不會被覆蓋或刪除。時間為台灣時間。' + (L.truncated ? '只列最近 ' + L.rows.length + ' 筆。' : '') + '</p></details>' + sel +
    (rows.length ? '<div class="table-scroll"><table><thead><tr><th scope="col">記錄時間</th><th scope="col">記錄者</th><th scope="col">類別</th><th scope="col">項目</th><th scope="col">異動（之前 → 之後）</th><th scope="col">臨床日期</th><th scope="col">來源</th><th scope="col">註記</th></tr></thead><tbody>' +
      rows.map(function (o) {
        var note = (o.corrects ? chip('更正先前的紀錄', 'warn') : '') + (o.corrected_by ? chip('已被後來的紀錄更正', '') : '') + (o.kind === 'FIELD' && o.action_type !== 'UPDATE' && o.action_type !== 'CORRECT' ? chip(OBSA_ZH[o.action_type] || o.action_type) : '');
        return '<tr' + (o.corrected_by ? ' class="muted"' : '') + '><td class="small">' + esc(tw(o.at)) + '</td><td class="small">' + esc(o.by) + (o.role && ROLE_ZH[o.role] ? '<br><span class="muted">' + esc(ROLE_ZH[o.role]) + '</span>' : '') + '</td><td class="small">' + esc(LOGK_ZH[o.kind]) + '</td><td>' + logWhat(o) + '</td><td>' + logChange(o) + '</td><td class="small">' + esc(d10(o.effective_at)) + '</td><td class="small">' + esc(srcZh(o.source_type)) + '</td><td>' + note + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">沒有符合的紀錄。</p>') + '</details>';
}

/* ---------- 病人連結 QR code（2026-09-27）：在瀏覽器本機產生（qrcode-generator，MIT），不連外、不存檔；和連結文字一樣只顯示這一次 ---------- */
function qrHtml(link) {
  try {
    if (typeof qrcode !== 'function') return '';
    var q = qrcode(0, 'M'); q.addData(link); q.make();
    var svg = q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    return '<figure class="qr" data-qr-modules="' + q.getModuleCount() + '">' + svg.replace('<svg ', '<svg role="img" aria-label="病人連結 QR code：請病人用手機相機掃描" ') +
      '<figcaption class="small muted">請病人用手機相機掃描開啟（與上面的連結相同，不要拍照轉傳）</figcaption></figure>';
  } catch (e) { return '<p class="small muted">QR code 無法產生，請改用「複製連結」。</p>'; }
}
/* ---------- 病人連結 ---------- */
function linksHtml() {
  var h = '<section class="panel noprint"><h2>病人連結（讓病人或家人自己填）</h2>';
  if (ISSUED) h += '<div class="notice ok"><p><strong>連結只會顯示這一次</strong>，請現在交給病人（簡訊、紙本或當面開啟）。系統不留存原始連結，之後無法再顯示。</p><p class="linkbox" id="issued_link">' + esc(ISSUED.link || ('（尚未設定 PATIENT_APP_URL）代碼：' + ISSUED.token)) + '</p><div class="row"><button class="btn small" type="button" data-act="copy_link">複製連結</button><span class="small muted">有效到 ' + esc(d10(ISSUED.expires_at)) + '</span></div>' + (ISSUED.link ? qrHtml(ISSUED.link) : '') + '</div>';
  h += '<div class="row"><label class="f">給誰用<select id="lk_resp">' + opt('SELF', '病人本人') + opt('CAREGIVER', '家人或照顧者') + '</select></label><label class="f">有效天數<input type="number" id="lk_days" min="1" max="90" value="30"></label><button class="btn" type="button" data-act="issue">建立新連結</button></div><p id="lk_err" class="small field-err"></p>';
  var L = CUR.links || [];
  h += L.length ? '<div class="table-scroll"><table><thead><tr><th scope="col">代碼</th><th scope="col">給誰</th><th scope="col">建立</th><th scope="col">到期</th><th scope="col">狀態</th><th scope="col"></th></tr></thead><tbody>' + L.map(function (t) {
    var expired = d10(t.expires_at) < today();
    return '<tr><td>' + esc(t.token_ref) + '</td><td>' + esc(t.respondent === 'CAREGIVER' ? '照顧者' : '病人') + '</td><td>' + esc(d10(t.issued_at)) + '</td><td>' + esc(d10(t.expires_at)) + '</td><td>' + (t.revoked ? (t.revoke_reason === 'COMPROMISED' ? chip('已停用：可能外流', 'err') : chip('已停用')) : (expired ? chip('已過期') : chip('有效', 'ok'))) + '</td><td>' +
      (!t.revoked && !expired ? '<button class="btn small" type="button" data-act="rotate" data-val="' + esc(t.token_ref) + '">換新連結</button><button class="btn small danger" type="button" data-act="revoke" data-val="' + esc(t.token_ref) + '">停用</button>' : '') +
      (t.revoke_reason !== 'COMPROMISED' ? '<button class="btn small danger" type="button" data-act="revoke_comp" data-val="' + esc(t.token_ref) + '">可能外流</button>' : '') + '</td></tr>';
  }).join('') + '</tbody></table></div>' + (L.some(function (t) { return !t.revoked; }) ? '<div class="row"><button class="btn small danger" type="button" data-act="revoke_all">全部停用（懷疑外流）</button></div>' : '') : '<p class="muted small">尚未建立連結。</p>';
  h += '<p class="small muted">連結如果可能外流（傳錯人、手機遺失、被別人看到）：按「可能外流」。從那時起由這個連結送來、還沒寫入的資料會先隔離，等您向病人確認後再決定採用或捨棄；含警訊的送出仍會立刻列為警訊。</p>';
  return h + '<details class="help"><summary>說明</summary><p class="small muted">病人從連結送出的資料會標示為「病人自述／家人代述」，約 1–2 分鐘後出現在紀錄中；病人連結不能建立已確認的出院、專業追蹤、檢查結果或診斷。</p></details></section>';
}

/* ---------- 團隊儀表板 ---------- */
function renderTeamShell() {
  $('view_team').innerHTML = '<section class="panel noprint"><h2>團隊儀表板</h2><details class="help"><summary>說明</summary><p class="small muted">範圍：' + esc(ME.dashboard_scope === 'FACILITY' ? '您權限內院所的所有病人' : '您在照護團隊中的病人') + '。篩選只能縮小範圍；分母少於 5 的格子會遮蔽。</p><p class="small muted">怎麼讀：先看最上面一段；再依類型打開想看的那一組。標「資料缺口」的是沒有病人可算，先補資料再判讀；標「審查中」的先不要拿來下結論。</p></details><fieldset class="row"><legend>院所</legend>' +
    ME.facilities.map(function (f) { return '<label class="small"><input type="checkbox" class="tf_fac" value="' + esc(f) + '" checked> ' + esc(FAC_ZH[f] || f) + '</label>'; }).join(' ') + '</fieldset><div class="row"><button class="btn primary" type="button" data-act="team_load">更新儀表板</button><button class="btn" type="button" data-act="team_snap">更新並存快照</button></div></section><div id="team_out"></div>' +
    '<section class="panel"><h2>成效趨勢：依出院季</h2><details class="help"><summary>說明</summary><p class="small muted">以已確認的心衰竭出院為起點，依出院日所在的季分組，看 7 天與 42 天追蹤、42 天藥物檢視、30 與 90 天再住院的變化。由紀錄即時計算，補登的過去出院也會算進正確的季。使用上方勾選的院所。</p></details>' +
    '<div class="row noprint"><button class="btn" type="button" data-act="trend_load">顯示趨勢</button></div><div id="trend_out"></div></section>' +
    /* v4.3 X07：聚合匯出（用途必填；小格遮蔽；同一天同一組指標的兩次匯出只差幾位病人 → 拒絕；沒有個案列匯出） */
    '<section class="panel noprint" id="mx_panel"><h2>匯出彙總結果</h2><p class="small muted">只匯出彙總數字（與上方儀表板相同的遮蔽）；不提供個案列。每次匯出都記錄用途、匯出者與時間。</p><div class="row"><label class="f">用途<select id="mx_purpose">' + opt('', '請選擇') +
      ((DICT.metric_purposes || []).map(function (x) { return opt(x[0], x[1]); }).join('')) + '</select></label><label class="f">用途說明（選填，最多 200 字，不寫病歷號）<input id="mx_note" maxlength="200" autocomplete="off"></label><button class="btn" type="button" data-act="mx_export">匯出彙總結果</button></div><div id="mx_out" aria-live="polite"></div></section>' +
    (ME.dashboard_scope === 'FACILITY' ? '<section class="panel"><h2>成效趨勢：每日快照</h2><details class="help"><summary>說明</summary><p class="small muted">系統每天自動存一次所有指標（需管理者安裝排程），用來看流程指標隨時間的變化。</p></details><div class="row noprint"><label class="f">範圍<select id="sn_fac">' + opt('*', '全部院所') + ME.facilities.map(function (f) { return opt(f, FAC_ZH[f] || f); }).join('') + '</select></label><button class="btn" type="button" data-act="snap_load">顯示每日快照</button></div><div id="snap_out"></div></section>' : '');
}
/* 4.9.3 WP-E：分母為 0 → 明示「資料缺口」與原因（不是 0%，也不只顯示「—」）；遮蔽仍由伺服器決定 */
var GAP_ZH = { NO_ELIGIBLE: '目前沒有符合條件的病人', NOT_YET_ASSESSABLE: '病人都還在觀察期內', ONLY_UNKNOWN: '只有「不確定」的紀錄' };
function gapHtml(m) { return '<span data-gap="' + esc(m.gap_reason || '') + '">— ' + chip('資料缺口', 'warn') + '<br><span class="small muted">' + esc(GAP_ZH[m.gap_reason] || '分母為 0') + '</span></span>'; }
function fmtMetric(m) {
  if (m.status === 'NOT_IN_SCOPE') return '<span class="muted">權限外</span>';
  if (m.display_state === 'DATA_GAP') return gapHtml(m);
  if (m.kind === 'DISTRIBUTION') return m.categories ? Object.keys(m.categories).map(function (k) { return esc(DIST_ZH[k] || distLabel(k)) + ' ' + esc(m.categories[k] === 'SUPPRESSED' ? '遮蔽' : m.categories[k]); }).join('、') : '—';
  if (m.kind === 'MEDIAN') return m.value === null ? '—' : esc(m.value) + ' ' + esc(m.value_unit || '天');
  if (m.kind === 'COUNT') return m.value === null ? '—' : esc(m.value);
  return m.value === null || m.value === undefined ? '—' : (Math.round(m.value * 1000) / 10) + '%';
}
var DIST_ZH = { KEPT: '維持理解', REGRESSED: '退步', IMPROVED: '進步', STILL_GAP: '仍有缺口', UNDERSTOOD_DONE: '理解×做到', UNDERSTOOD_NOT_DONE: '理解×未做到（執行障礙）', NOT_UNDERSTOOD_DONE: '未理解×做到', NOT_UNDERSTOOD_NOT_DONE: '未理解×未做到' };
var RES_ZH = { UNDERSTOOD: '理解', PARTIAL: '部分', NEEDS_RETEACH: '需再教' };
function distLabel(k) {
  if (k.indexOf('→') > 0) return k.split('→').map(function (x) { return RES_ZH[x] || x; }).join('→');
  return ((DICT.fields.recent_change_previous || {}).enum_labels || {})[k] || k;
}
var EXTRA_ZH = { self_reported: '病人或照顧者自述（不進分母）', clinician_created: '醫療人員自己建立（不進分母）', class_excluded: '有某一類不適用、以其餘類別計算', rule_not_enabled: '規則未啟用的病人（不計）', with_unknown: '完整但有回答不知道', not_reassessed: '有缺口尚未再評估', reported_only: '只有病人自述完成', accepted_late: '逾期才接手', excluded: '排除（禁忌、不耐受等）', positive: '陽性', acted: '有對應行動', closed: '行動已完成', declined: '病人拒絕／接收方退回', redirected: '轉給其他職類', no_reply: '已接手但沒有回覆結果', reviewed_late: '判讀晚於追蹤日', patient_choice: '病人選擇不用（算未達成）', partial: '只有一項或不同天採檢', potassium: '血鉀超過門檻', creatinine: '肌酸酐上升超過門檻', not_in_hf_population: '心衰竭診斷未經醫療人員確認', resulted_not_reviewed: '結果已回、尚未判讀', no_result: '追蹤日已過、沒有結果', unverified_only: '觀察期已過、只有未確認結果（不算安全）', deduplicated: '同一天調整兩類藥（只算一次）', baseline_age_days_median: '調藥前基準距調藥日（天，中位數）', missing_lab: '觀察期已過、沒有已確認結果（不算安全）', no_baseline: '沒有調藥前基準', unknown_profession: '職業不明的紀錄', future_dated: '臨床日期在資料時間之後（不採用）', assessed_after_due: '到期後才第一次評估理解（不列入）', assessor_is_teacher: '評估者就是授課者' };
function sup(v) { return v === 'SUPPRESSED' ? '遮蔽' : v; }
/* v4.4 WP-D：分組結果（溝通需要分層、接觸方式、最常缺的核心欄位、藥物類別）——沿用伺服器的分組遮蔽，畫面只翻譯 */
var GX_ZH = { by_method: '依第一次評估方法', by_source: '依來源（病人連結／醫療人員）', by_index_rule: '病人層級（每位病人第一個醫療人員評估的起點）', by_comm_need: '依溝通需要', by_contact: '依接觸方式', missing: '缺的核心欄位（次數／評估數）', by_class: '依藥物類別' };
var GK_ZH = { NEEDS_SUPPORT: '有協助需要', NO_NEED: '沒有', NOT_RECORDED: '未記錄', FACE_TO_FACE: '面對面', PHONE: '電話', VIDEO: '視訊', UNRECORDED: '未記錄', PATIENT_LINK: '病人連結', CLINICIAN: '醫療人員評估', FIRST_CLINICIAN_INDEX_PER_PATIENT: '每人第一個起點', TEACH_BACK_VERBAL: '用自己的話說', DEMONSTRATION: '示範', CHECK_QUESTION: '確認題', OTHER: '其他或未註明' };
function gkLabel(g, k) { if (g === 'missing') return k.split('|').map(function (f) { return (DICT.fields[f] || {}).label || f; }).join('／'); if (g === 'by_class') return (DICT.fmt_classes || {})[k] || k; return GK_ZH[k] || k; }
function groupExtras(m) {
  if (!m.extra) return '';
  return Object.keys(m.extra).filter(function (g) { return m.extra[g] && typeof m.extra[g] === 'object' && GX_ZH[g]; }).map(function (g) {
    var sub = m.extra[g], ks = Object.keys(sub).filter(function (k) { return sub[k] && typeof sub[k] === 'object'; });
    if (!ks.length) return '';
    return '<br><span class="small" data-gx="' + esc(g) + '">' + esc(GX_ZH[g]) + '：' + ks.map(function (k) { var c = sub[k]; return esc(gkLabel(g, k)) + ' ' + (c.denominator === 'SUPPRESSED' ? '遮蔽' : esc(c.numerator === null ? '—' : sup(c.numerator)) + '/' + esc(sup(c.denominator))); }).join('、') + '</span>';
  }).join('');
}
var TS_ZH = { POINT: '目前狀態', CUMULATIVE: '全期累計', ROLLING: '往回固定天數', COHORT: '世代（起始事件起算）', UNKNOWN: '未標示' };   /* v4.9 S6 */
var MSTATUS_ZH = { PARAM_MISSING: '這一項缺計算參數，已停用（其他指標不受影響）', DEFINITION_DRIFT: '定義和登錄不符，已停用', UNREGISTERED: '尚未登錄，已停用', NOT_REPORTABLE: '相關規則對這批病人尚未啟用，不可報告（不是 0）' };   /* v4.6 */
/* v4.9 S7：每張指標卡交代時間語意、生效日、查核層級與遮蔽原因（讀團隊儀表板回傳的 registry；不另存） */
var MREG = {}, MASK_ZH = { SMALL_PATIENT_N: '病人數少於門檻', COMPLEMENTARY_SUPPRESSION: '互補遮蔽（避免用總數相減推算出被遮蔽的人數）', FACILITY_CELL: '有院所格子太小', FAMILY_SUPPRESSION: '相關指標一併遮蔽', PUBLICATION_HISTORY: '與先前發布的數字相差太少' };
function metricMeta(m) { var r = MREG[m.metric_id]; return '<br><span class="small muted" data-mmeta="' + esc(m.metric_id) + '">' + (r ? esc(TS_ZH[r.time_semantics] || r.time_semantics) + '｜生效 ' + esc(r.valid_from || '—') + '｜' + (r.verification_level === 'ORACLE' ? '已有手算對照' : '尚未有手算對照') : '') + (m.suppressed ? '｜遮蔽：' + esc(MASK_ZH[m.suppressed_reason] || '格子太小') : '') + '</span>' + reviewChip(m.metric_id); }
/* 4.9.3 WP-E：查核層級不是「已有手算對照」的指標，在每個出現的位置都加警示 */
var REVIEW_ZH = '審查中，請勿用於判斷';
function reviewChip(id) { var r = MREG[id]; return r && r.verification_level !== 'ORACLE' ? ' <span data-review="' + esc(id) + '">' + chip(REVIEW_ZH, 'warn') + '<span class="small muted">定義與計算的一致性尚在審查</span></span>' : ''; }
function windowZh(r) { if (!r) return '—'; return esc(TS_ZH[r.time_semantics] || r.time_semantics) + (r.observation_window_days ? '｜' + esc(r.observation_window_days) + ' 天' : ''); }
function verifyZh(r) { return r && r.verification_level === 'ORACLE' ? chip('已有手算對照', 'ok') : chip(REVIEW_ZH, 'warn'); }
/* 首屏主訊息（CDC CCI 第 2 項：主訊息放最上面、不捲動就看得到） */
function teamMainHtml(d) {
  var c = d.state_counts || {}, n = (d.registry || []).length, rv = (d.under_review || {}).metric_ids || [];
  return '<section class="panel" id="team_main" data-main-message><h2>這份儀表板在說什麼</h2><p><strong>' + esc(n) + ' 項指標：' + esc(c.VALUE || 0) + ' 項有數字，' + esc(c.DATA_GAP || 0) + ' 項資料缺口，' + esc(c.SUPPRESSED || 0) + ' 項因人數太少遮蔽' + (c.DISABLED ? '，' + esc(c.DISABLED) + ' 項停用' : '') + (c.NOT_IN_SCOPE ? '，' + esc(c.NOT_IN_SCOPE) + ' 項權限外' : '') + '。</strong></p>' +
    '<p class="small">資料時間 ' + esc(d10(d.as_of)) + '｜病人數 ' + esc(d.cohort_size) + '。用來找團隊流程哪裡要補，不是個人或職類的成績。' + (rv.length ? '有 ' + esc(rv.length) + ' 項標「' + esc(REVIEW_ZH) + '」（' + esc(rv.join('、')) + '）。' : '') + '目標值：' + esc((d.target_policy || {}).label_zh || '院方未設定') + '。</p></section>';
}
/* 依指標類型分組（伺服器 type_groups；只換排列，不改數字） */
function teamTypesHtml(d, byId) {
  var tp = (d.target_policy || {}).label_zh || '院方未設定';
  var h = '<section class="panel" id="team_types"><h2>依指標類型</h2><ul class="small"><li><strong>結構</strong>：人力和資源到位了嗎。</li><li><strong>過程</strong>：該做的照護做了嗎、準時嗎。</li><li><strong>結果</strong>：病人後來怎麼了（例如再住院）。</li><li><strong>平衡</strong>：推一件事時，有沒有造成別的問題（例如血鉀太高）。</li></ul>' +
    '<p class="small muted">「資料缺口」表示分母是 0：沒有可以計算的病人，不是 0%。目標值由院方決定，目前' + esc(tp) + '。' + esc((d.target_policy || {}).note_zh || '') + '</p>';
  (d.type_groups || []).forEach(function (g) {
    var ms = g.metric_ids.map(function (id) { return byId[id]; }).filter(Boolean);
    h += '<details class="panel" data-mgroup="' + esc(g.group) + '"><summary>' + esc(g.label_zh) + '（' + esc(g.metric_ids.length) + ' 項）</summary><p class="small muted">' + esc(g.explain_zh) + '</p>' +
      (!ms.length ? '<p class="small" data-mgroup-empty>' + chip(g.empty_note_zh || '目前沒有指標', 'warn') + '</p>' :
      '<div class="table-scroll"><table><thead><tr><th scope="col">指標</th><th scope="col">結果</th><th scope="col">分子／分母</th><th scope="col">時間範圍</th><th scope="col">查核</th><th scope="col">目標</th></tr></thead><tbody>' +
      ms.map(function (m) { var r = MREG[m.metric_id]; return '<tr data-mrow="' + esc(m.metric_id) + '" data-state="' + esc(m.display_state || '') + '"><th scope="row">' + esc(m.metric_id) + '　' + esc(m.name_zh) + reviewChip(m.metric_id) + '</th><td>' + (m.display_state === 'SUPPRESSED' && !m.status ? chip('遮蔽', '') + '<br><span class="small muted">' + esc(MASK_ZH[m.suppressed_reason] || '人數太少') + '</span>' : fmtMetric(m)) + '</td><td class="small">' + esc(m.numerator === null ? '—' : sup(m.numerator)) + '／' + esc(m.denominator === null ? '—' : sup(m.denominator)) + (r ? '<br><span class="muted">分子：' + esc(r.numerator) + '<br>分母：' + esc(r.denominator) + '</span>' : '') + '</td><td class="small">' + windowZh(r) + '</td><td class="small" data-vl="' + esc(r ? r.verification_level : '') + '">' + verifyZh(r) + '</td><td class="small muted" style="white-space:nowrap" data-target>' + esc(tp) + '</td></tr>'; }).join('') + '</tbody></table></div>') + '</details>';
  });
  return h + '</section>';
}
function metricDetail(m) { return (m.status ? chip(MSTATUS_ZH[m.status] || m.status, 'err') + ' ' : '') + '分子 ' + esc(m.numerator === null ? '—' : sup(m.numerator)) + '｜分母 ' + esc(m.denominator === null ? '—' : sup(m.denominator)) + '｜不確定 ' + esc(m.unknown) + '｜觀察期未滿 ' + esc(m.not_assessable) + (m.extra ? '｜' + Object.keys(m.extra).filter(function (k) { return typeof m.extra[k] !== 'object'; }).map(function (k) { return esc(EXTRA_ZH[k] || k) + ' ' + esc(sup(m.extra[k])); }).join('、') : '') + '｜v' + esc(m.metric_version) + metricMeta(m); }
/* ===================== 5.0 W5-M：主畫面 13 個指標群組、其他新指標（點開才顯示）、治理頁（管理者）、分母橋接表、月趨勢 ===================== */
var V5ST_ZH = { DATA_INSUFFICIENT: '資料不足', DATA_GAP: '資料缺口', SUPPRESSED: '遮蔽', DISABLED: '停用', NOT_IN_SCOPE: '權限外', VALUE: '' };
var LIFE_ZH = { SUPERSEDED: '已有新版本', RETIRED: '停用（已由其他指標取代）', ACTIVE: '' };
function v5Val(m) {
  if (m.display_state === 'DATA_INSUFFICIENT') return '<span data-insufficient="' + esc(m.metric_id) + '">' + chip('資料不足', 'warn') + '<br><span class="small muted">' + esc(m.status_detail || '需要的欄位尚未記錄') + '（不是 0）</span></span>';
  if (m.display_state === 'SUPPRESSED') return chip('遮蔽', '') + '<br><span class="small muted">' + esc(MASK_ZH[m.suppressed_reason] || '有格子只有 1–4 人') + '</span>';
  if (m.display_state === 'DATA_GAP') return '— ' + chip('資料缺口', 'warn') + '<br><span class="small muted">' + esc(GAP_ZH[m.gap_reason] || '分母為 0') + '</span>';
  if (m.status) return chip(MSTATUS_ZH[m.status] || m.status, 'err');
  if (m.kind === 'MEDIAN') return m.value === null ? '—' : esc(m.value) + ' ' + esc(m.value_unit || '');
  if (m.rate_display) return uxRateHtml(m.rate_display);   /* 5.1 W51-UX：分母未達門檻只顯示人數；達門檻附 95% 信賴區間 */
  return m.value === null || m.value === undefined ? '—' : (Math.round(m.value * 1000) / 10) + '%';
}
function v5Cells(m) { return '分子 ' + esc(m.numerator === null ? '—' : sup(m.numerator)) + '｜分母 ' + esc(m.denominator === null ? '—' : sup(m.denominator)) + '｜未知 ' + esc(sup(m.unknown)) + '｜觀察期未滿 ' + esc(sup(m.not_assessable)); }
var V5X_ZH = { competing_death: '競爭事件：死亡', competing_readmission: '競爭事件：再住院', competing: '競爭事件', no_contact_recorded: '出院後系統沒有紀錄', reported_other_admission: '自述或他院住院', death_reported_unverified: '死亡待確認', reviewed_with_change: '檢視且有調整', reviewed_no_change: '檢視未調整', reason_only: '只記不用理由',
  excluded: '有理由的禁忌等（排除）', declined: '病人選擇不用', cost_access: '取得或費用困難', not_assessed: '尚未評估', on_without_rx: '狀態寫使用中但處方沒有', ci_without_reason: '不用但沒有理由碼', care_cohort_not_dx: '照護族群但未確認診斷', missing_lab: '缺檢驗', unverified_only: '只有未確認檢驗', no_baseline: '沒有調藥前基準',
  duplicate: '以重複結案', reported_only: '自述（未確認）', death_or_readmission: '死亡或再住院', ed_visits: '急診', not_suitable: '已記錄目前不適合', maintain_only: '只有維持評估', untagged: '沒有進展類型', first_check_question: '第一次為確認題', early_checks: '期限前的複述', not_assessed_at_due: '到期時未評估', barrier: '遇到困難',
  no_caregiver: '沒有照顧者（不適用）', caregiver_unknown: '照顧者狀態未記錄', not_patient_voice: '不是病人自己的想法', unmappable: '對應職業不明', reviewed_without_values: '有判讀但沒有數值', first_independent: '第一次即可自己做到', excluded_event: '住院或死亡另列', redirected: '有轉派', accepted_late: '逾期才接手', unknown_value: '值為不知道' };
var V5G_ZH = { cause_specific: '因別分析（移出競爭事件）', reviewed_only: '已檢視者（敏感度值）', by_lvef: '依 LVEF（≤40%／41–49%／改善後）', by_route: '依緊急度', by_type: '依行動類型', by_scenario: '依監測場景', by_class: '依藥類', by_comprehension: '依到期時理解（四象限）', original_sla: '原始期限', patient_link: '病人連結（另列）', by_basis: '依族群來源', by_domain: '依篩檢領域', by_table: '依事件表', structured: '結構化教回', by_facet: '依學習目標', by_comm_need: '依溝通需要', by_contact_mode: '依接觸方式（達成者）' };
var V5K_ZH = { LE40: '≤40%', B41_49: '41–49%', IMPROVED: '改善後', GE50: '≥50%', UNKNOWN: '未知', UNDERSTOOD: '當時理解', NOT_UNDERSTOOD: '當時未理解', TEAM: '團隊流程', SELF_CARE: '病人自我照顧', REFERRAL: '轉介', POST_START: '開始', POST_INCREMENT: '調升', RAAS_ARNI: 'RASi／ARNI', MRA: 'MRA', DX_CONFIRMED: '確認診斷', HOSP_ONLY: '只有確認住院',
  EMERGENCY: '119', URGENT_NOW: '現在就醫', URGENT_IN_PERSON: '今天當面', SAME_DAY: '今天聯絡', ROUTINE: '一般', FACE_TO_FACE: '面對面', PHONE: '電話', VIDEO: '視訊', UNRECORDED: '未記錄' };
function v5Extras(m) {
  if (!m.extra || m.display_state === 'SUPPRESSED') return '';
  var x = m.extra, sc = Object.keys(x).filter(function (k) { return V5X_ZH[k] && (typeof x[k] === 'number' || typeof x[k] === 'string') && x[k] !== 0; }).map(function (k) { return esc(V5X_ZH[k]) + ' ' + esc(sup(x[k])); });
  var gr = Object.keys(x).filter(function (k) { return V5G_ZH[k] && x[k] && typeof x[k] === 'object'; }).map(function (k) { var g = x[k];
    if (typeof g.numerator !== 'undefined') return esc(V5G_ZH[k]) + '：' + (g.denominator === 'SUPPRESSED' ? '遮蔽' : esc(sup(g.numerator)) + '/' + esc(sup(g.denominator)));
    return esc(V5G_ZH[k]) + '：' + Object.keys(g).map(function (j) { var c = g[j]; return esc(V5K_ZH[j] || j) + ' ' + (c && typeof c === 'object' ? (c.denominator === 'SUPPRESSED' ? '遮蔽' : esc(sup(c.numerator)) + '/' + esc(sup(c.denominator))) : esc(sup(c))); }).join('、'); });
  return sc.concat(gr).length ? '<br><span class="small" data-v5x="' + esc(m.metric_id) + '">' + sc.concat(gr).join('｜') + '</span>' : '';
}
function v5Row(m) {
  return '<tr data-v5row="' + esc(m.metric_id) + '" data-v5state="' + esc(m.display_state) + '"><th scope="row">' + esc(m.metric_id) + '<br>' + esc(m.name_zh) + '</th><td>' + v5Val(m) + '</td><td class="small">' + v5Cells(m) + v5Extras(m) + '</td><td class="small">' + esc(m.cohort || '') + (m.missing_policy ? '<br><span class="muted">缺值：' + esc(m.missing_policy) + '</span>' : '') + (m.competing_events && m.competing_events !== '不適用' ? '<br><span class="muted">競爭事件：已另列</span>' : '') + '</td><td class="small" data-v5target>' + esc(m.target || '待設定') + '</td></tr>';
}
function v5Table(list) { return '<div class="table-scroll"><table><thead><tr><th scope="col">指標（代碼@版本）</th><th scope="col">結果</th><th scope="col">分子｜分母｜未知｜觀察期未滿</th><th scope="col">族群與缺值處理</th><th scope="col">目標</th></tr></thead><tbody>' + list.map(v5Row).join('') + '</tbody></table></div>'; }
function teamCoreHtml(d) {
  var v = d.v5; if (!v) return '';
  var h = '<section class="panel" id="team_core">' + uxMainHtml(v) + '<details class="panel" id="team_core_groups"><summary>其他指標（' + esc((v.core_groups || []).length) + ' 個群組，點開才顯示；含上方 6 項的同群指標）</summary><p class="small muted">每一群點開可看實際的指標代碼與版本、四個數字（分子、分母、未知、觀察期未滿）、分母用哪一個族群、缺值與競爭事件怎麼處理。目標值：' + esc((v.target_policy || {}).label_zh || '院方未設定') + '。</p>';
  h += (v.core_groups || []).map(function (g) {
    var m0 = g.metrics[0] || {};
    return '<details class="panel" data-core-group="' + esc(g.group_id) + '" data-core-n="' + esc(g.metric_n) + '"><summary><strong>' + esc(g.title_zh) + '</strong> <span class="small muted">' + esc(g.group_id) + '｜含 ' + esc(g.metric_n) + ' 個指標</span><br><span class="small">' + esc(m0.metric_id || '') + '：' + v5Val(m0).replace(/<br>/g, ' ') + '｜' + (m0.metric_id ? v5Cells(m0) : '') + '</span></summary>' + v5Table(g.metrics) + '</details>';
  }).join('') + '</details>';   /* 5.1 W51-UX：13 群移到「其他指標」（收合） */
  h += '<details class="panel" id="team_v5_other"><summary>其他 5.0 指標（' + esc((v.other_metrics || []).length) + ' 項，點開才顯示）</summary>' + v5Table(v.other_metrics || []) + '</details>';
  if (v.governance) h += '<details class="panel" id="team_gov"><summary>治理頁（管理者）：資料品質與系統指標</summary><p class="small muted">' + esc(v.governance.note_zh) + '</p>' + v5Table(v.governance.metrics || []) + '<p class="small muted">4.9 版資料品質指標（' + esc(v.governance.legacy_data_quality_ids.length) + ' 項）仍在下方「依指標類型」的資料品質組，數字照舊。</p></details>';
  h += '<details class="panel" id="team_bridge"><summary>分母橋接表（每個指標用哪一個族群）</summary><ul class="small">' + (v.bridge.cohorts || []).map(function (c) { return '<li><strong>' + esc(c.label_zh) + '</strong>（' + esc(c.cohort) + '）：' + esc(c.rule_zh) + '</li>'; }).join('') + '</ul>' +
    '<div class="table-scroll"><table class="small"><thead><tr><th scope="col">指標</th><th scope="col">族群</th><th scope="col">缺值處理</th><th scope="col">競爭事件</th></tr></thead><tbody>' + (v.bridge.rows || []).map(function (r) { return '<tr><th scope="row">' + esc(r.metric_key) + '</th><td>' + esc(r.cohort) + '</td><td>' + esc(r.missing_policy) + '</td><td>' + esc(r.competing_events) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    '<h3>已被取代或停用的舊指標（定義與歷史數字保留，可在下方舊版區查看）</h3><ul class="small">' + (v.lifecycle || []).map(function (l) { return '<li data-life="' + esc(l.metric_id) + '">' + esc(l.metric_id) + '：' + esc(LIFE_ZH[l.status] || l.status) + '→ ' + esc(l.by.join('、')) + (l.note_zh ? '（' + esc(l.note_zh) + '）' : '') + '</li>'; }).join('') + '</ul></details>';
  h += '<details class="panel" id="team_monthly"><summary>趨勢（品質層；預設依季）</summary><p class="small muted">出院類依出院季（或出院月）由紀錄即時計算；其他指標的月快照請選「月」。</p><div class="row noprint"><label class="f">時間單位<select id="mt_grain">' + opt('QUARTER', '季') + opt('MONTH', '月') + '</select></label><button class="btn" type="button" data-act="mt_load">顯示趨勢</button></div><div id="mt_out"></div></details>';
  h += '<section class="small muted"><ul>' + (v.reading_notes || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></section>';
  return h + '</section>';
}
function loadMonthly() {
  var facs = [].slice.call(document.querySelectorAll('.tf_fac:checked')).map(function (x) { return x.value; });
  $('mt_out').innerHTML = '<p class="muted">計算中…</p>';
  var grain = $('mt_grain') ? $('mt_grain').value : 'QUARTER';   /* 5.1 W51-UX：預設季（月仍可選） */
  call('getMonthlyTrend', [{ facility_codes: facs }, 12, grain]).then(function (t) {
    var cell = function (c) { if (!c) return '<td>—</td>'; if (c.denominator === 'SUPPRESSED' || c.suppressed && c.numerator === null) return '<td class="muted">遮蔽</td>'; if (typeof c.denominator === 'string') return '<td class="muted">分母' + esc(c.denominator) + '</td>'; return '<td>' + (c.denominator ? esc(sup(c.numerator)) + '/' + esc(c.denominator) : '—') + (c.not_assessable ? '<br><span class="small muted">未滿 ' + esc(sup(c.not_assessable)) + '</span>' : '') + '</td>'; };
    var h = '<div class="table-scroll"><table class="small" id="mt_table" data-grain="' + esc(t.grain || 'MONTH') + '"><thead><tr><th scope="col">指標（' + (t.grain === 'QUARTER' ? '出院季世代' : '出院月世代') + '）</th>' + t.periods.map(function (p, i) { var c0 = ((t.cohort_series[0] || {}).cells || [])[i] || {}; return '<th scope="col">' + esc(p) + (c0.partial ? '（進行中）' : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      t.cohort_series.map(function (s) { return '<tr data-mt="' + esc(s.metric_id) + '"><th scope="row">' + esc(s.metric_id) + '<br>' + esc(s.name_zh) + '</th>' + s.cells.map(cell).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    if (t.snapshots) { var ids = {}; Object.keys(t.snapshots.points).forEach(function (p) { Object.keys(t.snapshots.points[p].metrics).forEach(function (k) { ids[k] = 1; }); });
      h += '<h3>月快照（' + esc(t.snapshots.facility === '*' ? '全部院所' : (FAC_ZH[t.snapshots.facility] || t.snapshots.facility)) + '）</h3>' + (Object.keys(ids).length ? '<div class="table-scroll"><table class="small"><thead><tr><th scope="col">指標</th>' + t.periods.map(function (p) { return '<th scope="col">' + esc(p) + (t.snapshots.points[p] && t.snapshots.points[p].capture === 'PROVISIONAL' ? '（進行中）' : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
        Object.keys(ids).sort().map(function (k) { return '<tr><th scope="row">' + esc(k) + '</th>' + t.periods.map(function (p) { var pt = t.snapshots.points[p]; return cell(pt ? pt.metrics[k] : null); }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' : '<p class="small muted">還沒有月快照（排程每月存一次；本月進行中每天更新一次）。</p>'); }
    else if (t.grain !== 'QUARTER') h += '<p class="small muted">月快照只提供院所層級儀表板權限的帳號。</p>';
    $('mt_out').innerHTML = h + '<ul class="small muted">' + t.limitations.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
  }).catch(function (e) { $('mt_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
function loadTeam(snap) {
  var facs = [].slice.call(document.querySelectorAll('.tf_fac:checked')).map(function (x) { return x.value; });
  $('team_out').innerHTML = '<p class="muted">計算中…</p>';
  call('getTeamDashboard', [{ facility_codes: facs }, !!snap]).then(function (d) {
    MREG = {}; (d.registry || []).forEach(function (r) { MREG[r.metric_id] = r; });
    var LAYER = { A: '病人軌跡', B: '轉銜照護（以已確認的心衰竭出院為起點）', C: '跨職類連續性（不做職類排名）', D: '資料品質與治理', E: '精準衛教與學習成效：懂了嗎 → 之後還記得嗎 → 能自己做嗎 → 有沒有做到', M: '用藥後續追蹤：改藥後有人追蹤判讀、差異有人處理、暫停的藥有人重新評估' };
    var topN = d.top_limit || 12, tile = function (m) { return '<div class="tile"><div class="small">' + esc(m.metric_id) + '　' + esc(m.name_zh) + '</div><div class="v">' + fmtMetric(m) + '</div><div class="d">' + metricDetail(m) + '</div></div>'; };
    var byId = {}; Object.keys(d.layers).forEach(function (L) { d.layers[L].forEach(function (m) { byId[m.metric_id] = m; }); });
    var h = teamMainHtml(d) + teamCoreHtml(d) + '<details class="panel" id="team_top_legacy"><summary>舊版重點（' + d.top.length + ' 項；含已被新版本取代或停用的指標，數字照舊）</summary><p class="small muted">資料時間 ' + esc(d10(d.as_of)) + '｜病人數 ' + esc(d.cohort_size) + (d.snapshot ? '｜已存快照 ' + esc(d.snapshot.snapshot_id.slice(0, 8)) : '') + '</p><div class="tiles">' +
      d.top.slice(0, topN).map(tile).join('') + '</div>' + (d.top.length > topN ? '<details id="top_more"><summary>其他重點（' + (d.top.length - topN) + ' 項）</summary><div class="tiles">' + d.top.slice(topN).map(tile).join('') + '</div></details>' : '') + '</details>' + teamTypesHtml(d, byId) + '<p class="small muted" id="team_layers_head">依照護層面（原分層，含分組細項）</p>';
    ['E', 'M', 'A', 'B', 'C', 'D'].forEach(function (L) {
      if (!d.layers[L]) return;
      h += '<details class="panel"><summary>' + esc(LAYER[L]) + '</summary><div class="table-scroll"><table><thead><tr><th scope="col">指標</th><th scope="col">結果</th><th scope="col">分子／分母／不確定／觀察期未滿</th></tr></thead><tbody>' +
        d.layers[L].map(function (m) { return '<tr><th scope="row">' + esc(m.metric_id) + '　' + esc(m.name_zh) + '</th><td>' + fmtMetric(m) + '</td><td class="small">' + metricDetail(m) + groupExtras(m) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    });
    h += '<details class="panel"><summary>指標定義（分子、分母、排除、觀察期、來源要求）</summary><div class="table-scroll"><table><thead><tr><th scope="col">指標</th><th scope="col">分子</th><th scope="col">分母</th><th scope="col">不確定的處理</th><th scope="col">觀察期與截尾</th><th scope="col">來源／確認要求</th><th scope="col">依據</th><th scope="col">時間定義／生效日／查核</th></tr></thead><tbody>' +
      d.registry.map(function (r) { return '<tr><th scope="row">' + esc(r.metric_id) + ' v' + esc(r.metric_version) + '<br>' + esc(r.name_zh) + '</th><td>' + esc(r.numerator) + '</td><td>' + esc(r.denominator) + '</td><td>' + esc(r.unknown_handling) + '</td><td>' + esc(r.observation_window_days ? r.observation_window_days + ' 天；' : '') + esc(r.censoring_rule) + '</td><td>' + esc([r.source_requirements, r.verification_requirements].filter(Boolean).join('；')) + '</td><td>' + esc(r.evidence_anchor) + '</td><td class="small" data-ts="' + esc(r.time_semantics) + '" data-vl="' + esc(r.verification_level) + '">' + esc(TS_ZH[r.time_semantics] || r.time_semantics) + '<br>生效 ' + esc(r.valid_from || '—') + '<br>' + (r.verification_level === 'ORACLE' ? chip('已有手算對照測試', 'ok') : chip('尚未有手算對照（未驗證）', 'warn')) + '</td></tr>'; }).join('') + '</tbody></table></div><p class="small muted">' + esc(d.registry[0] ? d.registry[0].risk_adjustment : '') + '　時間怎麼算：目前狀態＝看資料時間當下；全期累計＝所有已記錄事件；往回固定天數＝從資料時間往回算；世代＝從起始事件起算、觀察期滿才計。舊版定義的數值不與新版比較。</p></details>';
    h += '<section class="panel small muted"><h2>限制</h2><ul>' + d.limitations.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + (d.filter_notes.length ? '<li>篩選中有超出您權限的部分，已忽略。</li>' : '') + '</ul></section>';
    $('team_out').innerHTML = h;
  }).catch(function (e) { $('team_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}

/* ---------- 成效趨勢（2026-09-29） ---------- */
function pct(n, d) { return Math.round(n / d * 1000) / 10 + '%'; }
function trendCell(c) {
  if (c.denominator === 'SUPPRESSED') return '<span class="muted">遮蔽</span>';
  if (typeof c.denominator === 'string') return '<span class="muted">分母' + esc(c.denominator) + '</span>';
  if (!c.denominator) return '<span class="muted">—</span>';
  var nz = c.numerator === null ? '—' : (c.numerator === 'SUPPRESSED' ? '遮蔽' : c.numerator);
  return (typeof c.numerator === 'number' ? '<strong>' + pct(c.numerator, c.denominator) + '</strong>' : '<span class="muted">分子' + esc(nz) + '</span>') + '<br><span class="small muted">' + esc(nz) + '/' + esc(c.denominator) + '</span>';
}
function lineSvg(vals, label) {
  var pts = vals.map(function (v, i) { return { i: i, v: v }; }).filter(function (p) { return typeof p.v === 'number'; });
  if (pts.length < 2) return '<span class="small muted">可比較的點不足 2 個</span>';
  var n = Math.max(vals.length - 1, 1);
  function X(i) { return 6 + i / n * 188; } function Y(v) { return 44 - v * 40; }
  return '<svg class="spark" viewBox="0 0 200 48" role="img" aria-label="' + esc(label) + '"><line x1="6" y1="44" x2="194" y2="44" stroke="currentColor" stroke-opacity=".2"/><polyline points="' + pts.map(function (p) { return X(p.i).toFixed(1) + ',' + Y(p.v).toFixed(1); }).join(' ') + '"/>' + pts.map(function (p) { return '<circle r="2.5" cx="' + X(p.i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '"/>'; }).join('') + '</svg>';
}
function loadTrend() {
  var facs = [].slice.call(document.querySelectorAll('.tf_fac:checked')).map(function (x) { return x.value; });
  $('trend_out').innerHTML = '<p class="muted">計算中…</p>';
  call('getOutcomeTrend', [{ facility_codes: facs }, 'QUARTER']).then(function (d) {
    var periods = {}; d.metrics.forEach(function (m) { m.series.forEach(function (c) { periods[c.period] = 1; }); });
    var P = Object.keys(periods).sort();
    if (!P.length) { $('trend_out').innerHTML = '<p class="muted">範圍內還沒有已確認的心衰竭出院。</p>'; return; }
    var h = (d.suppressed_all ? '<p class="notice warn">為避免交叉相減推算出個人資料，這次結果已全部遮蔽。請放寬篩選條件。</p>' : '') + (d.facility_subset ? '<p class="small notice">只勾選部分院所：若某院所在某一季只有 1–4 位，該季會顯示「遮蔽」。</p>' : '') +
      '<div class="table-scroll"><table><thead><tr><th scope="col">指標</th><th scope="col">走勢（達成率，0–100%）</th>' + P.map(function (p) { return '<th scope="col">' + esc(p) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      d.metrics.map(function (m) {
        var by = {}; m.series.forEach(function (c) { by[c.period] = c; });
        var vals = P.map(function (p) { var c = by[p]; return c && typeof c.numerator === 'number' && typeof c.denominator === 'number' && c.denominator > 0 ? c.numerator / c.denominator : null; });
        return '<tr><th scope="row">' + esc(m.metric_id) + '<br><span class="small">' + esc(m.name_zh) + '</span></th><td>' + lineSvg(vals, m.name_zh + ' 走勢') + '</td>' +
          P.map(function (p) { var c = by[p]; return '<td class="small">' + (c ? trendCell(c) + (c.not_assessable && c.not_assessable !== 0 ? '<br><span class="muted">觀察期未滿 ' + esc(sup(c.not_assessable)) + '</span>' : '') : '<span class="muted">—</span>') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div><ul class="small muted">' + d.limitations.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    $('trend_out').innerHTML = h;
  }).catch(function (e) { $('trend_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
function loadSnapSeries() {
  $('snap_out').innerHTML = '<p class="muted">讀取中…</p>';
  call('getSnapshotSeries', [$('sn_fac').value, 120]).then(function (d) {
    if (!d.points.length) { $('snap_out').innerHTML = '<p class="muted">還沒有每日快照。管理者安裝排程後每天會自動存一份；也可以在「管理」按「立即存今日快照」。</p><ul class="small muted">' + d.limitations.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; return; }
    var last = d.points.slice(-10);
    var h = '<p class="small muted">共 ' + d.points.length + ' 天有快照（' + esc(d.points[0].day) + ' 至 ' + esc(d.points[d.points.length - 1].day) + '）；表格列出最近 ' + last.length + ' 天。</p><div class="table-scroll"><table><thead><tr><th scope="col">指標</th><th scope="col">走勢</th>' +
      last.map(function (p) { return '<th scope="col">' + esc(p.day.slice(5)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      d.metrics.map(function (m) {
        var vals = d.points.map(function (p) { var x = p.metrics[m.metric_id]; return x && !x.not_comparable && typeof x.value === 'number' ? x.value : null; });   /* v4.6：舊版定義不畫進同一條線 */
        var rate = m.kind !== 'COUNT' && m.kind !== 'MEDIAN' && m.kind !== 'DISTRIBUTION';
        return '<tr><th scope="row">' + esc(m.metric_id) + '<br><span class="small">' + esc(m.name_zh) + '</span></th><td>' + (rate ? lineSvg(vals, m.name_zh + ' 每日走勢') : '<span class="small muted">非比率指標</span>') + '</td>' +
          last.map(function (p) { var x = p.metrics[m.metric_id]; if (!x) return '<td class="small muted">—</td>'; return '<td class="small"' + (x.not_comparable ? ' data-nc="1"' : '') + '>' + (x.not_comparable ? '<span class="muted">' + (x.not_comparable_reason === 'POLICY_VERSION' ? '院內流程參數版本不同' : x.not_comparable_reason === 'DEFINITION_HASH' ? '同版本但定義內容不同' : '舊版定義 v' + esc(x.metric_version)) + '（不比較）</span><br>' : '') + (typeof x.value === 'number' ? '<strong>' + pct(x.numerator, x.denominator) + '</strong><br>' : '') + '<span class="muted">' + esc(x.numerator === null ? '—' : x.numerator) + '/' + esc(x.denominator === null ? '—' : x.denominator) + '</span></td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div><ul class="small muted">' + d.limitations.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    $('snap_out').innerHTML = h;
  }).catch(function (e) { $('snap_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}

/* ---------- 管理 ---------- */
/* LEXICON-SKIP-BEGIN（5.0 W5-W 文字掃描）：以下到 LEXICON-SKIP-END 是管理者畫面（管理分頁、維運、設定）；管理者需要照抄的設定名稱與技術說明在這裡，不列入醫療人員畫面文字掃描 */
function renderAdmin() {
  if (!ME.is_admin) return;
  /* W5-R2（5.0 K03-05）：控制台模式＝這一頁只顯示狀態；系統設定、院所與人員名單改在控制台試算表修改 */
  if (ME.control_mode === 'SHEET') { renderAdminReadonly(); return; }
  $('view_admin').innerHTML = (ME.trial ? '<section class="panel"><h2>同仁與專屬連結</h2><p class="small muted">先在下方「人員名單」新增同仁，再按「產生專屬連結」。連結就是登入：請用私訊或當面交給本人，不要貼在群組；重新產生會讓舊連結立即失效。</p><div id="slink_list"><p class="muted">讀取中…</p></div><div id="slink_out" aria-live="polite"></div></section>' +
      '<section class="panel"><h2>系統設定</h2><div id="settings_box"><p class="muted">讀取中…</p></div></section>' : '') +
    '<section class="panel"><h2>人員名單</h2><p class="small muted">' + (ME.trial ? '試用模式：email 可以留空（同仁用專屬連結登入）。' : 'email 以院內 Google 帳號為準。') + '「啟用」必須勾選才有效。</p><div class="grid2">' +
    '<label class="f">email' + (ME.trial ? '（可留空）' : '') + '<input id="sf_email" type="email" autocomplete="off"></label><label class="f">人員編號<input id="sf_id" autocomplete="off"></label><label class="f">顯示名稱<input id="sf_name" autocomplete="off"></label>' +
    '<label class="f">職責（決定在本系統能做什麼）<select id="sf_role">' + ME.roles.map(function (r) { return opt(r, ROLE_ZH[r] || r); }).join('') + opt('ADMIN', '系統管理者') + '</select></label>' +
    '<label class="f">職業類別（決定教學 EPA；個管師、安寧團隊必填）<select id="sf_prof">' + opt('', '（依職責推定）') + (ME.professions || []).map(function (p) { return opt(p, PROF_ZH[p] || p); }).join('') + '</select></label>' +
    '<label class="f">服務團隊代碼（選填，只做分組）<input id="sf_team" autocomplete="off" placeholder="例如 HF_TEAM"></label>' +
    '<fieldset><legend>院所範圍</legend>' + ME.facility_codes.map(function (f) { return '<label class="small"><input type="checkbox" class="sf_fac" value="' + esc(f) + '"> ' + esc(FAC_ZH[f] || f) + '</label><br>'; }).join('') + '</fieldset>' +
    '<label class="f">病人範圍<select id="sf_scope">' + opt('CARE_TEAM', '只限照護團隊') + opt('FACILITY', '院所內全部') + '</select></label>' +
    '<label class="f">儀表板範圍<select id="sf_dash">' + opt('NONE', '無') + opt('CARE_TEAM', '照護團隊') + opt('FACILITY', '院所') + '</select></label>' +
    '<label class="f">生效日<input id="sf_from" type="date"></label><label class="f">失效日<input id="sf_to" type="date"></label>' +
    (ME.teaching ? '<fieldset><legend>臨床教學角色（選填）</legend>' + [['TRAINEE', '在訓學員'], ['CLINICAL_TEACHER', '臨床教師'], ['PROGRAM_DIRECTOR', '計畫主持人']].map(function (x) { return '<label class="small"><input type="checkbox" class="sf_teach" value="' + x[0] + '"> ' + x[1] + '</label><br>'; }).join('') + '</fieldset>' +
      '<label class="f">訓練計畫（在訓學員必填；二年期醫事人員含藥師、護理師、營養師、治療師等）<select id="sf_prog">' + opt('', '（無）') + (ME.teaching.programs || []).map(function (p) { return opt(p[0], p[1]); }).join('') + '</select></label>' +
      '<label class="f">臨床教師資格有效至（老師與主持人必填；依院內師資認證紀錄）<input type="date" id="sf_cred"></label>' : '') +
    '<label class="small"><input type="checkbox" id="sf_admin"> 管理者</label><label class="small"><input type="checkbox" id="sf_active" checked> 啟用</label></div>' +
    '<div class="row"><button class="btn primary" type="button" data-act="staff_save">儲存人員</button>' + (ME.teaching ? '<button class="btn" type="button" data-act="t_ready">教學啟用檢查</button>' : '') + '</div><div id="staff_out" aria-live="polite"></div>' + (ME.teaching ? '<div id="t_ready_out" aria-live="polite"></div>' : '') + '</section>' +
    '<section class="panel"><h2>維運</h2><div class="row"><button class="btn" type="button" data-act="adm" data-val="adminVerifyProjections">檢查目前狀態與異動紀錄（事件帳本）</button><button class="btn" type="button" data-act="adm" data-val="adminRebuildProjections:dry">修復預演</button><button class="btn danger" type="button" data-act="adm" data-val="adminRebuildProjections:real">執行修復</button>' +
    '<button class="btn" type="button" data-act="adm" data-val="adminExportBackup">建立備份</button><button class="btn" type="button" data-act="adm" data-val="adminOpsSummary">效能摘要（7 天）</button><button class="btn" type="button" data-act="adm" data-val="adminInstallTriggers">安裝排程</button><button class="btn" type="button" data-act="adm" data-val="adminDailySnapshot">立即存今日快照</button></div>' +
    (ME.trial ? '<div class="row"><button class="btn" type="button" data-act="adm" data-val="adminSeedDemo">建立示範資料（36 位模擬病人）</button><span class="small muted">只在試用模式：另建院所「示範資料（系統產生）」，寫入過去約 6 個月的出院、追蹤、評估與再住院，讓成效儀表板與趨勢有足夠樣本。約需數分鐘；若顯示「已先完成一部分」請再按一次。</span></div><div class="row"><button class="btn danger" type="button" data-act="adm" data-val="adminRetireDemo">移除示範資料</button><span class="small muted">所有同仁的示範院所權限會被移除（原紀錄仍保留供稽核），不再出現在名單、儀表板與快照；移除後不能再建立。</span></div>' : '') +
    '<div class="row"><label class="f">備份試算表 ID<input id="bk_id" autocomplete="off"></label><button class="btn" type="button" data-act="adm" data-val="adminRestoreDryRun">還原演練（不寫入）</button></div>' + opsCenterShellHtml() + '<pre id="adm_out" class="linkbox" style="white-space:pre-wrap" aria-live="polite"></pre></section>' + rvpShellHtml();
  if (ME.trial) { loadStaffLinks(); loadSettings(); }
}
function renderAdminReadonly() {
  $('view_admin').innerHTML = '<section class="panel" id="admin_ro"><h2>管理（唯讀）</h2><p class="notice warn">這個系統的系統設定、院所與聯絡、人員名單（授權名單）都改在控制台試算表修改：請專案擁有者開啟控制台試算表，修改後從選單「HFPC 控制台」→「檢查並啟用」。這一頁只顯示目前生效的狀態。</p></section>' +
    '<section class="panel"><h2>系統設定（目前生效的值）</h2><div id="settings_box"><p class="muted">讀取中…</p></div></section>' +
    opsCenterShellHtml() + rvpShellHtml();
  loadSettings(); if (typeof opsLoad === 'function') opsLoad();
}
/* ---------- v4.3 X02：維運控制中心（唯讀顯示＋明確按鈕；preflight 任一 FAIL → 不產生「開始升版」按鈕） ---------- */
var OPS = { status: null, preflight: null };
var OPS_STEP_ZH = { SELECT_ENV: '1 選環境', PREFLIGHT: '2 Preflight', BACKUP_DRYRUN: '3 備份＋預演', DEPLOY_DECLARED: '4 宣告已部署（附新版本雜湊）', SMOKE: '5 36 項冒煙測試（smoke）', REPORTS_DOSSIER: '6 報告與佐證檔（dossier）', GATE: '7 放行判定：全部通過？' };
function opsCenterShellHtml() { return '<section class="panel" id="ops_center"><h2>維運控制中心</h2><p class="small muted">四區：環境狀態、待處理阻擋、常用維運、更新與回滾。Preflight 只檢查不寫入；「開始升版」只在 preflight 全部通過時出現。真實 Google Apps Script 的部署與回滾是人工步驟，系統只記錄。</p><div class="row"><button class="btn" type="button" data-act="ops_load">讀取環境狀態</button><button class="btn" type="button" data-act="ops_preflight">執行 Preflight（不寫入）</button><button class="btn" type="button" data-act="ops_backup">建立備份（登錄雜湊）</button></div><div id="ops_body"><p class="muted">按「讀取環境狀態」。</p></div></section>'; }
function opsLoad() { return call('opsStatus', []).then(function (st) { OPS.status = st; renderOps(); }).catch(function (e) { $('ops_body').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; }); }
function renderOps() {
  var st = OPS.status, pf = OPS.preflight; if (!st) return;
  var okPf = !!(pf && pf.overall === 'PASS' && pf.upgrade_allowed === true);
  var h = '<h3>環境狀態</h3><table class="small" id="ops_env"><tbody>' +
    [['環境模式（profile）', st.profile + (st.profile_blocked_reasons.length ? '（不得切換為 PILOT／CLINICAL：' + st.profile_blocked_reasons.join('；') + '）' : '')], ['伺服器／資料結構', st.version.server + '／' + st.version.schema], ['建置版本代碼', st.build_commit || '未注入'],
     ['最近備份', st.last_backup ? md(st.last_backup.at) + ' ' + st.last_backup.at.slice(11, 16) + '｜雜湊 ' + st.last_backup.content_hash_prefix + '｜' + st.last_backup.rows + ' 列｜' + st.last_backup.state + (st.last_backup.restore_verified ? '｜RESTORE_VERIFIED' : '｜尚未還原演練') : '尚無備份'],
     ['觸發條件', Object.keys(st.triggers).map(function (k) { var t = st.triggers[k]; return k + '：' + (t.installed ? '已安裝' : '未安裝') + (t.last_at ? '，最後執行 ' + t.last_at.slice(0, 16) + (t.last_ok ? ' OK' : ' ' + (t.last_code || 'FAIL')) : '，尚未執行'); }).join('；')],
     ['報告新鮮度（建置時）', st.report_freshness ? st.report_freshness.status + '（' + (st.report_freshness.generated_at || '') + '）' : '未注入'], ['配額', st.quota.label]].map(function (r) { return '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>';
  var bl = st.blockers; h += '<h3>待處理阻擋</h3>' + (bl ? '<p class="small">共 ' + bl.total + ' 項：' + Object.keys(bl.by_gate).map(function (g) { return g + ' ' + bl.by_gate[g]; }).join('、') + '</p><details class="small"><summary>逐項（前 ' + bl.items.length + ' 項）</summary><ul>' + bl.items.map(function (i) { return '<li>' + esc(i.id) + '｜' + esc(i.gate) + '｜由誰解除：' + esc({ reviewer: '審查者', hospital: '院方', engineering: '工程' }[i.resolved_by] || i.resolved_by) + (i.resolved_by === 'engineering' ? '（票號見待裁決清單）' : '') + '｜' + esc(i.required_input) + '</li>'; }).join('') + '</ul></details>' : '<p class="muted">這一版沒有附上待處理阻擋清單。</p>');
  h += '<h3>常用維運</h3><p class="small">人員與權限（含有效期）：上方「人員名單」。備份：本區按鈕。稽核查詢、指標對帳、匯出稽核：「效能摘要」與儀表板（本版唯讀）。</p>';
  h += '<h3>Preflight</h3>' + (pf ? '<ul class="small" id="ops_pf" data-checked="' + esc(pf.checked_at) + '">' + pf.items.map(function (i) { return '<li data-pf="' + esc(i.id) + '" data-status="' + esc(i.status) + '">' + (i.status === 'PASS' ? '✓' : (i.status === 'FAIL' ? '✗' : '•')) + ' ' + esc(i.name) + '：' + esc(i.detail) + '</li>'; }).join('') + '</ul><p class="small"><b>Preflight ' + esc(pf.overall) + '</b>（' + esc(pf.note) + '）</p>' : '<p class="muted">尚未執行。</p>');
  var run = st.upgrade_run;
  h += '<h3>更新與回滾（七步）</h3>' + (run ? '<ol class="small" id="ops_run" data-run="' + esc(run.run_id) + '">' + run.steps.map(function (s) { return '<li data-step="' + esc(s.step) + '" data-status="' + esc(s.status) + '">' + esc(OPS_STEP_ZH[s.step] || s.step) + '：' + esc(s.status) + (s.at ? '（' + esc(s.at.slice(0, 16)) + ' ' + esc(s.by) + '）' : '') + (s.note ? ' ' + esc(s.note) : '') + '</li>'; }).join('') + '</ol>' +
    (run.failed.length ? '<p class="notice err">本次升版在 ' + esc(run.failed.join('、')) + ' 失敗：後續步驟不可記錄，請回滾。</p>' : (run.next_step ? '<div class="row small"><label>附註／雜湊 <input id="ops_note" autocomplete="off"></label> <button class="btn small" type="button" data-act="ops_step" data-val="' + esc(run.next_step) + ':PASS">記錄「' + esc(OPS_STEP_ZH[run.next_step]) + '」通過</button> <button class="btn small" type="button" data-act="ops_step" data-val="' + esc(run.next_step) + ':FAIL">記錄失敗</button></div>' : '<p class="notice ok">七步全部通過（測試通過不等於核准上線；是否發佈仍由院方決定並登錄）。</p>')) : '<p class="muted">沒有進行中的升版。</p>');
  if (okPf && !(run && !run.failed.length && run.next_step)) h += '<div class="row"><button class="btn primary" type="button" id="ops_upgrade_btn" data-act="ops_start">開始升版（選環境 → 七步）</button></div>';
  else h += '<p class="small muted" id="ops_upgrade_hint">' + (okPf ? '升版進行中。' : 'Preflight 未全部通過或尚未執行：不顯示「開始升版」。') + '</p>';
  h += '<div class="row small"><label>備份 ID <input id="ops_bk" autocomplete="off"></label><button class="btn small" type="button" data-act="ops_drill">還原演練（只在 DEV／TEST）</button> <label>前一版 <input id="ops_prev" autocomplete="off" placeholder="例如 4.0.0@25450e1"></label><button class="btn small" type="button" data-act="ops_rollback">回滾（退回前一版）：驗證備份（不覆寫）</button></div><div id="ops_out" class="small"></div>';
  /* 狀態重繪不得清掉剛才操作的結果（備份、演練、回滾的輸出；之前重繪會把結果洗掉——X02 e2e 偶發失敗的原因） */
  var keepOut = $('ops_out') ? $('ops_out').textContent : '', keepBk = $('ops_bk') ? $('ops_bk').value : '';
  $('ops_body').innerHTML = h;
  if ($('ops_out')) $('ops_out').textContent = keepOut; if ($('ops_bk') && keepBk) $('ops_bk').value = keepBk;
}
function opsAct(fn, args, after) { $('ops_out').textContent = '執行中…'; return call(fn, args).then(function (r) { $('ops_out').textContent = JSON.stringify(r, null, 2); if (after) after(r); return opsLoad(); }).catch(function (e) { $('ops_out').textContent = '失敗：' + errText(e); }); }
function staffSave() {
  var row = { email: $('sf_email').value.trim(), actor_id: $('sf_id').value.trim(), display_name: $('sf_name').value.trim(), role: $('sf_role').value,
    facility_scope: [].slice.call(document.querySelectorAll('.sf_fac:checked')).map(function (x) { return x.value; }), patient_scope_rule: $('sf_scope').value, dashboard_scope: $('sf_dash').value,
    is_admin: $('sf_admin').checked, active: $('sf_active').checked, valid_from: $('sf_from').value, valid_to: $('sf_to').value,
    teaching_roles: [].slice.call(document.querySelectorAll('.sf_teach:checked')).map(function (x) { return x.value; }), training_program: $('sf_prog') ? $('sf_prog').value : '', teacher_credential_until: $('sf_cred') ? $('sf_cred').value : '', profession: $('sf_prof') ? $('sf_prof').value : '', service_team: $('sf_team') ? $('sf_team').value : '' };
  call('adminUpsertStaff', [row]).then(function (r) { $('staff_out').innerHTML = '<p class="notice ok">已' + (r.result === 'UPDATED' ? '更新' : '新增') + '：' + esc(r.actor_id) + '</p>'; if (ME.trial) loadStaffLinks(); })
    .catch(function (e) { $('staff_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
/* 試用模式：同仁專屬連結與系統設定 */
function loadStaffLinks() {
  if (!$('slink_list')) return;
  call('adminListStaff').then(function (rows) {
    $('slink_list').innerHTML = rows.length ? '<div class="table-scroll"><table><thead><tr><th>人員編號</th><th>顯示名稱</th><th>職類</th><th>狀態</th><th>專屬連結</th><th></th></tr></thead><tbody>' + rows.map(function (r) {
      return '<tr><td>' + esc(r.actor_id) + '</td><td>' + esc(r.display_name) + '</td><td>' + esc(ROLE_ZH[r.role] || r.role) + (r.is_admin ? '（管理者）' : '') + '</td><td>' + (r.active ? '啟用' : '停用') + '</td>' +
        '<td>' + (r.link_active ? '有效至 ' + esc(d10(r.link_expires_at)) : '沒有有效連結') + '</td><td>' + (r.is_self ? '<span class="small muted">（您自己；要換連結請重新執行 trialSetup）</span>' : '<button class="btn small" type="button" data-act="slink_issue" data-val="' + esc(r.actor_id) + '"' + (r.active ? '' : ' disabled') + '>' + (r.link_active ? '重新產生' : '產生專屬連結') + '</button>' +
        (r.link_active ? ' <button class="btn small danger" type="button" data-act="slink_revoke" data-val="' + esc(r.actor_id) + '">停用連結</button>' : '')) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="muted">還沒有人員。</p>';
  }).catch(function (e) { $('slink_list').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
function slinkIssue(id) {
  $('slink_out').innerHTML = '<p class="muted">產生中…</p>';
  call('adminIssueStaffLink', [id, 180]).then(function (r) {
    $('slink_out').innerHTML = '<p class="notice ok">' + esc(r.display_name || r.actor_id) + ' 的專屬連結（只顯示這一次；有效至 ' + esc(d10(r.expires_at)) + '）：</p>' + (r.warning ? '<p class="notice warn">' + esc(r.warning) + '</p>' : '') + linkBox(r.link, r.token);
    loadStaffLinks();
  }).catch(function (e) { $('slink_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
function slinkRevoke(id) {
  call('adminRevokeStaffLink', [id]).then(function () { $('slink_out').innerHTML = '<p class="notice ok">已停用 ' + esc(id) + ' 的連結。</p>'; loadStaffLinks(); })
    .catch(function (e) { $('slink_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
function renderSettings(s) {
  /* W5-R2（5.0 K03-05）：控制台模式下這裡只顯示目前生效的值；修改一律在控制台試算表完成（選單「HFPC 控制台」→「檢查並啟用」） */
  var ro = s.control_mode === 'SHEET';
  var h = (ro ? '<p class="notice warn" id="settings_ro">這個系統的設定改在控制台試算表修改：請專案擁有者開啟控制台試算表，在「系統設定」或「院所與聯絡」修改後，從選單「HFPC 控制台」→「檢查並啟用」。這裡只顯示目前生效的值。</p>' : '') +
    '<p class="small muted">病人頁面與通知使用的設定；留空代表不顯示或不寄送。</p>' + (s.clinician_app_url ? '<p class="small">本系統網址（第一次設定時決定，畫面不能改）：' + esc(s.clinician_app_url) + '</p>' : '');
  Object.keys(s.settings).forEach(function (k) {
    var lk = s.settings[k].locked || ro;
    h += '<div class="row"><label class="f wide">' + esc(s.settings[k].label) + '<input id="set_' + esc(k) + '" autocomplete="off" value="' + esc(s.settings[k].value || '') + '"' + (lk ? ' readonly' : '') + '></label>' + (lk ? '' : '<button class="btn small" type="button" data-act="setting_save" data-val="' + esc(k) + '">儲存</button>') + '</div>';
  });
  if (s.sheet_id) h += '<p class="small">病人連結版需要的「試算表 ID」（貼到病人連結版專案的指令碼屬性 SHEET_ID）：</p><pre class="linkbox" style="white-space:pre-wrap;word-break:break-all">' + esc(s.sheet_id) + '</pre>';
  h += '<div id="set_out" aria-live="polite"></div>';
  $('settings_box').innerHTML = h;
}
function loadSettings() { if (!$('settings_box')) return; call('adminGetSettings').then(renderSettings).catch(function (e) { $('settings_box').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; }); }
function settingSave(k) {
  call('adminSetSetting', [k, $('set_' + k).value]).then(function (s) { renderSettings(s); $('set_out').innerHTML = '<p class="notice ok">已儲存。</p>'; })
    .catch(function (e) { $('set_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
/* 5.2 第 3 波 H-07：職類視角預覽（管理者；唯讀、只限模擬病人；伺服器每次稽核） */
var RVP_ROLES = Object.keys(ROLE_ZH).filter(function (r) { return ['ADMIN', 'PATIENT', 'CAREGIVER'].indexOf(r) < 0; });
function rvpShellHtml() {
  return '<section class="panel" id="rvp"><h2>職類視角預覽（唯讀，只限模擬病人）</h2><p class="small muted">不需登出即可檢視各職類看到的照護計畫、本職紀錄區與本次要問的項目；不寫入紀錄、不加入照護團隊，每次查看都留下稽核紀錄。真實病人不能預覽。</p>' +
    '<div class="row"><button class="btn small" type="button" data-act="rvp_list">載入模擬病人</button> <label>病人 <select id="rvp_pk"><option value="">（先載入）</option></select></label> <label>職類 <select id="rvp_role">' + opt('', '全部職類') +
    RVP_ROLES.map(function (r) { return opt(r, ROLE_ZH[r]); }).join('') + '</select></label> <button class="btn small" type="button" data-act="rvp_show">顯示</button></div><div id="rvp_out" aria-live="polite"></div></section>';
}
function rvpRender(r) {
  var M = {}; (r.messages || []).forEach(function (m) { M[m.id] = m; });
  var li = function (id) { var m = M[id] || {}; return '<li>' + esc(m.tier || '') + ' ' + esc(m.title || cardTitle(m.card_id) || m.rule_id || id) + '</li>'; };
  return '<p class="small">' + esc(r.short_ref) + '｜' + esc(String(r.as_of || '').slice(0, 16).replace('T', ' ')) + '（UTC）' + (r.care_mode ? '｜舒適優先' : '') + ' ' + chip('唯讀預覽', 'warn') + '</p>' + (r.views || []).map(function (v) {
    var V = v.view || { today: [], other: [], collapsed: [] };
    return '<details class="rvp-role" data-role="' + esc(v.role) + '"><summary><strong>' + esc(v.role_zh) + '</strong>：今天 ' + V.today.length + ' 件、本職其他 ' + V.other.length + ' 件、本次要問 ' + v.ask_now.length + ' 項</summary>' +
      '<h4>今天最需要處理</h4>' + (V.today.length ? '<ol class="plain">' + V.today.map(li).join('') + '</ol>' : '<p class="muted small">沒有</p>') +
      (V.other.length ? '<h4>本職其他事項</h4><ol class="plain">' + V.other.map(li).join('') + '</ol>' : '') +
      '<p class="small">本職紀錄區：' + (v.record_fields.length ? v.record_fields.map(function (f) { return esc(field(f).label || f); }).join('、') : '無') + '</p>' +
      '<p class="small">本次要問：' + (v.ask_now.length ? v.ask_now.map(function (f) { return esc(field(f).label || f); }).join('、') : '無') + '</p></details>';
  }).join('');
}
function adm(v) {
  var p = v.split(':'), fn = p[0], args = [];
  if (fn === 'adminRebuildProjections') { args = [p[1] !== 'real']; if (p[1] === 'real' && !window.confirm('會依歷次異動紀錄（事件帳本）重建不一致的目前狀態，並留下紀錄。確定執行？')) return; }
  if (fn === 'adminRestoreDryRun') { if (!$('bk_id').value.trim()) { $('bk_id').focus(); return; } args = [$('bk_id').value.trim()]; }
  if (fn === 'adminOpsSummary') args = [7];
  if (fn === 'adminRetireDemo' && !window.confirm('移除後示範病人不再出現在名單與儀表板，而且不能再建立。確定？')) return;
  if (fn === 'adminSeedDemo' && !window.confirm('會建立院所「示範資料（系統產生）」與 36 位模擬病人（病歷號 TESTDEMO01–36），並把這個院所加到您的權限。確定？')) return;
  $('adm_out').textContent = '執行中…' + (fn === 'adminSeedDemo' ? '（約需數分鐘，請不要關閉畫面）' : '');
  call(fn, args).then(function (r) {
    $('adm_out').textContent = (r && r.message ? r.message + '\n\n' : '') + JSON.stringify(r, null, 2);
    /* 示範資料會把 DEMO 院所加進自己的權限：重新讀一次身分，儀表板的院所勾選才會出現 */
    if (fn === 'adminSeedDemo') call('whoAmI').then(function (me) { ME = me; Object.keys(me.facility_labels || {}).forEach(function (k) { FAC_ZH[k] = me.facility_labels[k]; }); renderTeamShell(); }).catch(function () {});
  }).catch(function (e) { $('adm_out').textContent = '失敗：' + errText(e); });
}

/* ---------- 工作清單 ---------- */
var WL = null, WL_FILTER = '', WL_MINE = false, WL_SCROLL = 0, WL_OFFSET = 0;
/* ===================== 5.0 W5-M（K10-07）：工作清單摘要 ===================== */
/* LEXICON-SKIP-END */
var WL5_MINE = true, WL5_FLAT = [];
var TIER_ZH = ['第 0 級 安全', '第 1 級 時效臨床', '第 2 級 流程', '第 3 級 整理'];
var WL5_DEFER_ZH = { WAITING_LAB: '等檢驗結果', PATIENT_ADMITTED: '病人住院中', VISIT_SCHEDULED: '已排回診日', PATIENT_DECLINED: '病人拒絕', OTHER_FACILITY: '他院處理中' };
function wl5Idx(i) { WL5_FLAT.push(i); return WL5_FLAT.length - 1; }
function wl5Label(i) { var z = WL_ZH[i.kind] || [i.kind === 'DEATH_REPORTED_CONFIRM' ? '死亡轉述待確認' : (i.kind === 'DEATH_VERIFIED_CLOSEOUT' ? '已核實死亡：請結案其餘待辦' : i.kind), i.tier === 0 ? 'err' : '']; return chip(z[0], z[1]); }
function wl5Item(i) {
  var ix = wl5Idx(i), d = i.detail || {}, deferable = i.tier >= 1;
  var dd = deferable ? '<details class="noprint wl5-defer"><summary class="small">延後（需原因與喚醒日）</summary><div class="row"><label class="f small">原因<select id="wl5_r_' + ix + '"><option value="">請選擇</option>' + Object.keys(WL5_DEFER_ZH).map(function (k) { return opt(k, WL5_DEFER_ZH[k]); }).join('') + '</select></label><label class="f small">喚醒日<input type="date" id="wl5_w_' + ix + '" min="' + esc(addDays(today(), 1)) + '" max="' + esc(addDays(today(), (WL.v5 && WL.v5.defer_max_days) || 30)) + '"></label><button class="btn small" type="button" data-act="wl5_defer" data-val="' + ix + '">延後</button></div><p class="small field-err" id="wl5_e_' + ix + '"></p></details>' : '';
  return '<li data-wl5-item="' + esc(i.item_key) + '" data-tier="' + esc(i.tier) + '">' + wl5Label(i) + (i.mine_v5 ? ' ' + chip('我的') : '') + (i.aging ? ' ' + chip('逾期 ' + i.aging_days + ' 天：請重新排程、取消或轉派', 'err') : '') + (i.next_contact ? ' ' + chip('下次接觸 ' + md(i.next_contact) + ' 時處理') : '') +
    ' <span class="small">' + wlDetail(i) + '</span> <button class="btn small" type="button" data-act="wl5_go" data-val="' + ix + '">直接處理</button>' + dd + '</li>';
}
function wlV5Html() {
  WL5_FLAT = []; var v = WL && WL.v5; if (!v) return '';
  if (v.error) return '<section class="panel" id="wl_v5"><p class="notice warn">' + esc(v.message) + '</p></section>';
  var rows = v.rows.filter(function (r) { return !WL5_MINE || r.mine; }), other = v.rows.length - rows.length;
  var h = '<section class="panel" id="wl_v5"><h2>依病人整理（每位病人一列）</h2><p class="small muted">第 0 級（安全警訊、通知未送達、血鉀或腎功能超過門檻）每一件各自一張卡、置頂、不可延後；同一位病人有多件也不合併。其他項目每位病人一列，顯示最優先的原因與其餘件數，點開逐項處理。</p>' +
    '<div class="row noprint"><button class="btn small' + (WL5_MINE ? ' primary' : '') + '" type="button" data-act="wl5_mine" data-val="1">我的（本職負責＋所有第 0 級）</button><button class="btn small' + (WL5_MINE ? '' : ' primary') + '" type="button" data-act="wl5_mine" data-val="">全團隊</button></div>';
  h += '<h3>第 0 級：安全（' + v.tier0.length + ' 件）</h3>' + (v.tier0.length ? '<div class="wl5-cards" id="wl5_tier0">' + v.tier0.map(function (i) { var ix = wl5Idx(i), d = i.detail || {};
    return '<div class="card wl5-card" data-wl5-t0="' + esc(i.item_key) + '">' + wl5Label(i) + ' <strong>病人 #' + esc(i.short_ref) + '</strong>' + identTxt(i) + '<br><span class="small">' + wlDetail(i) + '</span><br><span class="small">負責：' + esc((i.owner_roles || []).map(function (r) { return ROLE_ZH[r] || r; }).join('、') || '依院內流程') + (i.due_at ? '｜期限 ' + esc(md(d10(i.due_at))) + ' ' + esc(hm(i.due_at)) : '') + (d.overdue ? ' ' + chip('已逾時', 'err') : '') + '</span> <button class="btn small" type="button" data-act="wl5_go" data-val="' + ix + '">直接處理</button></div>'; }).join('') + '</div>' : '<p class="small muted">目前沒有第 0 級事件。</p>');
  h += '<h3>每位病人一列（' + rows.length + ' 列' + (WL5_MINE && other ? '；團隊其他 ' + other + ' 列已收合' : '') + '）</h3>' + (rows.length ? '<div class="table-scroll"><table id="wl5_rows"><thead><tr><th scope="col">病人</th><th scope="col">最優先的原因</th><th scope="col">其餘</th></tr></thead><tbody>' + rows.map(function (r) {
    return '<tr data-wl5-row="' + esc(r.short_ref) + '"><td>#' + esc(r.short_ref) + identTxt(r) + (r.tier0_n ? '<br>' + chip('另有第 0 級 ' + r.tier0_n + ' 件（見上方）', 'err') : '') + (r.what_matters ? '<br><span class="small">在意：' + esc(wmText(r.what_matters)) + '</span>' : '') + '</td><td>' + wl5Label(r.top) + ' <span class="small">' + wlDetail(r.top) + '</span>' + (r.next_contact ? '<br>' + chip('下次接觸 ' + md(r.next_contact)) : '') + '</td>' +
      '<td><details><summary>' + (r.others_n ? '其餘 ' + r.others_n + ' 項' : '展開處理') + '</summary><ul class="plain">' + r.items.map(wl5Item).join('') + '</ul></details></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="small muted">沒有需要您處理的項目。</p>') +
    (WL5_MINE && other ? '<p class="small"><button class="btn small" type="button" data-act="wl5_mine" data-val="">團隊其他 ' + other + ' 列</button></p>' : '');
  h += '<details class="panel" id="wl5_batch"><summary>第 3 級：整理（每週批次，預設收合）——長期用藥檢驗過期 ' + v.batch.lab_stale.length + '、診斷待確認 ' + v.batch.dx_queue_n + '、其他 ' + v.batch.tidy.length + '</summary>' +
    '<h4>開檢驗單清單（長期用藥的鉀／腎功能過期，可一次處理）</h4><ul class="plain">' + v.batch.lab_stale.map(wl5Item).join('') + '</ul>' +
    '<h4>診斷待確認（處方者每週確認：一鍵到病人頁確認或改為評估中）</h4>' + (v.batch.dx_queue.length ? '<ul class="plain">' + v.batch.dx_queue.map(function (q) { var ix = wl5Idx({ patient_key: q.patient_key, target: q.target, kind: 'DX_UNCONFIRMED', tier: 3 }); return '<li>#' + esc(q.short_ref) + ' <button class="btn small" type="button" data-act="wl5_go" data-val="' + ix + '">到病人頁確認</button></li>'; }).join('') + '</ul>' : '<p class="small muted">' + (v.batch.dx_queue_n ? '共 ' + v.batch.dx_queue_n + ' 位，由處方者確認。' : '沒有。') + '</p>') +
    '<h4>其他整理</h4><ul class="plain">' + v.batch.tidy.map(wl5Item).join('') + '</ul>' +
    '<h4>延後中（' + v.deferred.length + '）</h4><ul class="plain small">' + v.deferred.map(function (z) { return '<li>#' + esc(z.short_ref) + '｜' + esc((WL_ZH[z.kind] || [z.kind])[0]) + '｜' + esc(WL5_DEFER_ZH[z.reason] || z.reason) + '｜' + esc(md(z.wake)) + ' 喚醒（有新的警訊、住院出院或檢驗會提早喚醒）</li>'; }).join('') + '</ul></details>';
  return h + '<h2 class="small muted" id="wl_items_head">逐項清單（與 4.9 相同）</h2></section>';
}
function wl5Go(ix) { var i = WL5_FLAT[Number(ix)]; if (!i) return; WL_SCROLL = window.scrollY || 0; if (TAB !== 'patients') switchTab('patients'); openPatient(i.patient_key, false, false, i.target || null); }
function wl5Defer(ix) {
  var i = WL5_FLAT[Number(ix)]; if (!i) return; var r = $('wl5_r_' + ix).value, w = $('wl5_w_' + ix).value;
  if (!r || !w) { inlineErr('wl5_e_' + ix, '請選擇延後原因與喚醒日。'); return; }
  call('deferWorklistItem', [i.patient_key, i.item_key, r, w]).then(function () { loadWorklist(); }).catch(function (e) { inlineErr('wl5_e_' + ix, errText(e)); });
}
function loadWorklist() {
  $('view_work').innerHTML = '<section class="panel"><h2>工作清單</h2><p class="muted">讀取中…</p></section>';
  call('getWorklist', [{ offset: WL_OFFSET }]).then(function (w) { WL = w; renderWorklist(); if (WL_SCROLL) { window.scrollTo(0, WL_SCROLL); } }).catch(function (e) { $('view_work').innerHTML = '<section class="panel"><h2>工作清單</h2><p class="notice err">' + esc(errText(e)) + '</p></section>'; });
}
function wlDetail(i) {
  var d = i.detail || {};
  switch (i.kind) {
    case 'T01_WINDOW_OPEN': return '出院 ' + esc(d10(d.discharge_at)) + '，還剩 ' + esc(d.days_left) + ' 天';
    case 'SAFETY_FOLLOWUP': return esc(d.route_label || '') + '｜' + esc(codeZh(DICT.alert_outcomes, d.responded_outcome)) + '（' + esc(md(d10(d.responded_at))) + '）｜確認後續期限 ' + esc(md(d10(d.followup_due))) + ' ' + esc(hm(d.followup_due)) + (d.overdue ? '（已過）' : '');
    case 'ACTION_OVERDUE': return esc(actName(d)) + '，到期 ' + esc(d10(d.due_at)) + (d.owner_role ? '（' + esc(ROLE_ZH[d.owner_role] || d.owner_role) + '）' : '');
    case 'ACTION_BARRIER': return esc(actName(d)) + '：' + esc(codeZh(DICT.barrier_codes, d.barrier_code)) + (d.by_patient ? '（病人回報）' : '') + (d.aggregated ? '　等共 ' + esc(d.n) + ' 項' : '');
    case 'ACTION_PATIENT_COMPLETED': return esc(actName(d)) + '，病人說 ' + esc(d10(d.completed_at)) + ' 完成' + (d.aggregated ? '　等共 ' + esc(d.n) + ' 項' : '');
    case 'CONCERN_WORSE': return esc((DICT.concern_labels || {})[d.concern_code] || d.concern_code) + (d.aggregated ? '　等共 ' + esc(d.n) + ' 項' : '');
    case 'EPISODE_MANUAL_REVIEW': return esc(d10(d.admission_at)) + '–' + esc(d10(d.discharge_at));
    case 'INBOX_REJECTED': return esc(d10(d.processed_at)) + '（' + esc(d.code) + '）';
    case 'INBOX_QUARANTINED': return '隔離於 ' + esc(md(d10(d.processed_at))) + ' ' + esc(hm(d.processed_at)) + '｜先向病人確認是不是本人送出，再決定' +
      '<div class="row"><label class="f small">確認方式<input type="text" id="qr_note_' + esc(d.inbox_id) + '" maxlength="200" placeholder="例如：已電話向病人確認是本人送出"></label>' +
      '<button class="btn small" type="button" data-act="qr_release" data-val="' + esc(d.inbox_id) + '">確認是本人，採用</button><button class="btn small danger" type="button" data-act="qr_discard" data-val="' + esc(d.inbox_id) + '">捨棄</button></div><p class="small field-err" id="qr_err_' + esc(d.inbox_id) + '"></p>';
    case 'ACTION_ASSIGNED_TO_MY_ROLE': return esc(actName(d)) + '｜' + esc(ROLE_ZH[d.created_role] || d.created_role || '') + ' 安排' + (d.due_at ? '｜' + esc(md(d10(d.due_at))) + ' 前' : '');
    case 'HANDOFF_IN_PROGRESS_MINE': return esc(actName(d)) + '｜' + esc(hoText(d.handoff)) + (d.about_ref ? '｜' + esc(aboutText(d.about_ref)) : '') + (d.due_at ? '｜' + esc(md(d10(d.due_at))) + ' 前' : '');
    case 'HANDOFF_OUT_OF_SYSTEM': return esc(actName(d)) + '｜交給 ' + esc(ROLE_ZH[d.owner_role] || d.owner_role || '') + '｜' + esc(hoText(d.handoff)) + '｜您已用系統外方式通知；對方加入照護團隊前，系統不會顯示已送達';
    case 'HANDOFF_TO_MY_ROLE': return esc(actName(d)) + '｜' + esc(hoText(d.handoff)) + (d.about_ref ? '｜' + esc(aboutText(d.about_ref)) : '') + (d.accept_by ? '｜接手期限 ' + esc(md(d.accept_by)) : '') + (d.redirected ? '｜' + esc('由 ' + (ROLE_ZH[d.redirected.from] || d.redirected.from) + ' 轉來（' + codeZh(DICT.action_change_reasons, d.redirected.reason) + '）') : '');
    case 'HANDOFF_UNACCEPTED_LATE': return esc(actName(d)) + '｜給 ' + esc(ROLE_ZH[d.owner_role] || d.owner_role) + '｜接手期限 ' + esc(md(d.accept_by)) + '（已過）｜請改派、直接聯絡或取消並寫原因';
    case 'HANDOFF_RETURNED': return esc(actName(d)) + '｜' + esc(ROLE_ZH[d.owner_role] || d.owner_role) + ' 退回；請另外安排';
    case 'HANDOFF_REPLIED': return esc(actName(d)) + '｜結果：' + esc(codeZh(DICT.result_codes, d.result_code));
    case 'MONITOR_DUE': case 'RESULT_TO_REVIEW': return esc(d.label || '') + (d.due_at ? '｜' + esc(md(d.due_at)) + (d.overdue ? '（已過）' : '') + '前' : '');
    case 'MED_DISCREPANCY': case 'HOLD_REVIEW_DUE': case 'REBASELINE': case 'HF_HAZARD_REVIEW': case 'HF_HAZARD_PRESCRIBER': case 'T01_EVENT_MISSING': return esc(d.label || '');
    case 'K_RENAL_THRESHOLD': case 'K_RISING': case 'MONITOR_STALE': case 'EXERCISE_PAUSE': case 'DX_UNCONFIRMED': return wlB1Detail(i);
    case 'PATIENT_ACTION_OVERDUE': return wlB1Detail(i);
    case 'ALERT_DELIVERY_FAILED': return esc(d.route_label) + '｜原因：' + esc(d.reason) + '（第 ' + esc(d.attempt) + ' 次' + (d.final ? '，不再重試' : '，系統會再試，最多 ' + esc(d.max_attempts) + ' 次') + '）｜' + (d.final ? '請依院內流程直接聯絡病人並在警訊記錄處理結果' : '重試成功前請不要假設已有人收到；必要時直接聯絡');
    case 'PARKED_INPUT': case 'DATA_CONFLICT': return esc(d.n) + ' 筆';
    default: return '';
  }
}
/* 4.9.3 WP-B1（CARE-CARD-06）：固定分類（0 件也顯示），排在逐類按鈕前；點選只篩選，不改內容 */
var WL_GROUPS = [['G:ALERT', '警訊待處理', ['SAFETY_ALERT', 'ALERT_DELIVERY_FAILED', 'SAFETY_FOLLOWUP']], ['G:MONITOR', '監測', ['K_RENAL_THRESHOLD', 'MONITOR_DUE', 'MONITOR_STALE', 'K_RISING', 'RESULT_TO_REVIEW', 'HOLD_REVIEW_DUE']],
  ['G:HANDOFF', '交接待接手', ['HANDOFF_TO_MY_ROLE', 'HANDOFF_UNACCEPTED_LATE']], ['G:DX', '診斷待確認', ['DX_UNCONFIRMED']]];
function wlInGroup(g, kind) { var x = WL_GROUPS.filter(function (y) { return y[0] === g; })[0]; return !!x && x[2].indexOf(kind) >= 0; }
function wlFixedGroups() {
  return '｜' + WL_GROUPS.map(function (g) { var n = WL.items.filter(function (i) { return g[2].indexOf(i.kind) >= 0; }).length;
    return '<button class="btn small' + (WL_FILTER === g[0] ? ' primary' : '') + '" type="button" data-act="wl_filter" data-val="' + esc(g[0]) + '" data-wl-group="' + esc(g[0]) + '">' + esc(g[1]) + '（' + n + '）</button>'; }).join('') + '｜';
}
function wlB1Detail(i) {
  var d = i.detail || {};
  if (i.kind === 'PATIENT_ACTION_OVERDUE') return esc(actName(d)) + (d.n > 1 ? '　等共 ' + esc(d.n) + ' 項' : '') + '｜最久逾期 ' + esc(d.overdue_days) + ' 天｜追蹤：' + esc((d.owner_roles || []).map(function (r) { return ROLE_ZH[r] || r; }).join('、'));
  return esc(d.label || '') + (d.due_at ? '｜' + esc(String(d.due_at).length > 10 ? tw(d.due_at).slice(5).replace('-', '/') : md(d.due_at)) + ' 前' : '') +   /* 5.2 H-02：有時間的期限顯示到分 */ (d.owner_role ? '｜負責：' + esc(ROLE_ZH[d.owner_role] || d.owner_role) : (d.owner_roles ? '｜負責：' + esc(d.owner_roles.map(function (r) { return ROLE_ZH[r] || r; }).join('、')) : ''));
}
function renderWorklist() {
  if (!WL) return;
  var items = WL.items.filter(function (i) { return (!WL_FILTER || i.kind === WL_FILTER || wlInGroup(WL_FILTER, i.kind)) && (!WL_MINE || i.mine); });
  var alerts = items.filter(function (i) { return i.kind === 'SAFETY_ALERT'; }), rest = items.filter(function (i) { return i.kind !== 'SAFETY_ALERT'; });
  var hid = Object.keys(WL.hidden_by_kind || {});
  var h = '<section class="panel"><h2>工作清單</h2><p class="small muted">範圍：您可以查看的病人｜資料時間 ' + esc(d10(WL.as_of)) + ' ' + esc(hm(WL.as_of)) + '｜高風險項目（安全、逾期、困難、交接、出院 7 天）一律全部列出，共 ' + esc(WL.high_risk_n) + ' 項' +
    (WL.general_total > WL.page_size ? '｜一般項目共 ' + esc(WL.general_total) + ' 項，這一頁從第 ' + esc(WL.offset + 1) + ' 項開始' : '') + '</p>' +
    '<p class="small notice">本系統不是即時監控：病人送出的資料由系統定時處理（約每分鐘一次）後才會出現；通知信可能失敗，失敗的會另列「需人工聯絡」。病人頁面已提醒緊急時直接撥 119。</p><div class="row noprint">' +
    '<button class="btn small' + (WL_MINE ? ' primary' : '') + '" type="button" data-act="wl_mine" data-val="1">我的工作</button><button class="btn small' + (WL_MINE ? '' : ' primary') + '" type="button" data-act="wl_mine" data-val="">全團隊</button>｜' +
    '<button class="btn small' + (WL_FILTER ? '' : ' primary') + '" type="button" data-act="wl_filter" data-val="">全部（' + WL.items.length + '）</button>' + wlFixedGroups() +
    Object.keys(WL.counts).map(function (k) { return '<button class="btn small' + (WL_FILTER === k ? ' primary' : '') + '" type="button" data-act="wl_filter" data-val="' + esc(k) + '">' + esc((WL_ZH[k] || [k])[0]) + '（' + esc(WL.counts[k]) + '）</button>'; }).join('') +
    '<button class="btn small" type="button" data-act="wl_reload">重新整理</button></div>' +
    (hid.length ? '<p class="small">其他頁還有：' + hid.map(function (k) { return esc((WL_ZH[k] || [k])[0]) + ' ' + esc(WL.hidden_by_kind[k]); }).join('、') + (WL.next_offset !== null ? ' <button class="btn small" type="button" data-act="wl_page" data-val="' + esc(WL.next_offset) + '">下一頁</button>' : '') + (WL.offset ? ' <button class="btn small" type="button" data-act="wl_page" data-val="0">回第一頁</button>' : '') + '</p>' : '') +
    '<p class="small muted">「我的工作」＝交給我這個職類、我送出的交接、我接手的事與所有安全警訊；其他人的事仍看得到（切換「全團隊」），安全資訊不因角色被隱藏。</p></section>';
  /* 3.4（T06）：未送達、超過首次處理時限仍未確認的警訊，放在工作清單最上面（文字＋圖示，不只靠顏色）；只看資料，不推算服務時間 */
  var undel = WL.items.filter(function (i) { return i.kind === 'ALERT_DELIVERY_FAILED'; }).length, unack = WL.items.filter(function (i) { return i.kind === 'SAFETY_ALERT' && i.detail && i.detail.overdue; }).length;
  h += wlV5Html();   /* 5.0 W5-M：每位病人一列的摘要（預設）；下方逐項清單不變 */
  if (undel || unack) h = '<div class="notice err" id="wl_undelivered" role="alert"><strong>⚠ ' + [undel ? '未送達 ' + undel + ' 筆（通知信沒有送出）' : '', unack ? '未確認 ' + unack + ' 筆（超過首次處理時限）' : ''].filter(Boolean).join('；') + '</strong><br><span class="small">寄出、送達都不等於有人處理；請依院內流程直接聯絡，並在警訊記錄處理結果。</span></div>' + h;
  /* 3.4（T11）：同一病人、同一路徑、尚未結案的警訊合併為一列（顯示件數，展開看每一筆；每一筆仍各自結案）。
     不跨路徑合併（不會把較緊急的併進較不緊急的）；含 119／現在去急診或任一筆逾時的群組一律展開，不被收起來。 */
  if (alerts.length) {
    var grp = {}, order = [];
    alerts.forEach(function (i) { var d = i.detail || {}, k = i.patient_key + '|' + (d.route || ''); if (!grp[k]) { grp[k] = []; order.push(k); } grp[k].push(i); });
    h += '<section class="panel"><h2>安全警訊</h2>' + order.map(function (k) {
      var g = grp[k], cards = g.map(function (i) { return alertCard(Object.assign({ patient_key: i.patient_key, short_ref: i.short_ref }, i.detail), true); }).join('');
      if (g.length === 1) return cards;
      var d0 = g[0].detail || {}, hot = ['EMERGENCY', 'URGENT_NOW'].indexOf(d0.route) >= 0 || g.some(function (i) { return i.detail && (i.detail.overdue || i.detail.followup_overdue); });
      return '<details class="wl-group" data-group-n="' + g.length + '"' + (hot ? ' open' : '') + '><summary><strong>病人 #' + esc(g[0].short_ref) + '</strong>' + identTxt(g[0]) + '<strong>｜' + esc(d0.route_label || d0.route || '') + '｜同類未結案 ' + g.length + ' 筆</strong>' + (hot ? ' ' + chip('緊急或逾時：已展開', 'err') : '') + ' <span class="small">（展開逐筆處理；每一筆分別結案）</span></summary>' + cards + '</details>';
    }).join('') + '</section>';
  }
  /* 3.4（T11）：同一病人、同一類別的待處理項目合併為一列（顯示件數，展開看每一筆；每一筆各自「直接處理」、各自結案）；
     含高優先（安全相關、逾期、未送達）的群組一律展開，不被收起來 */
  function wlRow(i) { var z = WL_ZH[i.kind] || [i.kind, '']; return '<tr><td>' + chip(z[0], z[1]) + (i.mine ? ' ' + chip('我的') : '') + '</td><td>#' + esc(i.short_ref) + identTxt(i) + (i.what_matters ? '<br><span class="small">在意：' + esc(wmText(i.what_matters)) + '</span>' : '') + '</td><td>' + wlDetail(i) + '</td><td><button class="btn small" type="button" data-act="wl_go" data-val="' + esc(WL.items.indexOf(i)) + '">直接處理</button></td></tr>'; }
  var rg = {}, ro = [];
  rest.forEach(function (i) { var k = i.patient_key + '|' + i.kind; if (!rg[k]) { rg[k] = []; ro.push(k); } rg[k].push(i); });
  h += uxWl49Open() + '<section class="panel"><h2>其他待處理</h2>' + (rest.length ? '<div class="table-scroll"><table><thead><tr><th scope="col">項目</th><th scope="col">病人</th><th scope="col">說明</th><th scope="col"></th></tr></thead><tbody>' + ro.map(function (k) {
    var g = rg[k]; if (g.length === 1) return wlRow(g[0]);
    var z = WL_ZH[g[0].kind] || [g[0].kind, ''], hot = g.some(function (i) { return i.kind === 'ALERT_DELIVERY_FAILED' || i.priority < 3 || (i.detail && i.detail.overdue); });
    return '<tr class="wl-grp" data-group-n="' + g.length + '"><td colspan="4"><details class="wl-group"' + (hot ? ' open' : '') + '><summary>' + chip(z[0], z[1]) + ' <strong>病人 #' + esc(g[0].short_ref) + '</strong>' + identTxt(g[0]) + '<strong>｜同類 ' + g.length + ' 筆</strong>' + (hot ? ' ' + chip('含高優先：已展開', 'err') : '') + ' <span class="small">（展開逐筆處理；每一筆分別結案）</span></summary><table class="small"><tbody>' + g.map(wlRow).join('') + '</tbody></table></details></td></tr>';
  }).join('') + '</tbody></table></div>' : '<p class="muted">沒有其他待處理項目。</p>') + '</section>' + uxWl49Close();
  $('view_work').innerHTML = h;
}
/* 直達：開啟病人、切到對應分頁、捲到那一項並標示；回到工作清單時保留篩選與捲動位置 */
function wlGo(ix) {
  var i = WL && WL.items[Number(ix)]; if (!i) return;
  WL_SCROLL = window.scrollY || 0;
  if (TAB !== 'patients') switchTab('patients');
  openPatient(i.patient_key, false, false, i.target || null);
}
function focusTarget(t) {
  if (!t || !t.ref) return;
  var ref = String(t.ref), id = ref.indexOf('act:') === 0 ? 'act_' + ref.slice(4) : ref.indexOf('alert:') === 0 ? 'alert_' + ref.slice(6) : ref.indexOf('ep:') === 0 ? 'ep_' + ref.slice(3) : ref.indexOf('msg:') === 0 ? 'msg_' + ref.slice(4).replace(/[^A-Za-z0-9_\-]/g, '_') : ref;
  var el = document.getElementById(id); if (!el) return;
  el.classList.add('target-hl'); el.setAttribute('tabindex', '-1');
  try { el.scrollIntoView({ block: 'center' }); } catch (e) { el.scrollIntoView(); }
  el.focus();
  var back = $('pt_back'); if (back) back.hidden = false;
}
/* ---------- 給病人的一頁行動計畫（列印）：讀同一份照護計畫的病人端投影（plan_patient_view），不另外挑內容 ----------
   固定的只有版面骨架與安全底線；主題、順序、篇幅、用藥段落依計畫而變。內容太多時由計畫的排序決定先後，不縮小字體硬塞。 */
function cardForPrint(id, cg) {
  var c = cardFull(id) || {}, v = cg ? ((catalog().caregiver_variants || {})[id] || null) : null;
  return { title: (v && v.title) || c.title || cardTitle(id), action: (v && v.actions && v.actions[0]) || c.summary_action || (c.actions || [])[0] || '', steps: ((v && v.actions) || c.actions || []).slice(), do_not: c.do_not || '', ask: c.ask || '' };
}
function printPlan() {
  if (deadNoPrint()) return;   /* 第二輪獨立複核（G-01 延伸） */
  var pv = CUR.rec.plan_patient_view, phone = FAC_PHONE[CUR.rec.facility_code] || '';
  if (!pv) { inlineErr('pt_msg', '照護計畫暫時無法產生，無法列印行動計畫。'); return; }
  var cg = pv.communication.caregiver_variant, v = CUR.rec.view, f = v.fields;
  function num(fid) { return f[fid] && typeof f[fid].value === 'number' ? f[fid].value : null; }
  /* 4.9.3 WP-A（移植 4.9.2，CARE-NURSE-01／CARE-NEW-01）：新句型每句過內容閘門（只對模擬病人）；真實病人印 4.9.1 原句型 */
  var G = {}; Object.keys(CONTENT_GATE).forEach(function (k) { G[k] = contentGate(k); });
  var td = todayTW();
  function dueTxt(d) { if (!d) return ''; var x = d10(d); return G.PRINT_DUE_PAST && x < td ? '（原訂 ' + md(x) + ' 前，已超過；請和醫療團隊重新約定）' : '（' + md(x) + '前）'; }
  var h = '<h1>' + (G.PRINT_TITLE_V492 ? '我的心衰竭行動計畫' : '我的心衰竭一頁行動計畫') + '</h1><p>' + esc(md(today())) + '｜代碼 #' + esc(CUR.rec.short_ref) + '｜醫療團隊電話：' + (phone ? esc(phone) : '＿＿＿＿＿＿＿＿（請醫療團隊寫上）') + '</p>';
  if (pv.changes.length || pv.done.length) h += '<h2>和上次（' + esc(md(pv.last_encounter_date)) + '）相比</h2><ul>' + pv.done.map(function (x) { return '<li>✓ ' + esc(x) + '</li>'; }).join('') + pv.changes.map(function (c) { return '<li>' + esc(c.label) + '：' + esc(c.before) + ' → ' + esc(c.after) + '</li>'; }).join('') + '</ul>';
  /* 4.9.3 WP-A（CARE-PHARM-08）：卡片的「請不要」一律印出（已審核的卡片原文，不新增措辭；4.9.1 只在「不要自行改變」的行動才印） */
  h += '<h2>這次最重要</h2><ol>' + pv.today_actions.map(function (a) { var c = cardForPrint(a.card_id, cg); return '<li><strong>' + esc(c.title) + '</strong>' + (c.action ? (G.PRINT_HOWTO_LINE ? '<br>怎麼做：' : '：') + esc(c.action) : '') +
    /* v4.8 WP-5（H12）：溝通需要「寫下步驟」→ 印出全部步驟（已審核內容）；5.2 F-05：「怎麼做」已印的那一句不重複 */ (pv.communication.written_steps && v5Steps(c).length ? '<ol class="print-steps">' + v5Steps(c).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : '') + esc(dueTxt(a.due_at)) + (a.why.length ? '<br><span style="font-size:11pt">' + (G.PRINT_WHY_LABEL ? '為什麼：' : '因為：') + esc(a.why.join('；')) + '</span>' : '') + (c.do_not ? '<br><span class="print-donot">請不要：' + esc(c.do_not) + '</span>' : '') + '</li>'; }).join('') + '</ol>';
  /* v4.6 WP-B2：其他主題與病人端同一份清單；溝通需要「寫下步驟」時印出每一項的做法，否則只列標題 */
  if ((pv.more || []).length) h += '<h2>其他主題（之後再一起看）</h2><ul id="print_more">' + pv.more.map(function (m) { var c = cardForPrint(m.card_id, cg); return '<li>' + esc(c.title) + (pv.communication.written_steps && c.action ? '：' + esc(c.action) : '') + '</li>'; }).join('') + '</ul>';
  if (pv.medication.status !== 'NO_CHANGE' || pv.medication.items.length) {
    h += '<h2>我的用藥重點</h2>' + (pv.medication.text ? '<p>' + esc(pv.medication.text) + '</p>' : '') + (pv.medication.items.length ? '<ul>' + pv.medication.items.map(function (i) { var mc = medClass(i.med_class); return '<li><strong>' + esc(mc.label || i.med_class) + '</strong>：' + esc(i.facets.filter(function (k) { return mc[k]; }).map(function (k) { return mc[k]; }).slice(0, 2).join(' ')) + '</li>'; }).join('') + '</ul>' : '') + '<p>不要因為這張紙自行開始、停用、換藥或改變劑量。</p>';
  } else h += '<h2>我的用藥</h2><p>' + esc(pv.medication.text) + '</p>';
  if (num('weight_alert_kg') !== null && num('weight_alert_days') !== null) h += '<h2>在家特別注意：體重</h2><p id="print_weight">' + (G.PRINT_WEIGHT_V492 ? '每天早上起床、上完廁所、吃早餐前，用同一台體重計量，寫在記錄表上。' + esc(num('weight_alert_days')) + ' 天內增加 ' + esc(num('weight_alert_kg')) + ' 公斤以上，請當天打電話給醫療團隊。'
    : esc(num('weight_alert_days')) + ' 天內增加 ' + esc(num('weight_alert_kg')) + ' 公斤以上，請打電話給醫療團隊。每天早上起床、上完廁所、吃早餐前量。') +
    (G.PRINT_DRY_WEIGHT && num('dry_weight_kg') !== null ? '醫療團隊記錄的乾體重（身體沒有多餘積水時的體重）約 ' + esc(num('dry_weight_kg')) + ' 公斤。' : '') + '</p>';
  h += '<h2>什麼情況要提早求助</h2>' + pv.safety_floor.map(function (r) { return '<div class="rung"><strong>' + esc(r.headline) + '</strong>：' + esc(r.signals.join('；')) + '</div>'; }).join('');
  /* 4.9.3 WP-A（移植 4.9.2）：下次聯絡（與照護旅程同一份；醫療團隊未開放給病人看的行動不印日期） */
  var nc = CUR.rec.plan && CUR.rec.plan.journey ? CUR.rec.plan.journey.next_contact : null, ncOk = nc && nc.status === 'SCHEDULED' && nc.due_at && nc.patient_visible !== false;
  if (G.PRINT_NEXT_CONTACT && (ncOk || G.PRINT_NEXT_CONTACT_NONE)) h += '<h2>下次聯絡</h2><p id="print_next">' + esc(ncOk ? md(d10(nc.due_at)) + (nc.pt ? '：' + nc.pt : '') + (G.PRINT_DUE_PAST && d10(nc.due_at) < td ? '（已超過；請和醫療團隊重新約定）' : '') : '還沒有排定。請在離開前問醫療團隊：下次回診或電話追蹤是哪一天？') + '</p>';
  if (pv.open.length || pv.questions.length) h += '<h2>下次照護要完成、要問的</h2><ul>' + pv.open.map(function (o) { return '<li>' + esc(o.text) + esc(dueTxt(o.due)) + '</li>'; }).join('') + pv.questions.slice(0, 3).map(function (id) { var c = cardForPrint(id, cg); return c.ask ? '<li>問：' + esc(c.ask) + '</li>' : ''; }).join('') + '</ul>';
  if ((pv.care_plan_results || []).length) h += '<p style="font-size:11pt">' + esc(pv.care_plan_results.map(function (a) { return a.text; }).join(' ')) + '</p>';
  if (pv.limiters.length) h += '<p style="font-size:11pt">' + esc(pv.limiters.map(function (l) { return l.text; }).join(' ')) + '</p>';
  /* 4.9.3 WP-A（移植 4.9.2）：教回（teach-back）確認欄——醫療人員請病人或家屬用自己的話說一次，說對了再打勾 */
  if (G.PRINT_TEACHBACK) h += '<h2>請用自己的話說一次（醫療人員勾選）</h2><p id="print_teachback">□ 這次最重要要做的事是什麼<br>□ 出現哪些情況要打 119、哪些要當天打電話給醫療團隊<br>□ 哪些藥不能自己停、自己換或自己加</p>';
  h += '<p style="font-size:10pt">這張紙依您目前的紀錄整理（計畫 ' + esc(pv.plan_hash.slice(0, 8)) + '），是提醒，不取代醫師的指示；有疑問請問您的醫療團隊。</p>';
  printHtml(h, !!pv.communication.large_print);
}
/* ==================== W5-L begin（5.0 K08-04／K11-01／K11-06）：新版單張——A4 一頁核心＋可選附件頁 ====================
   段落：上次以來學會的（✓）、這次重點（最多 3 件；每件怎麼做／為什麼／請不要）、還要練習的、我的用藥、我的個人數值（已確認才印）、什麼時候要求助（紅黃綠三區；依本次分級展開，其他收合一行）、下次聯絡、教回欄。
   全部是新文字：只對模擬病人（contentGate）；真實病人沿用原本的單張（printPlan）。卡片文字一律引用已審核衛教卡原文，不改字。 */
var V5_LEVEL = { UNDERSTOOD: '知道怎麼做了', CAN_DO: '會做了', DOING: '在家也做到了' };
var V5_ZONE = [['RED', '紅區：立刻求救', ['EMERGENCY', 'URGENT_NOW']], ['YELLOW', '黃區：今天就要處理', ['URGENT_IN_PERSON', 'SAME_DAY']]];
function v5StagePt(code) { var x = lcodes('ladder_stages').filter(function (y) { return y[0] === code; })[0]; return x ? x[2] : ''; }
function v5Schedule() {
  /* K11-06：吃藥時間表——藥師完成用藥整合（pharm_med_review_status＝COMPLETE，藥師記錄、在目前處方之後）才印；否則只說明「等藥師核對」 */
  var F = CUR.rec.view.fields || {}, rv = F.pharm_med_review_status, rx = F.prescribed_meds;
  var ok = rv && rv.value === 'COMPLETE' && rv.provider_role === 'PHARMACIST' && rx && Array.isArray(rx.value) && rx.value.length && String(rv.recorded_at || '') >= String(rx.recorded_at || '');
  if (!ok) return { ok: false, html: '<p id="v5_sched_wait">吃藥時間表要等藥師核對過您的處方和實際用法後才會印出。</p>' };
  /* 處方和實際使用還有不一致（例如自己停了）→ 先不印，等醫療團隊處理完 */
  var pvx = CUR.rec.plan_patient_view;
  if (pvx && pvx.medication && (pvx.medication.items || []).some(function (i) { return (i.statuses || []).indexOf('DISCREPANCY') >= 0; })) return { ok: false, html: '<p id="v5_sched_hold">處方和您實際的吃法還有不一樣的地方，吃藥時間表等醫療團隊確認後再印。</p>' };
  var T = [['MORNING', '早上'], ['NOON', '中午'], ['EVENING', '晚上'], ['BEDTIME', '睡前']];
  var rows = rx.value.filter(function (m) { return m.rx_status !== 'HELD'; }).map(function (m) {
    var at = Array.isArray(m.admin_times) ? m.admin_times : String(m.admin_times || '').split(',').filter(Boolean), u = m.units_per_dose ? m.units_per_dose + ' 顆' : '✓';
    return '<tr><th scope="row">' + esc(ingName(m.ingredient)) + '</th>' + T.map(function (t) { return '<td>' + (at.indexOf(t[0]) >= 0 ? esc(u) : '') + '</td>'; }).join('') + '<td>' + (at.length ? '' : '時段請問藥師') + '</td></tr>'; }).join('');
  return { ok: true, html: '<table id="v5_sched"><thead><tr><th scope="col">藥</th>' + T.map(function (t) { return '<th scope="col">' + t[1] + '</th>'; }).join('') + '<th scope="col">備註</th></tr></thead><tbody>' + rows + '</tbody></table><p style="font-size:9.5pt">藥師核對：' + esc(md(d10(rv.recorded_at))) + '。暫停中的藥不列；不要因為這張表自行改變吃法。</p>' };
}
/* 5.2 F-02：給病人的單張一定要有團隊電話與院方核准的服務資訊（含非服務時間的處理方式）；沒有設定 → 不列印並說明設定位置（fail-closed） */
function printContactBlocked() {
  var fac = CUR.rec.facility_code, miss = [];
  if (!FAC_PHONE[fac]) miss.push('團隊聯絡電話');
  var sv = FAC_SVC[fac]; if (!(sv && sv.owner_role && sv.response_time && sv.hours && sv.after_hours)) miss.push('服務資訊（負責職類、回覆時間、服務時間、非服務時間的處理方式）');
  if (!miss.length) return false;
  $('pt_msg').innerHTML = '<span class="notice err" id="print_contact_block">不能列印給病人的單張：院所「' + esc(FAC_ZH[fac] || fac) + '」尚未設定' + esc(miss.join('、')) + '。單張上要寫明今天怎麼聯絡與非上班時間怎麼辦；請系統管理者到「控制台 → 院所設定」設定。</span>';
  return true;
}
/* 5.2 F-05：「怎麼做」已印出的第一句不在步驟清單重複；同一張單張的「請不要」相同句子只印一次 */
function v5Steps(c) { var a = String(c.action || '').trim(); return (c.steps || []).filter(function (x) { return String(x).trim() !== a; }); }
function v5DoNotOnce(t, seen) { var k = String(t || '').trim(); if (!k || seen[k]) return false; seen[k] = 1; return true; }
/* 5.2 D-03：社工記錄有外籍看護 → 列印可選「外籍看護」（照顧者口吻＋看護教回提醒）；外語版尚未翻譯與雙審，只能印華語版 */
function fcYes() { var f = (CUR.rec.view && CUR.rec.view.fields) || {}, e = f.sw_foreign_caregiver; return !!e && e.value === 'YES'; }
function printPlanV5(opt) {
  if (deadNoPrint()) return;   /* 第二輪獨立複核（G-01 延伸） */
  var pv = CUR.rec.plan_patient_view, phone = FAC_PHONE[CUR.rec.facility_code] || '';
  if (!pv || !pv.v5) { inlineErr('pt_msg', '照護計畫暫時無法產生，無法列印新版單張；請改用「列印給病人的照護計畫」。'); return; }
  if (!contentGate('PRINT_V5')) { inlineErr('pt_msg', '新版單張還在臨床審核，只能用在模擬病人；請改用「列印給病人的照護計畫」。'); return; }
  opt = opt || {}; var appx = opt.appendix !== false && contentGate('PRINT_V5_APPENDIX');
  /* 5.2 F-05：人稱依「這張給誰」（列印時選；預設病人本人，病人需要家人那一份時才用照顧者口吻），不再因「家人有參與」整張改成照顧者口吻 */
  var aud = opt.audience || (($('pv5_who') || {}).value) || 'SELF';
  var V5 = pv.v5, cg = contentGate('PRINT_V52_AUDIENCE') ? (aud === 'CAREGIVER' || aud === 'FOREIGN_CAREGIVER') : pv.communication.caregiver_variant, f = CUR.rec.view.fields || {}, td = todayTW();
  var who = cg ? '病人' : '您', dnSeen = {};
  function dueTxt(d) { if (!d) return ''; var x = d10(d); return x < td ? '（原訂 ' + md(x) + ' 前，已超過；請和醫療團隊重新約定）' : '（' + md(x) + '前）'; }
  var h = '<h1>我的心衰竭行動計畫</h1><p>' + esc(md(today())) + '｜代碼 #' + esc(CUR.rec.short_ref) + '｜醫療團隊電話：' + (phone ? esc(phone) : '＿＿＿＿＿＿＿＿（請醫療團隊寫上）') + (contentGate('PRINT_V51_CONTACT') ? leafContactHtml() : '') + '</p>';
  if (aud === 'FOREIGN_CAREGIVER' && contentGate('PRINT_V52_FOREIGN_CG')) h += '<p id="v5_fcg"><strong>給看護：</strong>這張是華語版（其他語言尚未翻譯，待雙審）。請看護在醫療人員面前示範量體重、記錄與備藥一次；看不懂的地方請醫療團隊說明。</p>';
  /* 5.2 D-03：家裡要改的事（職能治療師評估） */
  if (contentGate('PRINT_V52_HOME_SAFETY') && pv.home_safety && pv.home_safety.items.length) h += '<h2>家裡要改的事（職能治療師建議）</h2><ul id="v5_home_safety">' + pv.home_safety.items.map(function (x) { return '<li>□ ' + esc(x) + '</li>'; }).join('') + '</ul>';
  /* 5.1 W51-LEAF（PR-14）：和上一張不同的地方；沒有變的段落折成一行（不重印） */
  var fold = leafFolded(V5), folded = function (k) { return fold.indexOf(k) >= 0; };
  if (contentGate('PRINT_V51_DIFF')) h += leafDiffHtml(V5, cg, fold);
  /* 1. 上次以來學會的（第一次接觸：今天學會的；同一張卡也還要練習 → 只列一次，標下一步） */
  var knownOn = V5.known.length && !folded('KNOWN');
  if (contentGate('PRINT_V5_LEARNED') && (V5.learned.length || knownOn)) h += '<h2 id="v5_learned_h">' + (contentGate('PRINT_V51_LEARNED') && V5.first_contact ? '今天學會的' : '上次以來學會的') + '</h2><ul id="v5_learned">' + V5.learned.map(function (x) { return '<li data-card="' + esc(x.card_id) + '">✓ ' + esc(cardForPrint(x.card_id, cg).title) + '：' + esc(V5_LEVEL[x.level] || '') + (x.next_stage && contentGate('PRINT_V51_LEARNED') && v5StagePt(x.next_stage) ? '；下一步：' + esc(v5StagePt(x.next_stage)) : '') + '</li>'; }).join('') +
    (knownOn ? '<li id="v5_known">✓ 已經會的，照原本的方式繼續：' + esc(V5.known.map(function (x) { return cardForPrint(x.card_id, cg).title; }).join('、')) + '</li>' : '') + '</ul>';
  /* 2. 這次重點（最多 3 件；安全項目全部列；沒有進展時寫「這次重點／需要協助」） */
  var help = V5.today.some(function (x) { return x.help_needed; }), prep = leafPrep(V5);
  if (contentGate('PRINT_V5_FOCUS')) {
    h += '<h2 id="v5_focus_h">這次重點' + (help ? '／需要協助' : '') + '</h2>';
    /* 5.1 W51-LEAF（NU-07）：用藥清單不明、沒有體重警戒、下次聯絡未排 → 不寫「做得很好」，改列還沒完成的準備 */
    if (!V5.today.length) h += prep.length && contentGate('PRINT_V51_PREP') ? leafPrepHtml(prep) : '<p id="v5_maintain">' + esc(who) + '目前做得很好：這次以維持和確認為主，不需要學新的方法。下面「還要練習的」有需要再看。</p>';
    else {
      h += '<ol id="v5_focus">' + V5.today.map(function (a) { var c = cardForPrint(a.card_id, cg), st = contentGate('PRINT_V5_STAGE') && a.team_scope !== 'ACTION' ? v5StagePt(a.stage) : '';
        return '<li data-card="' + esc(a.card_id) + '" data-stage="' + esc(a.stage) + '" data-progress="' + esc(a.progress_type) + '"><strong>' + esc(c.title) + '</strong>' + (st && a.stage !== 'INTRODUCE' ? '（這次：' + esc(st) + '）' : (a.next_topic ? '（新的主題）' : '')) + (a.help_needed ? '（需要協助）' : '') +
          (c.action ? '<br>怎麼做：' + esc(c.action) : '') + (pv.communication.written_steps && v5Steps(c).length ? '<ol class="print-steps">' + v5Steps(c).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : '') + esc(dueTxt(a.due_at)) +
          (a.why.length ? '<br>為什麼：' + esc(a.why.join('；')) : '') + (c.do_not && v5DoNotOnce(c.do_not, dnSeen) ? '<br><span class="print-donot">請不要：' + esc(c.do_not) + '</span>' : '') + '</li>'; }).join('') + '</ol>';
      if (prep.length && contentGate('PRINT_V51_PREP') && (V5.team || []).some(function (t) { return t.scope === 'CARD'; })) h += leafPrepHtml(prep);   /* 團隊工作卡不列重點，改列它需要的準備 */
    }
  }
  /* 3. 還要練習的（依重要度；超過 3 項另列件數；和上一張相同 → 折疊） */
  if (contentGate('PRINT_V5_PRACTICE') && V5.practice.length && !folded('PRACTICE')) h += '<h2>還要練習的</h2><ul id="v5_practice">' + V5.practice.map(function (x) { var st = contentGate('PRINT_V5_STAGE') ? v5StagePt(x.stage) : ''; return '<li data-card="' + esc(x.card_id) + '">' + esc(cardForPrint(x.card_id, cg).title) + (st ? '：' + esc(st) : '') + '</li>'; }).join('') +
    (V5.practice_more && contentGate('PRINT_V51_PRACTICE_MORE') ? '<li id="v5_practice_more">另有 ' + esc(V5.practice_more) + ' 項，下次再確認</li>' : '') + '</ul>';
  /* 4. 我的用藥：「沒有問題」和「沒有資料」分開寫（K11-01） */
  var M = V5.medication, mt;
  if (M.status === 'ACTION') mt = '這次有和用藥有關的重點（列在上面「這次重點」與下面各類藥）。不要自己停藥、換藥或改劑量；有疑問先問醫師或藥師。';
  else if (M.status === 'NO_CHANGE') mt = M.data_basis === 'RX_AND_USE' ? '已對照醫療團隊登錄的處方和' + who + '實際在吃的藥：這次沒有新的用藥處理重點。請照確認過的方式使用，有疑問時問藥師。'
    : (M.data_basis === 'USE_ONLY' ? '醫療團隊還沒有登錄' + who + '的處方，所以這次還不能確認用藥有沒有問題（不代表沒有問題）；請帶所有藥袋請藥師核對一次。' : '醫療團隊有處方紀錄，但還沒有核對' + who + '實際怎麼吃，所以還不能說用藥沒有問題；請帶所有藥袋請藥師核對一次。');
  else mt = pv.medication.text || '目前的用藥資料不足，這次先不列個別的用藥重點。';
  if (contentGate('PRINT_V5_MED_BASIS') && !folded('MED')) {
    h += '<h2>我的用藥</h2><p id="v5_med" data-basis="' + esc(M.data_basis) + '" data-status="' + esc(M.status) + '">' + esc(mt) + '</p>' + (pv.medication.items.length ? '<ul>' + pv.medication.items.map(function (i) { var mc = medClass(i.med_class); return '<li><strong>' + esc(mc.label || i.med_class) + '</strong>：' + esc(i.facets.filter(function (k) { return mc[k]; }).map(function (k) { return mc[k]; }).slice(0, 2).join(' ')) + '</li>'; }).join('') + '</ul>' : '') +
      '<p style="font-size:9.5pt">不要因為這張紙自行開始、停用、換藥或改變劑量。</p>';
  }
  /* 5.2 F-01：我的藥（醫療團隊登錄的處方；與病人連結同一個組法 C.myMedRows；待臨床雙審，只對模擬病人） */
  var myM = (pv.medication && pv.medication.my_meds) || [];
  if (contentGate('PRINT_V52_MY_MEDS') && myM.length && catalog().myMedRows) h += '<h2>我的藥（醫療團隊登錄的處方）</h2><table id="v5_mymeds"><thead><tr><th scope="col">藥名</th><th scope="col">做什麼用</th><th scope="col">怎麼吃</th><th scope="col">要注意</th></tr></thead><tbody>' +
    catalog().myMedRows(myM).map(function (r) { return '<tr data-ing="' + esc(r.ingredient) + '"><th scope="row">' + esc(r.name) + (r.held ? '（先暫停）' : '') + '</th><td>' + esc(r.use) + '</td><td>' + esc([r.dose, r.times].filter(Boolean).join('，')) + (r.dose || r.times ? '；' : '') + esc(r.how) + '</td><td>' + esc(r.notice) + '</td></tr>'; }).join('') + '</tbody></table>';
  /* 5. 我的個人數值（醫療團隊已確認才印；5.1 W51-LEAF：沒有體重警戒 → 印空格請醫療團隊填，附件附 14 天表；乾體重標訂定日） */
  var weightBlank = false;
  if (contentGate('PRINT_V5_VALUES')) {
    /* 5.2 F-05：個人數值（體重警戒、乾體重）是醫療團隊訂的計畫值——醫療人員記錄（量測或確認）的都算，與病人連結頁同一個來源；病人自述的不算 */
    var vf = function (fid) { var e = f[fid]; return e && typeof e.value === 'number' && ['CLINICIAN_OBSERVED', 'CLINICIAN_VERIFIED'].indexOf(e.source_type) >= 0 ? e.value : null; }, vals = [];
    if (vf('weight_alert_kg') !== null && vf('weight_alert_days') !== null) vals.push('體重：' + vf('weight_alert_days') + ' 天內增加 ' + vf('weight_alert_kg') + ' 公斤以上，請當天打電話給醫療團隊（每天早上起床、上完廁所、吃早餐前量）。');
    else if (contentGate('PRINT_V51_WEIGHT_BLANK')) { weightBlank = true; vals.push('醫療團隊還沒有確認' + who + '的個人數值，請醫療團隊在空格填上：體重在 ＿＿ 天內增加 ＿＿ 公斤，請當天打電話給醫療團隊（每天早上起床、上完廁所、吃早餐前量）。'); }
    if (vf('dry_weight_kg') !== null) vals.push('醫療團隊記錄的乾體重（身體沒有多餘積水時的體重）約 ' + vf('dry_weight_kg') + ' 公斤' + (contentGate('PRINT_V51_DRY_DATE') ? leafDryNote(V5.dry_weight) : '') + '。');
    h += '<h2>我的個人數值</h2><p id="v5_values"' + (weightBlank ? ' data-weight="BLANK"' : '') + '>' + (vals.length ? esc(vals.join(' ')) : '醫療團隊還沒有確認' + who + '的個人數值（例如體重標準），所以這裡先不印；請問醫療團隊。') + '</p>';
  }
  /* 6. 什麼時候要求助（5.1 W51-LEAF（NU-01）：紅區＋黃區「今天聯絡」固定展開、每項一行、本次警訊加粗；只有「今天請人陪您去看醫師」可收合到附件） */
  var focus = V5.safety_focus || ['EMERGENCY'], floor = pv.safety_floor || [], byLv = {}; floor.forEach(function (r) { byLv[r.level] = r; });
  var collapsed = appx ? floor.filter(function (r) { return focus.indexOf(r.level) < 0; }) : [];
  if (contentGate('PRINT_V5_ZONES') && contentGate('PRINT_V51_ZONES')) h += leafZonesHtml(V5, floor, collapsed);
  else if (contentGate('PRINT_V5_ZONES')) {
    h += '<h2>什麼時候要求助</h2><div id="v5_help">' + V5_ZONE.map(function (z) {
      var lvls = z[2].filter(function (l) { return byLv[l] && collapsed.indexOf(byLv[l]) < 0; });
      return lvls.length ? '<div class="rung" data-zone="' + z[0] + '"><strong>' + esc(z[1]) + '</strong>' + lvls.map(function (l) { return '<br><strong>' + esc(byLv[l].headline) + '</strong>：' + esc(byLv[l].signals.join('；')); }).join('') + '</div>' : ''; }).join('') +
      (collapsed.length ? '<p id="v5_help_more">其他情況（' + esc(collapsed.map(function (r) { return r.headline; }).join('、')) + '）的完整清單見附件。</p>' : '') +
      '<div class="rung" data-zone="GREEN"><strong>綠區：照計畫做</strong><br>沒有上面的情況：照這張紙的重點做，下次聯絡時再一起看。</div></div>';
  } else h += '<h2>什麼情況要提早求助</h2>' + floor.map(function (r) { return '<div class="rung"><strong>' + esc(r.headline) + '</strong>：' + esc(r.signals.join('；')) + '</div>'; }).join('');
  /* 7. 下次聯絡 */
  var nc = CUR.rec.plan && CUR.rec.plan.journey ? CUR.rec.plan.journey.next_contact : null, ncOk = nc && nc.status === 'SCHEDULED' && nc.due_at && nc.patient_visible !== false;
  h += '<h2>下次聯絡</h2><p id="v5_next">' + esc(ncOk ? md(d10(nc.due_at)) + (nc.pt ? '：' + nc.pt : '') + (d10(nc.due_at) < td ? '（已超過；請和醫療團隊重新約定）' : '') : '還沒有排定。請在離開前問醫療團隊：下次回診或電話追蹤是哪一天？') + '</p>';
  /* 8. 教回欄（開放式：請病人用自己的話說；醫療人員勾病人的回答）。5.1 W51-LEAF：題目與評估畫面收尾區同一份（leafTbRows）；固定的求救題記在「今天聯絡」卡的「什麼情況要提早求助」 */
  if (contentGate('PRINT_V5_TB_OPEN')) {
    h += '<h2>請用自己的話說一次（醫療人員記錄）</h2><table id="v5_tb"><tbody>' + leafTbRows(V5).map(function (q) { return '<tr' + (q.tbi ? ' data-tbi="' + esc(q.tbi) + '"' : ' data-card="' + esc(q.card_id) + '"') + '><td>' + esc(q.q) + '<br>病人怎麼說：＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿</td><td style="white-space:nowrap">□ 說對　□ 部分對　□ 說錯<br>□ 已重新說明，之後：□ 說對　□ 仍不清楚</td></tr>'; }).join('') + '</tbody></table>';
  }
  h += '<p style="font-size:9pt">這張紙依' + esc(who) + '目前的紀錄整理（計畫 ' + esc(pv.plan_hash.slice(0, 8)) + '），是提醒，不取代醫師的指示；有疑問請問醫療團隊。</p>';
  /* 附件頁：求救清單（第 1 頁已展開的不重印）＋14 天體重表（沒有體重警戒時）＋吃藥時間表（藥師核對後才印） */
  if (appx) {
    var sc = contentGate('PRINT_V5_MED_SCHEDULE') ? v5Schedule() : null;
    h += '<div class="v5-appendix" id="v5_appendix"><h2>附件：什麼時候要求助（完整清單）</h2>' + (contentGate('PRINT_V51_ZONES') ? leafAppendixHelp(floor, collapsed) : floor.map(function (r) { return '<div class="rung"><strong>' + esc(r.headline) + '</strong>：' + esc(r.signals.join('；')) + '</div>'; }).join('')) +
      (weightBlank ? leafDiaryHtml() : '') + (sc ? '<h2>附件：吃藥時間表</h2>' + sc.html : '') + '</div>';
  }
  PRINT_V5_NEXT = true;
  printHtml(h, !!pv.communication.large_print);
}
var PRINT_V5_NEXT = false;
/* ==================== W5-L end ==================== */
function printHtml(h, large) {
  $('print_plan').innerHTML = h;
  $('print_plan').classList.toggle('large', !!large);
  $('print_plan').classList.toggle('v5', PRINT_V5_NEXT); PRINT_V5_NEXT = false;   /* W5-L：新版單張的精簡版面 */
  document.body.classList.add('printing-plan');
  var done = function () { document.body.classList.remove('printing-plan'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1000);
}
/* 4.9.3 WP-A（CARE-NEW-04）：病人偏好語言不是華語、或需要唸讀／通譯 → 列印前提醒醫療人員（單張內容不變，仍是中文） */
function interpNote() {
  var f = CUR.rec.view.fields || {}, lang = f.comm_preferred_language ? f.comm_preferred_language.value : null, sup = f.comm_support_needs && Array.isArray(f.comm_support_needs.value) ? f.comm_support_needs.value : [];
  var other = lang && ['MANDARIN', 'UNKNOWN', 'UNSURE'].indexOf(lang) < 0, help = sup.filter(function (x) { return x === 'READ_ALOUD' || x === 'INTERPRETER'; });
  if (!other && !help.length) return '';
  var L = field('comm_preferred_language').enum_labels || {}, S = field('comm_support_needs').enum_labels || {};
  return '此單張為中文：' + (other ? '請以' + (lang === 'OTHER' ? '病人偏好的語言' : (L[lang] || lang)) + '口頭說明或使用通譯' : '請唸給病人聽或使用通譯') + (help.length ? '（溝通需要：' + help.map(function (x) { return S[x] || x; }).join('、') + '）' : '') + '，並在衛教歷程記錄說明方式。';
}
function deadNoPrint() {
  var pv = CUR && CUR.rec && CUR.rec.plan_patient_view;
  if (!pv || !pv.closed_for || pv.closed_for.reason !== 'DEATH_VERIFIED') return false;
  $('pt_msg').innerHTML = '<span class="notice" id="print_closed">已核實死亡：不列印衛教單張（撤回死亡紀錄後恢復）。</span>'; return true;
}
function printPlanCheck() {
  var n = interpNote();
  if (n && !CUR.interpAck) { $('pt_msg').innerHTML = '<span class="notice warn" id="interp_note">' + esc(n) + ' <button class="btn small" type="button" data-act="print_plan_go">我知道了，列印</button></span>'; return; }
  printPlan();
}
/* 4.9.3 WP-A（CARE-PCP-03）：給基層／居家團隊的轉銜摘要（專業對專業；只讀畫面上已載入的紀錄，不另產生判斷）。
   不印姓名與完整病歷號（姓名欄留空手寫），只印短代碼；頁尾印計畫雜湊與列印時間 */
function printTransition() {
  var v = CUR.rec.view, F = v.fields || {}, P = CUR.rec.plan || {}, phone = FAC_PHONE[CUR.rec.facility_code] || '';
  var V4M = (CUR.rec.v4 && CUR.rec.v4.sections && CUR.rec.v4.sections.meds) || null, D4 = {}; ((V4M && V4M.dose_rows) || []).forEach(function (x) { D4[x.ingredient] = x; });
  function val(fid) { var e = F[fid]; return e && e.value !== null && e.value !== undefined && e.value !== '' ? e : null; }
  function lab(fid, nm) { var e = val(fid); return '<li>' + esc(nm) + '：' + (e && e.verification_state === 'VERIFIED' ? esc(fmtVal(fid, e.value)) + '（' + esc(d10(e.effective_at || e.recorded_at)) + '）' : '沒有已確認的數值') + '</li>'; }
  var rx = val('prescribed_meds') ? val('prescribed_meds').value : [];
  var h = '<h1>心衰竭轉銜摘要（給基層／居家照護團隊）</h1><p>病人代碼 #' + esc(CUR.rec.short_ref) + '｜姓名：＿＿＿＿＿＿＿＿（手寫）｜院所：' + esc(FAC_ZH[CUR.rec.facility_code] || CUR.rec.facility_code || '') + (phone ? '｜聯絡電話：' + esc(phone) : '') + '</p>';
  h += '<h2>目前處方</h2>' + (rx.length ? '<ul id="tr_rx">' + rx.map(function (m) { var d = D4[m.ingredient]; return '<li>' + esc(ingName(m.ingredient)) + (m.rx_status === 'HELD' ? '（暫停中，' + esc(md(m.reassess_on)) + ' 重新評估）' : '') + '：' + esc([m.strength, m.dose, m.frequency].filter(Boolean).join(' ') || '未記劑量頻次') + (d && d.daily_mg !== null && d.daily_mg !== undefined ? '｜每日 ' + esc(d.daily_mg) + ' mg' : '') + (Array.isArray(m.admin_times) && m.admin_times.length ? '｜' + esc(m.admin_times.join('、')) : '') + '</li>'; }).join('') + '</ul>' : '<p>沒有處方紀錄。</p>');
  var dw = val('dry_weight_kg'), wk = val('weight_alert_kg'), wd = val('weight_alert_days');
  h += '<h2>體重計畫</h2><p>乾體重：' + (dw ? esc(dw.value) + ' 公斤' : '未記錄') + '｜警戒：' + (wk && wd ? esc(wd.value) + ' 天內增加 ' + esc(wk.value) + ' 公斤以上' : '未設定') + '</p>';
  h += '<h2>最近已確認的檢驗</h2><ul>' + lab('potassium_mmol_l', '血鉀') + lab('scr_mg_dl', 'SCr') + lab('egfr_ml_min', 'eGFR') + '</ul>';
  var presc = ((ME.role_policy || {}).prescriber_roles) || [], owners = ['PHARMACIST'].concat(presc).map(function (r) { return ROLE_ZH[r] || r; }).join('、');
  var mon = ((P.medication || {}).monitoring || []).filter(function (o) { return ['DUE', 'OVERDUE', 'RESULTED', 'RESULT_CONFLICTED', 'REPEAT_DUE'].indexOf(o.status) >= 0; });
  h += '<h2>下次檢驗追蹤</h2>' + (mon.length ? '<ul>' + mon.map(function (o) { return '<li>血鉀／腎功能：' + esc((MON_ZH[o.status] || [o.status])[0]) + '（追蹤日 ' + esc(md(o.due_at)) + '）｜負責：' + esc(owners) + '</li>'; }).join('') + '</ul>' : '<p>沒有待追蹤的檢驗。</p>');
  var nc = P.journey ? P.journey.next_contact : null;
  h += '<h2>下次聯絡</h2><p>' + esc(nc ? (nc.status === 'SCHEDULED' ? md(nc.due_at) + ' ' + nc.clin + (nc.owner_role ? '（' + (ROLE_ZH[nc.owner_role] || nc.owner_role) + '）' : '') : nc.clin) : '未排定') + '</p>';
  var acts = Object.keys(v.actions || {}).map(function (k) { return v.actions[k]; }).filter(function (a) { return ['COMPLETED', 'NOT_DONE', 'CANCELED'].indexOf(a.action_status) < 0; });
  h += '<h2>尚未完成的行動</h2>' + (acts.length ? '<ul id="tr_acts">' + acts.map(function (a) { return '<li>' + esc(actName(a)) + '｜' + esc(ROLE_ZH[a.owner_role] || a.owner_role) + '｜' + esc(AST_ZH[a.action_status] || a.action_status) + (a.due_at ? '｜' + esc(md(a.due_at)) + ' 前' : '') + '</li>'; }).join('') + '</ul>' : '<p>沒有。</p>');
  var acp = ['goals_of_care_status', 'screen_acp', 'acp_documents'].filter(function (k) { return DICT.fields[k] && val(k); });
  h += '<h2>預立醫療照護／照護目標</h2><p>' + (acp.length ? acp.map(function (k) { return esc(field(k).label) + '：' + esc(fmtVal(k, F[k].value)); }).join('；') : '未記錄') + '</p>';
  h += '<p style="font-size:10pt" id="tr_foot">本摘要依系統紀錄整理，不取代病歷與醫囑；計畫 ' + esc(String(P.plan_hash || '').slice(0, 8) || '（無）') + '｜列印 ' + esc(todayTW()) + ' ' + esc(hm(new Date().toISOString())) + '</p>';
  printHtml(h, false);
}

/* ---------- 事件 ---------- */
function onClick(ev) {
  var t = ev.target.closest ? ev.target.closest('[data-act],[data-tab]') : null; if (!t) return;
  if (CUR && t.closest && t.closest('#pt')) enc().clicks++;   /* 5.0 W5-C（K07-06）：病人頁的操作點選次數 */
  if (t.hasAttribute('data-tab')) { switchTab(t.getAttribute('data-tab')); return; }
  var act = t.getAttribute('data-act'), val = t.getAttribute('data-val');
  if (act && act.indexOf('t_') === 0 && teachAct(act, val)) return;
  if (act && act.indexOf('ask51_') === 0 && ask51Act(act, val)) return;   /* 5.1 W51-ASK：一鍵確認 */
  if ((act === 'sd_sig_ok' || act === 'sd_sig_undo') && sameDaySignalAct(act)) return;   /* 5.2 C-01 */
  if (act === 'ap_filter') { AP.filter = val; renderApprovals(); return; }
  if (act === 'ap_archive') { var why = (($('ap_archive_why') || {}).value || '').trim(), m = $('ap_archive_msg'); if (why.length < 8) { if (m) m.textContent = '請寫封存理由（至少 8 個字）。'; return; }
    call('approvalLedgerArchive', [why]).then(function (r) { if (m) m.textContent = '已封存為 ' + r.archived_as + '；所有項目回到待核准。'; loadApprovals(); }).catch(function (e) { if (m) m.textContent = (e && e.message) || '封存失敗'; }); return; }
  if (act === 'ap_approve' || act === 'ap_revoke') { apAct(act, val); return; }   /* 5.3 S1 */
  switch (act) {
    case 'register': register(); break;
    case 'join': join(); break;
    case 'open': if (TAB !== 'patients') switchTab('patients'); openPatient(val); break;
    case 'reload': openPatient(CUR.pk, true); break;
    case 'leave_team':
      if (!window.confirm('確定要離開這位病人的照護團隊？')) break;
      call('leaveCareTeam', [CUR.pk, $('leave_reason').value]).then(function (r) { CUR = null; $('pt').innerHTML = '<section class="panel"><p class="notice">已離開照護團隊（團隊目前還有 ' + esc(r.remaining_members) + ' 位成員）。</p></section>'; loadMine(); })
        .catch(function (e) { inlineErr('pt_msg', errText(e)); });
      break;
    case 'reload_keep': openPatient(CUR.pk, true); break;
    /* 5.0 W5-C：病人自述一鍵確認（K07-03）、本職欄位整段沿用（K07-04）、久未聯絡逐項重新檢視（K09-02） */
    case 'prefill_ok': stagePatientPrefill(); break;
    case 'bulk_ok': stageBulk(); break;
    case 'rv_keep': reviewKeep(val); break;
    case 'rv_drop': reviewDrop(val); break;
    case 'print': window.print(); break;
    /* 4.9.3 WP-A：略過今日警訊要選理由；下次聯絡：當場建立或選暫不安排的理由 */
    case 'sh_ack_save': { var so = ($('sh_ack_out') || {}).value || '', sw = ($('sh_ack_whom') || {}).value || '', sm = ($('sh_ack_mode') || {}).value || '';
      if (!so) { inlineErr('sh_ack_err', '請選警訊處理結果，或選「稍後在警訊卡記錄」。'); break; }
      if (['CONTACTED_ADVISED', 'ADVISED_ED'].indexOf(so) >= 0 && (!sw || !sm)) { inlineErr('sh_ack_err', '已聯絡或請病人就醫時，請選聯絡對象與方式。'); break; }
      enc().sh_ack = { outcome: so, detail: sw || sm ? { contacted_whom: sw, contact_mode: sm } : {} }; save(); break; }
    case 'save_skip_safety': { var sk = $('skip_safety_reason') ? $('skip_safety_reason').value : ''; if (!sk) { inlineErr('skip_safety_err', '請先選擇這次不評估警訊的理由。'); if ($('skip_safety_reason')) $('skip_safety_reason').focus(); break; } enc().skip_safety = sk; save(); break; }
    case 'nc_defer': { var dr = $('nc_defer') ? $('nc_defer').value : ''; if (!dr) { inlineErr('nc_err', '請先選擇暫不安排的理由，或填日期建立下次聯絡。'); break; } enc().next_contact_ok = true; enc().next_contact_defer = dr; save(); break; }
    case 'nc_create': { var nd = $('nc_due') ? $('nc_due').value : '', no = $('nc_owner') ? $('nc_owner').value : ''; if (!nd || nd < todayTW()) { inlineErr('nc_err', '請填今天以後的下次聯絡日期。'); break; }
      var na = { action_type: 'FOLLOWUP_VISIT', action_status: 'PLANNED', owner_role: no || ME.role, patient_visible: true, due_at: nd }; if (unreachable(na.owner_role)) na.handoff_delivery = 'OUT_OF_SYSTEM_NOTIFIED';
      ST.ac.push(na); enc().next_contact_ok = true; afterStage(); save(); break; }
    case 'confirm': stageConfirm(val); break;
    case 'unknown': stageUnknown(val); break;
    case 'suggest': stageSuggested(val); break;
    case 'prefill': stagePrefill(val); break;
    case 'edit': CUR.editing = val; CUR.tab = val === 'prescribed_meds' ? 'meds' : (CUR.tab === 'data' || (CUR.rec.ask && wbFields().indexOf(val) < 0) ? 'data' : 'assess'); if (CUR.tab === 'data' && CUR.dataQ && (field(val).label + ' ' + val).toLowerCase().indexOf(CUR.dataQ.toLowerCase()) < 0) CUR.dataQ = ''; renderPatient(); var el = $('ed_val'); if (el && el.focus) el.focus(); break;
    case 'ed_cancel': CUR.editing = null; renderPatient(); break;
    case 'ed_ok': stageFromEditor(val); break;
    case 'unstage': delete ST.obs[val]; psy_afterStage(val, null); afterStage(); if (!stagedCount()) sync('IDLE'); break;   /* 5.1 W51-PSY（PS-09）：取消心理追蹤安排 → 一併移除預填的追蹤行動 */
    case 'unstage_ce': ST.ce.splice(Number(val), 1); afterStage(); break;
    case 'unstage_ac': ST.ac.splice(Number(val), 1); afterStage(); break;
    case 'unstage_co': ST.co.splice(Number(val), 1); afterStage(); break;
    case 'unstage_ed': ST.ed.splice(Number(val), 1); afterStage(); break;
    case 'edu_stage': stageEdu(val, t.getAttribute('data-msg')); break;
    case 'quick_ref': quickRef(val); break;
    case 'ptab': CUR.tab = val; CUR.editing = null; renderPatient(); var tb = document.querySelector('[data-act="ptab"][data-val="' + val + '"]'); if (tb) tb.focus(); break;
    case 'cmm_propose': { var cc = $('cmm_cat'), ci = $('cmm_ing'); if (!cc || !ci || !ci.value) { inlineErr('save_out', '請先選擇藥品（目前處方內）。'); break; }
      ST.v4.push({ table: 'PHARM_INTERVENTIONS', source_type: 'CLINICIAN_VERIFIED', observed_at: todayTW(), intervention_id: 'INT-' + Date.now().toString(36), category: cc.value, ingredient: ci.value, stage: 'INTERVENTION_PROPOSED', label: '藥事介入：' + cc.options[cc.selectedIndex].text + '｜' + ingName(ci.value) }); afterStage(); break; }
    case 'unstage_v4': ST.v4.splice(Number(val), 1); afterStage(); break;
    case 'cfs_stage': { var cv = Number(($('cfs_v') || {}).value); if (!(cv >= 1 && cv <= 9 && Math.floor(cv) === cv)) { inlineErr('save_out', 'CFS 請填 1–9 的整數。'); break; }
      ST.v4.push({ table: 'INSTRUMENT_RESPONSES', source_type: 'CLINICIAN_OBSERVED', observed_at: todayTW(), instrument_id: 'CFS', instrument_version: '2.0', score_value: cv, label: 'CFS ' + cv }); afterStage(); break; }
    case 'phq9_stage': { var pa = []; document.querySelectorAll('#phq9_f [data-phq]').forEach(function (x) { pa[Number(x.getAttribute('data-phq'))] = x.value === '' ? null : Number(x.value); });
      if (pa.every(function (x) { return x === null; })) { inlineErr('save_out', 'PHQ-9 請至少作答一題。'); break; }
      ST.v4.push({ table: 'INSTRUMENT_RESPONSES', source_type: 'CLINICIAN_OBSERVED', observed_at: todayTW(), instrument_id: 'PHQ-9', instrument_version: '1', item_responses: JSON.stringify(pa), label: 'PHQ-9 逐題作答（' + pa.filter(function (x) { return x !== null; }).length + '／9 題）' + (typeof pa[8] === 'number' && pa[8] > 0 ? '｜第 9 題大於 0' : '') }); afterStage(); break; }
    case 'inh_stage': { var ia = []; document.querySelectorAll('#inh_f [data-inh]').forEach(function (x) { ia[Number(x.getAttribute('data-inh'))] = x.checked ? 1 : 0; });
      ST.v4.push({ table: 'INSTRUMENT_RESPONSES', source_type: 'CLINICIAN_OBSERVED', observed_at: todayTW(), instrument_id: 'I_NEED_HELP', instrument_version: 'ESC2026_T15', item_responses: JSON.stringify(ia), label: 'I-NEED-HELP 訊號（' + ia.filter(Boolean).length + ' 項）' }); afterStage(); break; }
    case 'rxb_resp': { var rz = JSON.parse(val), rk2 = rz.hazard + '_' + rz.ingredient, rc2 = $('rxbrc_' + rk2), nc2 = $('rxbnc_' + rk2), e2 = $('rxberr_' + rk2);
      if (e2) e2.textContent = '';
      if (rc2.value === 'DECLINED_WITH_REASON' && !(nc2 && nc2.value)) { if (e2) e2.textContent = '保留請選理由。'; if (nc2) nc2.focus(); break; }
      var rw = { table: 'PHARM_INTERVENTIONS', source_type: 'CLINICIAN_VERIFIED', observed_at: todayTW(), intervention_id: 'HZ-' + Date.now().toString(36), category: 'DEPRESCRIBING_CANDIDATE', ingredient: rz.ingredient,
        stage: 'PRESCRIBER_RESPONDED', about_ref: 'HF_HAZARD:' + rz.hazard, response_code: rc2.value, label: '開立醫師回覆：' + ingName(rz.ingredient) + '｜' + (CMM_RC_ZH[rc2.value] || rc2.value) };
      if (rc2.value === 'DECLINED_WITH_REASON') { rw.note_code = nc2.value; rw.label += '（' + mcZh('decline_reasons', nc2.value) + '）'; }
      ST.v4.push(rw); afterStage(); break; }
    case 'cmm_next': { var cn = JSON.parse(val); cn.table = 'PHARM_INTERVENTIONS'; cn.source_type = 'CLINICIAN_VERIFIED'; cn.observed_at = todayTW();
      if (cn.stage === 'PRESCRIBER_RESPONDED') { var rcs = $('cmm_rc_' + cn.intervention_id), ncs = $('cmm_nc_' + cn.intervention_id); cn.response_code = rcs ? rcs.value : '';
        if (cn.response_code === 'DECLINED_WITH_REASON') { if (!ncs || !ncs.value) { inlineErr('save_out', '「不同意（有理由）」請選理由。'); break; } cn.note_code = ncs.value; } }
      cn.label = '藥事介入：' + cn.stage; ST.v4.push(cn); afterStage(); break; }
    case 'ref_new': { var rk = $('ref_k'); ST.v4.push({ table: 'REFERRAL_EVENTS', source_type: 'CLINICIAN_VERIFIED', observed_at: todayTW(), referral_id: 'REF-' + Date.now().toString(36), referral_kind: rk.value, state: 'CREATED', label: '轉介：' + rk.options[rk.selectedIndex].text }); afterStage(); break; }
    case 'ref_stage': { var rv = JSON.parse(val), rr = $('ref_r'); if ((rv.state === 'DECLINED' || rv.state === 'FAILED') && !(rr && rr.value)) { inlineErr('save_out', '退回或未送達請先選擇理由。'); break; }
      if (rr && rr.value && (rv.state === 'DECLINED' || rv.state === 'FAILED')) rv.state_reason = rr.value; rv.table = 'REFERRAL_EVENTS'; rv.source_type = 'CLINICIAN_VERIFIED'; rv.observed_at = todayTW(); rv.label = '轉介 ' + rv.referral_id + '：' + rv.state; ST.v4.push(rv); afterStage(); break; }
    case 'vax_stage': { var vv = $('vx_v'), vs = $('vx_s'), vd = $('vx_d'), vsrc = $('vx_src'); var vr = { table: 'VACCINATION_EVENTS', source_type: vsrc.value, observed_at: todayTW(), vaccine: vv.value, vacc_status: vs.value, label: '疫苗：' + VAX_ZH[vv.value] + ' ' + VST_ZH[vs.value] };
      if (vd && vd.value) { if (vd.value > todayTW()) { inlineErr('save_out', '接種日不能是未來日期。'); break; } vr.administered_on = vd.value; } ST.v4.push(vr); afterStage(); break; }
    case 'tr_stage': { var tv = JSON.parse(val); tv.table = 'TRANSITION_EVENTS'; tv.source_type = 'CLINICIAN_VERIFIED'; tv.observed_at = tv.observed_at || todayTW(); ST.v4.push(tv); afterStage(); break; }
    case 'tr_contact': { var sel = $('tr_ct_' + val), ctd = $('tr_cd_' + val); if (!sel || !sel.value) { inlineErr('save_out', '請先選擇聯絡結果。'); break; }
      ST.v4.push({ table: 'TRANSITION_EVENTS', source_type: 'CLINICIAN_VERIFIED', event_kind: 'CONTACT_ATTEMPT', plan_id: val, outcome_code: sel.value, observed_at: (ctd && ctd.value) || todayTW(), label: '轉銜聯絡：' + (TR_CT_ZH[sel.value] || sel.value) }); afterStage(); break; }
    case 'discard': if (window.confirm('放棄這次所有尚未儲存的變更？')) { ST = { obs: {}, ce: [], ac: [], co: [], ed: [], resolves: [], v4: [] }; resetEnc(); sync('IDLE'); renderPatient(); } break;
    case 'save': save(); break;
    case 'parked_take': takeParked(val); break;
    case 'parked_drop':
      if (!window.confirm('捨棄這筆待確認的輸入？（原始紀錄仍會保留，只是不套用）')) return;
      call('dismissParked', [CUR.pk, val]).then(function () { openPatient(CUR.pk, true); }).catch(function (e) { inlineErr('pt_msg', errText(e)); });
      break;
    case 'ce_add': addCe(); break;
    case 'death_retract': ST.ce.push({ event_type: 'DEATH_RECORD_RETRACTED', occurred_at: today(), source_type: 'CLINICIAN_VERIFIED', supersedes_event_id: val, note_code: ($('dr_' + val) || {}).value || 'ENTERED_IN_ERROR', hf_related: 'UNSURE' }); afterStage(); break;
    case 'rehab_add': rehabAdd(); break;
    case 'ac_upd': updAction(val); break;
    case 'ac_redirect': redirectAction(val); break;
    case 'mon_review': stageLinked('MON', val); break;
    case 'disc_resolve': stageLinked('DISC', val); break;
    case 'ac_resched': reschedAction(val); break;
    case 'ac_vis': { var vsel = $('avis_' + val), va = CUR.rec.view.actions[val]; if (!vsel || !vsel.value) { inlineErr('save_out', '請先選擇可見度理由。'); break; } ST.ac.push({ action_id: val, action_status: va.action_status, change_reason: vsel.value }); afterStage(); break; }
    case 'edu_handoff': stageEduHandoff(val); break;
    case 'goto_action': CUR.tab = 'care'; CUR.editing = null; renderPatient(); focusTarget({ ref: 'act:' + val }); break;
    case 'ac_ack': { var ka = CUR.rec.view.actions[val]; ST.ac.push({ action_id: val, action_status: ka.action_status, change_reason: ka.result_code === 'NEED_TALK' ? 'DISCUSSION_COMPLETED' : 'RESULT_ACKNOWLEDGED' }); afterStage(); break; }
    case 'ac_takeover': { var ta = CUR.rec.view.actions[val]; ST.ac.push({ action_id: val, action_status: ta.action_status, change_reason: ME.role === ta.owner_role ? 'TAKEOVER_ABSENT' : 'TAKEOVER_COORDINATOR' }); afterStage(); break; }
    case 'ac_continue': ST.ac.push({ action_id: val, action_status: CUR.rec.view.actions[val].action_status, change_reason: 'CONTINUE_AFTER_READMISSION' }); afterStage(); break;
    case 'ac_new': newAction(); break;
    case 'bundle_dc': bundleDischarge(); break;
    case 'ack': ackAlert(val, function () { if (TAB === 'work') loadWorklist(); else openPatient(CUR.pk, true, true); }); break;
    case 'print_plan': if (printContactBlocked()) break; printPlanCheck(); break;
    case 'print_plan_go': if (printContactBlocked()) break; CUR.interpAck = true; printPlan(); break;
    case 'print_plan_v5': if (printContactBlocked()) break; printPlanV5({ appendix: !$('pv5_appx') || $('pv5_appx').checked }); break;   /* W5-L：新版單張（只對模擬病人） */
    case 'print_transition': printTransition(); break;
    case 'wl_filter': WL_FILTER = val; renderWorklist(); break;
    case 'wl_mine': WL_MINE = !!val; renderWorklist(); break;
    case 'wl_page': WL_OFFSET = Number(val) || 0; WL_SCROLL = 0; loadWorklist(); break;
    case 'wl_go': wlGo(val); break;
    case 'wl5_go': wl5Go(val); break;
    case 'wl5_defer': wl5Defer(val); break;
    case 'wl5_mine': WL5_MINE = !!val; renderWorklist(); break;
    case 'med_from_rx': (function () {
      var root = $(val); if (!root) return;
      ((CUR.rec.view.fields.prescribed_meds || {}).value || []).forEach(function (m) {
        var box = root.querySelector('.med_item input[type=checkbox][value="' + m.ingredient + '"]'); if (!box) return;
        /* 3.3（ZT-A-006／REG-A-015）：只帶入「要問哪幾顆」；狀態不預設「在吃」、用法不複製處方（處方用法只當提示）——
           沒有逐項問過病人的不會變成實際使用，也不會產生假的「一致」 */
        var row = box.closest('.med_item'); box.checked = true;
        var st = row.querySelector('.med_st'); if (st && !st.value) st.value = '';
        ['strength', 'dose', 'frequency'].forEach(function (k) { var x = row.querySelector('.rg_' + k); if (x && !x.value && m[k]) x.placeholder = '處方：' + m[k]; });
      });
      t.textContent = '已列出處方上的藥：請逐項問病人實際的狀態與吃法（不會自動當成「在吃」）';
    })(); break;
    case 'med_all_same': { var mr = $(val); if (mr) medSame(mr, null); break; }
    case 'med_same_row': { var mr2 = t.closest('[data-kind="meds"]'); if (mr2) medSame(mr2, [val]); break; }
    case 'back_to_work': switchTab('work'); break;
    case 'co_upd': var s = $('cst_' + val).value; if (s) { ST.co.push({ concern_id: val, status: s }); afterStage(); } break;
    case 'co_new': ST.co.push({ concern_code: $('nc_code').value, status: 'OPEN' }); afterStage(); break;
    case 'rx_edit': CUR.editing = 'prescribed_meds'; CUR.tab = 'meds'; renderPatient(); break;
    case 'rx_ok': var rxv = readMeds($('rx_ed'), false), bh = rxv.filter(function (m) { return m.rx_status === 'HELD' && (!m.hold_reason || !m.reassess_on); });
      if (bh.length) { inlineErr('pt_msg', '暫停中的藥要寫暫停原因與重新評估日：' + bh.map(function (m) { return ingName(m.ingredient); }).join('、')); break; }
      /* 3.1.0：有前一份處方時，開始、恢復、停用都要選理由（處方沒寫就選「處方紀錄沒有記載理由」） */
      var rxPrev = {}; ((CUR.rec.view.fields.prescribed_meds || {}).value || []).forEach(function (m) { rxPrev[m.ingredient] = m; });
      var rxNow = {}; rxv.forEach(function (m) { rxNow[m.ingredient] = m; });
      var rxDisc = Object.keys(rxPrev).filter(function (k) { return !rxNow[k]; }).map(function (k) { var row = document.querySelector('#rx_ed .med_item input[value="' + k + '"]'); var sel = row ? row.closest('.med_item').querySelector('.rx_cr') : null; return { ingredient: k, change_reason: sel ? sel.value : '' }; });
      var rxNeed = Object.keys(rxPrev).length ? rxv.filter(function (m) { var b = rxPrev[m.ingredient]; return (!b || (b.rx_status === 'HELD' && m.rx_status !== 'HELD')) && !m.change_reason; }).map(function (m) { return ingName(m.ingredient); }).concat(rxDisc.filter(function (x) { return !x.change_reason; }).map(function (x) { return ingName(x.ingredient) + '（停用）'; })) : [];
      if (rxNeed.length) { inlineErr('pt_msg', '請選改變或停用的理由（處方沒有寫就選「處方紀錄沒有記載理由」）：' + rxNeed.join('、')); break; }
      ST.obs.prescribed_meds = { field_id: 'prescribed_meds', action_type: 'UPDATE', value: rxv, source_type: $('rx_src').value, label: 'UPDATE' };
      if (rxDisc.length) ST.obs.prescribed_meds.qualifiers = { discontinued: rxDisc };
      CUR.editing = null; afterStage(); break;
    case 'issue':
      call('issuePatientLink', [CUR.pk, $('lk_resp').value, Number($('lk_days').value) || 30]).then(function (r) { ISSUED = r; return call('listPatientLinks', [CUR.pk]); })
        .then(function (L) { CUR.links = L; renderPatient(); var b = $('issued_link'); if (b) b.scrollIntoView(); }).catch(function (e) { inlineErr('lk_err', errText(e)); });
      break;
    case 'copy_link':
      if (navigator.clipboard && ISSUED) navigator.clipboard.writeText(ISSUED.link || ISSUED.token).then(function () { t.textContent = '已複製'; }, function () { window.getSelection().selectAllChildren($('issued_link')); });
      else window.getSelection().selectAllChildren($('issued_link'));
      break;
    case 'rotate':
      if (!window.confirm('停用這個連結，並給同一位使用者一個新的連結？')) return;
      call('rotatePatientLink', [CUR.pk, val, 'ROUTINE', Number($('lk_days').value) || 30]).then(function (r) { ISSUED = r; return call('listPatientLinks', [CUR.pk]); }).then(function (L) { CUR.links = L; renderPatient(); var b = $('issued_link'); if (b) b.scrollIntoView(); }).catch(function (e) { inlineErr('lk_err', errText(e)); });
      break;
    case 'revoke_comp':
      var sf = window.prompt('從什麼時候開始可能外流？（例如 2026-10-01；不知道就留白＝從建立連結起都算）', '');
      if (sf === null) return;
      call('revokePatientLink', [CUR.pk, val, 'COMPROMISED', sf.trim()]).then(function () { return call('listPatientLinks', [CUR.pk]); }).then(function (L) { CUR.links = L; renderPatient(); }).catch(function (e) { inlineErr('lk_err', errText(e)); });
      break;
    case 'revoke_all':
      if (!window.confirm('停用這位病人的全部連結，並把它們標為「可能外流」？之後送來的資料會先隔離。')) return;
      call('revokeAllPatientLinks', [CUR.pk, 'COMPROMISED']).then(function () { return call('listPatientLinks', [CUR.pk]); }).then(function (L) { CUR.links = L; renderPatient(); }).catch(function (e) { inlineErr('lk_err', errText(e)); });
      break;
    case 'qr_release': case 'qr_discard':
      var qn = $('qr_note_' + val) ? $('qr_note_' + val).value.trim() : '';
      if (act === 'qr_release' && !qn) { inlineErr('qr_err_' + val, '採用前請寫下確認方式'); break; }
      if (act === 'qr_discard' && !window.confirm('捨棄這筆送出？內容不會寫進紀錄（警訊已另外記下）。')) return;
      call('resolveQuarantinedSubmission', [val, act === 'qr_release' ? 'RELEASE' : 'DISCARD', qn]).then(function () { loadWorklist(); }).catch(function (e) { inlineErr('qr_err_' + val, errText(e)); });
      break;
    case 'revoke':
      if (!window.confirm('停用後，這個連結立刻不能再使用。確定？')) return;
      call('revokePatientLink', [CUR.pk, val]).then(function () { return call('listPatientLinks', [CUR.pk]); }).then(function (L) { CUR.links = L; renderPatient(); }).catch(function (e) { inlineErr('lk_err', errText(e)); });
      break;
    case 'wl_reload': loadWorklist(); break;
    case 'team_load': loadTeam(false); break;
    case 'mt_load': loadMonthly(); break;
    case 'team_snap': loadTeam(true); break;
    case 'trend_load': loadTrend(); break;
    case 'snap_load': loadSnapSeries(); break;
    case 'ce_fix': CUR.ceFix = val; renderPatient(); var cf = $('cf_type'); if (cf) cf.focus(); break;
    case 'ce_fix_cancel': CUR.ceFix = null; renderPatient(); break;
    case 'ce_fix_ok': stageCeFix(val); break;
    case 'staff_save': staffSave(); break;
    case 'claim': claim(); break;
    case 'claim_start': STAFF_TOKEN = val; try { google.script.history.replace(null, null, 's=' + val); } catch (e) { /* 無法改網址時，請使用者用複製的連結 */ } start(); break;
    case 'copy_staff_link': copyLink(); break;   /* 同仁專屬連結（原與病人連結共用 copy_link，被上方同名 case 攔下而無法複製；2026-09-29 修正） */
    case 'slink_issue': slinkIssue(val); break;
    case 'slink_revoke': slinkRevoke(val); break;
    case 'setting_save': settingSave(val); break;
    case 'adm': adm(val); break;
    case 'rvp_list': $('rvp_out').textContent = '讀取中…'; call('adminRoleViewPreview', ['', []]).then(function (r) { var sel = $('rvp_pk');
        sel.innerHTML = (r.patients || []).length ? r.patients.map(function (p) { return opt(p.patient_key, p.short_ref + (p.ident ? '｜' + p.ident : '')); }).join('') : '<option value="">沒有模擬病人</option>'; $('rvp_out').textContent = '已載入 ' + (r.patients || []).length + ' 位模擬病人。'; })
      .catch(function (e) { $('rvp_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; }); break;
    case 'rvp_show': { var rpk = ($('rvp_pk') || {}).value, rr = ($('rvp_role') || {}).value; if (!rpk) { $('rvp_out').textContent = '請先載入並選擇模擬病人。'; break; }
      $('rvp_out').textContent = '讀取中…'; call('adminRoleViewPreview', [rpk, rr ? [rr] : []]).then(function (r) { $('rvp_out').innerHTML = rvpRender(r); }).catch(function (e) { $('rvp_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; }); break; }
    case 'mx_export': {
      var mp = $('mx_purpose').value; if (!mp) { $('mx_out').innerHTML = '<p class="notice err">請選擇匯出用途。</p>'; break; }
      var mfacs = [].slice.call(document.querySelectorAll('.tf_fac:checked')).map(function (x) { return x.value; });
      call('exportMetricsAggregate', [mp, $('mx_note').value, { facility_codes: mfacs }, null]).then(function (r) {
        var blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob);
        $('mx_out').innerHTML = '<p class="notice ok">已產生彙總匯出（' + esc(r.rows.length) + ' 個指標；病人數 ' + esc(r.cohort_size) + (r.suppressed_all ? '；整份遮蔽' : '') + '）。<a href="' + url + '" download="HF_metrics_aggregate_' + esc(String(r.exported_at).slice(0, 10)) + '.json">下載 JSON</a></p>';
      }).catch(function (e) { $('mx_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
      break; }
    case 'ops_load': opsLoad(); break;
    case 'ops_preflight': call('opsPreflight', []).then(function (pf) { OPS.preflight = pf; return opsLoad(); }).catch(function (e) { if ($('ops_out')) $('ops_out').textContent = '失敗：' + errText(e); }); break;
    case 'ops_backup': opsAct('opsBackup', [], null); break;
    case 'ops_drill': { var bk = $('ops_bk'); if (!bk || !bk.value.trim()) { inlineErr('ops_out', '請輸入備份 ID。'); break; } opsAct('opsRestoreDrill', [bk.value.trim()], null); break; }
    case 'ops_rollback': { var bk2 = $('ops_bk'), pv = $('ops_prev'); if (!bk2 || !bk2.value.trim()) { inlineErr('ops_out', '請輸入備份 ID。'); break; } opsAct('opsRollback', [bk2.value.trim(), pv ? pv.value.trim() : '', false], function (r) { if (r && r.state === 'ROLLBACK_VERIFIED_PENDING_CONFIRMATION' && window.confirm('備份已驗證。確認後系統只記錄回滾決定，不自動覆寫正式試算表；請依部署手冊 F 章人工完成。確定？')) call('opsRollback', [bk2.value.trim(), pv ? pv.value.trim() : '', true]).then(function (r2) { $('ops_out').textContent = JSON.stringify(r2, null, 2); }); }); break; }
    case 'ops_start': { if (!OPS.preflight || OPS.preflight.overall !== 'PASS') break; var rid = 'RUN-' + Date.now().toString(36).toUpperCase(); opsAct('opsUpgradeStep', [rid, 'SELECT_ENV', 'PASS', OPS.status ? OPS.status.profile : ''], null); break; }
    case 'ops_step': { var ps = val.split(':'), rr = OPS.status && OPS.status.upgrade_run; if (!rr) break; opsAct('opsUpgradeStep', [rr.run_id, ps[0], ps[1], ($('ops_note') || {}).value || ''], null); break; }
    default: break;
  }
}
function onChange(ev) {
  var t = ev.target;
  /* 4.9.3 WP-A：「與處方相同」帶入後又手動改了狀態或用法 → 不再標為「和處方一樣」 */
  if (t.closest && /\b(med_st|rg_strength|rg_dose|rg_frequency)\b/.test(t.className || '')) { var mi = t.closest('.med_item'); if (mi) { mi.removeAttribute('data-same-src'); mi.removeAttribute('data-route'); } }
  if (t.id === 'na_tpl') { tplPicked(); return; }
  if (t.id === 'na_owner') { reachNote(); return; }
  if (t.id === 'as_setting') { SESSION_CTX.setting = t.value; return; }
  if (t.id === 'as_fac') { SESSION_CTX.facility = t.value; return; }
  if (t.id === 'as_is_assessment') { enc().assessment = t.checked; return; }
  if (t.id === 'as_contact') { enc().contact = t.value; if (CUR && CUR.tab === 'assess' && !CUR.editing) renderPatient(); return; }
  if (t.id === 'as_date') { enc().enc_date = t.value; if (CUR && CUR.tab === 'assess' && !CUR.editing) renderPatient(); return; }   /* 5.2 H-06 */
  if (t.id === 'as_bf') { enc().bf_reason = t.value; return; }
  if (t.id === 'data_g') { CUR.dataG = t.value; renderPatient(); var dg = $('data_g'); if (dg) dg.focus(); return; }   /* 3.4（T12）：電話時重排快速欄位、帶出交接表單 */
  if (t.id === 'raise_alert') { enc().raise = t.checked; return; }
  if (t.id === 'alert_suppress') { enc().suppress = t.value; return; }
  if (t.id === 'log_filter') { CUR.logFilter = t.value; CUR.logOpen = true; renderPatient(); var lf = $('log_filter'); if (lf) lf.focus(); return; }
  if (t.classList && t.classList.contains('med_q')) return;
}
document.addEventListener('input', function (ev) {
  /* 5.2 D-06：編輯框有輸入但還沒加入 → 暫存區即時顯示「1 項未加入」 */
  if (ev.target && ev.target.closest && ev.target.closest('#ed_val')) { CUR.edErr = null; var su = $('staged_unadded'); if (su) su.innerHTML = unaddedHtml(); }
  var t0 = ev.target;
  /* v4.9 S3：完整資料頁搜尋（重畫後游標留在搜尋框） */
  if (t0 && t0.id === 'wb_other_q' && CUR) { CUR.otherQ = t0.value; renderPatient(); var oq = $('wb_other_q'); if (oq) { oq.focus(); try { oq.setSelectionRange(oq.value.length, oq.value.length); } catch (e) { /* 部分瀏覽器不支援 */ } } return; }   /* 5.0 W5-C：「其他（按需展開）」搜尋 */
  if (t0 && t0.id === 'data_q' && CUR) { CUR.dataQ = t0.value; renderPatient(); var dq = $('data_q'); if (dq) { dq.focus(); try { dq.setSelectionRange(dq.value.length, dq.value.length); } catch (e) { /* 部分瀏覽器不支援 */ } } return; }
  var t = ev.target; if (!(t.classList && t.classList.contains('med_q'))) return;
  var q = t.value.trim().toLowerCase();
  [].forEach.call(t.parentNode.querySelectorAll('.med_item'), function (d) { d.hidden = q && d.getAttribute('data-name').indexOf(q) < 0 && !d.querySelector('input').checked; });
});
/* 異動紀錄展開狀態：畫面重畫後維持使用者上次的開合 */
document.addEventListener('toggle', function (ev) {
  if (!CUR || !ev.target) return;
  if (ev.target.id === 'log_panel') CUR.logOpen = ev.target.open;
  var g = ev.target.getAttribute && ev.target.getAttribute('data-group'); if (g) { CUR.openGroups = CUR.openGroups || {}; CUR.openGroups[g] = ev.target.open; }
}, true);
window.addEventListener('beforeunload', function (ev) { if (stagedCount()) { ev.preventDefault(); ev.returnValue = ''; } });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
window.HFI_UI = { staged: function () { return JSON.parse(JSON.stringify(ST)); }, current: function () { return CUR; }, encounter: function () { return JSON.parse(JSON.stringify(enc())); }, session: function () { return JSON.parse(JSON.stringify(SESSION_CTX)); } };

/* =====================================================================
 * 臨床教學（HF-TEACH）：依教學角色顯示；老師記一次評量只需選學員、EPA、協助程度與 1–3 個回饋
 * ===================================================================== */
var TEACH = null, TFORM = {};
/* 4.9.3 WP-C（TEACH-NEW-05）：超過訓練計畫上限的舊決定 */
DEC_ZH.EXCEEDS_PROGRAM_CAP = '超過計畫上限，需重新決定';
/* 4.9.3 WP-C（TEACH-EPA-01）：EPA 適用職類尚未經教學委員會核定 → 標題旁標示 */
function draftChip() { return tf().epas.some(function (e) { return e.scope_basis !== 'COMMITTEE_APPROVED'; }) ? ' ' + chip('適用職類為草案（待教學委員會核定）', 'warn') : ''; }
/* 4.9.3 WP-C（TEACH-RPH-02）：訓練計畫的信賴等級上限（院內參數；伺服器仍逐筆檢查） */
function capOf(program) { var m = (TEACH && TEACH.program_max_level) || tf().program_max_level || {}; return Object.prototype.hasOwnProperty.call(m, program || '') ? Number(m[program]) : 5; }
/* 4.9.3 WP-C（TEACH-PD-10）：教師資格狀態提示；無效時儲存鈕停用 */
function credBlocked(d) { return d.credential_status === 'MISSING' || d.credential_status === 'EXPIRED'; }
function credNotice(d) {
  if (d.credential_status === 'MISSING') return '<p class="notice err">您的臨床教師資格尚未登錄，不能新增評量或信賴決定；請聯絡管理者。</p>';
  if (d.credential_status === 'EXPIRED') return '<p class="notice err">您的臨床教師資格已過期（' + esc(d.credential_until) + '），不能新增評量或信賴決定；請聯絡管理者更新。</p>';
  if (d.credential_expiring_soon) return '<p class="notice warn">您的臨床教師資格將於 ' + esc(d.credential_until) + ' 到期，請提早更新。</p>';
  return '';
}
var EV_REASON_ZH = { EPA_NOT_APPLICABLE_TO_CURRENT_ROLE: 'EPA 不適用這位學員目前的職類', MIN_DISTINCT_DATES: '不同觀察日不足', MIN_OBS: '觀察次數不足', MIN_ASSESSORS: '其他評量者人數不足', LEVEL_NOT_OBSERVED: '沒有其他評量者的觀察達到這個等級' };
var DECLINE_ZH = [['NO_OPPORTUNITY', '沒有機會觀察'], ['NOT_OBSERVED', '有機會但沒有實際觀察到'], ['WRONG_ASSESSOR', '請錯老師（不是我負責）'], ['DUPLICATE', '重複的請求']];
/* 3.2（R-C-001）：臨床教師在病人頁直接記錄教學觀察，評量連到這位病人（伺服器只存教學用病例參照，不存病人代碼） */
function isTeacher() { return ((ME && ME.teaching_roles) || []).some(function (r) { return r === 'CLINICAL_TEACHER' || r === 'PROGRAM_DIRECTOR'; }); }
function teachLinkHtml() { return isTeacher() ? '<p class="noprint"><button class="btn small" type="button" data-act="t_frompt">記錄教學觀察（連結這位病人）</button> <span class="small muted">學員在這位病人身上做的衛教、交接或用藥核對，可在教學頁記錄；評量只存去識別的病例代號。</span></p>' : ''; }
var PROG_ZH = function (c) { return codeZh((ME.teaching || {}).programs, c); };
function tf() { return ME.teaching || { epas: [], observation_scale: [], entrustment_scale: [], settings: [], feedback: { strength: [], next_step: [] } }; }
function epaTitle(id) { var e = tf().epas.filter(function (x) { return x.id === id; })[0]; return e ? e.id + '　' + e.title : id; }
function epasFor(profession) { return tf().epas.filter(function (e) { return !!profession && e.professions.indexOf(profession) >= 0; }); }   /* 3.3：依職業類別，不依臨床職責 */
function loadTeaching() {
  $('view_teach').innerHTML = '<section class="panel"><p class="muted">讀取中…</p></section>';
  call('getTeaching').then(function (d) { TEACH = d; renderTeaching(); }).catch(function (e) { $('view_teach').innerHTML = '<section class="panel"><p class="notice err">' + esc(errText(e)) + '</p></section>'; });
}
function renderTeaching() {
  var d = TEACH, h = '';
  if (d.requests_for_me) h += teachRequestsHtml(d) + wbaFormHtml(d) + teachRecentHtml(d);
  /* 4.9.3 WP-C（TEACH-UX-03）：新學員（全部 0 次）先看到「請老師觀察」與第一步說明 */
  if (d.my_portfolio) { var fresh = !d.my_portfolio.epas.some(function (e) { return e.n > 0; }); h += fresh ? requestFormHtml(d, true) + portfolioHtml(d.my_portfolio, true) : portfolioHtml(d.my_portfolio, true) + requestFormHtml(d); }
  if (d.program) h += programHtml(d.program) + decisionFormHtml(d) + (ME.dashboard_scope === 'FACILITY' ? linkedFormHtml() : '');
  h += '<section class="panel"><details class="help"><summary>說明</summary><p class="small muted">單次評量記錄的是「這次實際需要多少協助」；信賴等級由計畫主持人依多次、多位評量者的觀察決定，系統不計算平均。框架版本 ' + esc(d.framework_version) + '（對應 ESC 2026 心衰竭護理課程 EPA、HFA 心衰竭專科課程）。EPA 適用職類為草案、待教學委員會核定；尚未對應台灣各職類本土 EPA 編號。</p></details></section>';
  $('view_teach').innerHTML = h;
}
function teachRequestsHtml(d) {
  var R = d.requests_for_me;
  return '<section class="panel"><h2>學員請您觀察</h2>' + (R.length ? '<ul class="plain">' + R.map(function (r) {
    return '<li>' + esc(r.trainee_name) + '｜' + esc(epaTitle(r.epa_id)) + '｜' + esc(codeZh(tf().settings, r.setting)) + '｜' + esc(md(r.requested_at)) + (r.stale ? chip('超過時限', 'warn') : '') +
      ' <button class="btn small" type="button" data-act="t_fromreq" data-val="' + esc(r.request_id) + '">記錄這次觀察</button> <select id="tdr_' + esc(r.request_id) + '" aria-label="無法觀察的原因"><option value="">無法觀察的原因</option>' + DECLINE_ZH.map(function (x) { return opt(x[0], x[1]); }).join('') + '</select> <button class="btn small ghost" type="button" data-act="t_decline" data-val="' + esc(r.request_id) + '">結束這個請求</button></li>';
  }).join('') + '</ul>' : '<p class="muted">目前沒有待觀察的請求。</p>') + '<p id="t_req_err" class="small field-err"></p></section>';
}
function wbaFormHtml(d) {
  var F = TFORM, tr = (d.trainees || []).filter(function (x) { return x.actor_id === F.trainee_id; })[0];
  var h = '<section class="panel" id="t_form"><h2>' + (F.supersedes ? '更正一筆評量' : '記錄一次觀察') + draftChip() + '</h2>' + credNotice(d);
  h += '<div class="row"><label class="f">學員<select id="t_trainee"><option value="">請選擇</option>' + (d.trainees || []).map(function (x) { return opt(x.actor_id, x.display_name + '（' + (ROLE_ZH[x.role] || x.role) + '｜' + PROG_ZH(x.program) + '）', x.actor_id === F.trainee_id); }).join('') + '</select></label>';
  h += '<label class="f">EPA<select id="t_epa"><option value="">請選擇</option>' + (tr ? epasFor(tr.profession) : tf().epas).map(function (e) { return opt(e.id, e.id + '　' + e.title, e.id === F.epa_id); }).join('') + '</select></label>';
  h += '<label class="f">場域<select id="t_setting">' + tf().settings.map(function (s) { return opt(s[0], s[1], s[0] === (F.setting || 'WARD')); }).join('') + '</select></label>';
  h += '<label class="f">觀察日期<input type="date" id="t_date" value="' + esc(F.observed_on || today()) + '" max="' + today() + '"></label></div>';
  if (F.patient_key) h += '<p class="small">' + chip('已連結病例 #' + esc(F.patient_short || ''), 'ok') + ' <button class="btn small ghost" type="button" data-act="t_unlink">取消連結</button> <span class="muted">（只存去識別的病例代號，表示這次觀察的病例情境，不表示觀察了某一筆照護紀錄；用來累積個案組合）</span></p>';
  /* 3.3（ZT-B08-001）：連結病例只是情境；要說「觀察到哪一筆照護」，從學員本人在這位病人記錄的事件挑一筆（選填） */
  if (F.patient_key && F.trainee_id) h += F.evts ? '<label class="f wide">觀察到的照護事件（選填；只列學員本人最近 30 天在這位病人記錄的）<select id="t_evt"><option value="">不指定（只連結病例情境）</option>' + F.evts.map(function (x) { return opt(x.event_ref, x.date + '　' + (x.kind === 'ACT' && x.action_type ? '工作：' + (ACT_ZH[x.action_type] || x.action_type) + '（' + (AST_ZH[x.action_status] || x.action_status) + '）' : x.label), x.event_ref === F.event_ref); }).join('') + '</select></label>' + (F.evts.length ? '' : '<p class="small muted">這位學員最近 30 天沒有在這位病人記錄的事件。</p>')
    : '<p class="small"><button class="btn small" type="button" data-act="t_evts">列出學員在這位病人記錄的事件</button></p>';
  var e = tf().epas.filter(function (x) { return x.id === F.epa_id; })[0];
  if (e) h += '<details class="small"><summary>這項 EPA 要看的行為</summary><ul>' + e.observable.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join('') + '</ul></details>';
  h += '<fieldset class="levels"><legend>這次實際需要多少協助</legend>' + tf().observation_scale.map(function (l) {
    return '<label class="lv"><input type="radio" name="t_level" value="' + l.level + '"' + (Number(F.level) === l.level ? ' checked' : '') + '><span><strong>' + l.level + '</strong> ' + esc(l.label) + '</span></label>';
  }).join('') + '</fieldset>';
  h += chipsHtml('做得好（最多 3 個）', 't_s', tf().feedback.strength, F.s || []) + chipsHtml('下一步（最多 3 個）', 't_n', tf().feedback.next_step, F.n || []);
  h += '<label class="f wide">具體的下一步行動（建議填；80 字內；例：下次衛教後請病人示範量體重）<input type="text" id="t_next" maxlength="80" value="' + esc(F.next_action || '') + '"></label>';
  h += '<label class="f">回饋給學員的日期（選填）<input type="date" id="t_fb" value="' + esc(F.feedback_given_on || '') + '" max="' + today() + '"></label>';
  h += '<label class="f wide">補充（選填，200 字內；不要寫病人姓名、病歷號、床號、電話）<input type="text" id="t_comment" maxlength="200" value="' + esc(F.comment || '') + '"></label>';
  h += '<div class="row"><button class="btn" type="button" data-act="t_save"' + (credBlocked(d) ? ' disabled' : '') + '>儲存</button>' + (F.supersedes || F.request_id ? '<button class="btn ghost" type="button" data-act="t_reset">取消</button>' : (F.trainee_id ? '<button class="btn ghost" type="button" data-act="t_reset">換學員</button>' : '')) + '<span id="t_msg" class="small" role="status"></span></div><p id="t_err" class="small field-err"></p></section>';
  return h;
}
function chipsHtml(legend, name, list, sel) {
  return '<fieldset class="chips"><legend>' + esc(legend) + '</legend>' + list.map(function (c) {
    return '<label class="chipbox"><input type="checkbox" name="' + name + '" value="' + esc(c[0]) + '"' + (sel.indexOf(c[0]) >= 0 ? ' checked' : '') + '><span>' + esc(c[1]) + '</span></label>';
  }).join('') + '</fieldset>';
}
function teachRecentHtml(d) {
  var R = d.recent_by_me || [];
  /* 4.9.3 WP-C（TEACH-UX-04）：學員名可點開學習歷程（老師只看得到自己寫的評量與學員的回應） */
  return R.length ? '<section class="panel"><h2>我最近記錄的觀察</h2><ul class="plain">' + R.map(function (w) {
    return '<li>' + esc(md(w.observed_on)) + '｜<button class="linkbtn" type="button" data-act="t_pf" data-val="' + esc(w.trainee_id) + '">' + esc(w.trainee_name) + '</button>｜' + esc(w.epa_id) + '｜協助程度 ' + esc(w.level) + (w.reflected ? ' ' + chip('學員已回應', 'ok') : '') + (w.correctable ? ' <button class="btn small ghost" type="button" data-act="t_fix" data-val="' + esc(w.wba_id) + '">更正</button>' : '') + '</li>';
  }).join('') + '</ul>' + (d.program ? '' : '<div id="t_pf_view"></div>') + '</section>' : '';
}
function distHtml(dist) { return '<span class="dist" aria-label="協助程度 1 到 5 的次數：' + dist.join('、') + '">' + dist.map(function (n, i) { return '<span class="d' + (i + 1) + '" title="' + (i + 1) + '：' + n + ' 次"><small>' + (i + 1) + '</small> ' + n + '</span>'; }).join('') + '</span>'; }
var AGREE_ZH = { AGREE: '同意', PARTLY: '部分同意', DISAGREE: '不同意' };
var RF_IDEM = {};
function reflectFormHtml(id, revise) {
  return '<details class="small noprint"><summary>' + (revise ? '修改回應（舊的回應會保留）' : '回應這次回饋（同不同意、下次要做的一件事）') + '</summary><div class="row"><label class="f">看法<select id="rf_ag_' + esc(id) + '"><option value="">請選擇</option>' + Object.keys(AGREE_ZH).map(function (k) { return opt(k, AGREE_ZH[k]); }).join('') + '</select></label>' +
    '<label class="f">我覺得這次需要的協助（選填）<select id="rf_sl_' + esc(id) + '"><option value="">不填</option>' + tf().observation_scale.map(function (l) { return opt(String(l.level), l.level + ' ' + l.label); }).join('') + '</select></label>' +
    '<label class="f wide">下次我會做的一件事（120 字內；不要寫病人資料）<input type="text" id="rf_tx_' + esc(id) + '" maxlength="120"></label><button class="btn small" type="button" data-act="t_reflect" data-val="' + esc(id) + '" data-rev="' + (revise ? '1' : '') + '">' + (revise ? '送出修改' : '送出') + '</button></div><p id="rf_err_' + esc(id) + '" class="small field-err"></p></details>';
}
/* 3.2（R-C-010）：完整時序——看進展與不同評量者（A1、A2 為匿名代號），不計平均 */
function timelineDetails(e) {
  var T = e.timeline || []; if (T.length < 2) return '';
  return '<details class="small"><summary>完整時序（' + T.length + ' 次）</summary><ol class="tline">' + T.map(function (w) {
    return '<li>' + esc(md(w.observed_on)) + '｜協助程度 <strong>' + esc(w.level) + '</strong>｜' + esc(codeZh(tf().settings, w.setting)) + '｜' + esc(ROLE_ZH[w.assessor_role] || w.assessor_role) + ' ' + esc(w.assessor_ref === 'ME' ? '（我）' : w.assessor_ref) +
      (w.next_step_codes.length ? '｜下一步：' + w.next_step_codes.map(function (c) { return esc(codeZh(tf().feedback.next_step, c)); }).join('、') : '') + (w.linked_patient ? '｜有連結病例' : '') + (w.reflected ? '｜學員已回應' : '') + '</li>'; }).join('') + '</ol></details>';
}
/* 4.9.3 WP-C（TEACH-UX-05）：同一 EPA 較早的評量（最近 5 筆中第 2 筆以後）也能個別回應 */
function olderReflectHtml(e) {
  var R = (e.recent || []).slice(1).filter(function (w) { return w.wba_id; }); if (!R.length) return '';
  return '<details class="small"><summary>較早的評量（' + R.length + ' 筆，可分別回應）</summary><ul class="plain">' + R.map(function (w) {
    return '<li>' + esc(md(w.observed_on)) + '｜協助程度 ' + esc(w.level) + (w.reflection ? '｜已回應：' + esc(AGREE_ZH[w.reflection.agree_code] || '') + '｜下次：' + esc(w.reflection.action_text) : '') + reflectFormHtml(w.wba_id, !!w.reflection) + '</li>'; }).join('') + '</ul></details>';
}
function portfolioHtml(P, self) {
  var cap = P.program_max_level || 5;
  var h = '<section class="panel"><h2>' + (self ? '我的學習歷程' : esc(P.display_name) + ' 的學習歷程') + draftChip() + '</h2>' + (cap < 5 ? '<p class="small muted">訓練計畫（' + esc(PROG_ZH(P.program)) + '）的信賴等級上限為 ' + esc(cap) + '（院內參數）。</p>' : '') +
    '<div class="table-scroll"><table><thead><tr><th scope="col">EPA</th><th scope="col">觀察次數（全部）</th><th scope="col">可計入決定</th><th scope="col">評量者</th><th scope="col">這次需要多少協助（次數）<br><span class="small">1 老師做 → 5 獨立完成</span></th><th scope="col">最近一次</th><th scope="col">信賴決定</th></tr></thead><tbody>';
  h += P.epas.map(function (e) {
    var r = e.recent[0];
    return '<tr><th scope="row">' + esc(e.epa_id) + '<br><span class="small">' + esc(e.title) + '</span></th><td>' + e.n + '</td><td>' + esc(e.n_countable == null ? '—' : e.n_countable) + '</td><td>' + e.n_assessors + '</td><td>' + distHtml(e.level_distribution) + '</td><td>' +
      (r ? esc(md(r.observed_on)) + '｜' + r.level + '<br><span class="small">' + r.strength_codes.map(function (c) { return esc(codeZh(tf().feedback.strength, c)); }).join('、') + (r.next_step_codes.length ? '｜下一步：' + r.next_step_codes.map(function (c) { return esc(codeZh(tf().feedback.next_step, c)); }).join('、') : '') + (r.comment ? '｜' + esc(r.comment) : '') + '</span>' : '—') +
      (r && r.reflection ? '<br><span class="small">學員回應：' + esc(AGREE_ZH[r.reflection.agree_code] || '') + (r.reflection.self_level ? '｜自評 ' + esc(r.reflection.self_level) : '') + '｜下次：' + esc(r.reflection.action_text) + '</span>' : '') +
      (self && r && r.wba_id ? reflectFormHtml(r.wba_id, !!r.reflection) : '') + (self ? olderReflectHtml(e) : '') + timelineDetails(e) +
      '</td><td>' + (e.decision ? '等級 ' + e.decision.level + '（' + esc(md(e.decision.decided_at)) + (DEC_ZH[e.decision.status] ? '，' + DEC_ZH[e.decision.status] : '') + '）' + (e.decision.status === 'EXCEEDS_PROGRAM_CAP' ? '<br>' + chip('超過計畫上限，需重新決定', 'warn') : '') + (e.decision.downgrade ? '<br><span class="chip warn">由等級 ' + esc(e.decision.downgrade.from) + ' 調降</span> ' + esc(e.decision.downgrade.narrative || '') : '') : '尚未決定') + '</td></tr>';
  }).join('');
  return h + '</tbody></table></div></section>';
}
function requestFormHtml(d, fresh) {
  var T = d.teachers || [], P = d.my_portfolio, open = P.open_requests || [];
  var h = '<section class="panel"><h2>請老師觀察' + draftChip() + '</h2>' + (fresh ? '<p class="small">第一次使用：選一位老師和一項 EPA，送出後老師會在他的教學頁看到。</p>' : '') +
    (P.profession ? '' : '<p class="notice warn">您的職業類別尚未登錄，請聯絡管理者後才能選 EPA。</p>') + '<div class="row"><label class="f">老師<select id="tr_teacher"><option value="">請選擇</option>' + T.map(function (x) { return opt(x.actor_id, x.display_name + '（' + (ROLE_ZH[x.role] || x.role) + '）'); }).join('') + '</select></label>';
  h += '<label class="f">EPA<select id="tr_epa"><option value="">請選擇</option>' + epasFor(P.profession).map(function (e) { return opt(e.id, e.id + '　' + e.title); }).join('') + '</select></label>';
  h += '<label class="f">場域<select id="tr_setting">' + tf().settings.map(function (s) { return opt(s[0], s[1]); }).join('') + '</select></label><button class="btn" type="button" data-act="t_request">送出請求</button></div><p id="tr_err" class="small field-err"></p>';
  if (open.length) h += '<h3>還沒處理的請求</h3><ul class="plain">' + open.map(function (r) { return '<li>' + esc(epaTitle(r.epa_id)) + '｜' + esc(md(r.requested_at)) + ' <button class="btn small ghost" type="button" data-act="t_withdraw" data-val="' + esc(r.request_id) + '">撤回</button></li>'; }).join('') + '</ul>';
  return h + '</section>';
}
/* 5.0 W5-M（K10-09）：教學指標 T-1～T-6（只顯示件數，不排名） */
function teachV5Html(p) {
  var m = p.metrics_v5; if (!m) return '';
  if (!m.rows.length) return '<section class="panel" id="teach_v5"><p class="notice warn">' + esc(m.note_zh) + '</p></section>';
  return '<section class="panel" id="teach_v5"><h2>教學指標（T-1～T-6）</h2><p class="small muted">' + esc(m.note_zh) + '</p><div class="table-scroll"><table class="small"><thead><tr><th scope="col">指標</th><th scope="col">分子／分母</th><th scope="col">定義</th></tr></thead><tbody>' +
    m.rows.map(function (r) { return '<tr data-teach-v5="' + esc(r.metric_id) + '"><th scope="row">' + esc(r.metric_id) + '　' + esc(r.name_zh) + '</th><td>' + (r.denominator === null || r.denominator === undefined ? '—' : esc(r.numerator === null ? '—' : r.numerator) + '／' + esc(r.denominator)) + (r.not_assessable ? '<br><span class="muted">未到期限 ' + esc(r.not_assessable) + '</span>' : '') +
      (r.extra ? '<br><span class="muted">' + Object.keys(r.extra).map(function (k) { return esc({ codes_only: '只勾代碼', declined: '婉拒', expired: '到期', withdrawn: '撤回' }[k] || k) + ' ' + esc(r.extra[k]); }).join('、') + '</span>' : '') + '</td><td>' + esc(r.definition.numerator) + '／' + esc(r.definition.denominator) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
}
function programHtml(p) {
  var m = p.metrics, pct = function (x) { return x.denominator ? x.numerator + '／' + x.denominator : '—'; };
  var h = teachV5Html(p) + '<section class="panel"><h2>計畫儀表板（學員 ' + p.trainees + ' 位）</h2><ul class="kpis"><li>近 30 天觀察<strong>' + m.observations_30d + '</strong></li><li>近 30 天參與的老師<strong>' + m.active_teachers_30d + '</strong></li>' +
    '<li>待處理請求<strong>' + m.requests_open + '</strong>' + (m.requests_stale ? '（逾時 ' + m.requests_stale + '）' : '') + '</li><li>請求到結案的天數中位數（含婉拒、到期、撤回）<strong>' + (m.request_turnaround_median_days == null ? '—' : m.request_turnaround_median_days) + '</strong></li>' +
    '<li>有具體下一步行動的評量<strong>' + pct(m.actionable_feedback || { denominator: 0 }) + '</strong><span class="small">（只勾代碼 ' + pct(m.feedback_with_next_step) + '）</span></li><li>可做信賴決定但尚未決定<strong>' + m.decision_ready_without_decision + '</strong></li>' +
    (m.decisions_needing_review ? '<li>近期觀察與目前信賴不一致<strong>' + m.decisions_needing_review + '</strong></li>' : '') + (m.decisions_exceeding_cap ? '<li>超過計畫上限、需重新決定<strong>' + m.decisions_exceeding_cap + '</strong></li>' : '') + '</ul>';
  h += '<div class="table-scroll"><table class="matrix"><thead><tr><th scope="col">學員</th>' + p.epas.map(function (e) { return '<th scope="col" title="' + esc(e.title) + '">' + esc(e.id.replace('HF-EPA-', 'EPA ')) + '</th>'; }).join('') + '</tr></thead><tbody>';
  h += p.matrix.map(function (t) {
    return '<tr><th scope="row"><button class="linkbtn" type="button" data-act="t_pf" data-val="' + esc(t.trainee_id) + '">' + esc(t.display_name) + '</button><br><span class="small">' + esc(ROLE_ZH[t.role] || t.role) + '｜' + esc(PROG_ZH(t.program)) + '</span></th>' + t.cells.map(function (c) {
      if (!c.applicable) return '<td class="na">不適用</td>';
      /* 4.9.3 WP-C：不是您職類的學員 → 「由本職類主持人決定」（NEW-03）；跨職類觀察次數（IPE-01）；近期觀察與信賴不一致（NEW-04）；學生被記為老師不在旁（NEW-06） */
      return '<td class="' + (c.decision ? 'dec' : (c.decision_ready && c.can_decide !== false ? 'ready' : '')) + '">' + c.n + ' 次／' + c.n_assessors + ' 人' + (c.last_level ? '<br>最近 ' + c.last_level : '') +
        (c.cross_prof_n ? '<br><small>跨職類 ' + esc(c.cross_prof_n) + '</small>' : '') +
        (c.decision ? '<br><strong>信賴 ' + c.decision.level + '</strong>' + (DEC_ZH[c.decision.status] ? '<br>' + chip(DEC_ZH[c.decision.status], 'warn') : '') : (c.decision_ready && c.can_decide !== false ? '<br>可做決定' : '')) +
        (c.review_flag ? '<br>' + chip('近期觀察與目前信賴不一致，請檢視', 'warn') : '') + (c.student_unsupervised_n ? '<br>' + chip('學生被記為老師不在旁 ' + c.student_unsupervised_n + ' 次', 'warn') : '') +
        (c.can_decide === false ? '<br><small class="muted">由本職類主持人決定</small>' : '') + '</td>';
    }).join('') + '</tr>';
  }).join('');
  var md0 = p.metric_definitions || {}, gv = p.governance || {};
  var det = '<details class="small"><summary>指標定義與門檻來源</summary><ul>' + Object.keys(md0).map(function (k) { return '<li>' + esc(md0[k]) + '</li>'; }).join('') +
    (p.metrics.request_resolution ? '<li>請求結案分布：完成 ' + p.metrics.request_resolution.done + '、婉拒 ' + p.metrics.request_resolution.declined + '、到期 ' + p.metrics.request_resolution.expired + '、撤回 ' + p.metrics.request_resolution.withdrawn + '、未結 ' + p.metrics.request_resolution.open + '</li>' : '') +
    '<li>「可做決定」門檻：至少 ' + esc(gv.min_obs) + ' 次觀察、' + esc(gv.min_assessors) + ' 位評量者、' + esc(gv.min_dates) + ' 個不同觀察日、' + esc(gv.window_days) + ' 天內；性質：院內治理（' + esc(gv.basis) + '，' + esc(gv.version) + '），不是普遍證據門檻</li></ul></details>';
  return h + '</tbody></table></div><ul class="small muted">' + p.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' + det + '<div class="row"><button class="btn small" type="button" data-act="t_export">匯出評量、信賴決定與學員回應（CSV；只含您可決定的學員）</button><span id="t_exp" class="small"></span></div><div id="t_pf_view"></div></section>';
}
/* 教學與臨床流程指標並列：只並列同一照護領域，不做因果解讀 */
function linkedFormHtml() {
  return '<section class="panel" id="t_link"><h2>教學與臨床流程指標並列</h2><details class="help"><summary>說明</summary><p class="small muted">同一院所，依 EPA 的照護領域並列：教學次數依您選的期間，臨床指標依各指標定義的時間範圍（每項後面標示）。不代表教學造成臨床指標變化，不做院所、職類或個人比較。</p></details><div class="row">' +
    '<label class="f">院所<select id="tl_fac">' + ME.facilities.map(function (f) { return opt(f, FAC_ZH[f] || f); }).join('') + '</select></label>' +
    '<label class="f">教學期間<select id="tl_days">' + ((tf().related_metrics_policy || {}).window_days_allowed || [90]).map(function (n) { return opt(String(n), '近 ' + n + ' 天', n === (tf().related_metrics_policy || {}).default_window_days); }).join('') + '</select></label>' +
    '<button class="btn" type="button" data-act="t_link">顯示</button></div><div id="tl_out"></div></section>';
}
function linkedHtml(v) {
  var cell = function (x) { return esc(x === null || x === undefined ? '—' : x); };
  var h = '<p class="small muted">' + esc(FAC_ZH[v.facility_code] || v.facility_code) + '｜教學期間 ' + esc(v.period.from) + '～' + esc(v.period.to) + '｜病人數 ' + cell(v.cohort_size) + '｜學員 ' + cell(v.trainees_in_facility) + '｜資料時間 ' + esc(d10(v.as_of)) + '</p>';
  h += '<div class="table-scroll"><table class="linked"><thead><tr><th scope="col">EPA</th><th scope="col">觀察次數</th><th scope="col">被觀察學員</th><th scope="col">評量者</th><th scope="col">信賴決定</th><th scope="col">同領域臨床流程指標（時間範圍依各指標定義）</th></tr></thead><tbody>';
  h += v.rows.map(function (r) {
    return '<tr><th scope="row">' + esc(r.epa_id) + '<br><span class="small">' + esc(r.title) + '</span></th><td>' + cell(r.teaching.observations) + '</td><td>' + cell(r.teaching.trainees_observed) + '</td><td>' + cell(r.teaching.assessors) + '</td><td>' + cell(r.teaching.decisions) + '</td><td><ul class="plain small">' +
      r.clinical.map(function (m) { return '<li>' + esc(m.metric_id) + '　' + esc(m.name_zh) + '：' + (m.denominator === 'SUPPRESSED' ? '<strong>已遮蔽</strong>' : '<strong>' + (m.suppressed && m.value === null ? '已遮蔽' : fmtMetric(m)) + '</strong>（' + cell(m.numerator) + '／' + cell(m.denominator) + '）') + (m.observation_window_days ? '<span class="muted">｜' + esc(m.observation_window_days) + ' 天觀察期</span>' : '') + '</li>'; }).join('') + '</ul></td></tr>';
  }).join('');
  return h + '</tbody></table></div><ul class="small muted">' + v.limitations.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
}
function decisionFormHtml(d) {
  var p = d.program, mine = p.matrix.filter(function (t) { return t.can_decide !== false; });
  /* 4.9.3 WP-C：只列您可以決定的學員（PD-06／NEW-03）；EPA 依學員職類過濾、選好後顯示證據卡（PD-03）；理由必選（PD-02）；超過計畫上限的等級停用（RPH-02） */
  return '<section class="panel"><h2>信賴決定</h2>' + credNotice(d) + (mine.length < p.matrix.length ? '<p class="small muted">只列您同職類（或院方允許）的學員；其他學員由本職類主持人決定。</p>' : '') +
    '<div class="row"><label class="f">學員<select id="td_trainee"><option value="">請選擇</option>' + mine.map(function (t) { return opt(t.trainee_id, t.display_name); }).join('') + '</select></label>' +
    '<label class="f">EPA<select id="td_epa"><option value="">請先選學員</option></select></label>' +
    '<label class="f">理由<select id="td_rat"><option value="">請選擇</option>' + (tf().rationale || []).map(function (r) { return opt(r, ({ CONSISTENT_EVIDENCE: '多次觀察一致', MIXED_EVIDENCE_CONSERVATIVE: '證據不一致，保守決定', REMEDIATION_PLAN: '需補強計畫', REVIEW_AFTER_LEAVE: '長期離開後重新評估' })[r] || r); }).join('') + '</select></label>' +
    '<label class="f">有效到（選填）<input type="date" id="td_until"></label></div><div id="td_ev" class="small" aria-live="polite"></div><p id="td_cap" class="small muted"></p>' +
    '<details class="small"><summary>調降信賴等級時必填（比目前有效的決定低）</summary><div class="row"><label class="f">調降理由<select id="td_down"><option value="">（不是調降）</option>' +
    [['PATIENT_SAFETY_CONCERN', '病人安全疑慮'], ['PERFORMANCE_BELOW_LEVEL', '表現未達目前等級'], ['PROLONGED_ABSENCE', '長期未執行'], ['SCOPE_OR_CONTEXT_CHANGE', '工作範圍或情境改變']].map(function (x) { return opt(x[0], x[1]); }).join('') + '</select></label>' +
    '<label class="f wide">具體敘述（10–300 字；不要寫病人資料；學員會在學習歷程看到）<input type="text" id="td_narr" maxlength="300"></label></div></details><fieldset class="levels"><legend>決定之後，這位學員可以在哪一種督導下執行</legend>' + tf().entrustment_scale.map(function (l) {
      return '<label class="lv"><input type="radio" name="td_level" value="' + l.level + '"><span><strong>' + l.level + '</strong> ' + esc(l.label) + '</span></label>'; }).join('') +
    '</fieldset><div class="row"><button class="btn" type="button" data-act="t_decide"' + (credBlocked(d) ? ' disabled' : '') + '>送出決定</button><span id="td_msg" class="small" role="status"></span></div><p id="td_err" class="small field-err"></p></section>';
}
/* 4.9.3 WP-C（TEACH-PD-03）：證據卡（時效內次數、不同觀察日、其他評量者、他人觀察最高等級、排除筆數） */
function evidenceHtml(v) {
  var x = v.excluded || {}, nx = (x.other_role || 0) + (x.stale || 0) + (x.same_day_duplicate || 0);
  return '<p>時效內 ' + esc(v.n_obs) + ' 次｜不同觀察日 ' + esc(v.n_dates) + '｜其他評量者 ' + esc(v.n_assessors_excl_decider) + ' 位｜他人觀察最高 ' + esc(v.max_level_by_others || '—') + '｜排除 ' + esc(nx) + ' 筆</p>' +
    (v.reasons && v.reasons.length ? '<p class="muted">尚未達到：' + v.reasons.map(function (r) { return esc(EV_REASON_ZH[r] || r); }).join('、') + '（門檻：' + esc(v.min_obs) + ' 次、' + esc(v.min_assessors) + ' 位、' + esc(v.min_dates) + ' 個觀察日、' + esc(v.window_days) + ' 天內）</p>' : '<p>已達本院門檻；等級 3 以上另需其他評量者至少一次觀察達到該等級。</p>') +
    (v.latest_decision ? '<p>目前決定：等級 ' + esc(v.latest_decision.level) + (DEC_ZH[v.latest_decision.status] ? '（' + esc(DEC_ZH[v.latest_decision.status]) + '）' : '') + '</p>' : '');
}
function tdSync(which) {
  var p = TEACH && TEACH.program; if (!p || !$('td_trainee')) return;
  var t = p.matrix.filter(function (x) { return x.trainee_id === $('td_trainee').value; })[0];
  if (which === 'td_trainee') { var cur = $('td_epa').value; $('td_epa').innerHTML = '<option value="">' + (t ? '請選擇' : '請先選學員') + '</option>' + (t ? epasFor(t.profession) : []).map(function (e) { return opt(e.id, e.id + '　' + e.title, e.id === cur); }).join(''); }
  var cap = t ? capOf(t.program) : 5;
  [].forEach.call(document.querySelectorAll('input[name="td_level"]'), function (x) { x.disabled = Number(x.value) > cap; if (x.disabled) x.checked = false; });
  $('td_cap').textContent = t && cap < 5 ? '這位學員的訓練計畫（' + PROG_ZH(t.program) + '）信賴決定最高到等級 ' + cap + '（院內參數），較高等級已停用。' : '';
  $('td_ev').innerHTML = '';
  if (t && $('td_epa').value) call('getEntrustEvidence', [t.trainee_id, $('td_epa').value]).then(function (v) { $('td_ev').innerHTML = evidenceHtml(v); }).catch(function (e) { $('td_ev').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
}
/* 4.9.3 WP-C（TEACH-PD-13）：教學啟用檢查（管理頁） */
var READY_ZH = { NO_PROFESSION: '職業類別未登錄', NO_TRAINING_PROGRAM: '未指定訓練計畫', NO_APPLICABLE_EPA: '沒有適用的 EPA', NO_SAME_PROFESSION_DIRECTOR: '無本職類主持人', CREDENTIAL_MISSING: '教師資格未登錄', CREDENTIAL_EXPIRED: '教師資格已過期', CREDENTIAL_EXPIRING_30D: '教師資格 30 天內到期', PD_PROFESSION_MISSING: '主持人職業類別未登錄（不能做信賴決定）' };
function readinessHtml(r) {
  return r.items.length ? '<ul class="plain small">' + r.items.map(function (x) { return '<li>' + esc(x.display_name) + '（' + esc(x.actor_id) + '）：' + x.issues.map(function (k) { return esc(READY_ZH[k] || k); }).join('、') + '</li>'; }).join('') + '</ul>' : '<p class="small">已檢查 ' + esc(r.checked) + ' 位有教學角色的人員，沒有缺漏。</p>';
}
function readTForm() {
  var q = function (n) { return [].map.call(document.querySelectorAll('input[name="' + n + '"]:checked'), function (x) { return x.value; }); };
  TFORM.trainee_id = $('t_trainee').value; TFORM.epa_id = $('t_epa').value; TFORM.setting = $('t_setting').value; TFORM.observed_on = $('t_date').value;
  TFORM.level = (q('t_level')[0] || ''); TFORM.s = q('t_s'); TFORM.n = q('t_n'); TFORM.comment = $('t_comment').value; TFORM.next_action = $('t_next').value; TFORM.feedback_given_on = $('t_fb').value;
  TFORM.event_ref = $('t_evt') ? $('t_evt').value : '';
  if (TFORM.evts && TFORM.evts_for !== TFORM.trainee_id) { delete TFORM.evts; TFORM.event_ref = ''; }   /* 換學員 → 事件清單作廢 */
}
function teachAct(act, val) {
  switch (act) {
    case 't_fromreq': var r = TEACH.requests_for_me.filter(function (x) { return x.request_id === val; })[0]; TFORM = { trainee_id: r.trainee_id, epa_id: r.epa_id, setting: r.setting, request_id: r.request_id }; renderTeaching(); $('t_form').scrollIntoView(); $('t_trainee').focus(); return true;
    case 't_fix': var w = TEACH.recent_by_me.filter(function (x) { return x.wba_id === val; })[0]; TFORM = { supersedes: val, epa_id: w.epa_id, trainee_id: w.trainee_id, level: w.level }; renderTeaching(); $('t_form').scrollIntoView(); return true;
    case 't_reset': TFORM = {}; renderTeaching(); return true;
    case 't_unlink': readTForm(); delete TFORM.patient_key; delete TFORM.patient_short; delete TFORM.evts; delete TFORM.event_ref; renderTeaching(); return true;
    case 't_evts': readTForm(); if (!TFORM.trainee_id) { inlineErr('t_err', '請先選擇學員。'); return true; }
      call('listWbaEvents', [TFORM.patient_key, TFORM.trainee_id]).then(function (d) { TFORM.evts = d.events || []; TFORM.evts_for = TFORM.trainee_id; renderTeaching(); }, function (e) { inlineErr('t_err', e.message || '無法讀取事件。'); }); return true;
    case 't_frompt': TFORM = { patient_key: CUR.pk, patient_short: CUR.rec.short_ref, setting: 'WARD' }; switchTab('teach'); return true;
    case 't_reflect': var ag = $('rf_ag_' + val), tx = $('rf_tx_' + val), sl = $('rf_sl_' + val);
      if (!ag.value) { inlineErr('rf_err_' + val, '請選擇您對這次回饋的看法。'); ag.focus(); return true; }
      if (!tx.value.trim()) { inlineErr('rf_err_' + val, '請寫下次要做的一件事。'); tx.focus(); return true; }
      if (!RF_IDEM[val]) RF_IDEM[val] = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      call('reflectOnWba', [{ wba_id: val, agree_code: ag.value, self_level: sl.value, action_text: tx.value, idempotency_key: RF_IDEM[val], revise: ((document.querySelector('[data-act="t_reflect"][data-val="' + val + '"]') || { getAttribute: function () { return ''; } }).getAttribute('data-rev')) === '1' }]).then(function () { delete RF_IDEM[val]; return loadTeaching(); }).catch(function (e) { inlineErr('rf_err_' + val, errText(e)); }); return true;
    case 't_save':
      readTForm();
      if (!TFORM.trainee_id || !TFORM.epa_id || !TFORM.level) { inlineErr('t_err', '請選擇學員、EPA 與這次需要的協助程度。'); return true; }
      /* 4.9.3 WP-C（TEACH-NEW-06）：實習學生記為老師不在旁（4–5）→ 先確認 */
      var trS = (TEACH.trainees || []).filter(function (x) { return x.actor_id === TFORM.trainee_id; })[0];
      if (trS && trS.program === 'STUDENT' && Number(TFORM.level) >= 4 && !window.confirm('實習學生不應在無督導下執行。確認這次老師確實不在場？')) return true;
      if (TFORM.s.length > 3 || TFORM.n.length > 3) { inlineErr('t_err', '回饋最多各選 3 個。'); return true; }
      if (!TFORM.idem) TFORM.idem = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      $('t_msg').textContent = '正在儲存…';
      call('recordWba', [{ trainee_id: TFORM.trainee_id, epa_id: TFORM.epa_id, setting: TFORM.setting, observed_on: TFORM.observed_on, supervision_level: Number(TFORM.level), strength_codes: TFORM.s, next_step_codes: TFORM.n,
        comment: TFORM.comment, next_action: TFORM.next_action || '', feedback_given_on: TFORM.feedback_given_on || '', request_id: TFORM.request_id || '', supersedes_wba_id: TFORM.supersedes || '', idempotency_key: TFORM.idem, patient_key: TFORM.patient_key || '', event_ref: (TFORM.evts && TFORM.evts_for === TFORM.trainee_id && TFORM.event_ref) || '' }])
        /* 4.9.3 WP-C（TEACH-UX-02）：保留學員、場域、日期與連結病例（同一場觀察常評兩個 EPA）；EPA、等級、回饋、識別碼一律清空 */
        .then(function (res) { TFORM = { trainee_id: TFORM.trainee_id, setting: TFORM.setting, observed_on: TFORM.observed_on, patient_key: TFORM.patient_key, patient_short: TFORM.patient_short }; if (!TFORM.patient_key) { delete TFORM.patient_key; delete TFORM.patient_short; } TFORM._warn = res && res.warning; return call('getTeaching'); })
        .then(function (d) { TEACH = d; var wn = TFORM._warn; delete TFORM._warn; renderTeaching(); $('t_msg').textContent = '已儲存' + (wn === 'STUDENT_UNSUPERVISED' ? '（已標記：實習學生無督導執行，計畫主持人會看到）' : ''); })
        .catch(function (e) { $('t_msg').textContent = ''; inlineErr('t_err', errText(e)); });
      return true;
    case 't_decline':
      /* 3.3（ZT-C10-005）：原因由老師選，不再一律送「沒有機會」（避免統計失真） */
      var drs = $('tdr_' + val) ? $('tdr_' + val).value : '';
      if (!drs) { inlineErr('t_req_err', '請先選無法觀察的原因。'); if ($('tdr_' + val)) $('tdr_' + val).focus(); return true; }
      if (!window.confirm('結束這個觀察請求？學員會看到請求已結束與原因。')) return true;
      call('declineObservation', [val, drs]).then(loadTeaching).catch(function (e) { inlineErr('t_req_err', errText(e)); }); return true;
    case 't_withdraw': call('declineObservation', [val, 'DUPLICATE']).then(loadTeaching).catch(function (e) { inlineErr('tr_err', errText(e)); }); return true;
    case 't_request':
      if (!$('tr_teacher').value || !$('tr_epa').value) { inlineErr('tr_err', '請選擇老師與 EPA。'); return true; }
      call('requestObservation', [{ assessor_id: $('tr_teacher').value, epa_id: $('tr_epa').value, setting: $('tr_setting').value }]).then(loadTeaching).catch(function (e) { inlineErr('tr_err', errText(e)); }); return true;
    case 't_pf': call('getTrainingPortfolio', [val]).then(function (p) { $('t_pf_view').innerHTML = portfolioHtml(p, false); $('t_pf_view').scrollIntoView(); }).catch(function (e) { $('t_pf_view').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; }); return true;
    case 't_export':
      call('exportTeaching').then(function (x) {
        var link = function (name, text) { return '<a download="' + name + '" href="data:text/csv;charset=utf-8,' + encodeURIComponent(text) + '">' + name + '</a>'; };
        $('t_exp').innerHTML = link('wba_' + x.exported_at.slice(0, 10) + '.csv', x.wba_csv) + '　' + link('entrustment_' + x.exported_at.slice(0, 10) + '.csv', x.decisions_csv) + (x.reflections_csv ? '　' + link('reflections_' + x.exported_at.slice(0, 10) + '.csv', x.reflections_csv) : '') + '<span class="muted">（不含病人代碼；若無法下載，請改用管理者匯出）</span>';
      }).catch(function (e) { inlineErr('t_exp', errText(e)); }); return true;
    case 't_ready': $('t_ready_out').innerHTML = '<p class="muted">檢查中…</p>';
      call('adminTeachingReadiness').then(function (r) { $('t_ready_out').innerHTML = readinessHtml(r); }).catch(function (e) { $('t_ready_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; }); return true;
    case 't_link':
      $('tl_out').innerHTML = '<p class="muted">計算中…</p>';
      call('getTeachingClinicalView', [$('tl_fac').value, Number($('tl_days').value)]).then(function (v) { $('tl_out').innerHTML = linkedHtml(v); }).catch(function (e) { $('tl_out').innerHTML = '<p class="notice err">' + esc(errText(e)) + '</p>'; });
      return true;
    case 't_decide':
      var lv = (document.querySelector('input[name="td_level"]:checked') || {}).value;
      if (!$('td_trainee').value || !$('td_epa').value || !lv) { inlineErr('td_err', '請選擇學員、EPA 與信賴等級。'); return true; }
      if (!$('td_rat').value) { inlineErr('td_err', '請選擇決定理由。'); $('td_rat').focus(); return true; }   /* 4.9.3 WP-C（TEACH-PD-02） */
      call('recordEntrustment', [{ trainee_id: $('td_trainee').value, epa_id: $('td_epa').value, level: Number(lv), rationale_code: $('td_rat').value, valid_until: $('td_until').value, downgrade_reason: $('td_down') ? $('td_down').value : '', narrative: $('td_narr') ? $('td_narr').value : '' }])
        .then(function () { return call('getTeaching'); }).then(function (d) { TEACH = d; renderTeaching(); $('td_msg').textContent = '已記錄'; }).catch(function (e) { inlineErr('td_err', errText(e)); });
      return true;
  }
  return false;
}
document.addEventListener('change', function (ev) { if (ev.target && ev.target.id === 't_trainee' || ev.target && ev.target.id === 't_epa') { readTForm(); renderTeaching(); var el = $(ev.target.id); if (el) el.focus(); } });
document.addEventListener('change', function (ev) { if (ev.target && (ev.target.id === 'td_trainee' || ev.target.id === 'td_epa')) tdSync(ev.target.id); });   /* 4.9.3 WP-C */
/* ==== 5.1 W51-RXA 前端區（新函式只加在此區塊內） ==== */
/* 核心藥物對照（醫療端、試行規則只在模擬病人）：新代碼的中文標籤、下一步、教學（規則登錄與成分證據）、高齡與衰弱註記。不含任何藥物處置字樣。 */
var RXA_GAP_ZH = { CAUTION_CONTEXT: '先處理再討論', REVIEW_EVIDENCE_ROLE: '請藥師核對成分', TITRATION_REVIEW_DUE: '請檢視調整節奏', NOT_APPLICABLE: '不適用' };
var RXA_REASON_ZH = { DX_NOT_CONFIRMED: '資料不足（心衰竭診斷尚未確認）', EVIDENCE_LIMITED_DIALYSIS: '證據有限（透析）' };
var RXA_CZ_ZH = { K_HIGH: '血鉀偏高', EGFR_LOW: '腎功能偏低', SBP_LOW: '收縮壓偏低', T1DM: '第 1 型糖尿病' };
var RXA_CZ_FIX = { K_HIGH: '血鉀', EGFR_LOW: '腎功能', SBP_LOW: '血壓' };
var RXA_FLAG_ZH = { AGE_GE75: '75 歲以上', FRAILTY_SCREEN_POSITIVE: '衰弱篩檢陽性', FALL_LAST_12M: '過去 12 個月有跌倒' };
var RXA_STATUS_ZH = { SUPPORTED: '指引核心治療的試驗用藥', CLASS_EXTRAPOLATED: '同類推論（請藥師確認）', FORMULATION_UNKNOWN: '劑型不明（請藥師確認）', NOT_HF_FMT: '不是心衰竭核心治療的研究用藥' };
function rxaFlagZh(f) { var m = /^CFS_GE_(\d+)$/.exec(f || ''); return RXA_FLAG_ZH[f] || (m ? 'CFS ≥' + m[1] + '（院內候選閾值）' : f); }
function rxaNext(g) {
  var cr = g.caution_reasons || [];
  if (g.code === 'CAUTION_CONTEXT') return cr.indexOf('T1DM') >= 0 ? '下一步：請開立醫師與藥師今天核對處方' : '下一步：先處理' + cr.map(function (c) { return RXA_CZ_FIX[c]; }).filter(Boolean).join('／') + '，再討論此類藥物';
  if (g.code === 'REVIEW_EVIDENCE_ROLE') return '下一步：請藥師與開立醫師核對這個成分是不是此型心衰竭的實證核心成分';
  if (g.code === 'TITRATION_REVIEW_DUE') return '下一步：請醫師與藥師檢視是否已到可耐受上限，或記錄未調整的理由';
  if (g.reason_code === 'DX_NOT_CONFIRMED') return '下一步：請醫師確認心衰竭診斷，再對照核心藥物';
  if (g.reason_code === 'EVIDENCE_LIMITED_DIALYSIS') return '下一步：由心臟科、腎臟科與藥師個別評估';
  return '';
}
function rxaTeachHtml(g) {
  var t = g.teach || {}, rows = [];
  if (t.class_loe) rows.push('指引建議等級（規則登錄）：' + t.class_loe + (t.citation ? '；出處：' + t.citation : ''));
  if (t.dose_class_loe) rows.push('試驗目標對照：' + t.dose_class_loe + (t.dose_citation ? '；出處：' + t.dose_citation : ''));
  if (t.evidence_status) rows.push('成分證據：' + (RXA_STATUS_ZH[t.evidence_status] || t.evidence_status) + (t.scope_note ? '（' + t.scope_note + '）' : ''));
  if (t.role_source && (g.code === 'REVIEW_EVIDENCE_ROLE' || g.kind === 'CLASS')) rows.push('核心成分依據：' + t.role_source);
  if (g.evidence_note) rows.push('證據說明：' + g.evidence_note);
  (g.caution_detail || []).forEach(function (x) { if (x.source) rows.push((RXA_CZ_ZH[x.code] || x.code) + '的院內設定出處：' + x.source); });
  return rows.length ? '<details class="small" data-rxa="teach"><summary>教學：為什麼</summary><ul>' + rows.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></details>' : '';
}
function rxaGapLi(g) {
  var lab = (g.reason_code && RXA_REASON_ZH[g.reason_code]) || RXA_GAP_ZH[g.code] || GAP_ZH[g.code] || g.code, nx = rxaNext(g);
  var h = '<li data-code="' + esc(g.code) + '"' + (g.reason_code ? ' data-reason="' + esc(g.reason_code) + '"' : '') + '><b>' + esc(g.subject) + '</b>：' + esc(lab) + '｜' + esc(g.explanation) + (g.exclusions && g.exclusions.length ? '｜<span class="muted">排除條件：' + esc(g.exclusions.join('、')) + '</span>' : '');
  if (nx) h += '<br><span data-rxa="next">' + esc(nx) + '</span>';
  if (g.code !== 'CAUTION_CONTEXT' && (g.caution_reasons || []).length) h += '<br><span data-rxa="also">另需留意：' + esc(g.caution_reasons.map(function (c) { return RXA_CZ_ZH[c] || c; }).join('、')) + '</span>';
  if ((g.context_flags || []).length) h += '<br><span data-rxa="flags">' + chip('需個別化步調', 'warn') + ' ' + esc(g.context_flags.map(rxaFlagZh).join('、')) + '：請老年醫學與藥師共同評估起始與調整的步調（不排除、不改變上面的判斷）</span>';
  return h + rxaTeachHtml(g) + '</li>';
}
function rxaDxNote(G) {
  return (G && G.diagnosis && !G.diagnosis.recorded && G.profile ? '<p class="small muted" id="v4_gaps_dx">心衰竭診斷是否已確認（醫師）尚未記錄：上面的對照只依 LVEF；請醫師記錄診斷狀態。</p>' : '')
    /* CP-07（只做教學標示）：本系統的「改善」與 HFimpEF 國際定義不同 */
    + (G && G.improved ? '<p class="small muted" id="v4_gaps_impef">教學：本畫面的「射出分率改善」以 LVEF 曾經 <50%、目前 ≥50% 判定（核心藥物仍依降低型對照）；ESC 2026 §3.3.1 與第二版心衰竭通用定義（2026）的 HFimpEF 是先前 HFrEF、LVEF 絕對值增加 ≥10 個百分點且 >40%，兩者不同。</p>' : '');
}
REASON_ZH.V4_DX_UNRECORDED = '藥物建議需要醫師確認的心衰竭診斷';   /* 本次要問的原因（CP-02） */
function rxaHoldNote(c) { return c === 'SCHEDULED_SURGERY' ? '（預定手術；開立醫師下達的個人計畫。出處：Maddox 2024 ACC HFrEF ECDP Table 4——SGLT inhibitor 預定手術前至少 3 天暫時中斷，以降低酮酸中毒風險）' : ''; }
/* ==== W51-RXA END ==== */
/* ==== 5.1 W51-RXB 前端區（新函式只加在此區塊內） ==== */
/* CP-21／CP-22／CP-26：心衰竭可能惡化的藥物（醫療端）；DP-11／CP-25／CP-08：醫療端教學註記；PS-08：心理轉介範本的醫療端教學註記。全部只在醫療人員畫面，不進病人單張 */
WL_ZH.HF_HAZARD_REVIEW = ['心衰竭可能惡化的藥物待檢視', 'warn'];
WL_ZH.HF_HAZARD_PRESCRIBER = ['藥師已建議，待開立醫師回覆', 'warn'];   /* 5.2 B-05 */
WL_ZH.T01_EVENT_MISSING = ['7 天追蹤已完成，就醫事件待補', 'warn'];   /* 5.2 C-08 */
var RXB_SRC_ZH = { PRESCRIPTION: '處方', REPORTED_USE: '已確認的實際使用' };
var RXB_REVIEWED_ZH = { INTERVENTION: '已有藥事介入', PHARMACIST_REVIEW: '藥師已記錄用藥整合結論' };
/* 5.2 B-05：每一個藥的狀態（藥師檢視 ≠ 已解決） */
var RXB_STATE_ZH = { OPEN: '待藥師檢視', AWAITING_PRESCRIBER: '藥師已建議，待開立醫師回覆', ACCEPTED_PENDING_RX: '開立醫師已同意，待更新處方', RESOLVED: '開立醫師已回覆（保留，有理由）' };
function isPrescriber() { return (((ME.role_policy || {}).prescriber_roles) || []).indexOf(ME.role) >= 0; }
function declineReasonSel(id) { return '<select id="' + esc(id) + '" aria-label="保留（不採納）的理由"><option value="">保留時的理由</option>' + (((DICT.medication_changes || {}).decline_reasons) || []).map(function (x) { return opt(x[0], x[1]); }).join('') + '</select>'; }
function rxbRespHtml(x, it) {
  if (!isPrescriber() || ['AWAITING_PRESCRIBER', 'ACCEPTED_PENDING_RX'].indexOf(it.state) < 0) return '';
  var k = x.hazard + '_' + it.ingredient;
  return ' <span class="noprint"><select id="rxbrc_' + esc(k) + '" aria-label="開立醫師回覆：' + esc(ingName(it.ingredient)) + '">' + Object.keys(CMM_RC_ZH).map(function (c) { return opt(c, c === 'DECLINED_WITH_REASON' ? '保留（不採納，需理由）' : CMM_RC_ZH[c]); }).join('') + '</select> ' + declineReasonSel('rxbnc_' + k) +
    ' <button class="btn small" type="button" data-act="rxb_resp" data-val="' + esc(JSON.stringify({ hazard: x.hazard, ingredient: it.ingredient })) + '">記錄回覆（加入這次變更）</button><span class="small err" id="rxberr_' + esc(k) + '" role="alert"></span></span>';
}
function rxbPanelHtml() {
  var R = CUR.rec.v4 && CUR.rec.v4.sections && CUR.rec.v4.sections.rxb; if (!R) return '';
  var h = '', HZ = R.hazards || [], T = R.teach || [];
  if (HZ.length) {
    h += '<h3 id="rxb_hazards">心衰竭可能惡化的藥物（藥師檢視）</h3><p class="small muted">只提醒檢視，不提供任何用藥處置建議；核心藥物（ARNI／ACEI／ARB、beta-blocker、MRA、SGLT2 inhibitor）不列為減藥候選。</p><ul class="small" id="rxb_hz">' + HZ.map(function (x) {
      return '<li data-hazard="' + esc(x.hazard) + '" data-open="' + (x.open ? '1' : '0') + '"><b>' + esc(x.label) + '</b>：' + x.items.map(function (it) { return esc(ingName(it.ingredient)) + '（' + esc(it.sources.map(function (z) { return RXB_SRC_ZH[z] || z; }).join('＋')) + (it.reviewed ? '；' + esc(RXB_REVIEWED_ZH[it.reviewed] || it.reviewed) : '') + '）' + (it.state ? ' ' + chip(RXB_STATE_ZH[it.state] || it.state, it.state === 'RESOLVED' ? 'ok' : 'warn') : '') + (it.response && it.response.note_code ? '<span class="small muted">（理由：' + esc(mcZh('decline_reasons', it.response.note_code)) + '）</span>' : '') + rxbRespHtml(x, it); }).join('、') +
        (x.actionable ? '' : ' ' + chip('保留型：醫療端註記', '')) + '<br><span class="muted">' + esc(x.note) + '</span>' +
        (x.open && ME.role === 'PHARMACIST' ? x.items.filter(function (it) { return it.state === 'OPEN' || (!it.state && !it.reviewed); }).map(function (it) { return ' <button class="btn small noprint" type="button" data-act="rxb_draft" data-val="' + esc(it.ingredient) + '">預填減藥候選草稿：' + esc(ingName(it.ingredient)) + '</button>'; }).join('') : '') + '</li>';
    }).join('') + '</ul><details class="small"><summary>去處方五步驟（HFA 2025）</summary><p>' + esc(R.five_steps || '') + '</p></details>';
  }
  if (T.length) h += '<h3>用藥教學註記（醫療端）</h3><ul class="small" id="rxb_teach">' + T.map(function (x) { return '<li data-code="' + esc(x.code) + '">' + esc(x.text) + '</li>'; }).join('') + '</ul>';
  return h;
}
/* 預填藥事介入表單（分類＝減藥候選、藥品＝該成分）；只填表單，由藥師按「提出介入」才加入這次變更 */
function rxbDraft(ing) {
  var cc = $('cmm_cat'), ci = $('cmm_ing'), msg = $('rxb_draft_msg');
  if (!cc || !ci) { inlineErr('save_out', '找不到藥事介入表單：只有藥師可以提出介入。'); return; }
  if (!Array.prototype.some.call(ci.options, function (o) { return o.value === ing; })) { inlineErr('save_out', '這個藥不在目前處方或已確認的實際使用內，請先更新處方或實際使用紀錄，或在介入表單選擇其他藥品。'); return; }
  cc.value = 'DEPRESCRIBING_CANDIDATE'; ci.value = ing; ci.focus();
  if (!msg) { msg = document.createElement('p'); msg.id = 'rxb_draft_msg'; msg.className = 'small'; ci.parentNode.parentNode.appendChild(msg); }
  msg.textContent = '已預填「減藥候選｜' + ingName(ing) + '」：確認後按「提出介入（加入這次變更）」，再儲存。';
}
var RXB_TPL_NOTE = { MENTAL_CONSULT: '醫療端教學註記（ESC 2026 §10.7 正文，非建議表）：認知行為治療在 4–9 個月可減少焦慮與憂鬱、改善生活品質；sertraline（SADHART-CHF）與 escitalopram（MOOD-HF）安全性已證實，但減輕憂鬱未優於安慰劑；治療心衰竭病人的憂鬱應避免三環抗憂鬱劑（可能造成低血壓、心衰竭惡化與心律不整）。用藥選擇由開立醫師決定，藥師可協助核對交互作用。' };
function rxbTplNote() {
  var sel = $('na_tpl'); if (!sel) return;
  var el = $('rxb_tpl_note'), txt = RXB_TPL_NOTE[sel.value] || '';
  if (!el) { el = document.createElement('p'); el.id = 'rxb_tpl_note'; el.className = 'small muted'; sel.parentNode.parentNode.appendChild(el); }
  el.textContent = txt; el.hidden = !txt;
}
document.addEventListener('click', function (ev) { var t = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null; if (!t) return; var a = t.getAttribute('data-act');
  if (a === 'rxb_draft') rxbDraft(t.getAttribute('data-val'));
  else if (a === 'quick_ref') setTimeout(rxbTplNote, 0); });
document.addEventListener('change', function (ev) { if (ev.target && ev.target.id === 'na_tpl') rxbTplNote(); });
/* ==== W51-RXB END ==== */
/* ==== 5.1 W51-PSY 前端區（新函式只加在此區塊內） ==== */
/* 院內參數（登入時由伺服器帶來目前生效的值；伺服器另逐筆檢查） */
function psy_policy(k) { var P = (ME && ME.psy_policy) || {}; return { SELF_HARM_RULEOUT_ROLES: P.self_harm_ruleout_roles, PSYCH_FOLLOWUP_DAYS: P.psych_followup_days }[k] || null; }
/* PS-01：計畫訊息自帶的交接緊急度與到期天數（例如自傷念頭＝今天）→ 帶入轉介時覆寫範本預設；沒有就沿用範本 */
function psy_qrTail(q) { return q && (q.urgency || typeof q.due_days === 'number') ? '|' + (q.urgency || '') + '|' + (typeof q.due_days === 'number' ? q.due_days : '') : ''; }
function psy_qrApply(q) {
  if (!q || q.length < 3) return;
  if (q[2] && $('ho_urg') && (DICT.handoff_urgency || []).some(function (c) { return c[0] === q[2]; })) $('ho_urg').value = q[2];
  if (q[3] !== undefined && q[3] !== '' && isFinite(Number(q[3])) && $('na_due')) $('na_due').value = addDays(today(), Number(q[3]));
}
/* PS-06：自傷風險記「沒有」限院內參數 SELF_HARM_RULEOUT_ROLES；其他職類看到「立即告知護理師或醫師，並陪著病人」 */
function psy_canRuleOut() { var r = psy_policy('SELF_HARM_RULEOUT_ROLES'); return !Array.isArray(r) || r.indexOf(ME.role) >= 0; }
function psy_ruleoutNames() { var r = psy_policy('SELF_HARM_RULEOUT_ROLES'); return (Array.isArray(r) ? r : []).map(function (x) { return ROLE_ZH[x] || x; }).join('、'); }
function psy_enumOk(fid, x) { return !(fid === 'self_harm_risk' && x === 'NONE' && !psy_canRuleOut()); }
function psy_editorNote(fid) {
  if (fid !== 'self_harm_risk' || psy_canRuleOut()) return '';
  return '<p class="notice warn small" id="psy_sh_note">病人說有想傷害自己或不想活的念頭：立即告知護理師或醫師，並陪著病人。「沒有」請由' + esc(psy_ruleoutNames()) + '直接詢問後記錄。</p>';
}
function psy_stageErr(fid, val) { return fid === 'self_harm_risk' && val === 'NONE' && !psy_canRuleOut() ? '「沒有」請由' + psy_ruleoutNames() + '直接詢問後記錄；病人說有念頭時，請立即告知護理師或醫師，並陪著病人。' : ''; }
/* PS-09：心理師記錄「2 週內／1 個月內再追蹤」→ 預填一筆由心理師負責的追蹤行動（到期日＝今天＋院內參數 PSYCH_FOLLOWUP_DAYS；病人端預設看不到，儲存前可移除）；改選其他值 → 移除這一筆預填 */
var PSY_FU_STAGED = null;
function psy_afterStage(fid, val) {
  if (fid !== 'psych_followup_plan') return;
  if (PSY_FU_STAGED) { var i = ST.ac.indexOf(PSY_FU_STAGED); if (i >= 0) ST.ac.splice(i, 1); PSY_FU_STAGED = null; }
  var days = (psy_policy('PSYCH_FOLLOWUP_DAYS') || {})[val];
  if (typeof days !== 'number' || ME.role !== 'CLINICAL_PSYCHOLOGIST') return;
  PSY_FU_STAGED = { action_type: 'REFERRAL_MENTAL', action_ref: 'TPL:MENTAL_CONSULT', action_status: 'PLANNED', owner_role: 'CLINICAL_PSYCHOLOGIST', due_at: addDays(today(), days), patient_visible: false };
  ST.ac.push(PSY_FU_STAGED);
}
/* DP-25／PS-16：各職類評估結論（伺服器已依檢視者職類最少揭露；心理、社工對其他職類只有「有紀錄、日期、是否需追蹤或轉介」） */
function psy_roleConcHtml(where) {
  var P = CUR.rec.plan, L = P && P.role_conclusions; if (!L || !L.length) return '';
  var now = Date.parse(todayTW()), ago = function (d) { var n = Math.round((now - Date.parse(String(d || '').slice(0, 10))) / 86400000); return isNaN(n) ? '' : (n <= 0 ? '今天' : n + ' 天前'); };
  var yn = function (x) { return x === true ? '是' : (x === false ? '否' : '未記錄'); };
  return '<section class="panel" id="role_conc_' + esc(where) + '" aria-label="各職類評估結論"><h3>各職類評估結論</h3><ul class="small">' + L.map(function (g) {
    var head = '<strong>' + esc(ROLE_ZH[g.group] || g.group) + '</strong>';
    if (g.restricted) return '<li data-rc-group="' + esc(g.group) + '" data-restricted="1">' + head + '：有紀錄（' + esc(md(g.on)) + '，' + esc(ago(g.on)) + '；內容限相關職類查看）' +
      (g.group === 'CLINICAL_PSYCHOLOGIST' ? '；需要追蹤：' + yn(g.needs_followup) : '') + '；需要轉介：' + yn(g.needs_referral) + '</li>';
    return '<li data-rc-group="' + esc(g.group) + '">' + head + '：' + (g.items || []).map(function (i) {
      return '<span data-rc-field="' + esc(i.field) + '">' + esc(field(i.field).label) + '：' + esc(i.label) + '（' + esc(md(i.on)) + '，' + esc(ago(i.on)) + (i.role && i.role !== g.group ? '，' + esc(ROLE_ZH[i.role] || i.role) + '記錄' : '') + '）</span>'; }).join('；') + '</li>';
  }).join('') + '</ul></section>';
}
/* ==== W51-PSY END ==== */
/* ==== 5.1 W51-LEAF 前端區（新函式只加在此區塊內） ==== */
/* 新版單張（printPlanV5，只對模擬病人）：求救分區（NU-01／NU-02）、還沒完成的準備（NU-05／NU-07）、日夜聯絡（NU-06）、體重空格與 14 天表（NU-03）、乾體重訂定日（NU-04）、
   和上次不同（PR-14）、教回題與收尾區同一份（NU-08／NU-17）。病人會印出的新句子全部在 CONTENT_GATE 的 PRINT_V51_* 代碼下（PENDING＝只對模擬病人）。 */
var LEAF_ZONE = [['RED', '紅區：立刻求救', ['EMERGENCY', 'URGENT_NOW']], ['YELLOW', '黃區：今天就要處理', ['URGENT_IN_PERSON', 'SAME_DAY']]];
var LEAF_HINT_EG = ['S_BREATH'];   /* 黃區印「（例如：…）」的警訊：提示文字本身是症狀例子（S_BREATH：躺平就喘、半夜喘醒）；其他提示是安全確認畫面的操作說明，不適合印在紙上 */
var LEAF_Q119 = '出現哪些情況要打 119？哪些要當天打電話給醫療團隊？';
var LEAF_PREP_PT = { MED_LIST: '核對目前在吃的藥', WEIGHT_PLAN: '體重增加多少要打電話', NEXT_CONTACT: '下次回診或電話追蹤的日期', LAB_DATE: '下次抽血的日期', CONTACT_ROUTE: '晚上和假日的聯絡方式' };
var LEAF_PREP_CLIN = {
  MED_LIST: ['用藥：還沒有處方或實際使用紀錄（單張寫「核對目前在吃的藥」；到「用藥」分頁登錄）', '', '', ''],
  WEIGHT_PLAN: ['體重警戒值（幾天內增加幾公斤要聯絡）：還沒有醫療團隊確認的值（單張印空格，附件附 14 天表）', 'edit', 'weight_alert_kg', '填體重警戒值'],
  NEXT_CONTACT: ['下次回診或電話追蹤：還沒有排，也沒有記錄不需安排的理由（到「就醫與行動」分頁排）', '', '', ''],
  LAB_DATE: ['下次抽血：還沒有排（到「就醫與行動」分頁排）', '', '', ''],
  CONTACT_ROUTE: ['日夜聯絡方式：院方還沒有設定完整的服務時間與非服務時間處理方式（單張先印「晚上、假日打給：＿＿」空格，請手寫）', '', '', ''] };
var LEAF_PREP_ORDER = ['MED_LIST', 'WEIGHT_PLAN', 'NEXT_CONTACT', 'LAB_DATE', 'CONTACT_ROUTE'];
var LEAF_SEC_PT = { FOCUS: '這次重點', PRACTICE: '還要練習的', KNOWN: '已經會的主題', MED: '我的用藥', VALUES: '我的個人數值', NEXT: '下次聯絡' };
var LEAF_FOLD = ['KNOWN', 'PRACTICE', 'MED'];   /* 和上一張相同時可以折疊的段落；重點、個人數值、求救、下次聯絡、教回欄每次都印 */
function leafV5On() { return contentGate('PRINT_V5') && !!(CUR.rec.plan_patient_view && CUR.rec.plan_patient_view.v5); }
function leafSvc() { var s = FAC_SVC[CUR.rec.facility_code]; return s && s.owner_role && s.response_time && s.hours && s.after_hours ? s : null; }
function leafRouteOk() { return !!(FAC_PHONE[CUR.rec.facility_code] && leafSvc()); }
/* NU-06：電話與院方服務資訊（四項）齊全才印服務時間與非服務時間處理方式；否則留空格請醫療團隊手寫 */
function leafContactHtml() { var s = leafSvc(); return leafRouteOk() ? '<span id="v5_svc">｜服務時間：' + esc(s.hours) + '；非服務時間：' + esc(s.after_hours) + '</span>' : '<span id="v5_svc_blank">｜晚上、假日打給：＿＿＿＿＿＿＿＿</span>'; }
function leafPrep(V5) { var ok = leafRouteOk(); return (V5.prep || []).filter(function (n) { return LEAF_PREP_PT[n] && !(n === 'CONTACT_ROUTE' && ok); }); }
function leafPrepHtml(prep) { return '<p id="v5_prep" data-prep="' + esc(prep.join(' ')) + '">還沒完成的準備（請醫療團隊幫忙填好）：' + esc(prep.map(function (n) { return LEAF_PREP_PT[n]; }).join('、')) + '。</p>'; }
function leafPrevOf() { return (CUR.rec.plan && CUR.rec.plan.w51_leaf_prev) || null; }   /* 和上一張單張的逐段比對（伺服器只對模擬病人計算；不在病人端投影） */
function leafFolded(V5) {
  var P = leafPrevOf(); if (!P || !contentGate('PRINT_V51_DIFF')) return [];
  return LEAF_FOLD.filter(function (k) { return P.same.indexOf(k) >= 0 && (k === 'MED' || (k === 'KNOWN' ? V5.known.length : V5.practice.length)); });
}
/* PR-14：頂端「和上次不同」；沒有變的段落折成一行（只列實際被折疊、這次不重印的段落） */
function leafDiffHtml(V5, cg, fold) {
  var P = leafPrevOf(); if (!P) return '';
  var ch = (V5.learned.length ? ['上次以來學會的'] : []).concat(['KNOWN', 'FOCUS', 'PRACTICE', 'MED', 'VALUES', 'NEXT'].filter(function (k) { return P.changed.indexOf(k) >= 0 && (k !== 'KNOWN' || V5.known.length); }).map(function (k) { var n = (P.new_focus || []).length; return LEAF_SEC_PT[k] + (k === 'FOCUS' && n ? '（' + n + ' 項是新的或往前一步）' : ''); }));
  return '<p id="v5_diff" class="v5-diff" data-changed="' + esc(P.changed.join(' ')) + '"><strong id="v5_diff_h">和上次（' + esc(md(P.date)) + '）不同的地方：</strong>' + (ch.length ? esc(ch.join('、')) + '。' : '沒有新的內容。') +
    (fold.length ? '<span id="v5_same" data-same="' + esc(fold.join(' ')) + '">其餘和 ' + esc(md(P.date)) + ' 那張相同：' + esc(fold.map(function (k) { return LEAF_SEC_PT[k]; }).join('、')) + '（這次不再重印）。</span>' : '') + '</p>';
}
/* NU-04：乾體重訂定日；早於最近一次心衰竭出院 → 請再確認 */
function leafDryNote(dw) { return dw && dw.on ? '（' + md(dw.on) + '訂' + (dw.before_discharge ? '；出院前訂的，請和醫療團隊再確認' : '') + '）' : ''; }
/* NU-01／NU-02：紅區（119、現在去急診）與黃區「今天聯絡」每項一行、固定展開；本次警訊加粗；只有「今天請人陪您去看醫師」在沒有本次警訊、又附附件時收合 */
function leafZonesHtml(V5, floor, collapsed) {
  var byLv = {}; floor.forEach(function (r) { byLv[r.level] = r; });
  var cat = catalog().safety_signals || [], now = {}, hintOn = contentGate('PRINT_V51_HINT'); (V5.safety_now || []).forEach(function (id) { now[id] = 1; });
  var li = function (lv, label) {
    var s = cat.filter(function (x) { return x.level === lv && x.label === label; })[0] || null, b = !!(s && now[s.id]), hint = hintOn && s && s.hint && LEAF_HINT_EG.indexOf(s.id) >= 0 ? '（例如：' + s.hint + '）' : '';
    return '<li' + (s ? ' data-sig="' + esc(s.id) + '"' : '') + (b ? ' class="v5-now"' : '') + '>' + (b ? '<strong>' : '') + esc(label + hint) + (b ? '</strong>' : '') + '</li>'; };
  return '<h2>什麼時候要求助</h2><div id="v5_help">' + LEAF_ZONE.map(function (z) {
    var lvls = z[2].filter(function (l) { return byLv[l]; }); if (!lvls.length) return '';
    return '<div class="rung" data-zone="' + z[0] + '">' + lvls.map(function (l, i) {
      var r = byLv[l], zt = i ? '' : '<strong>' + esc(z[1]) + '</strong>｜';   /* 區名和第一個等級放同一行（維持 A4 一頁） */
      return collapsed.indexOf(r) >= 0 ? '<p class="v5-lv" id="v5_help_more" data-lv="' + esc(l) + '">' + zt + '<strong>' + esc(r.headline) + '</strong>：完整清單見附件（' + r.signals.length + ' 項）。</p>'
        : '<p class="v5-lv" data-lv="' + esc(l) + '">' + zt + '<strong>' + esc(r.headline) + '</strong>：</p><ul class="v5-sig">' + r.signals.map(function (x) { return li(l, x); }).join('') + '</ul>'; }).join('') + '</div>'; }).join('') +
    '<div class="rung" data-zone="GREEN"><strong>綠區：照計畫做</strong><br>沒有上面的情況：照這張紙的重點做，下次聯絡時再一起看。</div></div>';
}
/* PR-14：附件只印第 1 頁沒有展開的等級；第 1 頁已展開的寫一行（119 清單不再每張印兩次） */
function leafAppendixHelp(floor, collapsed) {
  var main = floor.filter(function (r) { return collapsed.indexOf(r) < 0; }), rest = floor.filter(function (r) { return collapsed.indexOf(r) >= 0; });
  return (main.length ? '<p class="rung" id="v5_appx_main" data-lv="' + esc(main.map(function (r) { return r.level; }).join(' ')) + '">' + esc(main.map(function (r) { return r.headline; }).join('、')) + '：已印在第 1 頁「什麼時候要求助」，這裡不重印。</p>' : '') +
    rest.map(function (r) { return '<div class="rung" data-lv="' + esc(r.level) + '"><strong>' + esc(r.headline) + '</strong>：' + esc(r.signals.join('；')) + '</div>'; }).join('');
}
/* NU-03：沒有醫療團隊確認的體重警戒 → 附件附 14 天自我觀察表（欄位與公版 src/app.js diaryHtml 相同） */
function leafDiaryHtml() {
  var cols = ['日期', '早上體重', '比昨天多／少', '喘（和平常比）', '腳或肚子腫', '血壓／心跳（有量才填）', '藥都吃了', '備註'], rows = '', f = CUR.rec.view.fields || {}, dw = f.dry_weight_kg && typeof f.dry_weight_kg.value === 'number' && f.dry_weight_kg.verification_state === 'VERIFIED' ? f.dry_weight_kg.value : null;
  for (var i = 0; i < 14; i++) rows += '<tr>' + cols.map(function () { return '<td>&nbsp;</td>'; }).join('') + '</tr>';
  return '<h2 id="v5_diary_h">附件：14 天自我觀察表</h2><p style="font-size:9.5pt">每天早上起床、上完廁所、吃東西前，用同一台秤量體重。我的乾體重：' + (dw !== null ? esc(dw) + ' 公斤' : '＿＿＿ 公斤') + '；打電話的標準：＿＿＿＿＿＿。</p>' +
    '<table id="v5_diary" class="v5-diary"><thead><tr>' + cols.map(function (c) { return '<th scope="col">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p style="font-size:9.5pt">出現第 1 頁「什麼時候要求助」列出的情況，照那裡寫的時間處理；看診時把這張表帶去。</p>';
}
/* NU-08／NU-17：單張教回欄與收尾區同一份題目。「要做什麼」是團隊工作的卡不問那一題；固定求救題記在「今天聯絡」卡的「什麼情況要提早求助」 */
function leafTbRows(V5) {
  var rows = V5.today.filter(function (a) { var c = cardFull(a.card_id) || {}; return a.team_scope !== 'ACTION' || (c.teach && c.teach.prompt) || (c.check && c.check.q); }).slice(0, 2)
    .map(function (a) { return { card_id: a.card_id, q: teachPrompt(a.card_id) }; }).filter(function (r) { return r.q; });
  rows.push({ card_id: 'SAME_DAY', tbi: 'SAME_DAY-WHEN_HELP', facet: 'WHEN_HELP', q: LEAF_Q119 });
  return rows;
}
function leafClosingHtml() {
  var P = CUR.rec.plan, V5 = CUR.rec.plan_patient_view.v5, nq = (P.next_visit_questions || []).slice(0, 3), lb = {}, tbBy = {};
  (P.learning || []).forEach(function (l) { lb[l.card_id] = l; }); leafTbRows(V5).forEach(function (r) { tbBy[r.card_id] = r; });
  var ctl = function (cid, prompt) { return eduControlHtml({ card_id: cid, id: '', prompt: prompt || '', education: { facets: (lb[cid] || {}).facets || [] } }); };
  var inToday = V5.today.some(function (a) { return a.card_id === 'SAME_DAY'; });
  var h = '<section class="panel wb" id="wb_close" data-src="v5"><h3>4　收尾</h3><p class="small">本次行動：在下方「這次的變更」確認後儲存；需要交接時到「就醫與行動」。</p>';
  h += '<div id="wb_teach" class="small"><p><strong>衛教與教回（和新版單張同一份）</strong></p>' + (V5.today.length ? '<ul id="wb_teach_list">' + V5.today.map(function (a) {
    var q = tbBy[a.card_id];
    return '<li data-card="' + esc(a.card_id) + '" data-stage="' + esc(a.stage) + '"><strong>' + esc(cardTitle(a.card_id)) + '</strong>（' + esc(stageZh(a.stage)) + '）' + (q ? '：「' + esc(q.q) + '」' : '：「要做什麼」是團隊工作，單張不問；可記錄其他學習目標') + ctl(a.card_id, q ? q.q : '') + '</li>'; }).join('') + '</ul>' : '<p id="wb_teach_none">這次單張沒有列衛教重點（維持與確認）。</p>') +
    '<p id="wb_tb119" data-tbi="SAME_DAY-WHEN_HELP">單張固定題：「' + esc(LEAF_Q119) + '」記在「' + esc(cardTitle('SAME_DAY')) + '」的「' + esc(FACET_ZH.WHEN_HELP) + '」。</p>' + (inToday ? '' : ctl('SAME_DAY', LEAF_Q119)) + '</div>';
  /* NU-05：團隊工作（不算病人學習）＋準備缺口；PS-11：連續多次沒有往前的練習改由醫療端處理 */
  var prep = leafPrep(V5), team = V5.team || [];
  if (!leafRouteOk() && prep.indexOf('CONTACT_ROUTE') < 0) prep.push('CONTACT_ROUTE');
  prep = LEAF_PREP_ORDER.filter(function (n) { return prep.indexOf(n) >= 0; });
  h += '<div id="wb_team" class="small"><p><strong>團隊要準備的（不算病人學習；填好後新版單張會印出內容）</strong></p>' +
    (team.length ? '<p id="wb_team_cards">團隊工作卡（不進學習階梯推進、不列教回）：' + team.map(function (t) { return '<span data-card="' + esc(t.card_id) + '">' + esc(cardTitle(t.card_id)) + (t.scope === 'ACTION' ? '（只有「要做什麼」）' : '') + '</span>'; }).join('、') + '</p>' : '') +
    (prep.length ? '<ul id="wb_prep">' + prep.map(function (n) { var c = LEAF_PREP_CLIN[n]; return '<li data-prep="' + esc(n) + '">' + esc(c[0]) + (c[1] ? ' <button class="btn small noprint" type="button" data-act="' + esc(c[1]) + '" data-val="' + esc(c[2]) + '">' + esc(c[3]) + '</button>' : '') + '</li>'; }).join('') + '</ul>' : '<p id="wb_prep_none">需要的準備都已完成。</p>') +
    ((V5.stalled || []).length ? '<ul id="wb_stalled">' + V5.stalled.map(function (x) { return '<li data-card="' + esc(x.card_id) + '">' + esc(cardTitle(x.card_id)) + '（' + esc(stageZh(x.stage)) + '）：最近一次衛教紀錄之後已經 ' + esc(x.contacts) + ' 次接觸沒有往前，新版單張不再列在「還要練習的」。請換個方式，或在「衛教歷程」交給其他職類。</li>'; }).join('') + '</ul>' : '') + '</div>';
  return h + '<p class="small" id="wb_next">下次確認的事：' + (nq.length ? nq.map(function (id) { return esc(cardTitle(id)); }).join('、') : '沒有') + '</p></section>';
}
/* ==== W51-LEAF END ==== */
/* ==== 5.1 W51-NUR 前端區（新函式只加在此區塊內） ==== */
/* NU-09：記錄今天聯絡級警訊（或居家體重）時，儲存前選這次的處置與時間；沒選處置＝建立待處理警訊（伺服器同樣 fail-safe）。
   處置碼只留稽核、不改病人端文字；「仍建立」可和處置同時勾（處置後仍交給團隊追蹤結果） */
var NUR_SAME_DAY_ZH = [['NOTIFIED_PHYSICIAN_IN_PERSON', '已當面通知醫師'], ['SAME_DAY_VISIT_ARRANGED', '今日已安排加診'], ['PATIENT_TO_CALL_TEAM_TODAY', '已請病人今天自行聯絡醫療團隊']];
function nurNowHHMM() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 16); }
function nurSameDayRowHtml() {
  var e = enc(), cur = NUR_SAME_DAY_ZH.some(function (x) { return x[0] === e.suppress; }) ? e.suppress : '';
  if (!e.disp_time) e.disp_time = nurNowHHMM();
  var sig = ST.obs.safety_signals && Array.isArray(ST.obs.safety_signals.value) && ST.obs.safety_signals.value.length;
  return '<div class="notice warn" id="nur_sd_box"><p><strong>' + (sig ? '這次記錄的是今天要聯絡的警訊：請選這次的處置' : '這次記了居家體重：如果已達到團隊訂的標準，就是今天要聯絡的警訊，請選這次的處置') + '</strong>。沒有選處置時，儲存會建立待處理警訊（團隊工作清單看得到，要有人回應並確認後續）。如果病人現在需要立刻求救，請先依求救階梯處理，再回來儲存。</p>' +
    '<div class="row"><label class="f">這次的處置（必選）<select id="alert_suppress"><option value="">還沒處置：建立待處理警訊</option>' + NUR_SAME_DAY_ZH.map(function (x) { return opt(x[0], x[1], cur === x[0]); }).join('') + '</select></label>' +
    '<label class="f">處置時間<input type="time" id="alert_disp_time" value="' + esc(e.disp_time) + '"></label></div>' +
    '<label><input type="checkbox" id="raise_alert"' + (e.raise === true ? ' checked' : '') + '> 仍建立待處理警訊（交給團隊追蹤結果）</label>' +
    '<p class="small muted">選了處置就不建立，並會留下處置與時間的紀錄；只補一筆居家體重且沒有達到團隊訂的標準時，不會建立。</p></div>';
}
function nurDispositionPayload(p) {
  var sel = $('alert_suppress'), isSd = sel && NUR_SAME_DAY_ZH.some(function (x) { return x[0] === sel.value; });
  if (!isSd) return;
  var tm = $('alert_disp_time') ? $('alert_disp_time').value : (enc().disp_time || '');
  p.alert_disposition_time = /^\d{2}:\d{2}$/.test(tm) ? tm : '';
}
document.addEventListener('change', function (ev) { var t = ev.target; if (t && t.id === 'alert_disp_time') enc().disp_time = t.value; });
/* CP-03：STRONG-HF 判定改為「試驗族群特徵」顯示；路徑另列（所有索引出院都列 6 週候選訪視，確認不穩定除外） */
Object.assign(TR_EL_ZH, { ELIGIBLE_PENDING_STABILITY_CONFIRMATION: 'STRONG-HF 試驗族群特徵：符合資料條件，待醫療人員確認血行動力學穩定', ELIGIBLE_STABILITY_CONFIRMED: 'STRONG-HF 試驗族群特徵：符合，已確認穩定',
  NOT_ELIGIBLE: 'STRONG-HF 試驗族群特徵：不符合', DATA_INSUFFICIENT: 'STRONG-HF 試驗族群特徵：資料不足' });
var NUR_TR_PATH_ZH = { STRONG_HF_CANDIDATE: '出院後 6 週密集追蹤候選', ESC26_INTENSIVE_6W_CANDIDATE: '出院後 6 週密集追蹤候選', EXISTING_7_DAY_FOLLOWUP: '沿用既有 7 天追蹤' };
function nurTrPathHtml(pl) { var z = NUR_TR_PATH_ZH[pl.path]; return z ? '｜<span data-tr-path="' + esc(pl.path) + '">' + esc(z) + '</span>' : ''; }
/* NU-10：出院前檢核補「只列有無」項（不判斷是否適合出院） */
function nurPredischargeHtml(n) {
  if (!n) return '';
  var yn = function (b, y, no) { return b ? y : no; };
  var held = (n.held_meds || []).length ? (n.held_all_have_reassess_date ? '都有重新評估日' : '有藥缺重新評估日') : '沒有暫停中的藥';
  return '<p class="small" data-nur-pre="1">出院前檢核（續）：警訊卡「什麼情況要提早求助」教回' + yn(n.alert_card_teach_back_done, '已通過', '未記錄') + '｜出院後實際用藥清單' + yn(n.med_list_after_discharge, '已記錄', '未記錄') +
    '｜體重警戒' + yn(n.weight_alert_set, '已設定', '未設定') + '｜口服利尿劑處方' + yn(n.oral_diuretic_rx, '有', '沒有') + '｜抽血' + (n.lab_check_due ? '已排（' + esc(md(n.lab_check_due)) + '）' : '未排') +
    '｜暫停中的藥：' + held + '｜心臟復健轉介' + yn(n.rehab_referral, '已建立', '未建立') + '<br><span class="muted">' + esc(n.note || '') + '</span></p>';
}
/* ==== W51-NUR END ==== */
/* ==== 5.1 W51-DPT 前端區（新函式只加在此區塊內） ==== */
/* ==== W51-DPT END ==== */
/* ==== 5.1 W51-ASK 前端區（新函式只加在此區塊內） ==== */
/* PR-13／NU-11：一鍵確認——伺服器題目預算 ask_budget.confirm 列的項目（和上次相同且仍有效、體重警戒計畫已設定、今天其他同仁已記錄）不算在本次需要；
   「全部相同」或逐項確認：和上次相同 → 暫存 CONFIRM（與整段沿用同一個 bulk_confirm 註記，伺服器逐筆檢查）；今天已記錄 → 只送被引用的事件代碼（同日引用稽核），不建立新觀察。
   有不同就逐項改填（改記本次的新答案，取代確認）。醫療端畫面，不經內容閘門。 */
W5C_OTHER_ZH.ROLE_CORE_NOT_NEEDED = '本職核心這次不需要（例如用藥清單已完整）';
W5C_OTHER_ZH.STILL_VALID = '仍在有效期內（需要時再記）';
function ask51Items() { var B = CUR && CUR.rec && CUR.rec.ask_budget; return B && B.confirm && Array.isArray(B.confirm.items) ? B.confirm.items.filter(function (it) { return it.field_ids.some(function (f) { return !!DICT.fields[f]; }); }) : []; }
function ask51Fields() { var out = []; ask51Items().forEach(function (it) { it.field_ids.forEach(function (f) { if (DICT.fields[f]) out.push(f); }); }); return out; }
function ask51Store() { var e = enc(); e.ask51 = e.ask51 || { refs: {} }; return e.ask51; }
function ask51Refs() { var r = ask51Store().refs; return Object.keys(r).filter(function (f) { return !ST.obs[f]; }).map(function (f) { return r[f]; }); }
function ask51FieldState(it, fid) {
  var o = ST.obs[fid]; if (o) return o.action_type === 'CONFIRM' ? 'CONFIRMED' : 'CHANGED';
  return it.write === 'REFERENCE' && ask51Store().refs[fid] ? 'CONFIRMED' : '';
}
function ask51Done(it) { return it.field_ids.every(function (f) { return !DICT.fields[f] || !!ask51FieldState(it, f); }); }
function ask51Stage(it) {
  var A = ask51Store();
  if (it.write === 'REFERENCE') { (it.refs || []).forEach(function (c) { if (!ST.obs[c.field_id] && c.event_id) A.refs[c.field_id] = c.event_id; }); return; }
  it.field_ids.forEach(function (fid) {
    if (ST.obs[fid] || !DICT.fields[fid] || !fieldAuthorized(fid)) return;
    var f = field(fid), e = CUR.rec.view.fields[fid]; if (!e || f.reuse_policy === 'ALWAYS_REASSESS') return;
    var src = allowedSources(f).indexOf(e.source_type) >= 0 ? e.source_type : allowedSources(f)[0];
    ST.obs[fid] = { field_id: fid, action_type: 'CONFIRM', source_type: src, label: 'CONFIRM', qualifiers: { bulk_confirm: true }, client_observed_old_value: e.value };
  });
}
function ask51Unstage(it) {
  var A = ask51Store();
  it.field_ids.forEach(function (fid) { delete A.refs[fid]; var o = ST.obs[fid]; if (o && o.action_type === 'CONFIRM' && o.qualifiers && o.qualifiers.bulk_confirm) delete ST.obs[fid]; });
}
function ask51Act(act, val) {
  var items = ask51Items();
  var after = function () { if (stagedCount()) afterStage(); else renderPatient(); };   /* 只有引用（沒有新觀察）時不顯示「尚未儲存」 */
  if (act === 'ask51_all') { var all = items.every(ask51Done); items.forEach(all ? ask51Unstage : ask51Stage); after(); return true; }
  if (act === 'ask51_one' || act === 'ask51_undo') { var it = items.filter(function (x) { return x.key === val; })[0]; if (it) { (act === 'ask51_one' ? ask51Stage : ask51Unstage)(it); after(); } return true; }
  return false;
}
var ASK51_KIND_ZH = { UNCHANGED: '和上次相同', PLAN_SET: '計畫已設定', SAME_DAY: '今天已記錄', SAME_DAY_RECHECK: '今天已記錄（請確認或更新）' };   /* 5.2 C-01 */
function ask51Line(it, v) {
  var parts = it.field_ids.filter(function (f) { return DICT.fields[f]; }).map(function (fid) {
    var ref = (it.refs || []).filter(function (c) { return c.field_id === fid; })[0], e = v.fields[fid], st = ask51FieldState(it, fid);
    var val = ref ? fmtVal(fid, ref.value) : (e ? fmtVal(fid, e.value) : '—');
    var who = ref ? '今天 ' + hm(ref.at) + ' 由' + (ROLE_ZH[ref.role] || ref.role || '醫療人員') + '記錄' : (e ? md(e.effective_at || e.recorded_at) + (e.provider_role ? '，' + (ROLE_ZH[e.provider_role] || e.provider_role) : '') + '記錄' : '');
    var stx = st === 'CHANGED' ? ' ' + chip('已改填（本次新答案）', 'warn') : st === 'CONFIRMED' ? ' ' + chip(ref ? '已確認（沿用今天的紀錄）' : '已確認', 'ok') : '';
    var ed = CUR.editing === fid ? editorHtml(fid, e) : (st ? '' : ' <button class="btn small noprint" type="button" data-act="edit" data-val="' + esc(fid) + '">有變化，改填</button>');
    return '<span data-fid="' + esc(fid) + '">' + esc(field(fid).label) + '：' + esc(val) + '<span class="small muted">（' + esc(who) + '）</span>' + stx + ed + '</span>';
  });
  var done = ask51Done(it);
  return '<li class="small" data-key="' + esc(it.key) + '" data-kind="' + esc(it.kind) + '">' + chip(ASK51_KIND_ZH[it.kind] || '', '') + ' ' + parts.join('；') +
    (done ? ' <button class="btn small noprint" type="button" data-act="ask51_undo" data-val="' + esc(it.key) + '">取消確認</button>' : ' <button class="btn small noprint" type="button" data-act="ask51_one" data-val="' + esc(it.key) + '">確認</button>') +
    '<br><span class="muted">' + esc(it.why || '') + '</span></li>';
}
function ask51ConfirmHtml(v) {
  var items = ask51Items(); if (!items.length) return '';
  var n = items.length, all = items.every(ask51Done), fs = ask51Fields(), open = fs.indexOf(CUR.editing) >= 0 || items.some(function (it) { return !ask51Done(it) && it.field_ids.some(function (f) { return ST.obs[f]; }); });
  return '<section class="panel wb" id="ask51_box" aria-label="一鍵確認"><h3>一鍵確認（' + n + ' 項，不算在本次需要）</h3>' +
    '<p class="small">和上次相同，或今天其他同仁已記錄，請和病人確認：<label><input type="checkbox" id="ask51_all" data-act="ask51_all"' + (all ? ' checked' : '') + '> 全部相同</label>' +
    '<span class="muted">（勾選後 ' + n + ' 項一起記為已確認；和上次相同的寫入確認紀錄，今天已記錄的記為引用今天的紀錄）</span></p>' +
    '<details id="ask51_items"' + (open ? ' open' : '') + '><summary>逐項查看（' + n + '）：有不同的項目請改填</summary><ul>' + items.map(function (it) { return ask51Line(it, v); }).join('') + '</ul></details></section>';
}
/* ==== W51-ASK END ==== */
/* ==== 5.1 W51-UX 前端區（新函式只加在此區塊內） ==== */
/* PR-12：主畫面 6 項（病人安全→核心治療→轉銜→衛教→負擔）；其餘群組在「其他指標」收合 */
function uxMainHtml(v) {
  var items = v.main_items || []; if (!items.length) return '<h2>主畫面</h2>';
  return '<h2>主畫面：6 項核心指標</h2><p class="small muted">依病人安全、核心治療、轉銜、衛教、負擔各取一項。比率指標分母未達 ' + esc(v.min_n_rate_display || '（未設定）') + ' 只顯示人數，不顯示百分比；達到時附 95% 信賴區間。分母 1–4 照舊遮蔽。</p><div class="tiles" id="team_main6">' +
    items.map(function (i) { var m = i.metric; if (!m) return '<div class="tile" data-main-item="' + esc(i.item_id) + '"><div class="small">' + esc(i.domain_zh) + '</div><div class="v">—</div><div class="d small muted">這一項目前沒有可顯示的結果</div></div>';
      return '<div class="tile" data-main-item="' + esc(i.item_id) + '" data-main-metric="' + esc(m.metric_id) + '" data-v5state="' + esc(m.display_state) + '"><div class="small"><strong>' + esc(i.domain_zh) + '</strong>｜' + esc(m.metric_id) + '　' + esc(m.name_zh) + '</div><div class="v">' + v5Val(m) + '</div><div class="d small">' + v5Cells(m) + '</div></div>'; }).join('') + '</div>';
}
function uxPctTxt(x) { return (Math.round(x * 1000) / 10) + '%'; }
function uxRateHtml(r) {
  if (!r.show_pct) return '<span data-rate="n_over_n">' + esc(r.n) + '／' + esc(r.N) + '</span><br><span class="small muted">' + (r.min_n ? '分母未達 ' + esc(r.min_n) + '，只顯示人數' : '最小分母未設定，只顯示人數') + '</span>';
  return '<span data-rate="pct">' + uxPctTxt(r.n / r.N) + '</span><br><span class="small muted" data-ci="1">95% 信賴區間 ' + uxPctTxt(r.ci_low) + '–' + uxPctTxt(r.ci_high) + '（' + esc(r.n) + '／' + esc(r.N) + '）</span>';
}
/* NW-03／PR-07：4.9 逐項清單在每位病人一列的摘要正常時預設收合（摘要失敗時照舊展開）；安全警訊段不收 */
function uxWl49Open() { var v = WL && WL.v5, collapse = !!(v && !v.error); return '<details class="panel" id="wl_v49_items"' + (collapse ? '' : ' open') + '><summary>逐項清單（4.9 版面，與上方摘要同一份資料' + (collapse ? '；預設收合' : '') + '）</summary>'; }
function uxWl49Close() { return '</details>'; }
/* PR-07／NW-07：給病人的單張只留一個主要按鈕——模擬病人且新版單張開放 → 新版版面；其他 → 原版面。原入口名稱 print_plan／print_plan_v5 保留（模擬病人另有「原版面（比對用）」） */
function uxPrintButtons() {
  if (contentGate('PRINT_V5')) return '<button class="btn small" type="button" data-act="print_plan_v5" id="print_v5_btn" data-print-primary="V5">列印給病人的照護計畫</button>' + (contentGate('PRINT_V52_AUDIENCE') ? ' <label class="small" for="pv5_who">這張給 <select id="pv5_who"><option value="SELF">病人本人</option><option value="CAREGIVER">家人或照顧者</option>' + (contentGate('PRINT_V52_FOREIGN_CG') && fcYes() ? '<option value="FOREIGN_CAREGIVER">外籍看護</option>' : '') + '</select></label>' +
    (contentGate('PRINT_V52_FOREIGN_CG') && fcYes() ? ' <label class="small" for="pv5_lang">語言 <select id="pv5_lang">' + Object.keys((field('caregiver_language').enum_labels) || { ZH_TW: '華語' }).map(function (k) { var ok = k === 'ZH_TW'; return '<option value="' + esc(k) + '"' + (ok ? '' : ' disabled') + '>' + esc(field('caregiver_language').enum_labels[k]) + (ok ? '' : '（尚未翻譯，待雙審）') + '</option>'; }).join('') + '</select></label>' : '') : '') + '<label class="small" for="pv5_appx"><input type="checkbox" id="pv5_appx" checked> 附完整求救清單與吃藥時間表（附件頁）</label><button class="btn small" type="button" data-act="print_plan" data-print-compare="1">原版面（比對用）</button>';
  return '<button class="btn small" type="button" data-act="print_plan" data-print-primary="V49">列印給病人的照護計畫</button>';
}
/* ==== W51-UX END ==== */
})();

