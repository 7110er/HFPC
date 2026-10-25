/* =====================================================================
 * 心衰竭照護對話｜介面控制（只在瀏覽器記憶體運作；不送出、不儲存）
 * 禁止事項（建置與測試會檢查）：fetch / XMLHttpRequest / sendBeacon / WebSocket /
 * localStorage / sessionStorage / indexedDB / document.cookie / google.script.run
 *
 * 單一來源：
 *  - 分流怎麼呈現：只讀 E.routeView()（content.js route_ui）
 *  - 今天先做／看診先問／帶什麼：只讀 r.projection（summary.js，DecisionOutput）
 *  - 下一題問什麼：只讀 QR.next()（questions.js）
 * ===================================================================== */
(function () {
'use strict';
var C = window.HFPC_CONTENT, E = window.HFPC_ENGINE, SUM = window.HFPC_SUMMARY, QR = window.HFPC_QUESTIONS;
var state, hist = [], current = 'HOME', lastRender = 0, lastResult = null, qSkipped = {}, currentQ = null, medQuery = '';
var $ = function (id) { return document.getElementById(id); };
/* F48 列印專用：標題、看診想問的話、預覽上的修改。只放在這個變數，不進 state、不複製、不儲存、不傳送；重新開始即清空 */
var printOnly = { title: '', note: '' };
/* F32 共病：目前展開哪一大類（只影響畫面） */
var coGroup = null;
/* F46 名詞白話解釋：同一個畫面只在第一次出現時解釋一次 */
var glSeen = {};
var GLOSS = (C.glossary || []).map(function (g) { return { g: g, keys: [g.term].concat(g.aliases || []) }; });
function isWordCh(ch) { return /[A-Za-z0-9]/.test(ch || ''); }
function G(s) {
  var src = String(s == null ? '' : s);
  if (!GLOSS.length || !src) return esc(src);
  var hits = [];
  GLOSS.forEach(function (x) {
    if (glSeen[x.g.term]) return;
    var best = null;
    x.keys.forEach(function (k) {
      var from = 0, i;
      while ((i = src.indexOf(k, from)) >= 0) {
        var end = i + k.length, ascii = /^[A-Za-z]/.test(k), before = src.charAt(i - 1), after = src.charAt(end);
        var okBoundary = !ascii || (!isWordCh(before) && !isWordCh(after));
        var alreadyExplained = after === '（' || after === '(' || before === '（' || before === '(';
        if (okBoundary && !alreadyExplained) { if (!best || i < best.i) best = { i: i, end: end, g: x.g }; break; }
        from = i + 1;
      }
    });
    if (best) hits.push(best);
  });
  hits.sort(function (a, b) { return a.i - b.i; });
  var out = '', pos = 0;
  hits.forEach(function (h) {
    if (h.i < pos) return;
    glSeen[h.g.term] = true;
    out += esc(src.slice(pos, h.end)) + '<span class="gl">（' + esc(h.g.plain) + '）</span>';
    pos = h.end;
  });
  return out + esc(src.slice(pos));
}
/* 病人連結版的轉接層（只存在於 patient-linked 建置；公開版沒有這個物件，以下所有 LINK 分支都不會執行） */
var LINK = window.HFPC_LINK || null;
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function label(pairs, k) { for (var i = 0; i < pairs.length; i++) if (pairs[i][0] === k) return pairs[i][1]; return k; }
function cg() { return state && state.mode === 'CAREGIVER'; }
function T(self, care) { return cg() ? care : self; }
function announce(t) { var s = $('status'); s.textContent = ''; setTimeout(function () { s.textContent = t; }, 30); }
function toSet(a) { var o = {}; (a || []).forEach(function (x) { o[x] = true; }); return o; }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function nowText() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function analyzeNow() { lastResult = E.analyze(state); if (lastResult.projection) lastResult.projection.generated_at = new Date().toISOString(); return lastResult; }

/* ---------- 導覽 ---------- */
function go(screen, opts) {
  opts = opts || {};
  if (!opts.back && current && current !== screen) hist.push(current);
  if (LINK && LINK.intercept) { var alt = LINK.intercept(screen, state, opts); if (alt) screen = alt; }
  current = screen;
  var fn = SCREENS[screen] || SCREENS.HOME;
  glSeen = {};
  $('screen').innerHTML = fn();
  lastRender = Date.now();
  var h = $('screen').querySelector('h1,h2');
  if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
  announce(h ? h.textContent : '');
}
function intentShown(o) { return !o.gate || !!(LINK && LINK.gate && LINK.gate(o.gate)); }   /* 5.2：有 gate 的選項只在病人連結、通過內容閘門時出現（公開版不出現） */
function intentDef(id) { return C.concern_intents.concat(C.concern_secondary).filter(function (x) { return x.id === id && intentShown(x); })[0] || null; }
function medProblemDef(id) { return C.med_problem_options.filter(function (x) { return x.id === id; })[0] || null; }
function otherTopicDef(id) { return C.other_topic_options.filter(function (x) { return x.id === id; })[0] || null; }
/* 「上一步」依流程邏輯回到前一題（不是瀏覽紀錄），答案保留 */
function prevOf(sc) {
  var rv = E.routeView(E.safetyRoute(state).route, state.mode);
  if (sc === 'SAFETY') return 'HOME';
  if (sc === 'SAFETY_RESULT') return 'SAFETY';
  if (sc === 'CHANGE') return (rv && rv.needs_ack) ? 'SAFETY_RESULT' : 'SAFETY';
  if (sc === 'CONCERN') return 'CHANGE';
  if (sc === 'CONCERN_SUB') return 'CONCERN';
  if (sc === 'BRANCH') { var it = intentDef(state.concern_intent); return it && it.sub ? 'CONCERN_SUB' : 'CONCERN'; }
  if (sc === 'PRINT' || sc === 'ASK') return 'RESULT';
  if (sc === 'RESULT') {
    if (rv && rv.stop_routine) return 'SAFETY';
    var p = state.primary_concern;
    if (p === 'POST_DISCHARGE') return 'BRANCH';
    if (C.branches[p] && !(p === 'GOALS' && state.branch.other_topic)) return 'BRANCH';
    if (p === 'MEDICATION') { var mp = medProblemDef(state.branch.med_problem); if (mp && mp.follow) return 'BRANCH'; }
    var it2 = intentDef(state.concern_intent); return it2 && it2.sub ? 'CONCERN_SUB' : 'CONCERN';
  }
  return 'HOME';
}
function back() {
  /* 共病：在某一大類裡按上一步，先回到大類清單 */
  if (current === 'BRANCH' && state.primary_concern === 'COMORBIDITY' && coGroup) { coGroup = null; state.branch.comorbidity_focus = null; go('BRANCH', { back: true }); return; }
  go(prevOf(current), { back: true });
}
function advance() { go(E.nextStep(state)); }
function reset() {
  state = E.newState(); state.session = { started: new Date().toISOString() };
  if (LINK && LINK.initialState) state = LINK.initialState(state) || state;
  hist = []; lastResult = null; qSkipped = {}; currentQ = null; medQuery = ''; askCount = 0; askRound = 0; askEnough = false; coGroup = null; wmStep = null;
  printOnly = { title: '', note: '' }; comboNo = {}; comboPending = null;
  go('HOME', { back: true });
}
function progress(step) {
  var dots = [1, 2, 3].map(function (i) { return '<i class="' + (i <= step ? 'on' : '') + '"></i>'; }).join('');
  return '<p class="progress"><span class="dots" aria-hidden="true">' + dots + '</span>第 ' + step + ' / 3 步</p>';
}
function backBtn(text) { return '<button class="btn ghost no-print" type="button" data-act="back">' + esc(text || '← 上一步') + '</button>'; }
function choiceBtn(act, val, text, selected, hint) {
  return '<button class="choice" type="button" data-act="' + act + '" data-val="' + esc(val) + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' + esc(text) +
    (hint ? '<span class="choice-hint">' + esc(hint) + '</span>' : '') + '</button>';
}
function oneQuestion(title, hint, opts, act, selected, extra) {
  return '<h2>' + esc(title) + '</h2>' + (hint ? '<p class="muted">' + esc(hint) + '</p>' : '') +
    '<div class="choices">' + opts.map(function (o) { return choiceBtn(act, o[0], o[1], selected === o[0]); }).join('') + '</div>' + (extra || '');
}

/* ---------- 首頁：首屏只有目的、身分、開始（HFAT-HOME-FIRSTVIEW-01） ---------- */
var SCREENS = {};
SCREENS.HOME = function () {
  return '<section class="panel home"><h1>' + esc(C.config.app_title) + '</h1>' +
    '<p class="lead">我們先確認您現在安不安全，再一起找出今天最需要處理的一件事。</p>' +
    '<ol class="flow" aria-label="接下來的三個步驟"><li><b>確認安全</b><span>有沒有要立刻處理的狀況</span></li><li><b>選一件事</b><span>今天最困擾或最想問的</span></li><li><b>帶走一張清單</b><span>可以列印或給醫療團隊看</span></li></ol>' +
    '<p class="small muted">給已經被醫師告知有心衰竭的人和家人使用；不取代看診。</p>' +
    '<fieldset><legend>今天是誰在使用？</legend><div class="choices two">' +
    choiceBtn('mode', 'SELF', '我是病人本人', state.mode === 'SELF') + choiceBtn('mode', 'CAREGIVER', '我是家人或照顧者', state.mode === 'CAREGIVER') + '</div>' +
    '<p id="mode_err" class="error" role="alert" tabindex="-1" hidden>請先選一個，這會影響接下來的用語。</p></fieldset>' +
    '<button class="btn primary" type="button" data-act="start">開始，先確認安全</button>' +
    (LINK ? LINK.homeNoteHtml() : '<p class="small muted">不用填姓名或病歷號；填的答案只留在這個頁面，不會傳到任何地方，包括提供這個網頁的網站。</p>') + '</section>' +
    '<details class="panel"><summary>資料與隱私</summary><div class="small muted" style="display:grid;gap:6px">' +
    (LINK ? LINK.privacyHtml() :
    '<p>不需要姓名、身分證字號、電話或病歷號。本頁不會把您填寫的答案傳到任何地方（包括提供這個網頁的網站），也不會留下可以找回的填答紀錄；關閉或重新整理頁面後，這次填的內容就會清掉。</p>' +
    '<p>如果您是從網址打開這一頁，架設網頁的網站服務可能依它的規定保留一般連線紀錄（例如連線時間、瀏覽器種類）；這些紀錄不包含您在本頁填寫的答案。</p>' +
    '<p>因為不建立填答紀錄，所以沒有辦法幫您把上次的內容找回來。要留下來，請用最後的「列印／存 PDF」或「複製」。</p>') + '</div></details>' +
    '<details class="panel"><summary>緊急求助｜Emergency help in other languages</summary><div class="small" style="display:grid;gap:6px">' +
    '<p lang="en"><strong>English:</strong> This page is in Chinese only. In an emergency in Taiwan, call <strong>119</strong> (ambulance). If the patient cannot speak a full sentence, has blue or grey lips, faints, or has chest pain that does not go away, call 119 now.</p>' +
    '<p lang="id"><strong>Bahasa Indonesia:</strong> Halaman ini hanya dalam bahasa Mandarin. Dalam keadaan darurat di Taiwan, hubungi <strong>119</strong>. Jika pasien tidak bisa bicara satu kalimat penuh, bibir kebiruan atau keabu-abuan, pingsan, atau nyeri dada tidak hilang, hubungi 119 sekarang.</p>' +
    '<p lang="vi"><strong>Tiếng Việt:</strong> Trang này chỉ có tiếng Trung. Khi khẩn cấp tại Đài Loan, hãy gọi <strong>119</strong>. Nếu người bệnh không nói hết câu, môi tím hoặc xám, ngất, hoặc đau ngực không giảm, hãy gọi 119 ngay.</p>' +
    '<p lang="th"><strong>ภาษาไทย:</strong> หน้านี้มีเฉพาะภาษาจีน หากฉุกเฉินในไต้หวัน โทร <strong>119</strong> หากผู้ป่วยพูดไม่จบประโยค ริมฝีปากเขียวหรือเทา เป็นลม หรือเจ็บหน้าอกไม่หาย ให้โทร 119 ทันที</p>' +
    '<p lang="en">Only the emergency part is translated. For anything else, please ask the care team or a Chinese-speaking family member to go through this page with the patient.</p>' +
    '<p class="muted">只有緊急求助內容提供這些語言版本；其他內容目前只有中文。這些翻譯還沒有經過母語人士與臨床人員審校，正式使用前需要再審校。</p></div></details>' +
    '<details class="panel"><summary>關於本工具</summary><div class="small muted" style="display:grid;gap:8px">' +
    '<p>本頁提供衛教與用藥溝通的整理，不會替您開始、停止、換藥或調整劑量；也不取代診斷、處方或緊急醫療。本頁無法判斷您是否有心衰竭。</p>' +
    '<p>內容依據國際心衰竭指引（2026 ESC、2022 AHA/ACC/HFSA、2024／2026 ACC 共識）、台灣心臟學會共識與台灣官方資源整理；每張提醒下方都可展開參考資料。</p>' +
    '<p>本工具沒有連接您的病歷、處方或檢驗資料，所以不會估算個人藥價、健保給付或劑量。</p>' +
    '<p>內容版本 ' + esc(C.config.version) + '｜內容更新 ' + esc(C.config.content_updated) + '</p>' + trialNote() + '</div></details>';
};
/* 建置設定檔（tools/build.py --profile）：不是正式版時，誠實標示試行 */
function trialNote() {
  var b = window.HFPC_BUILD || {};
  return b.profile === 'PRODUCTION' ? '' : '<p>目前是試行版：部分國際指引內容還在逐條對照全文，指引的正式使用授權也還在確認中。</p>';
}

/* ---------- 安全確認：單一畫面、兩段漸進展開（P0-01）；警訊分組只是畫面分組；「現在」等級一勾就跳；組合警訊先在原位置追問（P0-02） ---------- */
var comboNo = {};   /* 這一次安全確認裡，病人已回答「沒有」的組合追問（畫面狀態，不進 state） */
var comboPending = null;   /* { sig, partner }：正在追問中的組合 */
function comboPartners(sigId, sel) {
  return (C.emergency_combos || []).filter(function (c) { return c.indexOf(sigId) >= 0; }).map(function (c) { return c[0] === sigId ? c[1] : c[0]; })
    .filter(function (pt) { return !sel[pt] && !comboNo[sigId + '|' + pt] && !comboNo[pt + '|' + sigId]; });
}
function sigLabel(x, sel) {
  var rv = E.routeView(x.level);
  return '<label class="check sig-' + esc(rv.css) + '"><input type="checkbox" name="sig" value="' + x.id + '" id="sig_' + x.id + '"' + (sel[x.id] ? ' checked' : '') +
    (rv.immediate ? ' data-immediate="1"' : '') + '><div><span class="tbadge ' + esc(rv.css) + '">' + esc(rv.step_badge) + '</span><strong>' + esc(x.label) + '</strong>' +
    (x.hint ? '<span>' + esc(x.hint) + '</span>' : '') + '</div></label>';
}
function comboPromptHtml(sig, partner) {
  var pt = C.safety_signals.filter(function (x) { return x.id === partner; })[0];
  var q = (C.combo_prompts || {})[sig + '|' + partner] || ('同時有沒有：' + (pt ? pt.label : partner) + '？');
  return '<div class="combo-ask" id="combo_ask" role="group" aria-labelledby="combo_q" tabindex="-1"><p id="combo_q"><strong>再確認一件事：</strong>' + esc(q) + '</p>' +
    '<div class="choices three">' + [['combo_yes', '有'], ['combo_no', '沒有'], ['combo_unsure', '不確定']].map(function (o) {
      return '<button class="choice" type="button" data-act="' + o[0] + '" data-val="' + esc(sig + '|' + partner) + '">' + o[1] + '</button>'; }).join('') + '</div>' +
    '<p class="small muted">' + esc(C.combo_prompt_hint) + '</p></div>';
}
/* 3.3（ZT-D12-004，P0）：每一組都要看過（點開或「全部展開」）才能按「都沒有」；只做「看過」的紀錄，不記錄停留時間 */
function reviewedSet() { return toSet(state.safety.reviewed || []); }
/* 5.2 G-02／F-04：病人連結可依醫療人員確認的資料不問不相關的組（沒有去顫器或電擊已關閉、確定沒有抗凝血藥）；公開版與資料不確定時照問全部 */
function sgGroups(def) {
  var sc = LINK && LINK.safetyScope ? LINK.safetyScope() : null, hg = (state.safety && state.safety.scoped_out) || [], hs = (sc && sc.hide_signals) || [];   /* 組：與 engine 共用 state.safety.scoped_out */
  return (C.safety_groups || []).filter(function (g) { return g.step === def.id && hg.indexOf(g.id) < 0; }).map(function (g) {
    var sg = g.signals.filter(function (id) { return hs.indexOf(id) < 0; });
    return sg.length === g.signals.length ? g : Object.assign({}, g, { signals: sg, label: g.label_scoped || g.label });
  }).filter(function (g) { return g.signals.length; });
}
function stepUnseen(stepIdx) {
  var def = C.safety_steps[stepIdx], rv = reviewedSet();
  return sgGroups(def).filter(function (g) { return !rv[g.id]; });
}
/* 3.4（T10）：進度改為「已看 x／N 組」，各組標題另標「已看／未看」（文字，不只靠顏色）；閘門本身不變 */
function stepTotal(stepIdx) { return sgGroups(C.safety_steps[stepIdx]).length; }
function needText(unseen, total) { return '已看 ' + (total - unseen.length) + '／' + total + ' 組' + (unseen.length ? '。每一組都看過，才能按下面的「都沒有」。' : '。'); }
function markReviewed(gid) {
  if (!gid || (state.safety.reviewed || []).indexOf(gid) >= 0) return;
  state.safety.reviewed = (state.safety.reviewed || []).concat([gid]);
  var d = document.querySelector('details.sg[data-gid="' + gid + '"]'); if (d) { d.classList.add('seen'); var m = d.querySelector('.sg-seen'); if (m) m.textContent = '已看'; }
  refreshNoneGate();
}
function refreshNoneGate() {
  var step = Math.min(state.safety.step || 0, C.safety_steps.length - 1), un = stepUnseen(step), b = document.querySelector('[data-act="safety_none"][data-val="' + step + '"]'), n = $('sg_need' + step);
  if (n) n.textContent = needText(un, stepTotal(step));
  if (b) { if (un.length) b.setAttribute('aria-disabled', 'true'); else { b.removeAttribute('aria-disabled'); var oa = document.querySelector('[data-act="safety_open_all"][data-val="' + step + '"]'); if (oa) oa.parentNode.remove(); } }
}
function safetySection(stepIdx, sel, mode) {
  var def = C.safety_steps[stepIdx];
  var groups = sgGroups(def);
  var headRv = E.routeView(def.levels[0]);
  if (mode === 'done') {
    var chosen = C.safety_signals.filter(function (x) { return def.levels.indexOf(x.level) >= 0 && sel[x.id]; });
    return '<div class="safety-done"><p><strong>' + esc(chosen.length ? '已勾：' + chosen.map(function (x) { return x.label; }).join('；') : def.done_label) + '</strong> ' +
      '<button class="btn ghost small" type="button" data-act="safety_reopen" data-val="' + stepIdx + '">修改</button></p></div>';
  }
  var body = groups.map(function (g) {
    var items = g.signals.map(function (id) { return C.safety_signals.filter(function (x) { return x.id === id; })[0]; }).filter(Boolean);
    var nSel = items.filter(function (x) { return sel[x.id]; }).length;
    var inner = items.map(function (x) {
      var h = sigLabel(x, sel);
      if (comboPending && comboPending.sig === x.id) h += comboPromptHtml(x.id, comboPending.partner);
      return h;
    }).join('');
    /* 3.2（R-D-016）：收合時也看得到這一組的第一個具體情況，不會只看組名就按「都沒有」 */
    return '<details class="sg' + (nSel ? ' has-sel' : '') + (reviewedSet()[g.id] ? ' seen' : '') + '" data-gid="' + esc(g.id) + '"' + (nSel || (comboPending && items.some(function (x) { return x.id === comboPending.sig; })) ? ' open' : '') + '><summary><span>' + esc(g.label) + (items[0] ? '<span class="sg-eg">例如：' + esc(items[0].label) + (items.length > 1 ? '（還有 ' + (items.length - 1) + ' 項，點開看）' : '') + '</span>' : '') + '</span>' +
      (nSel ? '<span class="chip">已勾 ' + nSel + ' 項</span>' : '') + '<span class="chip sg-seen">' + (reviewedSet()[g.id] ? '已看' : '未看') + '</span></summary><div class="sg-body">' + inner + '</div></details>';
  }).join('');
  var anySel = C.safety_signals.some(function (x) { return def.levels.indexOf(x.level) >= 0 && sel[x.id]; });
  var unseen = stepUnseen(stepIdx);
  return '<div class="safety-step" id="safety_step_' + stepIdx + '"><h2 id="safety_h' + stepIdx + '" tabindex="-1">' + esc(T(def.title, def.title_caregiver || def.title)) + '</h2>' +
    '<p class="muted">' + esc(T(def.hint, def.hint_caregiver || def.hint)) + '</p>' + speakBtn('safety', stepIdx) +
    '<fieldset class="tier ' + esc(headRv.css) + '"><legend class="sr-only">' + esc(def.title) + '</legend>' + body + '</fieldset>' +
    '<p id="safety_err" class="error" role="alert" tabindex="-1" hidden>請先回答上面的追問。</p>' +
    '<div class="row split">' + backBtn() +
    (anySel ? '<button class="btn primary" type="button" data-act="safety_next" data-val="' + stepIdx + '">勾好了，繼續</button>'
      : '<button class="btn primary" type="button" data-act="safety_none" data-val="' + stepIdx + '"' + (unseen.length ? ' aria-disabled="true" aria-describedby="sg_need' + stepIdx + '"' : '') + '>' + esc(def.none) + '</button>') + '</div>' +
    (anySel ? '' : '<p class="small sg-need" id="sg_need' + stepIdx + '" role="status" aria-live="polite">' + needText(unseen, groups.length) + '</p>' +
      (unseen.length ? '<div class="row"><button class="btn secondary" type="button" data-act="safety_open_all" data-val="' + stepIdx + '">全部展開，一次看完</button></div>' : '')) + '</div>';
}
SCREENS.SAFETY = function () {
  var step = Math.min(state.safety.step || 0, C.safety_steps.length - 1);
  var sel = toSet(state.safety.signals);
  var h = '<section class="panel">' + progress(1);
  for (var i = 0; i < C.safety_steps.length; i++) {
    if (i < step) h += safetySection(i, sel, 'done');
    else if (i === step) h += safetySection(i, sel, 'open');
  }
  return h + '</section>';
};
function routeHead(rv, tag) {
  tag = tag || 'h1';
  if (LINK && LINK.selfHarmActive && LINK.selfHarmActive() && rv.route === 'ROUTINE') rv = Object.assign({}, rv, { css: 'day', headline: T('今天要處理：您回答的心情與安全', '今天要處理：病人的心情與安全'), lead: '' });   /* 5.2 F-03 */
  return '<section class="result-head ' + esc(rv.css) + '" data-route="' + esc(rv.route) + '"><' + tag + '>' + esc(rv.headline) + '</' + tag + '>' +
    (rv.lead ? '<p>' + esc(rv.lead) + '</p>' : '') + '</section>';
}
SCREENS.SAFETY_RESULT = function () {
  var r = analyzeNow();
  var rv = E.routeView(r.route, state.mode);
  if (!rv || !rv.needs_ack) return SCREENS.RESULT();
  return routeHead(rv, 'h2') + r.cards.filter(function (c) { return c.origin === 'SAFETY'; }).map(function (c) { return renderCard(c, { open: true }); }).join('') +
    '<div class="panel no-print"><p>' + T('知道今天要怎麼做了嗎？可以先去處理，之後再回來看其他整理。', '知道今天要怎麼陪病人處理了嗎？可以先去處理，之後再回來看其他整理。') + '</p>' +
    '<div class="row"><button class="btn primary" type="button" data-act="safety_ack">我知道了，繼續看其他整理</button>' + backBtn() + '</div></div>';
};
SCREENS.CHANGE = function () {
  return '<section class="panel">' + progress(2) + oneQuestion(T('和您平常相比，最近幾天整體狀況如何？', '和病人平常相比，最近幾天整體狀況如何？'), '', C.recent_change_options, 'change', state.recent_change) +
    backBtn() + '</section>';
};
/* ---------- 今天最想處理：6 個生活語言的意圖＋2 個次要連結（R1-B） ---------- */
SCREENS.CONCERN = function () {
  return '<section class="panel">' + progress(3) + '<h2>今天最想先處理哪一件事？</h2><p class="muted">選一個最重要的；其他的之後可以再補。</p><div class="choices">' +
    C.concern_intents.filter(intentShown).map(function (o) { return choiceBtn('intent', o.id, o.label, state.concern_intent === o.id); }).join('') + '</div>' +
    '<div class="row secondary-links">' + C.concern_secondary.map(function (o) {
      return '<button class="btn ghost" type="button" data-act="intent" data-val="' + esc(o.id) + '" aria-pressed="' + (state.concern_intent === o.id ? 'true' : 'false') + '">' + esc(o.label) + '</button>';
    }).join('') + '</div>' + backBtn() + '</section>';
};
/* 首屏最多 6 個選項（P1-01）：option_first 指定先顯示哪幾個，其餘收在「更多情況」 */
function choicesFirstMore(key, opts, act, selected, idOf, labelOf) {
  var first = (C.option_first || {})[key];
  if (!first) return '<div class="choices' + (opts.length > 6 ? ' two' : '') + '">' + opts.map(function (o) { return choiceBtn(act, idOf(o), labelOf(o), selected === idOf(o)); }).join('') + '</div>';
  var head = first.map(function (id) { return opts.filter(function (o) { return idOf(o) === id; })[0]; }).filter(Boolean);
  var rest = opts.filter(function (o) { return first.indexOf(idOf(o)) < 0; });
  var selInRest = rest.some(function (o) { return idOf(o) === selected; });
  return '<div class="choices">' + head.map(function (o) { return choiceBtn(act, idOf(o), labelOf(o), selected === idOf(o)); }).join('') + '</div>' +
    (rest.length ? '<details class="more-opts"' + (selInRest ? ' open' : '') + '><summary>' + esc(C.option_more_label) + '（' + rest.length + '）</summary><div class="choices">' +
      rest.map(function (o) { return choiceBtn(act, idOf(o), labelOf(o), selected === idOf(o)); }).join('') + '</div></details>' : '');
}
var pairId = function (o) { return o[0]; }, pairLabel = function (o) { return o[1]; }, objId = function (o) { return o.id; }, objLabel = function (o) { return o.label; };
SCREENS.CONCERN_SUB = function () {
  var it = intentDef(state.concern_intent);
  if (!it || !it.sub) return SCREENS.CONCERN();
  if (it.sub === 'med_problem') {
    return '<section class="panel"><p class="progress">再一題就好</p><h2>關於吃藥，今天最想先解決哪件事？</h2><p class="muted">不知道藥名也沒關係，不用先分是哪一類藥。</p>' +
      choicesFirstMore('med_problem', C.med_problem_options, 'med_problem', state.branch.med_problem, objId, objLabel) + backBtn() + '</section>';
  }
  return '<section class="panel"><p class="progress">再一題就好</p><h2>想一起談的是哪一方面？</h2><div class="choices">' +
    C.other_topic_options.map(function (o) { return choiceBtn('other_topic', o.id, o.label, state.branch.other_topic === o.id); }).join('') + '</div>' + backBtn() + '</section>';
};
SCREENS.BRANCH = function () {
  var p = state.primary_concern, b = state.branch;
  if (p === 'MEDICATION') {
    var mp = medProblemDef(b.med_problem);
    if (!mp) return SCREENS.CONCERN_SUB();
    if (mp.follow === 'MED_PICK') {
      /* 吃了不舒服：選好藥之後，再問一題「哪一種不舒服」（不同不舒服，處理方式不同） */
      if (mp.id === 'TOLERABILITY' && b.med_focus && !b.side_effect) return '<section class="panel"><p class="progress">再一題就好</p>' +
        oneQuestion(T('吃藥之後，哪一種不舒服最明顯？', '病人吃藥之後，哪一種不舒服最明顯？'), '選最接近的一個就好。', C.side_effect_options, 'side_effect', b.side_effect) +
        '<div class="row split">' + backBtn() + '<button class="btn secondary" type="button" data-act="side_effect" data-val="OTHER">說不上來，略過</button></div></section>';
      return medPickScreen();
    }
    if (mp.follow === 'RECON') return '<section class="panel"><p class="progress">再一題就好</p>' +
      oneQuestion(T('實際吃的藥，和藥袋／藥單上寫的一樣嗎？', '病人實際吃的藥，和藥袋／藥單上寫的一樣嗎？'), '不確定也可以選「不確定」。', C.med_reconciliation_options, 'br_recon', state.facts.med_reconciliation) +
      '<div class="row split">' + backBtn() + '<button class="btn secondary" type="button" data-act="br_skip">略過</button></div></section>';
    return SCREENS.CONCERN_SUB();
  }
  if (p === 'POST_DISCHARGE') {
    /* 出院後三個小問題放在同一頁（P1-02）：都可以不答；沒答的一律當「不知道」 */
    var f = state.facts;
    function q3(title, opts, act, cur) { return '<fieldset class="pd-q"><legend>' + esc(title) + '</legend><div class="choices three">' + opts.map(function (o) { return choiceBtn(act, o[0], o[1], cur === o[0]); }).join('') + '</div></fieldset>'; }
    return '<section class="panel"><p class="progress">再三個小問題就好，不確定的可以不答</p><h2>' + esc(T('剛出院或最近住過院：先確認三件事', '病人剛出院或最近住過院：先確認三件事')) + '</h2>' +
      q3('這次住院主要是不是因為心衰竭？', C.discharge_reason_options, 'pd_reason', f.discharge_reason) +
      q3('大約多久以前出院的？', C.discharge_when_options, 'pd_when', f.discharge_when) +
      q3(T('實際吃的藥，和出院藥單一樣嗎？', '病人實際吃的藥，和出院藥單一樣嗎？'), C.med_reconciliation_options, 'pd_recon', f.med_reconciliation) +
      '<p class="small muted">因為心衰竭住院、和因為別的原因住院，後續要注意的事不一樣；沒答的會當成「不知道」，不會當成「沒有」。</p>' +
      '<div class="row split">' + backBtn() + '<button class="btn primary" type="button" data-act="pd_done">' + (f.discharge_reason || f.discharge_when || f.med_reconciliation ? '好了，看整理' : '都不確定，直接看整理') + '</button></div></section>';
  }
  var br = C.branches[p];
  if (!br) return SCREENS.CONCERN();
  var val = b[br.field];
  var title = p === 'COMORBIDITY' ? T('您有、而且這次最想先一起照顧的是哪一項？', '病人有、而且這次最想先一起照顧的是哪一項？') : br.title;
  if (p === 'COMORBIDITY' && (C.comorbidity_groups || []).length) {
    /* F32／P1-01：4 個大類同頁展開（accordion），不換頁；也可以打字找 */
    return '<section class="panel"><p class="progress">再一題就好</p><h2>' + esc(title) + '</h2><p class="muted">先打開大概是哪一方面，再點確切的一項。</p>' +
      C.comorbidity_groups.map(function (g) {
        var has = g.items.indexOf(val) >= 0;
        return '<details class="sg co' + (has ? ' has-sel' : '') + '"' + (has || coGroup === g.id ? ' open' : '') + '><summary><span>' + esc(g.label) + '</span></summary><div class="sg-body"><div class="choices">' +
          g.items.map(function (id) { return choiceBtn('branch', id, label(br.options, id), val === id); }).join('') + '</div></div></details>';
      }).join('') +
      '<details class="panel"><summary>知道名稱？直接打字找</summary><label class="small" for="co_q">輸入兩三個字，例如「腎」「糖」「睡」</label>' +
      '<input id="co_q" type="search" inputmode="search" autocomplete="off" class="search" data-role="co_search"><div id="co_results"></div></details>' + backBtn() + '</section>';
  }
  return '<section class="panel"><p class="progress">再一題就好</p><h2>' + esc(title) + '</h2>' +
    choicesFirstMore(p, br.options, 'branch', val, pairId, pairLabel) + backBtn() + '</section>';
};
/* 想了解哪一顆：打字找，或依類別找；不知道就略過（不先要求病人選 14 類） */
var ING_BY_ID = {};
(C.ingredients || []).forEach(function (i) { ING_BY_ID[i.id] = i; });
function ingText(i) { return i.name + (i.zh ? '（' + i.zh + '）' : ''); }
function ingSearchText(i) { var al = (i.aliases || []).slice(0, 2).join(' '); return i.name + (i.zh || al ? '（' + [i.zh, al].filter(Boolean).join('｜') + '）' : ''); }
function ingMatches(q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  return C.ingredients.filter(function (i) {
    return [i.name, i.zh || '', i.id].concat(i.aliases || []).some(function (x) { return String(x).toLowerCase().indexOf(q) >= 0; });
  }).slice(0, 12);
}
function clsLabelMap() { var m = {}; C.medications.forEach(function (x) { m[x.id] = x.short || x.label; }); m.OTHER_CARDIO = '其他心臟或血壓的藥'; return m; }
function medPickScreen() {
  var b = state.branch;
  /* 5.2 F-01：病人連結版、選「不知道這些藥是做什麼的」且醫療團隊已登錄處方 → 先直接列出「我的藥」，不要病人自己搜尋（公開版沒有 LINK，照舊） */
  var mine = LINK && LINK.myMedsHtml && b.med_problem === 'UNDERSTAND' ? LINK.myMedsHtml() : '';
  if (mine) return '<section class="panel"><p class="progress">這是醫療團隊登錄的' + esc(T('您', '病人')) + '的藥</p>' + mine +
    '<details class="panel"><summary>想再了解其中一顆：打藥名找</summary><label class="small" for="mp_q">搜尋藥名</label><input id="mp_q" type="search" inputmode="search" autocomplete="off" class="search" value="' + esc(medQuery) + '" data-role="mp_search"><div id="mp_results">' + mpResults() + '</div></details>' +
    '<div class="row split">' + backBtn() + '<button class="btn primary" type="button" data-act="mp_mine">看整理</button></div></section>';
  return '<section class="panel"><p class="progress">再一題就好</p><h2>想先了解哪一顆藥？</h2>' +
    '<p class="muted">可以打藥名找（英文或中文都可以）。不知道藥名就直接按「不知道藥名」。</p>' +
    '<label class="small" for="mp_q">搜尋藥名</label><input id="mp_q" type="search" inputmode="search" autocomplete="off" class="search" value="' + esc(medQuery) + '" data-role="mp_search">' +
    '<div id="mp_results">' + mpResults() + '</div>' +
    '<details class="panel"><summary>找不到？依藥的用途找</summary><div class="choices two">' +
    C.medications.map(function (m) { return choiceBtn('mp_class', m.id, m.label, b.med_focus === m.id && !b.med_focus_ing); }).join('') + '</div></details>' +
    '<div class="row split">' + backBtn() + '<button class="btn secondary" type="button" data-act="mp_unknown">不知道藥名</button></div></section>';
}
function mpResults() {
  var hits = ingMatches(medQuery);
  if (!medQuery) return '<p class="small muted">輸入兩三個字就會出現。</p>';
  if (!hits.length) return '<p class="small muted">找不到「' + esc(medQuery) + '」。可以換個寫法，或用下面的「依藥的用途找」。</p>';
  return hits.map(function (i) { return '<button class="choice" type="button" data-act="mp_ing" data-val="' + esc(i.id) + '">' + esc(ingSearchText(i)) + '</button>'; }).join('');
}

/* ---------- 再補一題（Question Registry；一次一題、不顯示剩幾題；唯一逃生鍵「不知道／先略過」；補 3 題後先回結果） ---------- */
var askCount = 0, askRound = 0;
function askHeader() {
  return '<p class="progress">再補一題，這次的整理會更貼近您的狀況</p><p class="small voice">' + esc(T(C.voice.unknown_ok, C.voice.unknown_ok_cg)) + '</p>';
}
function askFooter(q, withNext) {
  return '<div class="row split">' + backBtn('← 回到整理') + '<div class="row"><button class="btn secondary" type="button" data-act="ask_escape" data-val="' + esc(q.id) + '">' + esc(C.ask_escape_label) + '</button>' +
    (withNext ? '<button class="btn primary" type="button" data-act="ask_save" data-val="' + esc(q.id) + '">下一步</button>' : '') + '</div></div>';
}
SCREENS.ASK = function () {
  var q = currentQ && QR.BY_ID[currentQ];
  if (!q) return SCREENS.RESULT();
  var title = T(q.label, q.label_cg || q.label);
  var h = '<section class="panel ask" data-question="' + esc(q.id) + '">' + askHeader() + '<h2>' + esc(title) + '</h2>' + (q.hint ? '<p class="muted">' + esc(q.hint) + '</p>' : '');
  if (q.kind === 'choice') {
    var cur = q.field.indexOf('.') > 0 ? state.facts[q.field.split('.')[1]] : state[q.field];
    h += '<div class="choices">' + QR.optionsOf(q).map(function (o) { return choiceBtn('ask_choice', o[0], o[1], cur === o[0]); }).join('') + '</div>' + askFooter(q, false);
  } else if (q.kind === 'numeric') {
    var spec = C.numeric_inputs[q.numeric];
    h += '<div class="row"><label for="ask_num" class="sr-only">' + esc(title) + '</label><input id="ask_num" type="number" inputmode="decimal" min="' + spec.min + '" max="' + spec.max + '" step="1" class="num"><span>' + esc(spec.unit) + '</span></div>' +
      '<p id="ask_err" class="error" role="alert" hidden>請輸入 ' + spec.min + ' 到 ' + spec.max + ' 之間的數字，或按「' + esc(C.ask_escape_label) + '」。</p>' +
      (q.band_fallback ? '<details><summary>' + esc(q.band_fallback.label) + '</summary><div class="choices two">' + C[q.band_fallback.options].filter(function (o) { return o[0] !== 'UNKNOWN'; }).map(function (o) { return choiceBtn('ask_band', o[0], o[1], false); }).join('') + '</div></details>' : '') +
      askFooter(q, true);
  } else if (q.kind === 'bmi') {
    h += '<div class="row"><label class="small" for="calc_h">身高（公分）</label><input id="calc_h" type="number" inputmode="decimal" min="100" max="230" class="num">' +
      '<label class="small" for="calc_w">體重（公斤）</label><input id="calc_w" type="number" inputmode="decimal" min="25" max="300" class="num"></div>' +
      '<p id="ask_err" class="error" role="alert" hidden>請輸入合理的身高與體重，或按「' + esc(C.ask_escape_label) + '」。</p>' + askFooter(q, true);
  } else if (q.kind === 'multi') {
    var sel = toSet(q.field.indexOf('.') > 0 ? state.facts[q.field.split('.')[1]] : state[q.field]);
    var mOpts = QR.optionsOf(q);
    var box = function (o) { return '<label class="check"><input type="checkbox" name="ask_multi" value="' + esc(o[0]) + '" id="am_' + esc(o[0]) + '"' + (sel[o[0]] ? ' checked' : '') + '><div><strong>' + esc(o[1]) + '</strong></div></label>'; };
    if (q.options_branch === 'COMORBIDITY' && (C.comorbidity_groups || []).length) {
      /* F32：14 個共病分成 4 大類，每類一個小標題 */
      h += '<p class="small muted">可以複選；有的才勾，沒勾不代表沒有。</p>' + C.comorbidity_groups.map(function (g) {
        return '<fieldset class="co-group"><legend>' + esc(g.label) + '</legend>' + mOpts.filter(function (o) { return g.items.indexOf(o[0]) >= 0; }).map(box).join('') + '</fieldset>';
      }).join('') + askFooter(q, true);
    } else h += '<fieldset><legend class="small muted">可以複選</legend>' + mOpts.map(box).join('') + '</fieldset>' + askFooter(q, true);
  } else if (q.kind === 'med_picker') {
    h += '<p class="small voice">' + esc(C.voice.meds_not_all) + '</p>' + medPickerBody() + askFooter(q, true);
  }
  return h + '</section>';
};
/* 找藥工具頁：搜尋＋依用途找；每一顆直接問「現在還有吃嗎」（R4 per-ingredient exposure） */
var pickDraft = null;   // [{ingredient,status}]，只在這一頁暫存；按「下一步」才寫入
function medPickerBody() {
  if (!pickDraft) pickDraft = (state.facts.med_instances || []).map(function (x) { return { ingredient: x.ingredient, status: x.status }; });
  var cl = clsLabelMap(), byCls = {};
  C.ingredients.forEach(function (i) { (byCls[i.cls] = byCls[i.cls] || []).push(i); });
  return '<label class="small" for="pk_q">搜尋藥名（英文或中文）</label><input id="pk_q" type="search" inputmode="search" autocomplete="off" class="search" value="' + esc(medQuery) + '" data-role="pk_search">' +
    '<div id="pk_results">' + pkResults() + '</div>' +
    '<details class="panel"><summary>找不到？依藥的用途找</summary>' + Object.keys(byCls).map(function (k) {
      return '<details class="ing-group"><summary>' + esc(cl[k] || k) + '</summary><div class="choices">' + byCls[k].map(function (i) {
        return '<button class="choice" type="button" data-act="pk_add" data-val="' + esc(i.id) + '">' + esc(ingText(i)) + '</button>';
      }).join('') + '</div></details>';
    }).join('') + '</details>' +
    '<h3>已經選的藥</h3><div id="pk_selected">' + pkSelected() + '</div>';
}
function pkResults() {
  var hits = ingMatches(medQuery), chosen = toSet(pickDraft.map(function (x) { return x.ingredient; }));
  if (!medQuery) return '<p class="small muted">輸入兩三個字就會出現。</p>';
  if (!hits.length) return '<p class="small muted">找不到「' + esc(medQuery) + '」。可以換個寫法、用「依藥的用途找」，或在最後一題選「還有藥，但上面找不到」。</p>';
  return hits.map(function (i) { return '<button class="choice" type="button" data-act="pk_add" data-val="' + esc(i.id) + '"' + (chosen[i.id] ? ' aria-pressed="true"' : '') + '>' + esc(ingSearchText(i)) + (chosen[i.id] ? '（已選）' : '') + '</button>'; }).join('');
}
function pkSelected() {
  if (!pickDraft.length) return '<p class="small muted">還沒有選。</p>';
  var ST = [['CURRENT', '現在有吃'], ['STOPPED', '已經停了'], ['UNSURE', '不確定']];
  return pickDraft.map(function (x, idx) {
    var i = ING_BY_ID[x.ingredient];
    return '<fieldset class="pk-item"><legend>' + esc(ingText(i)) + '：現在還有吃嗎？</legend><div class="choices three">' +
      ST.map(function (o) { return '<button class="choice" type="button" data-act="pk_status" data-val="' + idx + ':' + o[0] + '" aria-pressed="' + (x.status === o[0] ? 'true' : 'false') + '">' + o[1] + '</button>'; }).join('') +
      '</div><button class="btn ghost small" type="button" data-act="pk_remove" data-val="' + idx + '">移除這一顆</button></fieldset>';
  }).join('');
}
function refreshPicker() {
  var r = $('pk_results'); if (r) r.innerHTML = pkResults();
  var s = $('pk_selected'); if (s) s.innerHTML = pkSelected();
}
function nextQuestionOrResult() {
  askCount++; askRound++;
  var base = analyzeNow();
  var q = QR.next(state, qSkipped, base);
  pickDraft = null; medQuery = '';
  /* 補滿 3 題先回結果，說「已經夠用了」；想再補由病人自己按（P1-03）。
     追問同一個數字的日期／來源（depends_on）算同一題的一部分，不在中途打斷 */
  if (q && askRound >= 3 && !q.depends_on) { askRound = 0; currentQ = null; askEnough = true; go('RESULT'); return; }
  if (q) { currentQ = q.id; go('ASK', { back: current === 'ASK' }); }
  else { currentQ = null; go('RESULT'); }
}
var askEnough = false;

/* 少量功能性圖示（HL-P1-05）：一律和文字一起出現、aria-hidden，不單獨傳達意義 */
var ICON = {
  phone: '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.6 3.6a1 1 0 0 1-.25 1z"/></svg>',
  print: '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 8h-1V3H6v5H5a3 3 0 0 0-3 3v6h4v4h12v-4h4v-6a3 3 0 0 0-3-3zM8 5h8v3H8zm8 14H8v-4h8zm3-6h-1v-1H6v1H5v-2a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1z"/></svg>',
  search: '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>',
  calendar: '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14z"/></svg>',
  warn: '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/></svg>',
  doc: '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z"/></svg>',
  chat: '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>'
};
/* ---------- 結果 ---------- */
var ORIGIN_CHIP = { MAP: ['rule', '帶去核對'], SAFETY: ['safety', '先處理安全'], PRIMARY: ['primary', '您想談的事'], CHANGE: ['', '因為最近有變化'], FEAS: ['', '因為您說做起來有困難'], RULE: ['rule', '因為您的藥和其他健康問題'], COMBO: ['rule', '因為您選的藥'], FACT: ['', '因為您補充的資料'], MODE: ['', '給照顧者'] };
var GROUP_TITLE = { now: '現在先做', discuss: '這次看診帶去談', learn: '有空再了解' };
var TIER_TEXT = { PRIMARY: '先找', SUPPORT: '可以幫忙', ESCALATE: '緊急時' };
function whoText(roles) {
  var byTier = { PRIMARY: [], SUPPORT: [], ESCALATE: [] };
  (roles || []).forEach(function (r) {
    var lc = (C.config.local_contacts || []).filter(function (x) { return x.role === r; })[0];
    var role = C.roles[r];
    var txt = esc(role ? role.label : r) + (lc ? '：' + esc(lc.label) + (lc.phone ? ' ' + esc(lc.phone) : '') + (lc.hours ? '（' + esc(lc.hours) + '）' : '') : '');
    (byTier[(role && role.tier) || 'SUPPORT'] || byTier.SUPPORT).push(txt);
  });
  return ['PRIMARY', 'SUPPORT', 'ESCALATE'].filter(function (t) { return byTier[t].length; }).map(function (t) { return TIER_TEXT[t] + '：' + byTier[t].join('、'); }).join('｜');
}
/* 3.1：依據要看得懂——每個來源標「主要依據／補充說明」；有指引建議等級時用白話說（I＝建議、IIa＝應考慮、IIb＝可考慮、III＝不建議），
   等級尚未逐條對照全文的，照實寫出來 */
var COR_ZH = { I: '建議這樣做', IIa: '應該考慮', IIb: '可以考慮', III: '不建議' };
function evidenceHtml(ev, escInfo) {
  var rows = (ev || []).map(function (e) {
    var s = C.sources[e[0]];
    if (!s) return '<li>參考資料暫時無法顯示</li>';
    var unver = /未經查證/.test(s.verification || '');
    var role = e[1] === 'DIRECT' ? '主要依據' : '補充說明';
    return '<li><span class="ev-role' + (e[1] === 'DIRECT' ? ' direct' : '') + '">' + role + '</span><a class="print-url" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' + esc(s.title) + '</a><br><span class="muted">' + esc(s.org) + '｜' + esc(s.year) + '｜最後查看 ' + esc(s.last_verified || '—') + (unver ? '｜部分內容還沒有逐條對照全文' : '') + '</span></li>';
  }).join('');
  var cor = escInfo && escInfo.cor && COR_ZH[String(escInfo.cor).split(' ')[0]];
  var grade = cor ? '<p class="small ev-grade"><strong>國際指引建議等級：</strong>' + esc(escInfo.cor) + '（' + cor + '）' + (escInfo.loe ? '，證據等級 ' + esc(escInfo.loe) : '') + (/未經查證/.test(escInfo.verification || '') ? '。<span class="muted">這個等級還沒有由藥師或醫師逐條對照指引全文。</span>' : '') + '</p>' : '';
  return '<details><summary>參考資料</summary><p class="small muted">這些是內容的依據來源，不是給您個人的醫囑。</p>' + grade + '<ul class="source-list">' + rows + '</ul></details>';
}
function medTable(m) {
  var rows = [['用途', m.why], ['可能感覺到', m.notice], ['一般使用', m.how], ['要追蹤', m.monitor], ['常見問題', m.problem], ['要立即處理', m.urgent], ['帶去看診', m.bring]].filter(function (r) { return r[1] && r[1] !== '—'; });
  return '<p class="small muted">常見成分：' + esc(m.examples) + '</p><dl class="kv">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + G(r[1]) + '</dd>'; }).join('') + '</dl>';
}
function mapHtml(m) {
  var h = (m.pregnancy ? '<p class="do-not"><strong>' + esc(m.pregnancy) + '</strong></p>' : '') + '<p>' + esc(m.profile_text) + '</p><h4>核心長期治療</h4><ul class="map-list">' +
    m.fmt.map(function (x) { return '<li><strong>' + esc(x.label) + '</strong>' + (x.note ? '<br><span class="small muted">' + esc(x.note) + '</span>' : '') + '<br><span class="chip">' + esc(x.status) + '</span></li>'; }).join('') + '</ul>' +
    '<p class="small">' + esc(m.fmt_footer) + '</p><p class="small muted">' + esc(m.symptom) + '</p>';
  if (m.improved) h += '<p class="small"><strong>' + esc(m.improved) + '</strong></p>';
  if (m.amt.length) h += '<h4>依您的資料，可以和醫師討論的</h4><ul class="map-list">' + m.amt.map(function (x) { return '<li><strong>' + esc(x.label) + '</strong>：' + esc(x.note) + '<br><span class="chip ok">' + esc(x.why) + '</span></li>'; }).join('') + '</ul><p class="small muted">' + esc(m.amt_footer) + '</p>';
  if (m.amt_other && m.amt_other.length) {
    var ins = m.amt_other.filter(function (x) { return x.state === 'INSUFFICIENT_DATA'; });
    var no = m.amt_other.filter(function (x) { return x.state === 'NOT_MATCH'; });
    h += '<details><summary>其他附加治療：目前不符合或資料不足（' + m.amt_other.length + ' 項）</summary>' +
      (ins.length ? '<p class="small"><strong>資料不足，沒辦法判斷：</strong></p><ul class="map-list">' + ins.map(function (x) { return '<li><strong>' + esc(x.label) + '</strong><br><span class="small muted">' + esc(x.why) + '</span></li>'; }).join('') + '</ul>' : '') +
      (no.length ? '<p class="small"><strong>依您填的資料，目前不符合：</strong></p><ul class="map-list">' + no.map(function (x) { return '<li><strong>' + esc(x.label) + '</strong><br><span class="small muted">' + esc(x.why) + '</span></li>'; }).join('') + '</ul>' : '') +
      '<p class="small muted">「資料不足」不等於「不需要」；缺的資料補齊後，結果可能不同。</p></details>';
  }
  if (m.gdit.length) h += '<h4>裝置或介入治療（一般資訊）</h4><p class="small muted">以下是一般資訊，沒有針對您個別評估；是否需要由心臟科依檢查結果判斷。</p><ul class="map-list">' + m.gdit.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
  return h;
}
/* 看到一半突然不舒服，隨時可以回到第 1 步 */
function safetyReentry() {
  return '<div class="reentry no-print"><button class="btn secondary" type="button" data-act="safety_restart">現在突然不舒服？重新做一次安全確認</button>' +
    '<p class="small muted">按下去會把剛才的安全確認清掉、從頭問一次，因為身體狀況可能已經不一樣了。其他回答會保留。</p></div>';
}
/* ===== 什麼時候要求救：結果頁與列印都看得到（LADDER-VISIBLE-01）；時間與顏色只讀 route_ui ===== */
function ladderRows(full) {
  return C.route_order.filter(function (lv) { return C.route_ui[lv].step_badge; }).map(function (lv) {
    var u = C.route_ui[lv], all = C.safety_signals.filter(function (x) { return x.level === lv; });
    var ex = (C.ladder_examples || {})[lv] || [];
    var items = full ? all : all.filter(function (x) { return ex.indexOf(x.id) >= 0; });
    return { lv: lv, u: u, items: items.map(function (x) { return x.label; }), n_all: all.length };
  }).filter(function (r) { return r.items.length; });
}
/* 精簡版（P0-05）：每一級先只列代表例；完整 21 項清單收在「查看完整警訊清單」。列印同樣預設精簡，可另印完整版 */
function warningLadder(opts) {
  opts = opts || {};
  var id = opts.print ? (opts.full ? 'print_ladder_full' : 'print_ladder') : 'ladder';
  var h = '<section class="' + (opts.print ? 'p-sec p-ladder' : 'panel ladder') + '" id="' + id + '" aria-labelledby="' + id + '_h"><h2 id="' + id + '_h">什麼時候要求救' + (opts.full ? '（完整清單）' : '') + '</h2>' +
    (opts.print ? '' : '<p class="small muted">' + T('拍照存在手機，或印出來貼在家人看得到的地方。', '拍照存在手機，或印出來貼在家裡；病人和其他家人也要知道。') + '</p>');
  /* 3.4（T09）：畫面上的精簡版只恆常展開「現在打 119」與本次所在的分級；其他分級在下面「查看完整警訊清單」裡（列印照舊列全部分級） */
  ladderRows(!!opts.full).filter(function (row) { return opts.print || opts.full || row.lv === C.route_order[0] || row.lv === opts.route; }).forEach(function (row) {
    var u = row.u, tail = (!opts.full && row.n_all > row.items.length) ? '…' : '';
    h += opts.print ? '<p class="ladder-row ' + esc(u.css) + '"><strong>' + esc(u.step_badge) + '：</strong>' + row.items.map(esc).join('；') + tail + '</p>'
      : '<div class="ladder-row ' + esc(u.css) + (opts.route === row.lv ? ' here' : '') + '"><h3>' + esc(u.step_badge) + '</h3><p>' + row.items.map(esc).join('；') + tail + '</p>' + (opts.route === row.lv ? '<span class="here-tag">' + T('您這次勾的在這一級', '這次勾的在這一級') + '</span>' : '') + '</div>';
  });
  /* 3.1：一般（穩定）路徑也標出位置——讓人看得出自己離「要求救」還有多遠（健康識能：相對位置比抽象說明好懂） */
  if (!opts.print && opts.route && C.route_ui[opts.route] && !C.route_ui[opts.route].step_badge) h += '<div class="ladder-row ok here"><h3>都沒有</h3><p>這次沒有勾到上面的情況：照平常的計畫照顧自己、按時回診。</p><span class="here-tag">' + T('您這次在這裡', '病人這次在這裡') + '</span></div>';
  if (!opts.print && !opts.full) h += '<details class="ladder-full"><summary>查看完整警訊清單（' + C.safety_signals.length + ' 項）</summary>' +
    ladderRows(true).map(function (row) { return '<div class="ladder-row ' + esc(row.u.css) + '"><h3>' + esc(row.u.step_badge) + '</h3><p>' + row.items.map(esc).join('；') + '</p></div>'; }).join('') + '</details>';
  return h + (opts.print ? '' : '<p class="small">不確定算不算？寧可早一點打電話問。</p>') + '</section>';
}
/* 我的照護計畫：空白讓醫療團隊或自己手寫（本頁不收集任何文字輸入） */
function myPlanHtml() {
  var wr = C.weight_reference;
  function line(q) { return '<div class="p-note"><p class="small"><strong>' + esc(q) + '</strong></p><div class="p-line"></div></div>'; }
  return '<section class="p-sec p-myplan"><h2>我的照護計畫（請醫療團隊幫忙填）</h2>' +
    line('平常早上的體重（乾體重）：＿＿＿＿ 公斤') +
    line('體重在 ＿＿ 天內增加 ＿＿ 公斤，就打電話給：') +
    (wr ? '<p class="small">' + esc(wr.text) + '</p>' : '') +
    line('白天打給（科別／電話）：') + line('晚上、假日打給：') + line('我的心臟科醫院／醫師：') + line('常去的藥局：') +
    line('下次回診：＿＿ 月 ＿＿ 日　下次抽血：＿＿ 月 ＿＿ 日　下次心臟超音波：＿＿ 月 ＿＿ 日') +
    line('生病吃不下、拉肚子時，哪些藥要先問過再吃：') + '</section>';
}
/* 3.2（R-D-020）：我現在吃的藥——只列病人選過的藥名（中文／學名），劑量、時間、誰開的由藥師當面填；系統不填劑量或時間 */
function medListHtml() {
  var ms = (state.facts.med_instances || []).filter(function (m) { return m.status !== 'STOPPED'; });
  var cols = ['藥名（藥袋上的名字）', '早', '中', '晚', '睡前', '誰開的／哪裡拿', '備註'];
  var rows = ms.map(function (m) { var i = ING_BY_ID[m.ingredient]; return '<tr><td>' + esc(i ? ingText(i) : m.ingredient) + (m.status === 'UNSURE' ? '<br><span class="small">（不確定還有沒有在吃）</span>' : '') + '</td>' + cols.slice(1).map(function () { return '<td>&nbsp;</td>'; }).join('') + '</tr>'; }).join('');
  for (var k = ms.length; k < Math.max(ms.length + 3, 6); k++) rows += '<tr>' + cols.map(function () { return '<td>&nbsp;</td>'; }).join('') + '</tr>';
  return '<section class="p-sec p-medlist"><h2>我現在吃的藥（請藥師核對）</h2><p class="small">把所有藥袋（包括其他醫院、診所、成藥、保健品）一起帶去。下面是' + T('您', '病人') + '在這次選過的藥名；時間、劑量與誰開的，請藥師當面幫忙填，不要自己猜。</p>' +
    '<table class="p-table p-diary-table"><thead><tr>' + cols.map(function (c) { return '<th scope="col">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></section>';
}
/* 14 天自我觀察表：每天早上量體重，和自己比（DIARY-01） */
function diaryHtml() {
  var cols = ['日期', '早上體重', '比昨天多／少', '喘（和平常比）', '腳或肚子腫', '血壓／心跳（有量才填）', '藥都吃了', '備註'];
  var rows = '';
  for (var i = 0; i < 14; i++) rows += '<tr>' + cols.map(function () { return '<td>&nbsp;</td>'; }).join('') + '</tr>';
  return '<section class="p-sec p-diary"><h2>14 天自我觀察表</h2><p class="small">每天早上起床、上完廁所、吃東西前，用同一台秤量體重。我的乾體重：＿＿＿ 公斤；打電話的標準：＿＿＿＿＿＿。</p>' +
    '<table class="p-table p-diary-table"><thead><tr>' + cols.map(function (c) { return '<th scope="col">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p class="small">出現「什麼時候要求救」列出的情況，照那裡寫的時間處理；看診時把這張表帶去。</p></section>';
}
function homePackPanel() {
  return '<section class="panel no-print home-pack"><h2>' + T('在家自我照顧包', '在家照顧包') + '</h2>' +
    '<p class="small">把「什麼時候要求救」、「我的照護計畫」（請醫療團隊幫忙填）和「14 天自我觀察表」一起印出來，貼在家裡或帶去看診。</p>' +
    '<div class="row"><button class="btn secondary" type="button" data-act="preset_home">印在家自我照顧包</button></div></section>';
}
/* 唸給我聽：只用裝置本機的中文語音（不經網路；沒有本機語音就不提供） */
var speaking = false;
function localZhVoice() {
  if (!('speechSynthesis' in window)) return null;
  return (window.speechSynthesis.getVoices() || []).filter(function (v) { return v.localService && /^zh/i.test(v.lang); })
    .sort(function (a, b) { return (/TW|Hant/i.test(b.lang) ? 1 : 0) - (/TW|Hant/i.test(a.lang) ? 1 : 0); })[0] || null;
}
function speakSummary() { speak(summaryText()); }
/* 3.2（R-D-017）：安全確認與「先看這一張」也能唸；沒有本機中文語音時不顯示按鈕 */
function speakBtn(kind, val) { return localZhVoice() ? '<div class="row no-print"><button class="btn ghost small" type="button" data-act="speak_part" data-val="' + esc(kind + ':' + val) + '">唸這一段（再按一次停止）</button></div>' : ''; }
function speakPart(val) {
  var p = String(val).split(':'), t = '';
  if (p[0] === 'safety') {
    var def = C.safety_steps[Number(p[1])]; if (!def) return;
    t = T(def.title, def.title_caregiver || def.title) + '。' + T(def.hint, def.hint_caregiver || def.hint) + '。' + sgGroups(def).map(function (g) {
      return g.label + '：' + g.signals.map(function (id) { var x = C.safety_signals.filter(function (s) { return s.id === id; })[0]; return x ? x.label : ''; }).filter(Boolean).join('；');
    }).join('。') + '。有的就勾，都沒有就按最下面的按鈕。';
  } else if (p[0] === 'card') {
    var c = findCard(p[1]); if (!c) return;
    t = c.title + '。' + (c.actions || []).slice(0, 3).join('。') + (c.when ? '。什麼時候：' + c.when : '') + (c.escalate ? '。什麼情況要馬上處理：' + c.escalate : '');
  }
  if (t) speak(t);
}
function speak(text) {
  var v = localZhVoice();
  if (!v) { announce('這台裝置沒有可以離線朗讀的中文語音，所以不提供唸讀。'); return; }
  if (speaking) { window.speechSynthesis.cancel(); speaking = false; announce('已停止唸讀。'); return; }
  var u = new window.SpeechSynthesisUtterance(String(text).replace(/[｜|]/g, '，'));
  u.voice = v; u.lang = v.lang; u.rate = 0.9;
  u.onend = function () { speaking = false; };
  speaking = true; window.speechSynthesis.speak(u);
}
/* ===== 本次摘要（帶去看診）：畫面上唯一的一份，第一層只有它 ===== */
function item(id, inner, tag, cls) { tag = tag || 'p'; return '<' + tag + ' data-item="' + esc(id) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + inner + '</' + tag + '>'; }
/* 3.4（T09）：結果頁第一層只放「這次最重要」「今天先做」（part:'core'）；其餘摘要區塊放第二層收合（part:'rest'）。列印與一頁重點版照舊用完整版（不傳 part） */
function projectionHtml(proj, opts) {
  opts = opts || {};
  if (!proj) return '';
  var core = opts.part !== 'rest', rest = opts.part !== 'core';
  var h = opts.part === 'rest' ? '<details class="panel vs-more" id="visit_summary_more"><summary>本次摘要｜帶去看診</summary>' :
    '<section class="visit-summary" id="' + (opts.print ? 'print_summary' : 'visit_summary') + '" aria-labelledby="' + (opts.print ? 'ps_h' : 'vs_h') + '">' +
    '<h2 id="' + (opts.print ? 'ps_h' : 'vs_h') + '">本次摘要｜帶去看診</h2>';
  if (core) {
  var shA = LINK && LINK.selfHarmActive && LINK.selfHarmActive();   /* 5.2 F-03：自傷回答屬安全項，摘要狀態不再寫「沒有勾到需要立刻處理的警訊」 */
  h += item('SUMMARY.BADGE', esc(shA && (!proj.route_css || proj.route_css === 'neutral') ? T('您回答有想傷害自己的念頭：今天要處理（說明在最上面）', '您回答病人有想傷害自己的念頭：今天要處理（說明在最上面）') : proj.safety_badge), 'p', 'vs-badge ' + esc(shA && (!proj.route_css || proj.route_css === 'neutral') ? 'day' : (proj.route_css || 'neutral')));
  if (proj.primary_issue) h += '<div class="vs-block"><h3>這次最重要</h3>' + item('SUMMARY.ISSUE', esc(proj.primary_issue), 'p', 'vs-lead') + '</div>';
  if (proj.primary_action) {
    h += '<div class="vs-block"><h3>今天先做</h3>' + item('SUMMARY.ACTION', esc(proj.primary_action), 'p', 'vs-lead');
    proj.also_today.forEach(function (a, i) { h += item('SUMMARY.ALSO.' + (i + 1), '今天也要：' + esc(a.action), 'p', 'vs-also'); });
    h += '</div>';
  }
  }
  if (opts.part === 'core') {
    h += '<p class="small muted vs-meta">' + esc(proj.respondent_text) + '｜依這次填的資料整理</p>';
    if ('speechSynthesis' in window) h += '<div class="row no-print"><button class="btn ghost" type="button" data-act="speak">唸給我聽（再按一次停止）</button></div>';
    return h + '</section>';
  }
  if (proj.medication_signal) h += '<div class="vs-block"><h3>吃藥要先確認</h3>' + item('SUMMARY.MED', esc(proj.medication_signal.message) + (proj.medication_signal.action ? '<br><span class="small">' + esc(proj.medication_signal.action) + '</span>' : '')) + '</div>';
  if (proj.visit_questions.length || proj.what_matters) {
    h += '<div class="vs-block"><h3>看診先問</h3>' + (proj.what_matters ? item('SUMMARY.WHAT_MATTERS', '我最在意：' + esc(proj.what_matters.text), 'p', 'small') : '') +
      (proj.visit_questions.length ? '<ol class="vs-q">' + proj.visit_questions.map(function (q, i) { return item('SUMMARY.Q' + (i + 1), esc(q.text), 'li'); }).join('') + '</ol>' : '') + '</div>';
  }
  if (proj.blocking_gap) h += '<div class="vs-block"><h3>看診時問</h3>' + item('SUMMARY.GAP', esc(proj.blocking_gap.message)) + '<p class="small muted">' + esc(proj.blocking_gap.why_it_matters) + '</p></div>';
  if (proj.bring_item) h += '<div class="vs-block"><h3>看診時帶上</h3>' + item('SUMMARY.BRING', esc(proj.bring_item.message)) + '<p class="small muted">' + esc(proj.bring_item.why_it_matters) + '</p></div>';
  if ((proj.reteach || []).length) h += '<div class="vs-block"><h3>想請醫療團隊再說一次</h3>' + item('SUMMARY.RETEACH', '想請醫療團隊再說一次：' + esc(proj.reteach.map(function (x) { return x.title; }).join('、'))) + '<p class="small muted">' + T('您在理解確認時選了「還不太確定」或答錯的項目。很多人都需要再聽一次。', '照顧者或病人在理解確認時選了「還不太確定」或答錯的項目。') + '</p></div>';
  if (opts.part === 'rest') return h + '</details>';
  h += '<p class="small muted vs-meta">' + esc(proj.respondent_text) + (opts.print ? '' : '｜依這次填的資料整理') + '</p>';
  if (!opts.print && ('speechSynthesis' in window)) h += '<div class="row no-print"><button class="btn ghost" type="button" data-act="speak">唸給我聽（再按一次停止）</button></div>';
  return h + '</section>';
}
/* F52 照護者語氣的卡片順序：跟您有關的原因 → 現在怎麼做 → 為什麼 → 什麼情況要馬上處理 → 找誰／什麼時候 → 請不要 → 更精確的說法 */
function saltHtml(c) {
  var sr = C.salt_reference;
  if (!sr || sr.attach_to !== c.id) return '';
  var src = C.sources[sr.source_id];
  return '<p class="small salt-ref"><strong>一般成人的鹽量參考：</strong>' + esc(sr.text) + (src ? '<br><span class="muted">出處：' + esc(src.org) + '〈' + esc(src.title) + '〉</span>' : '') + '</p>';
}
/* 卡片三層（P0-04）：第一層 現在怎麼做／什麼時候／找誰／升級；第二層 原因、說明、請不要、更精確的說法；第三層 參考資料 */
var DIARY_CARDS = { SYM_SWELL: 1, SELF_DAILY: 1, SAME_DAY: 1, POST_FIRST_WEEK: 1, SELF_WORSEN_PLAN: 1 };
function renderCard(c, opts) {
  opts = opts || {};
  var chip = ORIGIN_CHIP[c.origin] || ['', ''];
  var safetyCls = c.origin === 'SAFETY' ? ' safety ' + (c.timing === 'NOW' ? 'urg-now' : (/^SAME_DAY/.test(c.id) ? 'day' : 'urg')) : '';
  var planned = toSet(state.planned);
  var h = '<div class="chips"><span class="chip ' + chip[0] + '">' + chip[1] + '</span></div>';
  if (c.hetero_note) h += '<p class="small">' + esc(c.hetero_note) + '</p>';
  var body = c.med ? medTable(c.med) : (c.map ? mapHtml(c.map) : '');
  if (body) h += body;
  var plain = c.id === 'EMERGENCY' || c.origin === 'SAFETY' || opts.plainActions;
  var acts = c.actions || [];
  if (acts.length) {
    var shown = acts.slice(0, 3), more = acts.slice(3);
    var allPlanned = acts.every(function (a, i) { return planned[c.id + '#' + i]; });
    h += '<div class="actions-list"><h4>現在這樣做</h4><ol>' + shown.map(function (a) { return '<li>' + G(a) + '</li>'; }).join('') + '</ol>' +
      (more.length ? '<details class="more-acts"><summary>還有 ' + more.length + ' 個做法</summary><ol start="4">' + more.map(function (a) { return '<li>' + G(a) + '</li>'; }).join('') + '</ol></details>' : '') +
      (plain ? '' : '<button class="btn ghost small no-print" type="button" data-act="plan_card" data-val="' + esc(c.id) + '" aria-pressed="' + (allPlanned ? 'true' : 'false') + '">' + (allPlanned ? '✓ 已加入我準備做的事（再按一次取消）' : '加入我準備做的事') + '</button>') + '</div>';
  }
  if (c.id === 'EMERGENCY') h += '<p><a class="btn em tel" href="tel:119">' + ICON.phone + '撥打 119</a></p><p class="small">若按鈕無法撥號，請直接用電話撥 119。</p>';
  var kv = [];
  if (c.when) kv.push('<strong>什麼時候：</strong>' + esc(c.when));
  if (c.who && c.who.length) kv.push('<strong>找誰：</strong>' + whoText(c.who));
  if (kv.length) h += '<p class="small">' + kv.join('<br>') + '</p>';
  if (c.escalate) h += '<p class="escalate"><strong>' + ICON.warn + '什麼情況要馬上處理：</strong>' + G(c.escalate) + '</p>';
  /* 4.9.3 WP-A（CARE-PHARM-08）：重要以上與高風險用藥卡（血鉀、消炎止痛藥）的「請不要」和「要馬上處理」一樣放第一層（已審核的卡片原文，不新增措辭）；第二層不重複 */
  var doNotTop = !!c.do_not && (c.risk === 'CRITICAL' || c.risk === 'IMPORTANT' || c.id === 'RULE_K_RISK' || c.id === 'RULE_NSAID');
  if (doNotTop) h += '<p class="do-not do-not-top"><strong>請不要：</strong>' + G(c.do_not) + '</p>';
  /* 3.2（R-D-019）：叫病人每天量、寫下來的卡，直接給工具（紙本 14 天表、行事曆提醒）；不改卡片文字 */
  if (DIARY_CARDS[c.id]) h += '<div class="row no-print card-tools"><button class="btn secondary small" type="button" data-act="preset_home">印 14 天體重表（在家照顧包）</button><button class="btn ghost small" type="button" data-act="ics_weight">加到行事曆：每天早上量體重</button></div>';
  if (opts.open && !opts.print) h += speakBtn('card', c.id);
  /* 第二層 */
  var why = '';
  if (c.reason) why += '<p class="ctx"><strong>' + T('跟您有關的原因：', '跟病人有關的原因：') + '</strong>' + esc(c.reason) + '</p>';
  if (!body && c.text) why += '<p>' + G(c.text) + '</p>';
  if (c.do_not && !doNotTop) why += '<p class="do-not"><strong>請不要：</strong>' + G(c.do_not) + '</p>';
  if (c.detail || saltHtml(c)) why += '<details class="detail"><summary>想知道更精確的說法</summary>' + (c.detail ? '<p class="small">' + G(c.detail) + '</p>' : '') + saltHtml(c) + '</details>';
  if (why) h += '<details class="why-layer"' + (opts.openWhy || plain ? ' open' : '') + '><summary>為什麼、請不要自己做什麼</summary>' + why + '</details>';
  /* 理解確認（chunk-and-check）：只在安全卡與高風險卡；一般主題卡不放測驗 */
  if ((c.risk === 'CRITICAL' || c.origin === 'SAFETY' || opts.teach) && !opts.noTeach) h += teachBlock(c);
  /* 3.0.0 連續衛教：醫療人員先前判定為理解的卡（不限高風險），病人可以只答確認題，不必整張重看 */
  else if (!opts.noTeach && c.check && LINK && LINK.verifyOnly && LINK.verifyOnly(c.id)) h += teachBlock(c);
  if (opts.feasibility) h += feasibilityBlock();
  /* 第三層 */
  h += evidenceHtml(c.evidence, c.esc);
  return '<details class="card' + safetyCls + '" id="card_' + esc(c.id) + '"' + (opts.open ? ' open' : '') + '><summary><span class="sum-title">' + esc(c.title) + '</span></summary>' + h + '</details>';
}
/* 理解確認兩步（HL-P1-04）：先用自己的話說（自述）→ 再選一題客觀確認；答錯就再教一次、再確認一次。
 * 「說得出來」只是自述；客觀題答對另記 OBJECTIVE_CORRECT／RETEST_CORRECT，兩者都只是提醒病人停下來想一想，不是評量。不打分數、不記錄病人說的內容。 */
function teachBlock(c) {
  var st = state.teach[c.id], lst = state.learning[c.id];
  if (!c.teach && !c.check) return '';
  var h = '<div class="selfcheck no-print" id="teach_' + esc(c.id) + '">';
  /* 連續照護（3.0.0）：之前醫療人員判定為理解、內容也沒改版的卡，病人可以跳過「用自己的話說」直接回答確認題；答錯照樣標示需要協助 */
  if (!st && c.check && LINK && LINK.verifyOnly && LINK.verifyOnly(c.id)) {
    h += '<p class="small">您之前已經和醫療團隊確認過這一張。如果還記得，可以直接回答一題確認；不確定的話先看一次上面的內容。</p>' +
      '<div class="choices two"><button class="choice" type="button" data-act="teach_verify" data-val="' + esc(c.id) + '">我記得，直接確認</button>' +
      (c.teach ? '' : '<button class="choice" type="button" data-act="teach_reread" data-val="' + esc(c.id) + '">我先看一次再回答</button>') + '</div>';
    if (!c.teach) return h + '</div>';   /* 沒有「用自己的話說」的卡：選了其中一個才出現確認題 */
  }
  if (c.teach) {
    h += '<p><strong>我想確認一下：</strong>' + esc(c.teach.prompt) + '</p>' +
      '<p class="small muted">請在心裡或對身邊的人用自己的話說一次，再選一個。這不是考試，也不代表已經測過您懂不懂。</p><div class="choices two">' +
      '<button class="choice" type="button" data-act="teach_ok" data-val="' + esc(c.id) + '" aria-pressed="' + (st && st !== 'NEED_HELP' ? 'true' : 'false') + '">我說得出來</button>' +
      '<button class="choice" type="button" data-act="teach_help" data-val="' + esc(c.id) + '" aria-pressed="' + (st === 'NEED_HELP' ? 'true' : 'false') + '">還不太確定</button></div>' +
      '<p class="feedback" id="tb_' + esc(c.id) + '" role="status" aria-live="polite">' + (st === 'NEED_HELP' ? esc(c.teach.hint) + '　看診時也可以請醫療團隊再說一次，這很常見。' : '') + '</p>';
  }
  var showCheck = c.check && (!c.teach || (st && st !== 'NEED_HELP'));
  if (showCheck) {
    var wrong = lst === 'UNDERSTANDING_NOT_YET';
    h += '<div class="objective"><p><strong>' + (c.teach ? '再確認一次：' : '確認我知道下一步：') + '</strong>' + esc(c.check.q) + '</p><div class="choices">' +
      c.check.options.map(function (o, i) { return '<button class="choice" type="button" data-act="check" data-val="' + esc(c.id + '#' + i) + '">' + esc(o[0]) + '</button>'; }).join('') + '</div>' +
      '<p class="feedback' + (lst === 'UNDERSTANDING_CHECKED' ? ' good' : (wrong ? ' bad' : '')) + '" id="fb_' + esc(c.id) + '" role="status" aria-live="polite">' +
      (lst === 'UNDERSTANDING_CHECKED' ? '對，就是這樣做。' : (wrong ? '再看一次上面的「現在這樣做」，然後再選一次。' : '')) + '</p></div>';
  }
  return h + '</div>';
}
/* 時間一律顯示台灣時間（UTC+8）；不顯示 ISO 的 Z 格式 */
function twTime(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? '' : new Date(t + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' '); }
function allCards(r) { return r.cards.concat(r.supplement_hidden || [], r.med_reference || []); }
function findCard(id) { if (!lastResult) return null; var a = allCards(lastResult); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
/* 「現在請打 119／現在去急診」：只給行動，不給一般衛教，也沒有「繼續看其他衛教」 */
function stopScreen(r, rv) {
  var h = routeHead(rv);
  if (rv.route === 'EMERGENCY') h = h.replace('</section>', '<p><a class="btn em tel" href="tel:119">撥打 119</a></p><p class="small">按鈕不能撥號時，請直接用電話撥 119；收訊不好時可改撥 112，聽語音按 9 轉接 119。</p></section>');
  else h = h.replace('</section>', '<p class="small">路上變得更不舒服、快昏倒、意識改變，或喘到講不出完整句子，改打 119。</p><p><a class="btn em tel" href="tel:119">需要時撥打 119</a></p></section>');
  return h + r.cards.map(function (c) { return renderCard(c, { open: true, plainActions: true, noTeach: true }); }).join('') +
    '<div class="panel no-print"><p class="small">如果是勾錯了，可以回去修改。</p><div class="row"><button class="btn ghost" type="button" data-act="safety_fix">勾錯了，回去修改</button></div></div>' +
    (LINK && LINK.stopPanel ? LINK.stopPanel(r) : '');
}
SCREENS.RESULT = function () {
  var r = analyzeNow();
  (r.cards || []).forEach(function (c) { if (!state.learning[c.id]) state.learning[c.id] = 'SHOWN'; });
  if (r.status !== 'OK') {
    return '<section class="result-head em"><h1>' + esc(r.cards[0].title) + '</h1></section>' + r.cards.map(function (c) { return renderCard(c, { open: true }); }).join('') +
      '<div class="panel no-print"><div class="row">' + (r.status === 'NEED_SAFETY_ASSESSMENT' ? '<button class="btn primary" type="button" data-act="safety_restart">回到第 1 步</button>' : '') + '<button class="btn secondary" type="button" data-act="restart_confirm">重新開始</button></div>' + restartBox() + '</div>';
  }
  var rv = E.routeView(r.route, state.mode);
  if (rv.stop_routine) return stopScreen(r, rv);
  var proj = r.projection;
  /* ===== RESULT_CORE：安全狀態 → 本次摘要 → 先看這一張 → 「主要整理已完成」＋帶走 ===== */
  var h = (LINK && LINK.resultTopHtml ? LINK.resultTopHtml() : '') + routeHead(rv) + resultLead(r) + (cg() ? '<p class="small cg-note">' + (anyCg(r) ? '有些提醒已經改寫成您可以幫病人做的事；其他' : '') + '下面寫的「您」，指的是您照顧的那位家人。</p>' : '') + projectionHtml(proj, { part: 'core' });
  var pool = r.cards.concat(r.supplement_hidden || []);
  var secondCards = pool.filter(function (c) { return c.origin === 'SECOND'; });
  pool = pool.filter(function (c) { return c.origin !== 'SECOND'; });
  var openIds = {};
  var safety = r.cards.filter(function (c) { return c.origin === 'SAFETY'; }).slice(0, 2);
  if (safety.length) safety.forEach(function (c) { openIds[c.id] = true; });
  else if (proj && proj.primary_card_id) openIds[proj.primary_card_id] = true;
  if (Object.keys(openIds).length < 2) { var firstPrim = pool.filter(function (c) { return c.origin === 'PRIMARY'; })[0]; if (firstPrim) openIds[firstPrim.id] = true; }
  var openCards = pool.filter(function (c) { return openIds[c.id]; });
  /* 3.2（R-D-005）：「先看這一張」裡第一張有理解確認內容的一般卡也提供 teach-back（剛出院、量體重的情境最需要）；一頁最多一張非安全卡，避免負擔 */
  var firstTeach = (openCards.filter(function (c) { return c.origin !== 'SAFETY' && (c.teach || c.check); })[0] || {}).id;
  /* 3.4（T09）：第一層＝這次最重要、今天先做（上面）＋帶走／儲存（下面這一塊；病人連結版另有固定在畫面下方的儲存按鈕）。
     安全卡（SAFETY）永遠展開在第一層；其他「先看這一張」、摘要其餘區塊移到第二層收合（內容與文字不變、不刪除） */
  var safeFirst = openCards.filter(function (c) { return c.origin === 'SAFETY'; }), otherFirst = openCards.filter(function (c) { return c.origin !== 'SAFETY'; });
  function cardsOf(list) { return list.map(function (c) { return renderCard(c, { open: true, feasibility: c === openCards[0], teach: c.origin !== 'SAFETY' && c.id === firstTeach }); }).join(''); }
  if (safeFirst.length) h += '<section class="group" aria-labelledby="g_first"><h2 class="group-title" id="g_first">先看這一張</h2>' + cardsOf(safeFirst) + '</section>';
  if (askEnough) { h += '<p class="notice small voice" role="status">' + esc(C.ask_enough_text) + '</p>'; askEnough = false; }
  /* 3.4（T09）：帶走的按鈕放在這一塊的最上面（390px 第一個螢幕看得到）；文字不變、仍在同一塊 */
  /* v4.3 X05：個人連結的結果頁主要按鈕只有「儲存給醫療團隊」（固定在下方）；列印改為次要按鈕。公開版不變 */
  h += '<section class="panel done-box" id="result_done"><div class="row"><button class="btn ' + (LINK ? 'secondary' : 'primary') + '" type="button" data-act="open_print">' + ICON.print + '列印／存 PDF</button>' +
    '<button class="btn secondary" type="button" data-act="copy">複製摘要</button></div><div id="copyarea"></div>' +
    '<p class="voice" id="done_voice"><strong>' + esc(LINK && LINK.doneText ? LINK.doneText(cg()) : T(C.result_done_text, C.result_done_text_cg)) + '</strong></p>' +
    (LINK ? '' : '<p class="small muted">' + esc(C.voice.save_not_notify) + '</p>') + '</section>';
  /* ===== 精簡求救階梯（安全內容，不收合；119 與本次分級恆常展開） ===== */
  h += warningLadder({ route: r.route });
  /* ===== 第二層 ===== */
  h += projectionHtml(proj, { part: 'rest' });
  if (otherFirst.length) h += '<details class="panel group first-more" id="first_more"><summary>先看這一張</summary>' + cardsOf(otherFirst) + '</details>';
  if (state.primary_concern === 'GOALS' || findCard('GOALS_WHAT_MATTERS')) h += whatMattersBlock();
  /* ===== RESULT_MORE：想更精準 → 第二件事 → 其他提醒 → 更多工具 ===== */
  var nq = QR.next(state, qSkipped, r);
  if (nq) {
    var why = proj && proj.blocking_gap ? proj.blocking_gap.why_it_matters : '回答了會讓上面的整理更貼近' + T('您', '病人') + '的情況；每一題都可以略過。';
    h += '<section class="panel no-print nbq"><h2>想讓整理更貼近您？再補一題</h2><p class="small">' + esc(why) + '</p>' +
      '<button class="btn secondary" type="button" data-act="ask_start">好，再補一題</button></section>';
  }
  h += secondTopicBlock(secondCards);
  var rest = pool.filter(function (c) { return !openIds[c.id]; }).concat(r.med_reference || []);
  if (rest.length) {
    h += '<details class="panel more-cards" id="more_cards"><summary>需要時再看其他提醒（' + rest.length + ' 項）</summary><div class="group">';
    ['now', 'discuss', 'learn'].forEach(function (g) {
      var list = rest.filter(function (c) { return c.group === g; });
      if (list.length) h += '<h3 class="group-title">' + GROUP_TITLE[g] + '</h3>' + list.map(function (c) { return renderCard(c); }).join('');
    });
    h += '</div></details>';
  }
  if (LINK && LINK.resultPanel) h += LINK.resultPanel(r);
  h += '<details class="panel more-tools" id="more_tools"><summary>更多工具（在家照顧包、提醒、修改回答、完整紀錄）</summary>';
  if (!(state.primary_concern === 'GOALS' || findCard('GOALS_WHAT_MATTERS'))) h += whatMattersBlock();
  if (state.primary_concern === 'ADHERENCE') h += secondBarrierBlock();
  h += homePackPanel() + calendarPanel() + safetyReentry();
  h += '<section class="panel no-print"><h2>修改回答或複製</h2><div class="row">' +
    '<button class="btn secondary" type="button" data-act="safety_restart">第 1 步 安全確認（會重問）</button>' +
    '<button class="btn secondary" type="button" data-act="goto" data-val="CHANGE">第 2 步 最近變化</button>' +
    '<button class="btn secondary" type="button" data-act="goto" data-val="CONCERN">第 3 步 今天最想處理</button>' +
    '<button class="btn secondary" type="button" data-act="edit_meds">藥袋上的藥</button>' +
    '<button class="btn ghost" type="button" data-act="copy_full">複製完整整理</button></div>' +
    '<div class="row"><button class="btn ghost" type="button" data-act="restart_confirm">重新開始</button></div>' + restartBox() + '</section>';
  h += '<details class="panel" id="full_record"><summary>查看這次完整填答紀錄</summary>' + fullRecordHtml(r) + '</details>';
  h += '<details class="panel small muted" id="meta_info"><summary>資料來源與版本</summary>' + metaHtml(r) + '</details>';
  h += '<section class="panel small muted"><h3>使用本頁時請記得</h3><p>本頁不是診斷或處方系統，不會要求您自行開始、停用、換藥或調整劑量。若醫療團隊已告訴您「症狀突然變差時怎麼做」、「生病吃不下時藥怎麼處理」或「利尿劑如何調整」，請以您的個人計畫為準。</p></section>';
  h += '</details>';
  return h;
};

/* F52：結果頁第一句話，承接病人剛剛選的事（不說「系統判斷」、不假裝已通知任何人） */
function concernText() {
  var b = state.branch, p = state.primary_concern;
  var mp = medProblemDef(b.med_problem); if (mp) return mp.label;
  var ot = otherTopicDef(b.other_topic); if (ot) return ot.label;
  var br = C.branches[p], f = br && b[br.field];
  if (br && f) return label(br.options, f);
  var it = intentDef(state.concern_intent); return it ? it.label : '';
}
function resultLead(r) {
  var ctx = concernText();
  if (LINK && LINK.selfHarmActive && LINK.selfHarmActive()) return '<p class="voice lead-voice" id="lead_sh">' + esc(T('您剛才回答有想傷害自己的念頭：請先看最上面的說明。下面是其他整理。', '您剛才回答病人有想傷害自己的念頭：請先看最上面的說明。下面是其他整理。')) + '</p>';   /* 5.2 F-03（模擬病人試行句） */
  if (ctx && state.concern_intent !== 'NONE') return '<p class="voice lead-voice">' + esc(T(C.voice.result_lead, C.voice.result_lead_cg).replace('{ctx}', ctx)) + '</p>';
  if (state.recent_change === 'WORSE' || state.recent_change === 'UNSURE') return '<p class="voice lead-voice">' + esc(C.voice.result_lead_change) + '</p>';
  if (!(state.safety.signals || []).length) return '<p class="voice lead-voice">' + esc(C.voice.result_lead_none) + '</p>';
  return '';
}
function anyCg(r) { return allCards(r).some(function (c) { return c.cg_applied; }); }
/* F31：看完第一件事之後才問第二件事；不增加開始時的負擔 */
function secondTopicBlock(cards) {
  var list = C.second_topics || [];
  if (!list.length) return '';
  var h = '<details class="panel no-print second-topic" id="second_topic"' + (state.second_topic ? ' open' : '') + '><summary>' + esc(C.voice.second_topic_q) + '</summary><p class="small muted">' + esc(C.voice.second_topic_hint) + '</p>' +
    choicesFirstMore('second_topics', list, 'second_topic', state.second_topic, objId, objLabel) +
    (state.second_topic ? '<div class="row"><button class="btn ghost small" type="button" data-act="second_topic" data-val="">先不用，拿掉第二件事</button></div>' : '') + '</details>';
  if (state.second_topic && !cards.length) h += '<p class="small voice" id="second_cards" role="status">' + esc(C.voice.second_topic_already) + '</p>';
  if (cards.length) h += '<section class="group" id="second_cards" aria-labelledby="g_second"><h2 class="group-title" id="g_second">您加的第二件事</h2>' +
    cards.map(function (c, i) { return renderCard(c, { open: i === 0 }); }).join('') + '</section>';
  return h;
}
/* 加到手機行事曆（.ics）：檔案在這台裝置上產生，不經網路；病人自己決定要不要匯入 */
function calendarPanel() {
  return '<section class="panel no-print" id="calendar_panel"><h2>' + ICON.calendar + T('加到手機行事曆，比較不會忘', '幫病人加到手機行事曆') + '</h2>' +
    '<p class="small">下載後用手機打開，就能加入提醒。檔案在這台裝置上產生，不會送出任何資料。<span class="muted">（檔案格式是 .ics）</span></p>' +
    '<div class="row"><button class="btn secondary" type="button" data-act="ics_weight">加到行事曆：每天早上量體重</button></div>' +
    '<div class="row"><label class="small" for="ics_visit">下次回診日期（選填）</label><input id="ics_visit" type="date" data-local-only="1" class="num">' +
    '<button class="btn secondary" type="button" data-act="ics_visit">加到行事曆：回診前一天提醒</button></div>' +
    '<p id="ics_msg" class="small" role="status" aria-live="polite"></p></section>';
}
function icsStamp(d) { return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'; }
function icsDate(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
/* RFC 5545：每行最多 75 個位元組（UTF-8），超過就折行，續行以一個空白開頭 */
function icsFold(line) {
  var out = '', n = 0;
  for (var i = 0; i < line.length; i++) {
    var c = line.charCodeAt(i), ch = line.charAt(i), b = c < 0x80 ? 1 : (c < 0x800 ? 2 : (c >= 0xD800 && c <= 0xDBFF ? 4 : 3));
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < line.length) { ch += line.charAt(i + 1); i++; }
    if (n + b > 75) { out += '\r\n '; n = 1; }
    out += ch; n += b;
  }
  return out;
}
function icsText(ev) {
  var now = new Date();
  var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HF Care Conversation//zh-TW', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    'UID:hfpc-' + ev.kind + '-' + now.getTime() + '@local', 'DTSTAMP:' + icsStamp(now)].concat(ev.lines).concat([
    'SUMMARY:' + ev.summary, 'DESCRIPTION:' + ev.desc, 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:' + ev.summary, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR']);
  return L.map(icsFold).join('\r\n') + '\r\n';
}
function downloadIcs(name, text) {
  var msg = $('ics_msg');
  try {
    var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    var okMsg = '已產生「' + name + '」。打開這個檔案，就能加到行事曆；如果沒有看到下載，請改用手機的時鐘或行事曆自己設定。';
    if (msg && msg.offsetParent !== null) msg.textContent = okMsg; else announce(okMsg);
  } catch (e) { if (msg) msg.textContent = '這個瀏覽器不能下載行事曆檔；請直接在手機的時鐘或行事曆設定提醒。'; }
}
function icsWeight() {
  var d = new Date(); d.setDate(d.getDate() + 1);
  downloadIcs('每天量體重提醒.ics', icsText({ kind: 'weight', lines: ['DTSTART:' + icsDate(d) + 'T070000', 'DURATION:PT5M', 'RRULE:FREQ=DAILY'],
    summary: '早上量體重（起床、上完廁所、吃東西前）', desc: '用同一台秤，記在觀察表。和平常比變化大時，照「什麼時候要求救」處理；有個人數字以醫療團隊為準。' }));
}
function icsVisit() {
  var el = $('ics_visit'), msg = $('ics_msg'), v = el && el.value;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  if (!m) { if (msg) msg.textContent = '請先選下次回診的日期。'; if (el) el.focus(); return; }
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); d.setDate(d.getDate() - 1);
  downloadIcs('回診前一天提醒.ics', icsText({ kind: 'visit', lines: ['DTSTART:' + icsDate(d) + 'T190000', 'DURATION:PT10M'],
    summary: '明天心臟科回診：準備藥袋、體重紀錄和這份整理', desc: '把所有的藥（含自己買的、保健品）和藥袋帶去；把想問的問題寫下來。' }));
}
function metaHtml(r) {
  var p = r.projection || {};
  return '<p>內容版本 ' + esc(C.config.version) + '（' + esc(C.config.content_updated) + ' 更新）｜證據查核 ' + esc(C.config.evidence_reviewed) + '</p>' +
    '<p>摘要規則 ' + esc(p.projection_version || '') + '｜產生時間 ' + esc(twTime(p.generated_at)) + '（台灣時間）｜比較基準：' + (LINK ? LINK.comparisonText() : '和平常相比（不是和上一次比）') + '</p>' +
    '<p>執行方式：' + (LINK ? LINK.runtimeText() : '只在這個頁面上計算，不會存下來，也不會送出。') + '</p>' + trialNote();
}
function fullRecordHtml(r) {
  var planned = plannedList();
  var checked = r.cards.filter(function (c) { return state.learning[c.id] === 'UNDERSTANDING_CHECKED' || state.teach[c.id] === 'OWN_WORDS_DONE'; }).map(function (c) { return c.title; });
  var needHelp = r.cards.filter(function (c) { return state.teach[c.id] === 'NEED_HELP'; }).map(function (c) { return c.title; });
  return '<div class="record"><h3>我這次的回答（自己填的）</h3><div class="table-scroll"><table><tbody>' + r.summary.answers.map(function (a) { return '<tr><th scope="row">' + esc(a[0]) + '</th><td>' + esc(a[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    '<h3>我準備做的事</h3>' + (planned.length ? '<ul>' + planned.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="muted">還沒有勾選。</p>') +
    (checked.length ? '<h3>已完成自我確認</h3><ul>' + checked.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul><p class="small muted">自我確認代表當下答對，不代表已經做到。</p>' : '') +
    (needHelp.length ? '<h3>想請醫療團隊再說一次的部分</h3><ul>' + needHelp.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
    ((r.gaps || []).length ? '<h3>這份整理還缺的資料</h3><ul>' + r.gaps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul><p class="small muted">沒有填不代表沒問題；補齊之後整理出來的內容可能不一樣。</p>' : '') + '</div>';
}
/* 重新開始是不可復原的動作，先確認再做 */
function restartBox() {
  return '<div id="restart_box" class="notice warn no-print" hidden role="alertdialog" aria-label="確認重新開始">' +
    '<p><strong>要重新開始嗎？</strong>這次填的內容會全部清掉，包括已經勾好的「我準備做」清單，而且沒辦法復原。</p>' +
    '<div class="row"><button class="btn em" type="button" data-act="restart">是，全部清掉重來</button>' +
    '<button class="btn secondary" type="button" data-act="restart_cancel">不要，留著</button></div></div>';
}
function feasibilityBlock() {
  var v = state.feasibility;
  var h = '<div class="feas no-print"><h4>上面要做的事，' + T('您', '你們') + '做得到嗎？（選填）</h4><div class="choices two">' + C.feasibility_options.map(function (o) { return choiceBtn('feas', o[0], o[1], v === o[0]); }).join('') + '</div>';
  if (v === 'HARD') h += '<fieldset><legend>最主要的困難是？</legend><div class="choices two">' + C.feasibility_barriers.map(function (o) { return choiceBtn('feasb', o[0], o[1], state.feasibility_barrier === o[0]); }).join('') + '</div></fieldset>';
  return h + '</div>';
}
/* 什麼對我最重要：一次一題的小流程（P1-04）；只在病人按了才開始；完成後只顯示摘要 */
var wmStep = null;
function whatMattersBlock() {
  var w = state.what_matters, done = !!(w.improve || w.worry) && !wmStep;
  var h = '<section class="panel no-print" id="what_matters"><h2>' + ICON.chat + '什麼對' + T('您', '病人') + '最重要（選填）</h2>';
  if (!wmStep && !done) {
    return h + '<p class="small muted">選了之後，「看診先問」會改成用' + T('您', '病人') + '在意的事來問。</p><div class="row"><button class="btn secondary" type="button" data-act="wm_start">我想回答</button></div></section>';
  }
  if (done) {
    return h + '<p>' + (w.improve ? '最希望改善：<strong>' + esc(label(C.what_matters_improve, w.improve)) + '</strong>' : '') + (w.worry ? '<br>最擔心：<strong>' + esc(label(C.what_matters_worry, w.worry)) + '</strong>' : '') +
      (state.preference_source ? '<br><span class="small muted">' + esc(label(C.preference_source_options, state.preference_source)) + '</span>' : '') + '</p>' +
      ((w.improve === 'OTHER' || w.worry === 'OTHER') ? '<p class="small voice">選了「其他」：可以在「列印／存 PDF」頁的「我的備註」寫下來，只會印在紙上，不會存下來。</p>' : '') +
      '<div class="row"><button class="btn ghost small" type="button" data-act="wm_start">修改</button></div></section>';
  }
  if (wmStep === 'READY') return h + oneQuestion('現在想談這件事嗎？', '選「今天先不談」也沒關係，前面的內容不會受影響。', C.goals_discussion_readiness_options, 'gdr', state.goals_discussion_readiness) + '</section>';
  if (wmStep === 'IMPROVE') return h + oneQuestion('最希望改善的一件事是？', '', C.what_matters_improve, 'wm_improve', w.improve) + '</section>';
  if (wmStep === 'WORRY') return h + oneQuestion('最擔心的一種治療負擔是？', '', C.what_matters_worry, 'wm_worry', w.worry) + '</section>';
  if (wmStep === 'SRC') return h + oneQuestion('上面這兩題，是誰的想法？', '寫清楚是誰的想法，醫療團隊才知道要跟誰確認。', C.preference_source_options, 'pref_src', state.preference_source) + '</section>';
  return h + '</section>';
}
function secondBarrierBlock() {
  var opts = C.branches.ADHERENCE.options.filter(function (o) { return o[0] !== state.branch.adherence_barrier; });
  return '<section class="panel no-print"><h2>還有其他用藥困難？（選填）</h2><div class="choices two">' + opts.map(function (o) { return choiceBtn('barrier2', o[0], o[1], state.adherence_barrier_2 === o[0]); }).join('') + '</div></section>';
}
function plannedList() {
  return (state.planned || []).map(function (k) { var parts = k.split('#'); var c = findCard(parts[0]); return c && c.actions ? c.actions[Number(parts[1])] : null; }).filter(Boolean);
}
function summaryText() {
  var r = lastResult || analyzeNow();
  return SUM.toText(r.projection, { when: nowText() });
}
function fullText() {
  var r = lastResult || analyzeNow();
  var L = [SUM.toText(r.projection, { when: nowText() }), '', '— 我這次的回答 —'];
  r.summary.answers.forEach(function (a) { L.push(a[0] + '：' + a[1]); });
  var planned = plannedList(); if (planned.length) { L.push('— 我準備做的事 —'); planned.forEach(function (x) { L.push('・' + x); }); }
  var more = (r.projection.visit_questions_more || []); if (more.length) { L.push('— 時間夠再問 —'); more.forEach(function (q) { L.push('・' + q.text); }); }
  if ((r.gaps || []).length) { L.push('— 這份整理還缺的資料 —'); r.gaps.forEach(function (g) { L.push('・' + g); }); }
  return L.join('\n');
}

/* ===== 列印／存 PDF：摘要固定在第一頁最上面；預設只印摘要 ===== */
var PRINT_SECTIONS = [
  { id: 'summary',   label: '本次摘要（帶去看診）', pinned: true, desc: '固定印在最前面', origin: 'SYSTEM_CLINICAL' },
  { id: 'ladder',    label: '什麼時候要求救（精簡）', pinned: true, desc: '固定印在摘要後面；每一級只列幾個例子', origin: 'SYSTEM_SAFETY' },
  { id: 'ladder_full', label: '什麼時候要求救（完整清單）', desc: '全部警訊逐項列出', origin: 'SYSTEM_SAFETY' },
  { id: 'myplan',    label: '我的照護計畫（空白欄）', desc: '請醫療團隊幫忙填：體重警戒、聯絡電話、下次回診與抽血' },
  { id: 'diary',     label: '14 天自我觀察表',       desc: '每天早上量體重，看診時帶去' },
  { id: 'mynote',    label: '我的備註：這次看診我想問（自己寫）', desc: '在「我的備註」打字，或留空白印出來手寫；只印在紙上，不會存下來；印出來會標示「您自行填寫的內容」', origin: 'PATIENT_NOTE' },
  { id: 'notes',     label: '看診後記下來（空白欄）', desc: '留空白讓您當場手寫', origin: 'PATIENT_NOTE' },
  { id: 'medlist',   label: '我現在吃的藥（請藥師核對）', desc: '您選過的藥名，後面留空白欄給藥師寫時間與誰開的' },
  { id: 'plan',      label: '我準備做的事',          desc: '您在各項提醒裡勾起來的行動' },
  { id: 'now',       label: '現在先做的提醒',        desc: '完整卡片內容' },
  { id: 'discuss',   label: '這次看診帶去談',        desc: '完整卡片內容' },
  { id: 'map',       label: '心衰竭治療核對清單',    desc: '依您資料整理的核對表' },
  { id: 'meds',      label: '用藥類別說明',          desc: '您選的藥所屬的類別說明' },
  { id: 'learn',     label: '有空再了解',            desc: '衛教內容' },
  { id: 'questions', label: '完整問題清單',          desc: '含「時間夠再問」的題目' },
  { id: 'answers',   label: '我這次的回答',          desc: '完整填答紀錄' },
  { id: 'gaps',      label: '還缺的資料',            desc: '這份整理還沒有的資訊' },
  { id: 'sources',   label: '參考資料來源',          desc: '每項內容的依據' }
];
function printPrefs() {
  if (!state.print_prefs) {
    /* 3.2（R-D-018）：畫面用大字的人，印出來預設也放大 */
    state.print_prefs = { order: PRINT_SECTIONS.map(function (x) { return x.id; }), on: { summary: true, ladder: true }, font: document.documentElement.classList.contains('large-text') ? 'large' : 'normal', paper: 'a4' };
  }
  return state.print_prefs;
}
function sectionDef(id) { for (var i = 0; i < PRINT_SECTIONS.length; i++) if (PRINT_SECTIONS[i].id === id) return PRINT_SECTIONS[i]; return null; }
function printSectionHtml(id, r) {
  var proj = r.projection;
  if (id === 'summary') return projectionHtml(proj, { print: true });
  if (id === 'ladder') return warningLadder({ print: true });
  if (id === 'ladder_full') return warningLadder({ print: true, full: true });
  if (id === 'myplan') return myPlanHtml();
  if (id === 'diary') return diaryHtml();
  if (id === 'medlist') return medListHtml();
  if (id === 'plan') {
    var planned = plannedList();
    return '<section class="p-sec"><h2>我準備做的事</h2>' + (planned.length ? '<ul>' + planned.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="muted">（還沒有勾選）</p>') + '</section>';
  }
  if (id === 'now' || id === 'discuss' || id === 'learn') {
    var list = r.cards.concat(r.supplement_hidden || []).filter(function (c) { return c.group === id && c.id !== 'TREATMENT_MAP'; });
    return list.length ? '<section class="p-sec"><h2>' + GROUP_TITLE[id] + '</h2>' + list.map(printCardHtml).join('') + '</section>' : '';
  }
  if (id === 'map') {
    var m = r.cards.concat(r.supplement_hidden || []).filter(function (c) { return c.id === 'TREATMENT_MAP'; })[0];
    return m ? '<section class="p-sec"><h2>' + esc(m.title) + '</h2>' + mapHtml(m.map) + '</section>' : '';
  }
  if (id === 'meds') {
    var medCards = r.cards.filter(function (c) { return c.med; }).concat(r.med_reference || []);
    if (!medCards.length) return '';
    return '<section class="p-sec"><h2>用藥類別說明</h2>' + medCards.map(function (c) {
      return '<article class="p-card"><h3>' + esc(c.title) + '</h3>' + (c.hetero_note ? '<p class="small">' + esc(c.hetero_note) + '</p>' : '') + medTable(c.med) + '</article>';
    }).join('') + '</section>';
  }
  if (id === 'questions') {
    var qs = proj.visit_questions.concat(proj.visit_questions_more).map(function (q) { return q.text; });
    return qs.length ? '<section class="p-sec"><h2>看診時可以問的問題</h2><ol>' + qs.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol></section>' : '';
  }
  if (id === 'answers') return '<section class="p-sec"><h2>我這次的回答</h2><table class="p-table"><tbody>' + r.summary.answers.map(function (a) { return '<tr><th scope="row">' + esc(a[0]) + '</th><td>' + esc(a[1]) + '</td></tr>'; }).join('') + '</tbody></table></section>';
  if (id === 'gaps') {
    var g = r.gaps || [];
    return g.length ? '<section class="p-sec"><h2>這份整理還缺的資料</h2><ul>' + g.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul><p class="small">沒有填不代表沒問題；補齊之後整理出來的內容可能不一樣。</p></section>' : '';
  }
  if (id === 'sources') {
    var ids = {}, rows = [];
    allCards(r).forEach(function (c) { (c.evidence || []).forEach(function (e) { if (!ids[e[0]] && C.sources[e[0]]) { ids[e[0]] = true; rows.push(C.sources[e[0]]); } }); });
    return rows.length ? '<section class="p-sec"><h2>參考資料來源</h2><ul class="small">' + rows.map(function (x) { return '<li>' + esc(x.title) + '｜' + esc(x.org) + '｜' + esc(x.year) + '｜' + esc(x.url) + '</li>'; }).join('') + '</ul></section>' : '';
  }
  if (id === 'mynote') {
    var nt = printOnly.note.replace(/\r/g, '').trim();
    return '<section class="p-sec p-mynote"><h2>這次看診我想問 <span class="p-user-tag">' + esc(T('您自行填寫的內容', '照顧者自行填寫的內容')) + '</span></h2>' + (nt ? '<p>' + esc(nt).replace(/\n/g, '<br>') + '</p>' :
      '<div class="p-note"><div class="p-line"></div><div class="p-line"></div><div class="p-line"></div><div class="p-line"></div></div>') + '</section>';
  }
  if (id === 'notes') {
    return '<section class="p-sec p-notes"><h2>看診後記下來</h2>' + ['今天有沒有改藥？', '下一步要做的檢查或追蹤？', '下次回診或聯絡的時間？', '什麼情況要提早回來？'].map(function (q) {
      return '<div class="p-note"><p class="small">' + esc(q) + '</p><div class="p-line"></div><div class="p-line"></div></div>';
    }).join('') + '</section>';
  }
  return '';
}
function printCardHtml(c) {
  var h = '<article class="p-card"><h3>' + esc(c.title) + '</h3>';
  if (c.actions && c.actions.length) h += '<p class="small"><strong>現在怎麼做</strong></p><ul>' + c.actions.map(function (a) { return '<li>' + G(a) + '</li>'; }).join('') + '</ul>';
  h += '<p>' + G(c.text) + '</p>';
  if (c.escalate) h += '<p class="small"><strong>什麼情況要馬上處理：</strong>' + G(c.escalate) + '</p>';
  if (c.who && c.who.length) h += '<p class="small"><strong>找誰：</strong>' + whoText(c.who) + '</p>';
  if (c.when) h += '<p class="small"><strong>什麼時候：</strong>' + esc(c.when) + '</p>';
  if (c.do_not) h += '<p class="small"><strong>請不要：</strong>' + G(c.do_not) + '</p>';
  h += saltHtml(c);
  return h + '</article>';
}
/* 回答改變後，預覽上的手改內容就不適用了（避免印出和答案不一致的內容） */
function printFooter() {
  return '<footer class="p-foot small">內容版本 ' + esc(C.config.version) + '｜內容更新 ' + esc(C.config.content_updated) + '｜證據查核 ' + esc(C.config.evidence_reviewed) + '｜列印 ' + nowText() +
    '<br>本頁是衛教與溝通用的整理，不是診斷或處方；系統整理的醫療與安全內容不能修改，標示「自行填寫」的是' + T('您', '照顧者') + '自己寫的。有醫療團隊給您的個人計畫時，以個人計畫為準。緊急狀況請直接撥 119。</footer>';
}
/* 列印文件：系統產生的醫療與安全內容一律不可編輯（PRINT_CLINICAL_TEXT_IMMUTABILITY）；只有標成「自行填寫」的備註是病人的文字 */
function printDocHtml(r) {
  var pp = printPrefs();
  glSeen = {};
  var head = '<header class="p-head"><h1 id="p_head_title">心衰竭照護對話｜看診用整理</h1>' +
    (printOnly.title ? '<p class="p-user-title">' + esc(T('您填寫的標題', '照顧者填寫的標題')) + '：' + esc(printOnly.title) + '</p>' : '') +
    '<p class="small">填寫時間 ' + nowText() + '｜' + esc(r.projection.respondent_text) + '｜內容版本 ' + esc(r.summary.version) + '｜不含姓名或病歷號</p></header>';
  var ids = pp.order.filter(function (id) { var d = sectionDef(id); return d && (pp.on[id] || d.pinned); });
  var body = ids.map(function (id) {
    var inner = printSectionHtml(id, r); if (!inner) return '';
    var d = sectionDef(id), origin = d.origin || 'SYSTEM_CLINICAL';
    return '<div class="p-wrap' + (origin === 'PATIENT_NOTE' ? ' p-user' : '') + '" data-sec="' + esc(id) + '" data-origin="' + esc(origin) + '">' + inner + '</div>';
  }).join('');
  return '<div id="printdoc" class="printdoc font-' + esc(pp.font) + ' paper-' + esc(pp.paper) + '">' + head + body + printFooter() + '</div>';
}
function refreshPreview() { var prev = document.querySelector('.p-preview'); if (prev) prev.innerHTML = printDocHtml(lastResult || analyzeNow()); }
var PRESETS = {
  min: { label: '一頁重點版', desc: '本次摘要、什麼時候要求救', on: { summary: true, ladder: true } },
  home: { label: '在家自我照顧包', desc: '加上我的照護計畫（空白欄）、14 天觀察表、我現在吃的藥、我準備做的事', on: { summary: true, ladder: true, plan: true, myplan: true, diary: true, medlist: true } },
  notes: { label: '摘要＋看診筆記', desc: '加上我的備註與看診後記下來的空白欄', on: { summary: true, ladder: true, mynote: true, notes: true } },
  full: { label: '完整照護版', desc: '所有段落，含完整警訊清單、卡片、核對表、來源', on: null }
};
function applyPreset(name) {
  var pp = printPrefs(), pr = PRESETS[name]; if (!pr) return;
  if (pr.on) pp.on = JSON.parse(JSON.stringify(pr.on)); else { pp.on = {}; PRINT_SECTIONS.forEach(function (x) { pp.on[x.id] = true; }); }
  if (printOnly.note.trim()) pp.on.mynote = true;
  pp.preset = name;
}
SCREENS.PRINT = function () {
  var r = lastResult || analyzeNow();
  var pp = printPrefs();
  if (!pp.preset) { pp.preset = 'min'; if (plannedList().length && pp.on.plan === undefined) pp.on.plan = true; }
  var pinnedIds = PRINT_SECTIONS.filter(function (x) { return x.pinned; }).map(function (x) { return x.id; });
  var movable = pp.order.filter(function (id) { return pinnedIds.indexOf(id) < 0 && sectionDef(id); });
  var rows = pinnedIds.concat(movable).map(function (id) {
    var d = sectionDef(id); if (!d) return '';
    var empty = !printSectionHtml(id, r);
    var i = movable.indexOf(id);
    return '<li class="p-row' + (empty ? ' empty' : '') + '">' +
      '<label class="check"><input type="checkbox" data-act="psec" data-val="' + esc(id) + '"' + (pp.on[id] || d.pinned ? ' checked' : '') + (d.pinned ? ' disabled' : '') + '>' +
      '<div><strong>' + esc(d.label) + '</strong><span>' + esc(d.desc) + (empty ? '（這次沒有內容）' : '') + '</span></div></label>' +
      '<span class="p-move">' + (d.pinned ? '<span class="small muted">固定在前面</span>' :
        '<button class="btn ghost" type="button" data-act="pmove" data-val="' + esc(id) + ':up" aria-label="把「' + esc(d.label) + '」往前移"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button class="btn ghost" type="button" data-act="pmove" data-val="' + esc(id) + ':down" aria-label="把「' + esc(d.label) + '」往後移"' + (i === movable.length - 1 ? ' disabled' : '') + '>▼</button>') + '</span></li>';
  }).join('');
  /* 病人模式（P0-06）：一鍵一頁重點版；其他格式、我的備註、進階設定都收起來 */
  return '<section class="panel no-print"><h1>' + ICON.print + '帶走這份整理</h1>' +
    '<div class="preset-card' + (pp.preset === 'min' ? ' on' : '') + '"><h2>一頁重點版<span class="chip ok">建議</span></h2><p>' + esc(PRESETS.min.desc) + '（一張 A4）</p>' +
    '<div class="row"><button class="btn primary" type="button" data-act="print_min">' + ICON.print + '列印／存 PDF</button></div>' +
    '<p class="small muted">要存成 PDF：按下去之後，印表機選「另存為 PDF」或「儲存為 PDF」。</p></div>' +
    '<details class="panel"' + (pp.preset !== 'min' ? ' open' : '') + '><summary>其他格式' + (pp.preset !== 'min' ? '：目前選「' + esc(PRESETS[pp.preset].label) + '」' : '') + '</summary><div class="choices">' +
    ['home', 'notes', 'full'].map(function (k) { return '<button class="choice" type="button" data-act="preset_' + k + '" aria-pressed="' + (pp.preset === k ? 'true' : 'false') + '">' + esc(PRESETS[k].label) + '<span class="choice-hint">' + esc(PRESETS[k].desc) + '</span></button>'; }).join('') + '</div>' +
    '<div class="row"><button class="btn primary" type="button" data-act="print">' + ICON.print + '列印／存 PDF</button></div></details>' +
    '<details class="panel" id="mynote_box"' + (printOnly.note || printOnly.title ? ' open' : '') + '><summary>我的備註（選填）：這次看診想問的話</summary>' +
    '<p class="small muted">這兩格只會印在紙上，並標示為「' + esc(T('您自行填寫的內容', '照顧者自行填寫的內容')) + '」：不會存下來、不會送出、不會出現在「複製」；關掉或重新開始就清空。系統整理的醫療與安全內容不能修改。不需要寫姓名、身分證字號或病歷號。</p>' +
    '<label class="small" for="p_title">紙上的標題</label><input id="p_title" type="text" data-print-only="1" maxlength="40" autocomplete="off" class="search" placeholder="例如：爸爸的看診整理" value="' + esc(printOnly.title) + '">' +
    '<label class="small" for="p_note">這次看診我想問（寫了會自動加入列印）</label><textarea id="p_note" data-print-only="1" rows="4" maxlength="600" class="copybox note" autocomplete="off">' + esc(printOnly.note) + '</textarea></details>' +
    '<details class="panel" id="print_advanced"><summary>進階設定（選段落、排順序、字級、紙張）</summary>' +
    '<fieldset><legend>要印哪些？</legend><ul class="p-list">' + rows + '</ul></fieldset>' +
    '<fieldset><legend>字要多大？</legend><div class="choices two">' +
    [['normal', '一般'], ['large', '放大（給長輩看）'], ['xlarge', '特大']].map(function (o) { return choiceBtn('pfont', o[0], o[1], pp.font === o[0]); }).join('') + '</div></fieldset>' +
    '<fieldset><legend>紙張</legend><div class="choices two">' +
    [['a4', 'A4 直式'], ['a5', 'A5 小張'], ['a4l', 'A4 橫式（兩欄）']].map(function (o) { return choiceBtn('ppaper', o[0], o[1], pp.paper === o[0]); }).join('') + '</div></fieldset>' +
    '<div class="row"><button class="btn ghost" type="button" data-act="preset_reset">全部恢復預設</button></div></details>' +
    '<div class="row split">' + backBtn('← 回到整理') + '</div></section>' +
    '<section class="panel no-print-shell"><h2>印出來會長這樣</h2><p class="small muted">' + (pp.paper === 'a4' ? '紅色虛線大約是 A4 換頁的位置；' : '') + '實際分頁由印表機決定。系統整理的內容不能在這裡修改；要補充請用「我的備註」。</p>' +
    '<div class="p-preview">' + printDocHtml(r) + '</div></section>';
};

/* ---------- 事件（委派） ---------- */
function setPressed(t) { [].slice.call(t.parentNode.children).forEach(function (b) { b.setAttribute('aria-pressed', b === t ? 'true' : 'false'); }); }
function afterMedPick() {
  if (state.branch.med_problem === 'TOLERABILITY' && !state.branch.side_effect) { go('BRANCH'); return; }
  state.branch.med_done = true; go('RESULT');
}
function refreshPdButton() { var b = document.querySelector('[data-act="pd_done"]'); if (b) b.textContent = '好了，看整理'; }
function clearBranch() {
  Object.keys(state.branch).forEach(function (k) { state.branch[k] = (k === 'med_done' || k === 'post_done') ? false : null; });
  state.adherence_barrier_2 = null; coGroup = null;
}
function saveAsk(qid) {
  var q = QR.BY_ID[qid]; if (!q) return false;
  if (q.kind === 'numeric') {
    var v = $('ask_num') && $('ask_num').value;
    if (v === '' || v === null) { QR.skip(state, qid); qSkipped[qid] = true; return true; }
    if (!QR.apply(state, qid, { value: Number(v) })) { var e = $('ask_err'); e.hidden = false; e.focus && e.focus(); announce(e.textContent); return false; }
    return true;
  }
  if (q.kind === 'bmi') {
    var hh = parseFloat($('calc_h').value), ww = parseFloat($('calc_w').value);
    if (!hh && !ww) { QR.skip(state, qid); qSkipped[qid] = true; return true; }
    if (!(hh >= 100 && hh <= 230 && ww >= 25 && ww <= 300)) { var e2 = $('ask_err'); e2.hidden = false; announce(e2.textContent); return false; }
    var bmi = ww / Math.pow(hh / 100, 2);
    QR.apply(state, qid, { value: bmi >= 30 ? 'GE30' : 'LT30' });
    return true;
  }
  if (q.kind === 'multi') {
    var vals = [].slice.call(document.querySelectorAll('input[name="ask_multi"]:checked')).map(function (x) { return x.value; });
    QR.apply(state, qid, { value: vals });
    return true;
  }
  if (q.kind === 'med_picker') {
    state.facts.med_instances = (pickDraft || []).map(function (x) { return { ingredient: x.ingredient, status: x.status || 'UNSURE', source: 'PATIENT_REPORTED' }; });
    state.field_meta.med_instances = 'ASKED';
    return true;
  }
  return true;
}
function onClick(ev) {
  var t = ev.target.closest('[data-act]'); if (!t) return;
  var act = t.getAttribute('data-act'), val = t.getAttribute('data-val');
  if (t.tagName === 'INPUT') return;                     // checkbox 由 change 事件處理
  /* 防連點跳步（HFPC-AUD-0702）：只擋「同一次連點」的第二下（ev.detail ≥ 2）剛好落在新畫面上；
     鍵盤、螢幕報讀器（detail 0）與刻意的單擊（detail 1）即使很快也照常處理 */
  if (ev.detail >= 2 && Date.now() - lastRender < 350 && act !== 'check' && act !== 'pk_status') return;
  switch (act) {
    case 'mode': state.mode = val; setPressed(t); var me0 = $('mode_err'); if (me0) me0.hidden = true; break;
    case 'start': {
      if (!state.mode) { var me = $('mode_err'); if (me) { me.hidden = false; me.focus(); announce(me.textContent); } return; }
      go('SAFETY'); break; }
    case 'back': back(); break;
    case 'safety_open_all': {
      var so = Number(val); stepUnseen(so).forEach(function (g) { var d = document.querySelector('details.sg[data-gid="' + g.id + '"]'); if (d) d.open = true; markReviewed(g.id); });
      var f1 = document.querySelector('#safety_step_' + so + ' details.sg summary'); if (f1) f1.focus();
      announce('已全部展開。請由上往下看一遍，有的就勾；都沒有再按「都沒有」。'); break; }
    case 'safety_next': case 'safety_none': {
      var stepN = Number(val); if (isNaN(stepN)) stepN = Math.min(state.safety.step || 0, C.safety_steps.length - 1);
      if (act === 'safety_none' && stepUnseen(stepN).length) {
        var un0 = stepUnseen(stepN)[0], d0 = document.querySelector('details.sg[data-gid="' + un0.id + '"]');
        if (d0) { d0.scrollIntoView({ block: 'center' }); var s0 = d0.querySelector('summary'); if (s0) s0.focus(); }
        announce(needText(stepUnseen(stepN), stepTotal(stepN))); break;
      }
      if (comboPending) { var e = $('safety_err'); if (e) { e.hidden = false; e.focus(); announce(e.textContent); } return; }
      var pickedN = act === 'safety_none' ? [] : [].slice.call(document.querySelectorAll('input[name="sig"]:checked')).map(function (x) { return x.value; });
      commitSafetyStep(C.safety_steps[stepN], pickedN);
      if (stepN + 1 < C.safety_steps.length) { state.safety.step = stepN + 1; go('SAFETY', { back: true }); var hh = $('safety_h' + (stepN + 1)); if (hh) hh.focus(); }
      else { finishSafety(); advance(); }
      break; }
    case 'safety_reopen': { state.safety.step = Number(val) || 0; state.safety.status = 'NOT_ASSESSED'; state.safety.none = null; go('SAFETY', { back: true }); break; }
    case 'combo_yes': case 'combo_no': case 'combo_unsure': {
      var cp = val.split('|'), sigA = cp[0], partner = cp[1];
      comboPending = null;
      if (act === 'combo_no') comboNo[sigA + '|' + partner] = true;
      var stepC = Math.min(state.safety.step || 0, C.safety_steps.length - 1);
      var pickedC = [].slice.call(document.querySelectorAll('input[name="sig"]:checked')).map(function (x) { return x.value; });
      if (pickedC.indexOf(sigA) < 0) pickedC.push(sigA);
      commitSafetyStep(C.safety_steps[stepC], pickedC);
      if (act !== 'combo_no') {
        /* 「有」或「不確定」：把另一項也算進去（不確定不等於沒有），順序無關 */
        if (state.safety.signals.indexOf(partner) < 0) state.safety.signals = state.safety.signals.concat([partner]);
        if (act === 'combo_unsure') state.safety.combo_unsure = (state.safety.combo_unsure || []).concat([partner]);
      }
      var rvC = E.routeView(E.safetyRoute(Object.assign({}, state, { safety: Object.assign({}, state.safety, { status: 'COMPLETED', none: null }) })).route);
      var sigDef = C.safety_signals.filter(function (x) { return x.id === sigA; })[0];
      if ((rvC && rvC.immediate) || (sigDef && E.routeView(sigDef.level).immediate)) { finishSafety(); go(E.nextStep(state)); }
      else { go('SAFETY', { back: true }); var el = $('sig_' + sigA); if (el) el.focus(); }
      break; }
    case 'safety_ack': state.safety_ack = true; advance(); break;
    case 'safety_restart': E.resetSafety(state); lastResult = null; comboNo = {}; comboPending = null; go('SAFETY'); break;
    case 'safety_fix': {
      /* 勾錯了：回到最嚴重那一項所在的那一頁，勾選保留，重新確認 */
      var sig = state.safety.signals || [], idx = -1;
      C.safety_steps.forEach(function (st, i) { if (idx < 0 && C.safety_signals.some(function (x) { return sig.indexOf(x.id) >= 0 && st.levels.indexOf(x.level) >= 0; })) idx = i; });
      if (idx < 0) idx = 0;
      state.safety.status = 'NOT_ASSESSED'; state.safety.none = null; state.safety.step = idx; state.safety_ack = false;
      go('SAFETY', { back: true }); break; }
    case 'change': state.recent_change = val; advance(); break;
    case 'intent': {
      var it = intentDef(val); if (!it) break;
      if (state.concern_intent !== val) { clearBranch(); state.primary_concern = null; }
      state.concern_intent = val;
      if (it.preset) Object.keys(it.preset).forEach(function (k) { state.branch[k] = it.preset[k]; });   /* 5.2 F-03：心情 → 直接帶入「心情低落、焦慮或記性變差」 */
      if (it.to) { state.primary_concern = it.to; advance(); } else go('CONCERN_SUB');
      break; }
    case 'med_problem': {
      var mp = medProblemDef(val); if (!mp) break;
      if (state.branch.med_problem !== val) { clearBranch(); }
      state.branch.med_problem = val; state.primary_concern = mp.to;
      if (mp.to === 'MEDICATION' && !mp.follow) state.branch.med_done = true;
      advance(); break; }
    case 'other_topic': {
      var ot = otherTopicDef(val); if (!ot) break;
      if (state.branch.other_topic !== val) clearBranch();
      state.branch.other_topic = val; state.primary_concern = ot.to;
      if (ot.goals_topic) state.branch.goals_topic = ot.goals_topic;
      advance(); break; }
    case 'branch': state.branch[E.BRANCH_FIELD_BY_CONCERN[state.primary_concern]] = val; coGroup = null; advance(); break;
    case 'co_group': coGroup = val || null; if (!val) state.branch.comorbidity_focus = null; go('BRANCH', { back: true }); break;
    case 'second_topic': state.second_topic = val || null; rerenderResult(val ? 'second_cards' : 'second_topic'); break;
    case 'ics_weight': icsWeight(); break;
    case 'ics_visit': icsVisit(); break;
    case 'preset_reset': { state.print_prefs = null; applyPreset('min'); go('PRINT', { back: true }); announce('已恢復預設：一頁重點版。'); break; }
    case 'br_recon': state.facts.med_reconciliation = val; state.field_meta.med_reconciliation = 'ASKED'; state.branch.med_done = true; go('RESULT'); break;
    case 'br_skip': state.field_meta.med_reconciliation = 'ASKED'; state.branch.med_done = true; go('RESULT'); break;
    case 'mp_ing': { var ing = ING_BY_ID[val]; if (!ing) break; state.branch.med_focus = C.medications.some(function (m) { return m.id === ing.cls; }) ? ing.cls : 'UNKNOWN_NAME'; state.branch.med_focus_ing = val;
      /* 病人點了這顆藥＝正在吃；帶進用藥清單，後面不用再選一次（MED-CARRY-01） */
      var mis = Array.isArray(state.facts.med_instances) ? state.facts.med_instances : [];
      if (!mis.some(function (m) { return m.ingredient === val; })) state.facts.med_instances = mis.concat([{ ingredient: val, status: 'CURRENT', source: 'PATIENT_REPORTED' }]);
      medQuery = ''; afterMedPick(); break; }
    case 'mp_class': state.branch.med_focus = val; state.branch.med_focus_ing = null; medQuery = ''; afterMedPick(); break;
    case 'mp_unknown': state.branch.med_focus = 'UNKNOWN_NAME'; state.branch.med_focus_ing = null; medQuery = ''; afterMedPick(); break;
    case 'mp_mine': state.branch.med_focus = 'ALL'; state.branch.med_focus_ing = null; medQuery = ''; afterMedPick(); break;   /* 5.2 F-01：看過「我的藥」→ 整理全部的藥 */
    case 'side_effect': state.branch.side_effect = val; state.branch.med_done = true; go('RESULT'); break;
    case 'pd_reason': state.facts.discharge_reason = val; state.field_meta.discharge_reason = 'ASKED'; setPressed(t); refreshPdButton(); break;
    case 'pd_when': state.facts.discharge_when = val; state.field_meta.discharge_when = 'ASKED'; setPressed(t); refreshPdButton(); break;
    case 'pd_recon': state.facts.med_reconciliation = val; state.field_meta.med_reconciliation = 'ASKED'; setPressed(t); refreshPdButton(); break;
    case 'pd_done': { ['discharge_reason', 'discharge_when', 'med_reconciliation'].forEach(function (k) { state.field_meta[k] = 'ASKED'; }); state.branch.post_done = true; go('RESULT'); break; }
    case 'goto': go(val); break;
    case 'edit_meds': { currentQ = 'Q_MEDS'; pickDraft = null; delete qSkipped.Q_MEDS; go('ASK'); break; }
    case 'ask_start': { askRound = 0; askEnough = false; var nq = QR.next(state, qSkipped, analyzeNow()); if (nq) { currentQ = nq.id; pickDraft = null; go('ASK'); } else go('RESULT'); break; }
    case 'ask_choice': QR.apply(state, currentQ, { value: val }); nextQuestionOrResult(); break;
    case 'ask_escape': {
      /* 唯一逃生鍵：數字題記成「不知道」（不當正常）；選項題與多選題略過（不當成「沒有」） */
      var qe = QR.BY_ID[currentQ];
      if (qe && (qe.kind === 'numeric' || qe.kind === 'bmi')) QR.apply(state, currentQ, { unknown: true }); else { QR.skip(state, val); qSkipped[val] = true; }
      nextQuestionOrResult(); break; }
    case 'ask_band': QR.apply(state, currentQ, { band: val }); nextQuestionOrResult(); break;
    case 'ask_skip': QR.skip(state, val); qSkipped[val] = true; nextQuestionOrResult(); break;
    case 'ask_save': if (saveAsk(val)) nextQuestionOrResult(); break;
    case 'pk_add': {
      if (!pickDraft.some(function (x) { return x.ingredient === val; })) pickDraft.push({ ingredient: val, status: null });
      refreshPicker(); var last = document.querySelector('#pk_selected .pk-item:last-child legend'); if (last) announce('已加入：' + last.textContent);
      break; }
    case 'pk_status': { var ps = val.split(':'); if (pickDraft[Number(ps[0])]) pickDraft[Number(ps[0])].status = ps[1]; setPressed(t); break; }
    case 'pk_remove': pickDraft.splice(Number(val), 1); refreshPicker(); break;
    case 'feas': state.feasibility = val; if (val !== 'HARD') state.feasibility_barrier = null; rerenderResult('card_' + ((lastResult && lastResult.projection && lastResult.projection.primary_card_id) || '')); break;
    case 'feasb': state.feasibility_barrier = val; rerenderResult(); break;
    case 'wm_start': wmStep = 'READY'; rerenderResult('what_matters'); break;
    case 'gdr': state.goals_discussion_readiness = val; wmStep = val === 'NOT_TODAY' ? null : 'IMPROVE'; rerenderResult('what_matters'); break;
    case 'wm_improve': state.what_matters.improve = val; wmStep = 'WORRY'; rerenderResult('what_matters'); break;
    case 'wm_worry': state.what_matters.worry = val; wmStep = cg() ? 'SRC' : null; rerenderResult('what_matters'); break;
    case 'pref_src': state.preference_source = val; wmStep = null; rerenderResult('what_matters'); break;
    case 'barrier2': state.adherence_barrier_2 = val; rerenderResult(); break;
    case 'check': answerCheck(val); break;
    case 'plan_card': {
      var pc = findCard(val); if (!pc || !pc.actions) break;
      var setP = toSet(state.planned), keys = pc.actions.map(function (a, i) { return pc.id + '#' + i; });
      var allOn = keys.every(function (k) { return setP[k]; });
      keys.forEach(function (k) { if (allOn) delete setP[k]; else setP[k] = true; });
      state.planned = Object.keys(setP);
      if (!allOn) state.learning[pc.id] = state.learning[pc.id] === 'UNDERSTANDING_CHECKED' ? 'UNDERSTANDING_CHECKED' : 'ACTION_PLANNED';
      t.setAttribute('aria-pressed', allOn ? 'false' : 'true'); t.textContent = allOn ? '加入我準備做的事' : '✓ 已加入我準備做的事（再按一次取消）';
      announce(allOn ? '已從我準備做的事移除。' : '已加入我準備做的事。'); refreshRecord(); break; }
    case 'teach_ok': case 'teach_help': case 'teach_verify': case 'teach_reread': {
      var tc = findCard(val); if (!tc || (act === 'teach_verify' || act === 'teach_reread' ? !tc.check : !tc.teach)) break;
      state.teach[val] = act === 'teach_help' ? 'NEED_HELP' : (act === 'teach_verify' ? 'VERIFY_ONLY' : (act === 'teach_reread' ? 'REREAD' : 'OWN_WORDS_DONE'));
      state.verify_only = state.verify_only || {};
      if (act === 'teach_verify') state.verify_only[val] = true; else delete state.verify_only[val];
      if (act === 'teach_help') delete state.learning[val];
      /* 重畫這一張的理解確認區：說得出來之後才出現客觀確認題 */
      var tbox = $('teach_' + val); if (tbox) { var tmpT = document.createElement('div'); tmpT.innerHTML = teachBlock(tc); tbox.replaceWith(tmpT.firstChild); var fq = document.querySelector('#teach_' + val + ' .objective .choice'); if (fq) fq.focus(); }
      refreshProjectionSummary(); break; }
    case 'print': doPrint(); break;
    case 'print_min': applyPreset('min'); go('PRINT', { back: true }); doPrint(); break;
    case 'preset_min': case 'preset_notes': case 'preset_home': case 'preset_full': applyPreset(act.slice(7)); go(current === 'PRINT' ? 'PRINT' : 'PRINT', { back: current === 'PRINT' }); break;
    case 'open_print': go('PRINT'); break;
    case 'pmove': {
      var parts = val.split(':'), pp = printPrefs(), pins = PRINT_SECTIONS.filter(function (x) { return x.pinned; }).map(function (x) { return x.id; }),
        mv = pp.order.filter(function (x) { return pins.indexOf(x) < 0; }), i = mv.indexOf(parts[0]);
      var j = parts[1] === 'up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < mv.length) { var tmp = mv[i]; mv[i] = mv[j]; mv[j] = tmp; }
      pp.order = pins.concat(mv);
      go('PRINT', { back: true });
      var btn = document.querySelector('[data-act="pmove"][data-val="' + val + '"]'); if (btn && !btn.disabled) btn.focus();
      break; }
    case 'pfont': printPrefs().font = val; go('PRINT', { back: true }); break;
    case 'ppaper': printPrefs().paper = val; go('PRINT', { back: true }); break;
    case 'speak_part': speakPart(val); break;
    case 'speak': speakSummary(); break;
    case 'copy': doCopy(summaryText(), '已複製摘要，可以貼到訊息或記事本。'); break;
    case 'copy_full': doCopy(fullText(), '已複製完整整理。'); break;
    case 'restart_confirm': {
      var box = $('restart_box');
      if (box) { box.hidden = false; var y = box.querySelector('button'); if (y) y.focus(); announce('要重新開始嗎？這會清掉這次填的全部內容。'); }
      else reset();
      break; }
    case 'restart_cancel': { var b2 = $('restart_box'); if (b2) b2.hidden = true; break; }
    case 'restart': reset(); break;
  }
}
/* 把這一段的勾選併入 signals；同一段未勾的項目一律移除，避免上一輪殘留 */
function commitSafetyStep(def, picked) {
  var inStep = toSet(C.safety_signals.filter(function (x) { return def.levels.indexOf(x.level) >= 0; }).map(function (x) { return x.id; }));
  var kept = (state.safety.signals || []).filter(function (id) { return !inStep[id]; });
  state.safety.signals = kept.concat(picked);
  if ((state.safety.steps_done || []).indexOf(def.id) < 0) state.safety.steps_done = (state.safety.steps_done || []).concat([def.id]);
}
function finishSafety() {
  var prevRoute = E.safetyRoute(state).route;
  state.safety.status = 'COMPLETED';
  state.safety.none = state.safety.signals.length ? null : true;
  state.safety.step = C.safety_steps.length;
  if (E.safetyRoute(state).route !== prevRoute) state.safety_ack = false;
}
function onInput(ev) {
  var t = ev.target.nodeType === 1 ? ev.target : ev.target.parentElement, role = t && t.getAttribute && t.getAttribute('data-role');
  if (!t) return;
  if (role === 'mp_search') { medQuery = t.value; var r = $('mp_results'); if (r) r.innerHTML = mpResults(); }
  if (role === 'co_search') {
    var q = String(t.value || '').trim(), br0 = C.branches.COMORBIDITY, box = $('co_results');
    if (box) box.innerHTML = !q ? '' : (function () { var hits = br0.options.filter(function (o) { return o[1].indexOf(q) >= 0; });
      return hits.length ? '<div class="choices">' + hits.map(function (o) { return choiceBtn('branch', o[0], o[1], false); }).join('') + '</div>' : '<p class="small muted">找不到「' + esc(q) + '」，請改用上面的大類。</p>'; })();
  }
  if (role === 'pk_search') { medQuery = t.value; var r2 = $('pk_results'); if (r2) r2.innerHTML = pkResults(); }
  if (t.id === 'ask_num' || t.id === 'calc_h' || t.id === 'calc_w') { var e = $('ask_err'); if (e) e.hidden = true; }
  /* F48 列印專用輸入：只寫進 printOnly，不進 state；標題印成「您填寫的標題」，備註印成「您自行填寫的內容」 */
  if (t.id === 'p_title') { printOnly.title = String(t.value || '').slice(0, 40); refreshPreview(); }
  if (t.id === 'p_note') {
    printOnly.note = String(t.value || '').slice(0, 600);
    var pp0 = printPrefs(); if (printOnly.note.trim() && !pp0.on.mynote) { pp0.on.mynote = true; var cb = document.querySelector('[data-act="psec"][data-val="mynote"]'); if (cb) cb.checked = true; }
    var w = document.querySelector('.p-wrap[data-sec="mynote"]');
    if (w) w.innerHTML = printSectionHtml('mynote', lastResult || analyzeNow()); else refreshPreview();
  }
}
function onChange(ev) {
  var t = ev.target;
  if (t.name === 'sig') { var e = $('safety_err'); if (e) e.hidden = true; }
  /* 「這些目前都不需要」不能和其他項目並存 */
  if (t.name === 'ask_multi') {
    if (t.value === 'NONE_OF_THESE' && t.checked) [].slice.call(document.querySelectorAll('input[name="ask_multi"]')).forEach(function (x) { if (x !== t) x.checked = false; });
    else if (t.checked) { var none = document.querySelector('input[name="ask_multi"][value="NONE_OF_THESE"]'); if (none) none.checked = false; }
  }
  /* 勾到警訊：先看有沒有組合追問（P0-02，順序無關）；再看是不是「現在」等級（119 或現在去急診）→ 立刻把行動送到眼前（V100-P0-SAFE-02） */
  if (t.name === 'sig') {
    var stepS = Math.min(state.safety.step || 0, C.safety_steps.length - 1);
    var pickedS = [].slice.call(document.querySelectorAll('input[name="sig"]:checked')).map(function (x) { return x.value; });
    commitSafetyStep(C.safety_steps[stepS], pickedS);
    if (!t.checked) { if (comboPending && comboPending.sig === t.value) comboPending = null; return; }
    var partners = comboPartners(t.value, toSet(state.safety.signals));
    if (partners.length) { comboPending = { sig: t.value, partner: partners[0] }; go('SAFETY', { back: true }); var ca = $('combo_ask'); if (ca) { ca.focus(); announce($('combo_q').textContent); } return; }
    if (t.getAttribute('data-immediate') === '1') { finishSafety(); go(E.nextStep(state)); return; }
    /* 非立即項目：勾了之後按鈕從「都沒有」變成「勾好了，繼續」 */
    go('SAFETY', { back: true }); var back = $('sig_' + t.value); if (back) back.focus({ preventScroll: true });
    return;
  }
  if (t.getAttribute('data-act') === 'psec') {
    var pp = printPrefs(); pp.on[t.getAttribute('data-val')] = t.checked;
    refreshPreview();
    return;
  }
  if (t.getAttribute('data-act') === 'plan') {
    var k = t.getAttribute('data-val'), set = toSet(state.planned);
    if (t.checked) set[k] = true; else delete set[k];
    state.planned = Object.keys(set);
    var cid = k.split('#')[0]; if (t.checked) state.learning[cid] = state.learning[cid] === 'UNDERSTANDING_CHECKED' ? 'UNDERSTANDING_CHECKED' : 'ACTION_PLANNED';
    refreshRecord();
  }
}
function answerCheck(val) {
  var parts = val.split('#'), c = findCard(parts[0]); if (!c || !c.check) return;
  var o = c.check.options[Number(parts[1])], fb = $('fb_' + c.id);
  var wasWrong = state.learning[c.id] === 'UNDERSTANDING_NOT_YET';
  state.learning[c.id] = o[1] ? 'UNDERSTANDING_CHECKED' : 'UNDERSTANDING_NOT_YET';
  if (c.teach) state.teach[c.id] = o[1] ? (wasWrong ? 'RETEST_CORRECT' : 'OBJECTIVE_CORRECT') : 'OBJECTIVE_INCORRECT';
  if (fb) { fb.textContent = o[2] + (o[1] ? '' : '　再看一次上面的「現在這樣做」，然後再選一次。'); fb.className = 'feedback ' + (o[1] ? 'good' : 'bad'); }
  refreshProjectionSummary();
}
/* 只換掉會變的區塊：本次摘要（refreshProjectionSummary）與完整紀錄 */
function refreshProjectionSummary() {
  if (current !== 'RESULT') return;
  var r = analyzeNow(), el = $('visit_summary');
  if (el) { var tmp = document.createElement('div'); tmp.innerHTML = projectionHtml(r.projection, { part: 'core' }); el.replaceWith(tmp.firstChild); }
  var el2 = $('visit_summary_more');
  if (el2) { var op = el2.open, tmp2 = document.createElement('div'); tmp2.innerHTML = projectionHtml(r.projection, { part: 'rest' }); tmp2.firstChild.open = op; el2.replaceWith(tmp2.firstChild); }
  refreshRecord();
}
function refreshRecord() {
  if (current !== 'RESULT' || !lastResult) return;
  var el = $('full_record'); if (!el) return;
  var open = el.open, tmp = document.createElement('div');
  tmp.innerHTML = '<details class="panel" id="full_record"><summary>查看這次完整填答紀錄</summary>' + fullRecordHtml(lastResult) + '</details>';
  el.replaceWith(tmp.firstChild); if (open) $('full_record').open = true;
}
function rerenderResult(anchorId) {
  var y = window.scrollY; glSeen = {}; $('screen').innerHTML = SCREENS.RESULT(); lastRender = 0; window.scrollTo(0, y);
  var a = anchorId && $(anchorId); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
}
function doPrint() {
  if (current !== 'PRINT') { go('PRINT'); return; }
  document.documentElement.classList.add('printing');
  var restorePrint = function () { document.documentElement.classList.remove('printing'); window.removeEventListener('afterprint', restorePrint); };
  window.addEventListener('afterprint', restorePrint);
  try { window.print(); } catch (e) { restorePrint(); }
}
function doCopy(text, okMsg) {
  var area = $('copyarea');
  function fallback() { area.innerHTML = '<p class="small">請長按或按 Ctrl+C 複製下方文字：</p><textarea class="copybox" id="copybox" readonly></textarea>'; var tb = $('copybox'); tb.value = text; tb.focus(); tb.select(); }
  try {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { area.innerHTML = '<p class="small" role="status">' + esc(okMsg) + '</p>'; }, fallback);
    else fallback();
  } catch (e) { fallback(); }
}

/* ---------- 啟動 ---------- */
function boot() {
  $('screen').addEventListener('click', onClick);
  $('screen').addEventListener('change', onChange);
  $('screen').addEventListener('input', onInput);
  /* details 的 toggle 不會冒泡：用捕獲階段記錄「看過」的警訊組（滑鼠、鍵盤、報讀軟體展開都算） */
  $('screen').addEventListener('toggle', function (ev) { var d = ev.target; if (d && d.matches && d.matches('details.sg[data-gid]') && d.open) markReviewed(d.getAttribute('data-gid')); }, true);
  $('fontToggle').addEventListener('click', function () { var on = document.documentElement.classList.toggle('large-text'); this.setAttribute('aria-pressed', String(on)); this.textContent = on ? '一般字' : '大字'; this.setAttribute('aria-label', on ? '改回一般文字大小' : '放大文字'); announce(on ? '已切換成大字。' : '已切換成一般文字。'); });
  if (LINK && LINK.attach) LINK.attach({ go: go, advance: advance, state: function () { return state; }, esc: esc, choiceBtn: choiceBtn, backBtn: backBtn, SCREENS: SCREENS, announce: announce, analyze: function () { return lastResult || analyzeNow(); }, plannedKeys: function () { return (state.planned || []).slice(); }, plannedText: plannedList, rerender: function () { go(current, { back: true }); } });
  if (LINK && LINK.ready) { $('screen').innerHTML = '<section class="panel"><p>正在載入上次的紀錄…</p></section>'; LINK.ready(reset); } else reset();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
window.HFPC_APP = { getState: function () { return JSON.parse(JSON.stringify(state)); }, current: function () { return current; },
  summaryText: function () { return summaryText(); }, projection: function () { return (lastResult || analyzeNow()).projection; },
  /* 4.9.3 WP-A：唯讀，測試用（檢查卡片分層：高風險卡「請不要」在第一層）；回傳 HTML 字串，不改狀態 */
  _renderCard: function (c, o) { return renderCard(c, o || {}); } };
})();

