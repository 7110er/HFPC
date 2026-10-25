/* =====================================================================
 * 本次摘要（帶去看診）｜精準投影層 Summary Projection Engine v1.1
 * ---------------------------------------------------------------------
 * 唯一原則：完整施工 ≠ 完整顯示。後端偵測範圍可以一直加，第一層摘要不得跟著變長。
 *
 * 這一份投影就是 DecisionOutput（R3-B）：畫面、列印、複製、主要行動列全部只讀它，
 * 不再有 engine 的 plan／questions 另外一套選擇器。
 *
 * 管線（卡片不得自己決定要不要進摘要）：
 *   Candidate → Admission Gate → Truth Gate → Specific-beats-Generic（先抑制、留紀錄）
 *   → Issue Clustering（依決策主題）→ 優先序（安全 → 行動時間 → 風險 → 影響 → 特定性 → 主題）
 *   → 病人在意的事（改措辭與同層排序）→ GapResolver（blocking_gap 與 bring_item 分開）
 *   → 語意去重（action_key／question_key）→ 硬／軟預算（must_surface 不得被默默刪掉）
 *   → display_items＋逐句 provenance
 *
 * 硬性上限見 content.js 的 config.summary_budget。
 * ===================================================================== */
(function (root) {
'use strict';
var C = root.HFPC_CONTENT || (typeof require !== 'undefined' ? require('./content.js') : null);
if (typeof require !== 'undefined' && (!C || !C.cards)) { require('./cards.js'); C = require('./meds.js'); }

var PROJECTION_VERSION = '1.1';

/* ---------- 決策主題：同一個臨床問題只能形成一條摘要主線 ---------- */
var TOPIC_ORDER = ['SAFETY_URGENT', 'WORSENING_CONGESTION', 'MED_RECONCILIATION', 'MED_INTERACTION', 'MED_TOLERABILITY',
  'TRANSITION_POST_DISCHARGE', 'MONITORING_LAB', 'DIAGNOSIS_PHENOTYPE', 'TREATMENT_REVIEW', 'MED_UNDERSTANDING',
  'ADHERENCE_FEASIBILITY', 'SELF_MANAGEMENT_PLAN', 'ACCESS_COST', 'ADVANCED_HF_GOALS', 'COMORBIDITY_RELEVANT',
  'SYMPTOM_OTHER', 'PATIENT_PRIORITY_QOL', 'SELF_CARE_EDUCATION'];
/* 這些主題屬於一般衛教：第一層固定為 0，只能留在第二層 */
var GENERIC_TOPICS = { SELF_CARE_EDUCATION: true };
var MED_TOPICS = { MED_RECONCILIATION: 1, MED_INTERACTION: 1, MED_TOLERABILITY: 1, MED_UNDERSTANDING: 1 };

/* ---------- 1. Candidate ---------- */
function specificityOf(card) {
  if (card.origin === 'SAFETY' || card.origin === 'COMBO' || card.origin === 'RULE' || card.origin === 'CHANGE') return 'SPECIFIC';
  if (card.origin === 'FACT' || card.origin === 'MAP' || card.origin === 'FEAS') return 'ISSUE_SPECIFIC';
  if (card.origin === 'PRIMARY') return card.group === 'learn' ? 'GENERIC' : 'ISSUE_SPECIFIC';
  return 'GENERIC';
}
function impactOf(card) {
  if (card.origin === 'SAFETY') return 'CHANGES_ROUTE';
  if (MED_TOPICS[card.topic] && card.topic !== 'MED_UNDERSTANDING') return 'CHANGES_MED_SAFETY';
  if (card.timing === 'NOW' || card.timing === 'TODAY' || card.timing === 'THIS_WEEK') return 'CHANGES_ACTION';
  if (card.ask) return 'CHANGES_VISIT_DECISION';
  return 'SUPPORT_ONLY';
}
function medRelevance(card) {
  if (card.id === 'MED_RECON' || card.id === 'RULE_DISCHARGE_RECON' || card.id === 'POST_RECON') return 'RECONCILIATION';
  if (card.id === 'MED_EXPOSURE_UNCLEAR' || card.id === 'MED_INCOMPLETE' || card.id === 'MED_UNKNOWN_NAME') return 'INCOMPLETE_TRUTH';
  if (/^COMBO_/.test(card.id)) return 'DUPLICATE_OR_INTERACTION';
  if (/^HAZARD_/.test(card.id)) return 'HF_HAZARD';
  if (card.id === 'MED_CHANGE_RECENT') return 'TRANSITION';
  if (card.topic === 'MED_TOLERABILITY') return 'TOLERABILITY';
  return 'NONE';
}
/* 每張卡帶進摘要時使用的輸入欄位（provenance 用；讓每一句都追得回是哪些回答造成的） */
function inputFactsOf(card) {
  if (card.input_facts) return card.input_facts;
  switch (card.origin) {
    case 'SAFETY': return ['safety.signals'];
    case 'CHANGE': return ['recent_change', 'facts.recent_hf_discharge', 'facts.med_change_recent', 'facts.med_reconciliation'];
    case 'PRIMARY': return ['concern_intent', 'primary_concern', 'branch'];
    case 'COMBO': return ['facts.med_instances', 'facts.med_list_complete'];
    case 'MAP': return ['facts.lvef_value', 'facts.lvef_when', 'facts.lvef_source', 'facts.hf_type_told', 'facts.med_instances'];
    case 'FEAS': return ['feasibility', 'feasibility_barrier'];
    case 'MODE': return ['mode'];
    default: return ['facts'];
  }
}
function buildCandidates(state, result) {
  var out = [];
  var pool = (result.cards || []).concat(result.supplement_hidden || []);
  pool.forEach(function (card, i) {
    if (!card || !card.topic) return;
    out.push({
      candidate_id: card.id, topic: card.topic, decision_topic: card.topic,
      issue_key: card.issue_key || card.id,
      question_key: card.question_key || card.issue_key || card.topic,
      action_key: card.action_key || card.id,
      order_hint: i, card: card,
      risk: card.risk || 'GENERAL', timing: card.timing || 'NEXT_VISIT', origin: card.origin,
      specificity: specificityOf(card), decision_impact: impactOf(card),
      medication_relevance: medRelevance(card),
      patient_text: card.issue || '',
      patient_action: card.summary_action || (card.actions && card.actions[0]) || '',
      visit_question: card.ask || '',
      claim_id: card.claim_id,
      evidence_ids: (card.evidence || []).map(function (e) { return e[0]; }),
      input_fact_ids: inputFactsOf(card),
      must_surface: card.origin === 'SAFETY',
      reason: card.reason || ''
    });
  });
  return out;
}

/* ---------- 2. Admission Gate：只有會改變下一步的資訊有資格 ---------- */
var ADMITTED_IMPACT = { CHANGES_ROUTE: true, CHANGES_ACTION: true, CHANGES_MED_SAFETY: true, CHANGES_VISIT_DECISION: true };
function admit(cands, state, trace) {
  var focusTopics = {};
  cands.forEach(function (c) { if (c.origin === 'PRIMARY') focusTopics[c.topic] = true; });
  return cands.filter(function (c) {
    var why = null;
    if (GENERIC_TOPICS[c.topic]) why = 'GENERIC_EDUCATION_LAYER2';
    else if (!c.patient_text) why = 'NO_EXPLICIT_MICROCOPY';
    else if (c.specificity === 'GENERIC') why = 'GENERIC';
    else if (!ADMITTED_IMPACT[c.decision_impact]) why = 'NO_DECISION_IMPACT';
    /* 只提供一個「可以問的問題」還不夠：必須是個別化訊號，或正是病人這次想談的主題 */
    else if (c.decision_impact === 'CHANGES_VISIT_DECISION' && c.specificity !== 'SPECIFIC' && !focusTopics[c.topic]) why = 'BACKGROUND_CONTEXT_ONLY';
    if (why) { c.reject = why; trace.push({ step: 'ADMISSION', id: c.candidate_id, result: 'REJECTED', reason: why }); return false; }
    return true;
  });
}

/* ---------- 3. Truth Gate：事實層級的可信度；不足時降級，不得產生肯定句 ---------- */
function truthGate(cands, ef) {
  return cands.map(function (c) {
    var t = 'CONFIRMED_BY_PATIENT_ANSWER';
    if (c.origin === 'FACT' || c.origin === 'MAP') t = 'PATIENT_REPORTED';
    if (c.card.id === 'SYS_LVEF_CONFLICT') t = 'DISPUTED';
    if (c.card.id === 'SYS_LVEF_STALE') t = 'NOT_CURRENT';
    if (c.medication_relevance === 'INCOMPLETE_TRUTH') t = 'INCOMPLETE';
    if (c.card.data_sufficiency && /^INSUFFICIENT/.test(c.card.data_sufficiency)) t = 'INSUFFICIENT_FOR_CONCLUSION';
    c.truth_status = t;
    /* 用藥真相不完整時，不得留下特定藥物的指示語氣，只能是「請核對」 */
    if (ef.listComplete !== 'COMPLETE' && (c.medication_relevance === 'DUPLICATE_OR_INTERACTION' || c.medication_relevance === 'HF_HAZARD')) c.med_downgraded = true;
    return c;
  });
}

/* ---------- 4. Specific beats Generic：先抑制、留紀錄，再組主線 ---------- */
/* 同一主題裡，有個別化訊號（SPECIFIC）而且時間不比它晚時，較一般的那張讓位；
 * 病人這次自己選的主題（PRIMARY）不被抑制。 */
function suppressGeneric(cands, trace, suppressed) {
  var specific = {};
  cands.forEach(function (c) { if (c.specificity === 'SPECIFIC') (specific[c.topic] = specific[c.topic] || []).push(c); });
  return cands.filter(function (c) {
    if (c.specificity === 'SPECIFIC' || c.origin === 'PRIMARY') return true;
    var by = (specific[c.topic] || []).filter(function (s) { return TIMING_RANK[s.timing] <= TIMING_RANK[c.timing]; })[0];
    if (by) {
      suppressed.push({ id: c.candidate_id, reason: 'SPECIFIC_BEATS_GENERIC', suppressed_by: by.candidate_id });
      trace.push({ step: 'SPECIFIC_BEATS_GENERIC', id: c.candidate_id, by: by.candidate_id });
      return false;
    }
    return true;
  });
}

/* ---------- 5. 決定性優先序（字典序，不用不可稽核的總分） ----------
 * 安全卡 → 行動時間（今天的事一定排在這週的藥物核對前面，SUM-PRIORITY-TODAY-01）
 * → 高風險（CRITICAL）→ 病人這次自己選的主題 → 風險 → 影響 → 特定性 → 主題 */
var RISK_RANK = { CRITICAL: 0, IMPORTANT: 1, GENERAL: 2 };
function navigationIssue(state, leadId) {
  var pc = state && state.primary_concern, br = (state && state.branch) || {};
  if (pc !== 'SELF_CARE' || !br.self_care_topic || !/^SYM_/.test(leadId || '')) return '';
  var q = ((C && C.branches) || {}).SELF_CARE, opt = q ? (q.options || []).filter(function (o) { return o[0] === br.self_care_topic; })[0] : null;
  return opt ? '想先了解：' + opt[1] : '';
}
var TIMING_RANK = { NOW: 0, TODAY: 1, THIS_WEEK: 2, NEXT_VISIT: 3, ONGOING: 4, AS_NEEDED: 5 };
var IMPACT_RANK = { CHANGES_ROUTE: 0, CHANGES_MED_SAFETY: 1, CHANGES_ACTION: 2, CHANGES_VISIT_DECISION: 3, SUPPORT_ONLY: 5 };
var SPEC_RANK = { SPECIFIC: 0, ISSUE_SPECIFIC: 1, GENERIC: 2 };
function priorityClass(c) {
  if (c.origin === 'SAFETY') return 'P0_SAFETY';
  if (c.timing === 'NOW' || c.timing === 'TODAY') return 'P1_TODAY';
  if (c.timing === 'THIS_WEEK') return 'P2_THIS_WEEK';
  return 'P3_VISIT';
}
function compareCandidates(a, b) {
  var pa = priorityClass(a), pb = priorityClass(b);
  var ca = a.risk === 'CRITICAL' ? 0 : 1, cb = b.risk === 'CRITICAL' ? 0 : 1;
  var fa = a.origin === 'PRIMARY' ? 0 : 1, fb = b.origin === 'PRIMARY' ? 0 : 1;
  return (pa < pb ? -1 : pa > pb ? 1 : 0)
    || (TIMING_RANK[a.timing] - TIMING_RANK[b.timing])
    || (ca - cb)
    || (fa - fb)
    || (RISK_RANK[a.risk] - RISK_RANK[b.risk])
    || (IMPACT_RANK[a.decision_impact] - IMPACT_RANK[b.decision_impact])
    || (SPEC_RANK[a.specificity] - SPEC_RANK[b.specificity])
    || (TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic))
    || (a.order_hint - b.order_hint)
    || (a.candidate_id < b.candidate_id ? -1 : a.candidate_id > b.candidate_id ? 1 : 0);
}
function cluster(cands) {
  var byTopic = {};
  cands.forEach(function (c) { c.summary_priority_class = priorityClass(c); (byTopic[c.topic] = byTopic[c.topic] || []).push(c); });
  return Object.keys(byTopic).map(function (topic) {
    var list = byTopic[topic].slice().sort(compareCandidates);
    return { topic: topic, lead: list[0], members: list,
      primary_action: list.filter(function (c) { return c.patient_action; })[0] || null,
      medication_member: list.filter(function (c) { return c.medication_relevance !== 'NONE'; })[0] || null };
  });
}
function compareBundles(a, b) { return compareCandidates(a.lead, b.lead) || (TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic)); }

/* ---------- 6. 病人在意的事：改措辭，也改同一優先層級內的排序（不跨越安全與時間） ---------- */
var WHAT_MATTERS_TOPICS = {
  improve: { BREATH: ['WORSENING_CONGESTION'], ENERGY: ['MONITORING_LAB', 'SYMPTOM_OTHER'], SLEEP: ['SYMPTOM_OTHER'], HOSPITAL: ['TRANSITION_POST_DISCHARGE', 'TREATMENT_REVIEW'], INDEPENDENT: ['COMORBIDITY_RELEVANT', 'ADHERENCE_FEASIBILITY'] },
  worry: { SIDE_EFFECT: ['MED_TOLERABILITY', 'MED_INTERACTION'], PILL_BURDEN: ['ADHERENCE_FEASIBILITY', 'MED_RECONCILIATION'], COST: ['ACCESS_COST'], VISITS: ['ACCESS_COST', 'MONITORING_LAB'] }
};
/* 主題之外，少數卡片本身就是在談這件事（例如「吃了不舒服」屬於用藥困難主題，但就是在談副作用） */
var WHAT_MATTERS_CARDS = { worry: { SIDE_EFFECT: ['ADH_SIDE', 'CO_PAIN_GOUT'], PILL_BURDEN: ['RULE_POLY_BURDEN', 'ADH_COMPLEX'] }, improve: { BREATH: ['SYM_BREATH', 'SYM_NIGHT_BREATH'], SLEEP: ['SYM_SNORING', 'SYM_NIGHT_BREATH'] } };
function label(pairs, k) { for (var i = 0; i < pairs.length; i++) if (pairs[i][0] === k) return pairs[i][1]; return k; }
function applyPatientPriority(bundles, state) {
  var w = (state && state.what_matters) || {};
  var wanted = {};
  ((WHAT_MATTERS_TOPICS.improve[w.improve]) || []).forEach(function (t) { wanted[t] = 'improve'; });
  ((WHAT_MATTERS_TOPICS.worry[w.worry]) || []).forEach(function (t) { wanted[t] = wanted[t] || 'worry'; });
  var wantedCards = {};
  ((WHAT_MATTERS_CARDS.improve[w.improve]) || []).forEach(function (id) { wantedCards[id] = 'improve'; });
  ((WHAT_MATTERS_CARDS.worry[w.worry]) || []).forEach(function (id) { wantedCards[id] = wantedCards[id] || 'worry'; });
  bundles.forEach(function (b) {
    b.patient_priority = wanted[b.topic] || b.members.map(function (m) { return wantedCards[m.candidate_id]; }).filter(Boolean)[0] || null;
  });
  return bundles.slice().sort(function (a, b) {
    if (a.lead.summary_priority_class !== b.lead.summary_priority_class) return compareBundles(a, b);
    if (!!a.patient_priority !== !!b.patient_priority) return a.patient_priority ? -1 : 1;
    return compareBundles(a, b);
  });
}
function whatMattersLine(state) {
  var w = (state && state.what_matters) || {};
  if (!w.improve && !w.worry) return null;
  var parts = [];
  if (w.improve) parts.push('最希望改善：' + label(C.what_matters_improve, w.improve));
  if (w.worry) parts.push('最擔心：' + label(C.what_matters_worry, w.worry));
  var who = state.mode === 'CAREGIVER' ? ({ PATIENT: '（病人自己說的）', CAREGIVER_PROXY: '（照顧者代為推測）', SHARED: '（兩人一起討論）' }[state.preference_source] || '（還沒寫是誰的想法）') : '';
  return { text: parts.join('；') + who, improve: w.improve || null, worry: w.worry || null };
}

/* ---------- 7. GapResolver：依決策相依性判斷；blocking_gap 與 bring_item 分開 ---------- */
function resolveGaps(ef, top, bundles) {
  var out = { blocking_gap: null, bring_item: null, trace: [] };
  if (!top) return out;
  var t = top.topic;
  /* blocking_gap：沒有這一項，這一次最重要的那個決定就做不了 */
  if ((t === 'TREATMENT_REVIEW' || t === 'DIAGNOSIS_PHENOTYPE') && !ef.lvef) {
    out.blocking_gap = { gap_id: 'LVEF_CURRENT', field_id: 'lvef', depends_on: ['lvef_value', 'lvef_when', 'lvef_source'], blocks: t,
      message: '看診時問一下最近一次心臟超音波的射出分率、日期，和報告在哪裡',
      why_it_matters: ef.lvefRaw ? '您記得的數字，日期或來源還不確定，所以先不拿來判斷現在適合討論哪些治療。' : '沒有這個數字，就分不出該核對哪一組心衰竭治療。' };
    out.trace.push({ step: 'GAP', id: 'LVEF_CURRENT', result: 'BLOCKING', for: t });
  }
  /* bring_item：這次看診要帶的東西；只在用藥真相不完整而且和前幾條主線有關時出現 */
  var medRelated = bundles.slice(0, 3).some(function (b) { return MED_TOPICS[b.topic] || b.topic === 'TREATMENT_REVIEW' || b.topic === 'TRANSITION_POST_DISCHARGE' || b.topic === 'WORSENING_CONGESTION'; });
  if (medRelated && ef.listComplete !== 'COMPLETE') {
    out.bring_item = { gap_id: 'MED_LIST', field_id: 'medication_list', action_key: 'BRING_MED_LIST', depends_on: ['med_instances', 'med_list_complete'],
      message: '把目前真的在吃的藥袋／藥單一起帶去核對',
      why_it_matters: t === 'WORSENING_CONGESTION'
        ? '如果最近比較腫或體重上升，知道目前怎麼吃利尿相關藥物，會比較容易和醫療團隊一起找原因。'
        : '目前還沒辦法確認您實際在吃哪些藥，用藥的部分要當面核對。' };
    out.trace.push({ step: 'GAP', id: 'MED_LIST', result: 'BRING_ITEM', for: t });
  }
  return out;
}

/* ---------- 8. 看診問題：同一個決定（question_key）只留一題 ---------- */
function pickQuestions(bundles, budget, wm) {
  var seenKey = {}, out = [];
  bundles.forEach(function (b) {
    b.members.forEach(function (m) {
      if (!m.visit_question || seenKey[m.question_key] || seenKey['T:' + b.topic]) return;
      seenKey[m.question_key] = true; seenKey['T:' + b.topic] = true;
      var text = m.visit_question;
      /* What Matters 要改措辭：把病人最在意的事放進問題本身 */
      if (b.patient_priority && wm) text = '我最在意的是「' + label(b.patient_priority === 'improve' ? C.what_matters_improve : C.what_matters_worry, b.patient_priority === 'improve' ? wm.improve : wm.worry) + '」，' + text;
      out.push({ question_id: m.candidate_id, question_key: m.question_key, decision_topic: b.topic, text: text, patient_priority: !!b.patient_priority,
        claim_id: m.claim_id, evidence_ids: m.evidence_ids, input_fact_ids: m.input_fact_ids });
    });
  });
  var visible = out.slice(0, budget.visit_decisions);
  if (out.length > budget.visit_decisions) {
    var third = out[budget.visit_decisions];
    var highImpact = { SAFETY_URGENT: 1, WORSENING_CONGESTION: 1, MED_RECONCILIATION: 1, MED_INTERACTION: 1, MED_TOLERABILITY: 1, TRANSITION_POST_DISCHARGE: 1 };
    if (highImpact[third.decision_topic] && visible.length < budget.visit_decisions_max) visible = visible.concat([third]);
  }
  return { visible: visible, more: out.slice(visible.length) };
}

/* ---------- 9. 主函式 ---------- */
function prov(proj, id, text, o) {
  proj.provenance.push({ display_item_id: id, text: text, derivation_type: o.derivation_type || 'RULE_DERIVED',
    rule_id: o.rule_id || null, card_id: o.card_id || null, claim_id: o.claim_id || null, evidence_ids: o.evidence_ids || [],
    input_fact_ids: o.input_fact_ids || [], content_version: C.config.version });
  proj.display_items.push({ display_item_id: id, text: text });
}
function dropItem(proj, id) {
  proj.provenance = proj.provenance.filter(function (p) { return p.display_item_id !== id; });
  proj.display_items = proj.display_items.filter(function (p) { return p.display_item_id !== id; });
}
function build(state, result, ef, meta) {
  var budget = C.config.summary_budget;
  var route = result.route || null;
  var trace = [];
  var proj = {
    projection_version: PROJECTION_VERSION, content_version: C.config.version,
    runtime_mode: C.config.runtime_mode, generated_at: (meta && meta.generated_at) || null,   /* 引擎是純函式；時間由畫面在顯示時填入 */
    respondent: state && state.mode === 'CAREGIVER' ? 'CAREGIVER' : (state && state.mode === 'SELF' ? 'SELF' : 'UNSPECIFIED'),
    respondent_text: state && state.mode === 'CAREGIVER' ? '家人／照顧者代為填寫' : '病人本人填寫',
    comparison_reference: C.recent_change_meta.comparison_reference,
    route: route, route_css: null, route_timing: null, mode: 'PRE_VISIT',
    safety_badge: '', primary_issue: null, primary_action: null, primary_action_key: null, primary_card_id: null, also_today: [],
    medication_signal: null, visit_questions: [], visit_questions_more: [],
    blocking_gap: null, bring_item: null, what_matters: null, supporting_actions: [],
    hidden_counts: { other_education: 0, other_gaps: 0, other_details: 0 },
    provenance: [], display_items: [], suppressed: [], selection_trace: trace, budget_trace: [],
    visible_message_units: 0, first_viewport_units: 0, stable: false
  };

  /* 系統保護狀態：摘要只說一件事 */
  if (result.status !== 'OK') {
    var sc = result.cards[0] || {};
    var sev = (sc.evidence || []).map(function (e) { return e[0]; });
    proj.safety_badge = result.status === 'NEED_SAFETY_ASSESSMENT' ? '還沒完成安全確認' : '這次的資料無法判讀';
    proj.primary_issue = sc.title || '';
    proj.primary_action = (sc.actions || [])[0] || '';
    prov(proj, 'SUMMARY.BADGE', proj.safety_badge, { derivation_type: 'SYSTEM_STATE', rule_id: result.status, input_fact_ids: ['safety'] });
    prov(proj, 'SUMMARY.ISSUE', proj.primary_issue, { card_id: sc.id, claim_id: sc.claim_id, evidence_ids: sev });
    if (proj.primary_action) prov(proj, 'SUMMARY.ACTION', proj.primary_action, { card_id: sc.id, claim_id: sc.claim_id, evidence_ids: sev });
    proj.visible_message_units = proj.display_items.length; proj.first_viewport_units = proj.display_items.length;
    return proj;
  }

  /* 分流徽章只讀 route_ui（ROUTE-PRESENTATION-01） */
  var ru = C.route_ui[route] || C.route_ui.ROUTINE;
  proj.safety_badge = ru.badge; proj.route_css = ru.css; proj.route_timing = ru.timing;
  prov(proj, 'SUMMARY.BADGE', proj.safety_badge, { derivation_type: 'ROUTE_UI', rule_id: 'route_ui.' + (route || 'ROUTINE'), input_fact_ids: ['safety.signals', 'safety.none'] });

  /* 需要立刻行動（119／現在去急診）：第一層只留安全，其他一律抑制 */
  if (ru.stop_routine) {
    var em = result.cards[0] || {};
    var evs = (em.evidence || []).map(function (e) { return e[0]; });
    proj.primary_issue = em.issue || em.title || '';
    proj.primary_action = em.summary_action || (em.actions || [])[0] || '';
    proj.primary_card_id = em.id || null;
    prov(proj, 'SUMMARY.ISSUE', proj.primary_issue, { card_id: em.id, claim_id: em.claim_id, evidence_ids: evs, input_fact_ids: ['safety.signals'] });
    prov(proj, 'SUMMARY.ACTION', proj.primary_action, { card_id: em.id, claim_id: em.claim_id, evidence_ids: evs, input_fact_ids: ['safety.signals'] });
    result.cards.slice(1, 3).forEach(function (c, i) {
      var a = c.summary_action || (c.actions || [])[0];
      if (!a) return;
      proj.also_today.push({ action: a, card_id: c.id, timing: c.timing });
      prov(proj, 'SUMMARY.ALSO.' + (i + 1), a, { card_id: c.id, claim_id: c.claim_id, evidence_ids: (c.evidence || []).map(function (e) { return e[0]; }), input_fact_ids: ['safety.signals'] });
    });
    proj.visible_message_units = proj.display_items.length; proj.first_viewport_units = Math.min(3, proj.display_items.length);
    trace.push({ step: 'ROUTE', result: 'STOP_ROUTINE', route: route });
    return proj;
  }

  var cands = buildCandidates(state, result);
  var admitted = truthGate(admit(cands, state, trace), ef);
  cands.forEach(function (c) { if (c.reject) proj.suppressed.push({ id: c.candidate_id, reason: c.reject }); });
  admitted = suppressGeneric(admitted, trace, proj.suppressed);
  var bundles = applyPatientPriority(cluster(admitted), state);
  bundles.forEach(function (b, i) { trace.push({ step: 'RANK', rank: i + 1, topic: b.topic, lead: b.lead.candidate_id, priority_class: b.lead.summary_priority_class, patient_priority: b.patient_priority }); });

  var wm = whatMattersLine(state);
  var top = bundles[0] || null;
  if (top) {
    proj.primary_issue = top.lead.patient_text;
    proj.primary_card_id = top.lead.candidate_id;
    /* 3.3（ZT-D12-003／R-D-004）：「想知道每天怎麼照顧自己」是想了解的方向，不是症狀；方向帶出的症狀卡當第一張時，
       主要問題寫病人選的方向，不寫成「水腫」等症狀（症狀只有病人真的回報時才當主要問題） */
    var nav = navigationIssue(state, top.lead.candidate_id);
    if (nav) { proj.primary_issue = nav; proj.primary_issue_basis = 'NAVIGATION_INTENT'; }
    prov(proj, 'SUMMARY.ISSUE', proj.primary_issue, { card_id: top.lead.candidate_id, claim_id: top.lead.claim_id, evidence_ids: top.lead.evidence_ids, input_fact_ids: top.lead.input_fact_ids });
    var act = top.primary_action || (bundles.filter(function (b) { return b.primary_action; })[0] || {}).primary_action;
    if (act) {
      proj.primary_action = act.patient_action; proj.primary_action_key = act.action_key; proj.primary_action_timing = act.timing;
      prov(proj, 'SUMMARY.ACTION', proj.primary_action, { card_id: act.candidate_id, claim_id: act.claim_id, evidence_ids: act.evidence_ids, input_fact_ids: act.input_fact_ids });
    }
    /* must_surface：同一條安全主線裡其他的安全行動不得被默默刪掉 */
    var seenAct = {}; seenAct[proj.primary_action_key] = true;
    top.members.filter(function (m) { return m.must_surface && m !== act && m.patient_action && !seenAct[m.action_key]; }).slice(0, 2).forEach(function (m, i) {
      seenAct[m.action_key] = true;
      proj.also_today.push({ action: m.patient_action, card_id: m.candidate_id, timing: m.timing });
      prov(proj, 'SUMMARY.ALSO.' + (i + 1), m.patient_action, { card_id: m.candidate_id, claim_id: m.claim_id, evidence_ids: m.evidence_ids, input_fact_ids: m.input_fact_ids });
    });
  }

  /* 用藥訊號：不是固定區塊，沒有 actionable signal 就整區不出現 */
  var medBundle = bundles.filter(function (b) { return b.medication_member && b !== top; })[0] || null;
  var medCand = medBundle ? medBundle.medication_member : null;
  if (medCand && medCand.medication_relevance !== 'NONE') {
    var sameAction = medCand.action_key === proj.primary_action_key;
    proj.medication_signal = { kind: medCand.medication_relevance, message: medCand.patient_text,
      action: sameAction ? '' : (medCand.med_downgraded ? '把目前真的在吃的藥袋／藥單一起帶去，請藥師核對。' : medCand.patient_action),
      action_key: medCand.med_downgraded ? 'BRING_MED_LIST' : medCand.action_key, downgraded: !!medCand.med_downgraded, truth_status: medCand.truth_status };
    prov(proj, 'SUMMARY.MED', medCand.patient_text + (proj.medication_signal.action ? '｜' + proj.medication_signal.action : ''), { card_id: medCand.candidate_id, claim_id: medCand.claim_id, evidence_ids: medCand.evidence_ids, input_fact_ids: medCand.input_fact_ids });
  }

  var qs = pickQuestions(bundles, budget, wm);
  proj.visit_questions = qs.visible; proj.visit_questions_more = qs.more;

  var gaps = resolveGaps(ef, top, bundles);
  gaps.trace.forEach(function (x) { trace.push(x); });
  proj.blocking_gap = gaps.blocking_gap;
  proj.bring_item = gaps.bring_item;
  /* 語意去重：「今天先做」或用藥訊號已經是帶藥單去核對，就不再重複一次（SUM-SEMANTIC-DEDUP-01） */
  if (proj.bring_item && (proj.primary_action_key === 'BRING_MED_LIST' || (proj.medication_signal && proj.medication_signal.action && proj.medication_signal.action_key === 'BRING_MED_LIST'))) {
    trace.push({ step: 'SEMANTIC_DEDUP', removed: 'bring_item', same_as: proj.primary_action_key === 'BRING_MED_LIST' ? 'primary_action' : 'medication_signal' });
    proj.bring_item = null;
  }
  proj.what_matters = wm;

  /* 支援性行動：不在摘要裡，放到第二層（列印完整版才出現） */
  var seenSupport = {}; seenSupport[proj.primary_action_key] = true;
  proj.supporting_actions = bundles.slice(1).map(function (b) { return b.primary_action; })
    .filter(function (a) { if (!a || !a.patient_action || seenSupport[a.action_key]) return false; seenSupport[a.action_key] = true; return true; })
    .slice(0, budget.supporting_actions)
    .map(function (a) { return { action: a.patient_action, timing: a.timing, card_id: a.candidate_id, claim_id: a.claim_id }; });

  /* 資訊預算：硬項目（徽章、最重要、今天先做、must_surface）不得被刪；軟項目依序讓位並留紀錄 */
  function units() { return 1 + (proj.primary_issue ? 1 : 0) + (proj.primary_action ? 1 : 0) + proj.also_today.length + (proj.medication_signal ? 1 : 0) + proj.visit_questions.length + (proj.blocking_gap ? 1 : 0) + (proj.bring_item ? 1 : 0); }
  var hardUnits = 1 + (proj.primary_issue ? 1 : 0) + (proj.primary_action ? 1 : 0) + proj.also_today.length;
  var softCap = Math.max(budget.total_units, hardUnits);
  proj.budget = { soft_cap: softCap, hard_units: hardUnits, must_surface: proj.also_today.length };
  while (units() > softCap) {
    if (proj.visit_questions.length > 1) { proj.visit_questions_more.unshift(proj.visit_questions.pop()); proj.budget_trace.push('visit_question→more'); continue; }
    if (proj.bring_item) { proj.budget_trace.push('bring_item→layer2'); proj.bring_item = null; continue; }
    if (proj.medication_signal) { proj.budget_trace.push('medication_signal→layer2'); proj.medication_signal = null; dropItem(proj, 'SUMMARY.MED'); continue; }
    if (proj.visit_questions.length) { proj.visit_questions_more.unshift(proj.visit_questions.pop()); proj.budget_trace.push('visit_question→more'); continue; }
    if (proj.blocking_gap) { proj.budget_trace.push('blocking_gap→layer2'); proj.blocking_gap = null; continue; }
    break;
  }
  proj.visit_questions.forEach(function (q, i) { prov(proj, 'SUMMARY.Q' + (i + 1), q.text, { card_id: q.question_id, claim_id: q.claim_id, evidence_ids: q.evidence_ids, input_fact_ids: q.input_fact_ids }); });
  if (wm) prov(proj, 'SUMMARY.WHAT_MATTERS', wm.text, { derivation_type: 'PATIENT_STATED', input_fact_ids: ['what_matters.improve', 'what_matters.worry', 'preference_source'] });
  if (proj.blocking_gap) prov(proj, 'SUMMARY.GAP', proj.blocking_gap.message, { derivation_type: 'GAP_RESOLVER', rule_id: 'GAP.' + proj.blocking_gap.gap_id, input_fact_ids: proj.blocking_gap.depends_on.map(function (x) { return 'facts.' + x; }) });
  if (proj.bring_item) prov(proj, 'SUMMARY.BRING', proj.bring_item.message, { derivation_type: 'GAP_RESOLVER', rule_id: 'GAP.' + proj.bring_item.gap_id, input_fact_ids: proj.bring_item.depends_on.map(function (x) { return 'facts.' + x; }) });

  /* 3.2（R-D-006）：病人在理解確認選「還不太確定」或確認題答錯的卡片——帶去看診的紙上要看得到「想請醫療團隊再說一次」
     （只列卡片標題，不記錄病人說的內容；不佔資訊預算：這是病人自己的請求） */
  var tb = state.teach || {}, lr = state.learning || {}, byId = {};
  (result.cards || []).concat(result.supplement_hidden || [], result.med_reference || []).forEach(function (c) { byId[c.id] = c; });
  proj.reteach = Object.keys(byId).filter(function (id) { return (tb[id] === 'NEED_HELP' || tb[id] === 'OBJECTIVE_INCORRECT' || lr[id] === 'UNDERSTANDING_NOT_YET') && lr[id] !== 'UNDERSTANDING_CHECKED'; })
    .slice(0, 4).map(function (id) { return { card_id: id, title: byId[id].title }; });
  if (proj.reteach.length) prov(proj, 'SUMMARY.RETEACH', '想請醫療團隊再說一次：' + proj.reteach.map(function (x) { return x.title; }).join('、'), { derivation_type: 'PATIENT_STATED', input_fact_ids: proj.reteach.map(function (x) { return 'teach.' + x.card_id; }) });

  /* 穩定：沒有需要優先處理的事就直說，不用一般衛教填版面，也不說過度安心的話 */
  if (!proj.primary_issue) {
    proj.stable = true;
    proj.primary_issue = '這次填的資料裡，沒有找到需要優先處理的新問題。';
    prov(proj, 'SUMMARY.ISSUE', proj.primary_issue, { derivation_type: 'SYSTEM_STATEMENT', rule_id: 'NO_ADMITTED_CANDIDATE', input_fact_ids: ['safety', 'recent_change', 'primary_concern'] });
  }
  proj.visible_message_units = units();
  proj.first_viewport_units = 1 + (proj.primary_issue ? 1 : 0) + (proj.primary_action ? 1 : 0);

  proj.hidden_counts.other_education = (result.cards || []).filter(function (c) { return GENERIC_TOPICS[c.topic]; }).length + (result.supplement_hidden || []).length;
  proj.hidden_counts.other_details = (result.med_reference || []).length;
  proj.hidden_counts.other_gaps = Math.max(0, (result.gaps || []).length - (proj.blocking_gap ? 1 : 0) - (proj.bring_item ? 1 : 0));
  return proj;
}

/* ---------- 10. 複製用純文字：只來自同一份投影（COPY-EQUALS-PROJECTION-01） ---------- */
function toText(proj, meta) {
  var L = ['【本次摘要｜帶去看診】'];
  L.push((meta && meta.when ? '填寫時間：' + meta.when + '｜' : '') + proj.respondent_text + '｜內容版本 ' + proj.content_version);
  L.push('');
  if (proj.safety_badge) L.push('目前狀態：' + proj.safety_badge);
  if (proj.primary_issue) L.push('這次最重要：' + proj.primary_issue);
  if (proj.primary_action) L.push('今天先做：' + proj.primary_action);
  proj.also_today.forEach(function (a) { L.push('今天也要：' + a.action); });
  if (proj.medication_signal) L.push('吃藥要先確認：' + proj.medication_signal.message + (proj.medication_signal.action ? '（' + proj.medication_signal.action + '）' : ''));
  if (proj.what_matters) L.push('我最在意：' + proj.what_matters.text);
  if (proj.visit_questions.length) {
    L.push('看診先問：');
    proj.visit_questions.forEach(function (q, i) { L.push('  ' + (i + 1) + '. ' + q.text); });
  }
  if (proj.blocking_gap) L.push('看診時問：' + proj.blocking_gap.message);
  if (proj.bring_item) L.push('看診時帶上：' + proj.bring_item.message);
  if ((proj.reteach || []).length) L.push('想請醫療團隊再說一次：' + proj.reteach.map(function (x) { return x.title; }).join('、'));
  return L.join('\n');
}

var API = { build: build, toText: toText, PROJECTION_VERSION: PROJECTION_VERSION, TOPIC_ORDER: TOPIC_ORDER, GENERIC_TOPICS: GENERIC_TOPICS,
  compareCandidates: compareCandidates, priorityClass: priorityClass };
root.HFPC_SUMMARY = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);

/* =====================================================================
 * 心衰竭精準照護助手｜決策引擎（純函式，不碰 DOM、不連網、不儲存）
 * 設計原則：
 *  - fail-closed：安全確認未完成 → NEED_SAFETY_ASSESSMENT；輸入不在 allow-list → VALIDATION_ERROR。
 *    例外：只要有任何合法的緊急警訊，一律先回 119（安全優先於驗證）。
 *  - 事實（facts）只有一份 SSOT；主要問題的選擇只「衍生」事實，不複製欄位。
 *  - null＝未回答（UNKNOWN），不等於「沒有」。
 *  - 主要問題卡片保留獨立名額，補充資料與組合提醒不會擠掉它。
 *  - 引擎只產生衛教、提醒與要問的問題，不產生開始／停止／調整藥物的指示。
 * ===================================================================== */
(function (root) {
'use strict';
var C = root.HFPC_CONTENT || (typeof require !== 'undefined' ? require('./cards.js') : null);
if (typeof require !== 'undefined' && (!C || !C.ingredients)) { require('./cards.js'); C = require('./meds.js'); }

function toSet(arr) { var o = {}; (Array.isArray(arr) ? arr : []).forEach(function (x) { o[x] = true; }); return o; }
function keys(pairs) { return pairs.map(function (p) { return p[0]; }); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

var SIGNALS = {}; C.safety_signals.forEach(function (s) { SIGNALS[s.id] = s; });
var GROUPS = {}; (C.safety_groups || []).forEach(function (g) { GROUPS[g.id] = g; });
/* 3.3（ZT-D12-004，P0）：「都沒有」或「今天聯絡」這類較低的路徑，只有在比它更緊急的警訊組都被看過（點開或全部展開）時才成立；
   沒看過的組裡可能藏著需要立刻處理的情況（假陰性）。更緊急的路徑（119、現在去急診）永遠不被擋。 */
var LEVEL_RANK = { EMERGENCY: 0, URGENT_NOW: 1, URGENT_IN_PERSON: 2, SAME_DAY: 3, ROUTINE: 4 };
/* 5.2 G-02／F-04：病人連結依醫療人員確認的資料不問的組（scoped_out：沒有去顫器或電擊已關閉）不算「沒看過」；
   公開版沒有這個欄位（照舊全部要看）；只能是登錄的組別（validate），而且組內每個警訊都必須被排除才算（部分排除的組仍要看） */
function unreviewedGroups(sf, route) {
  var rv = toSet(Array.isArray(sf.reviewed) ? sf.reviewed : []), picked = toSet(Array.isArray(sf.signals) ? sf.signals : []), r = LEVEL_RANK[route];
  var so = toSet(Array.isArray(sf.scoped_out) ? sf.scoped_out : []);
  return (C.safety_groups || []).filter(function (g) {
    if (rv[g.id] || so[g.id] || g.signals.some(function (x) { return picked[x]; })) return false;
    return g.signals.some(function (x) { return SIGNALS[x] && LEVEL_RANK[SIGNALS[x].level] < r; });
  }).map(function (g) { return g.id; });
}
var MEDS = {}; C.medications.forEach(function (m) { MEDS[m.id] = m; });
var ING = {}; (C.ingredients || []).forEach(function (i) { ING[i.id] = i; });
var ALLOW = {
  mode: toSet(['SELF', 'CAREGIVER']),
  safety_status: toSet(['NOT_ASSESSED', 'COMPLETED']),
  recent_change: toSet(keys(C.recent_change_options)),
  primary_concern: toSet(keys(C.primary_concerns)),
  med_focus: toSet(Object.keys(MEDS).concat(keys(C.med_focus_extra))),
  med_reconciliation: toSet(keys(C.med_reconciliation_options)),
  tri: toSet(keys(C.tri_state)),
  comorbidity: toSet(keys(C.branches.COMORBIDITY.options)),
  med_class: toSet(Object.keys(MEDS)),
  feasibility: toSet(keys(C.feasibility_options)),
  feasibility_barrier: toSet(keys(C.feasibility_barriers)),
  improve: toSet(keys(C.what_matters_improve)),
  worry: toSet(keys(C.what_matters_worry)),
  lvef: toSet(keys(C.lvef_bands)), hf_type: toSet(keys(C.hf_type_options)), bmi: toSet(keys(C.bmi_bands)), tsat: toSet(keys(C.tsat_bands)),
  ingredient: toSet(Object.keys(ING)),
  exposure_mode: toSet(keys(C.med_exposure_options)),
  med_list_complete: toSet(keys(C.med_list_complete_options)),
  lab_when: toSet(keys(C.lab_when_options)),
  rest_dyspnea: toSet(keys(C.rest_dyspnea_options)),
  hf_admissions: toSet(keys(C.hf_admission_count_options)),
  pregnancy: toSet(keys(C.pregnancy_options)),
  discharge_reason: toSet(keys(C.discharge_reason_options)),
  discharge_when: toSet(keys(C.discharge_when_options)),
  field_meta: toSet(['ASKED']),
  lvef_when: toSet(keys(C.lvef_when_options)), lvef_source: toSet(keys(C.lvef_source_options)),
  diagnosis: toSet(keys(C.diagnosis_options)), rhythm: toSet(keys(C.rhythm_options)), hr: toSet(keys(C.hr_bands)),
  symptom_status: toSet(keys(C.symptom_status_options)),
  whole_person: toSet(keys(C.whole_person_needs)),
  goals_discussion_readiness: toSet(keys(C.goals_discussion_readiness_options)), preference_source: toSet(keys(C.preference_source_options)),
  self_management_readiness: toSet(keys(C.self_management_readiness_options)),
  concern_intent: toSet(C.concern_intents.concat(C.concern_secondary).map(function (x) { return x.id; })),
  med_problem: toSet(C.med_problem_options.map(function (x) { return x.id; })),
  other_topic: toSet(C.other_topic_options.map(function (x) { return x.id; })),
  med_status: toSet(['CURRENT', 'STOPPED', 'UNSURE']),
  /* 3.2：VERIFY_ONLY（我記得，直接確認）、REREAD（我先看一次）是畫面早已寫入的值；過去沒列入，重新整理摘要時會被判為資料錯誤 */
  teach: toSet(['OWN_WORDS_DONE', 'NEED_HELP', 'OBJECTIVE_CORRECT', 'OBJECTIVE_INCORRECT', 'RETEST_CORRECT', 'VERIFY_ONLY', 'REREAD']),   /* 自述說得出來 ≠ 已確認理解；客觀確認另記 */
  side_effect: toSet(keys(C.side_effect_options)),
  caregiver_strain: toSet(keys(C.caregiver_strain_options)),
  care_dependency: toSet(keys(C.care_dependency_options)),
  mood_screen: toSet(keys(C.mood_screen_options)),
  device: toSet(keys(C.device_options)),
  nutrition_risk: toSet(keys(C.nutrition_risk_options)),
  cost_skip: toSet(keys(C.cost_skip_options)),
  second_topic: toSet((C.second_topics || []).map(function (x) { return x.id; })),
  learning: toSet(['SHOWN', 'UNDERSTANDING_CHECKED', 'UNDERSTANDING_NOT_YET', 'ACTION_PLANNED', 'FOLLOWUP_UNKNOWN'])
};
Object.keys(C.branches).forEach(function (k) { ALLOW['branch_' + C.branches[k].field] = toSet(keys(C.branches[k].options)); });

var BRANCH_FIELD_BY_CONCERN = { ADHERENCE: 'adherence_barrier', ACCESS: 'access_barrier', SYMPTOM: 'symptom_focus', COMORBIDITY: 'comorbidity_focus', SELF_CARE: 'self_care_topic', GOALS: 'goals_topic' };
var TOP_KEYS = toSet(['mode', 'safety', 'safety_ack', 'recent_change', 'concern_intent', 'primary_concern', 'branch', 'facts', 'adherence_barrier_2', 'feasibility', 'feasibility_barrier', 'what_matters', 'whole_person', 'goals_discussion_readiness', 'self_management_readiness', 'preference_source', 'teach', 'learning', 'verify_only', 'planned', 'field_meta', 'print_prefs', 'session', 'caregiver_strain', 'care_dependency', 'mood_screen', 'device', 'nutrition_risk', 'cost_skip', 'second_topic', 'team_floor']);
var BRANCH_KEYS = toSet(['med_focus', 'med_focus_ing', 'med_problem', 'other_topic', 'med_done', 'post_done', 'adherence_barrier', 'access_barrier', 'symptom_focus', 'comorbidity_focus', 'self_care_topic', 'goals_topic', 'side_effect']);
var FACT_KEYS = toSet(['known_comorbidities', 'recognized_med_classes', 'med_instances', 'recognized_ingredients', 'ingredient_exposure_mode', 'stopped_ingredients', 'med_list_complete', 'med_change_recent', 'recent_hf_discharge', 'discharge_reason', 'discharge_when', 'hf_admission_count', 'uses_otc', 'med_burden', 'med_reconciliation', 'lvef_value', 'lvef_band', 'lvef_when', 'lvef_source', 'diagnosis_status', 'rhythm', 'hr_value', 'hr_band', 'symptom_status', 'rest_dyspnea', 'hf_type_told', 'ef_improved', 'bmi_band', 'tsat_value', 'tsat_band', 'tsat_when', 'pregnancy_possible']);
/* 藥物實例（MED-INSTANCE-01）：公開版只有病人自述的「實際在用」這一層；處方層與劑量欄位保留為 null，
 * 院內版由藥師核對後填入（prescribed truth 與 actual-use truth 分層，MED-PRESCRIBED-ACTUAL-01） */
var MED_INSTANCE_KEYS = toSet(['ingredient', 'status', 'source', 'product', 'strength', 'dose', 'frequency', 'route', 'indication']);
/* 數值 → 分級（病人輸入數字，分級留在後端） */
function bandOf(field, v) {
  var spec = C.numeric_inputs[field];
  if (!spec || typeof v !== 'number' || !isFinite(v) || v < spec.min || v > spec.max) return null;
  for (var i = 0; i < spec.bands.length; i++) if (v <= spec.bands[i][0]) return spec.bands[i][1];
  return null;
}

function newState() {
  return {
    mode: null,                       /* 不預設身分：病人／照顧者的用語不同，必須明確選擇 */
    safety: { status: 'NOT_ASSESSED', signals: [], none: null, step: 0, steps_done: [], reviewed: [] },
    safety_ack: false,
    recent_change: null,
    primary_concern: null,
    concern_intent: null,
    branch: { med_focus: null, med_focus_ing: null, med_problem: null, other_topic: null, med_done: false, post_done: false, adherence_barrier: null, access_barrier: null, symptom_focus: null, comorbidity_focus: null, self_care_topic: null, goals_topic: null, side_effect: null },
    facts: { known_comorbidities: null, recognized_med_classes: null, recognized_ingredients: null,
      ingredient_exposure_mode: null, stopped_ingredients: null, med_list_complete: null, med_change_recent: null,
      recent_hf_discharge: null, discharge_reason: null, discharge_when: null, hf_admission_count: null, uses_otc: null, med_burden: null, med_reconciliation: null,
      lvef_band: null, lvef_when: null, lvef_source: null, diagnosis_status: null, rhythm: null, hr_band: null,
      symptom_status: null, rest_dyspnea: null, hf_type_told: null, ef_improved: null, bmi_band: null,
      tsat_band: null, tsat_when: null, pregnancy_possible: null,
      med_instances: null, lvef_value: null, hr_value: null, tsat_value: null },
    /* 哪些欄位「問過了」：用來分辨「還沒問」與「問過但不知道」 */
    field_meta: {},
    adherence_barrier_2: null,
    feasibility: null, feasibility_barrier: null,
    what_matters: { improve: null, worry: null },
    whole_person: null, goals_discussion_readiness: null, self_management_readiness: null, preference_source: null,
    teach: {}, learning: {}, planned: [],
    print_prefs: null,
    caregiver_strain: null, care_dependency: null, mood_screen: null, device: null,
    nutrition_risk: null, cost_skip: null, second_topic: null,
    session: null
  };
}

/* ---------- 驗證：回傳錯誤清單（空＝通過） ---------- */
function validate(s) {
  var e = [];
  function enumOk(val, set, name) { if (val !== null && val !== undefined && !set[val]) e.push(name + ':' + String(val)); }
  function listOk(arr, set, name) { if (arr === null || arr === undefined) return; if (!Array.isArray(arr)) { e.push(name + ':NOT_ARRAY'); return; } arr.forEach(function (x) { if (!set[x]) e.push(name + ':' + String(x)); }); }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['STATE:NOT_OBJECT'];
  Object.keys(s).forEach(function (k) { if (!TOP_KEYS[k]) e.push('UNKNOWN_FIELD:' + k); });
  enumOk(s.mode, ALLOW.mode, 'mode');
  var sf = s.safety;
  if (sf !== undefined && sf !== null) {
    if (typeof sf !== 'object') e.push('safety:NOT_OBJECT');
    else {
      enumOk(sf.status, ALLOW.safety_status, 'safety.status');
      if (sf.signals !== undefined && !Array.isArray(sf.signals)) e.push('safety.signals:NOT_ARRAY');
      (Array.isArray(sf.signals) ? sf.signals : []).forEach(function (x) { if (!SIGNALS[x]) e.push('safety.signal:' + String(x)); });
      if (sf.none !== undefined && sf.none !== null && typeof sf.none !== 'boolean') e.push('safety.none:NOT_BOOLEAN');
      if (sf.step !== undefined && sf.step !== null && (typeof sf.step !== 'number' || sf.step < 0 || sf.step > C.safety_steps.length)) e.push('safety.step:' + String(sf.step));
      /* 組合追問答「不確定」時被保守算進去的警訊：只能是登錄的警訊 */
      if (sf.combo_unsure !== undefined && sf.combo_unsure !== null) {
        if (!Array.isArray(sf.combo_unsure)) e.push('safety.combo_unsure:NOT_ARRAY');
        else sf.combo_unsure.forEach(function (x) { if (!SIGNALS[x]) e.push('safety.combo_unsure:' + String(x)); });
      }
      /* 3.3（ZT-D12-004）：看過（點開過）的警訊組；只能是登錄的組別 */
      if (sf.reviewed !== undefined && sf.reviewed !== null) {
        if (!Array.isArray(sf.reviewed)) e.push('safety.reviewed:NOT_ARRAY');
        else sf.reviewed.forEach(function (x) { if (!GROUPS[x]) e.push('safety.reviewed:' + String(x)); });
      }
      if (sf.scoped_out !== undefined && sf.scoped_out !== null) {
        if (!Array.isArray(sf.scoped_out)) e.push('safety.scoped_out:NOT_ARRAY');
        else sf.scoped_out.forEach(function (x) { if (!GROUPS[x]) e.push('safety.scoped_out:' + String(x)); });
      }
      if (sf.steps_done !== undefined && sf.steps_done !== null) {
        if (!Array.isArray(sf.steps_done)) e.push('safety.steps_done:NOT_ARRAY');
        else sf.steps_done.forEach(function (x) { if (!C.safety_steps.some(function (st) { return st.id === x; })) e.push('safety.step_id:' + String(x)); });
      }
    }
  }
  enumOk(s.recent_change, ALLOW.recent_change, 'recent_change');
  enumOk(s.primary_concern, ALLOW.primary_concern, 'primary_concern');
  var b = s.branch || {};
  Object.keys(b).forEach(function (k) { if (!BRANCH_KEYS[k]) e.push('UNKNOWN_FIELD:branch.' + k); });
  enumOk(b.med_focus, ALLOW.med_focus, 'branch.med_focus');
  Object.keys(BRANCH_FIELD_BY_CONCERN).forEach(function (c) { var f = BRANCH_FIELD_BY_CONCERN[c]; enumOk(b[f], ALLOW['branch_' + f], 'branch.' + f); });
  var f = s.facts || {};
  Object.keys(f).forEach(function (k) { if (!FACT_KEYS[k]) e.push('UNKNOWN_FIELD:facts.' + k); });
  listOk(f.known_comorbidities, ALLOW.comorbidity, 'facts.known_comorbidities');
  listOk(f.recognized_med_classes, ALLOW.med_class, 'facts.recognized_med_classes');
  enumOk(f.recent_hf_discharge, ALLOW.tri, 'facts.recent_hf_discharge');
  enumOk(f.uses_otc, ALLOW.tri, 'facts.uses_otc');
  enumOk(f.med_burden, ALLOW.tri, 'facts.med_burden');
  enumOk(f.med_reconciliation, ALLOW.med_reconciliation, 'facts.med_reconciliation');
  enumOk(f.lvef_band, ALLOW.lvef, 'facts.lvef_band'); enumOk(f.hf_type_told, ALLOW.hf_type, 'facts.hf_type_told');
  enumOk(f.ef_improved, ALLOW.tri, 'facts.ef_improved'); enumOk(f.bmi_band, ALLOW.bmi, 'facts.bmi_band');
  enumOk(f.tsat_band, ALLOW.tsat, 'facts.tsat_band'); enumOk(f.pregnancy_possible, ALLOW.pregnancy, 'facts.pregnancy_possible');
  listOk(f.recognized_ingredients, ALLOW.ingredient, 'facts.recognized_ingredients');
  listOk(f.stopped_ingredients, ALLOW.ingredient, 'facts.stopped_ingredients');
  enumOk(f.ingredient_exposure_mode, ALLOW.exposure_mode, 'facts.ingredient_exposure_mode');
  enumOk(f.med_list_complete, ALLOW.med_list_complete, 'facts.med_list_complete');
  enumOk(f.tsat_when, ALLOW.lab_when, 'facts.tsat_when');
  enumOk(f.rest_dyspnea, ALLOW.rest_dyspnea, 'facts.rest_dyspnea');
  enumOk(f.hf_admission_count, ALLOW.hf_admissions, 'facts.hf_admission_count');
  enumOk(f.discharge_reason, ALLOW.discharge_reason, 'facts.discharge_reason');
  enumOk(f.discharge_when, ALLOW.discharge_when, 'facts.discharge_when');
  enumOk(f.med_change_recent, ALLOW.tri, 'facts.med_change_recent');
  enumOk(f.lvef_when, ALLOW.lvef_when, 'facts.lvef_when'); enumOk(f.lvef_source, ALLOW.lvef_source, 'facts.lvef_source');
  enumOk(f.diagnosis_status, ALLOW.diagnosis, 'facts.diagnosis_status');
  enumOk(f.rhythm, ALLOW.rhythm, 'facts.rhythm'); enumOk(f.hr_band, ALLOW.hr, 'facts.hr_band');
  enumOk(f.symptom_status, ALLOW.symptom_status, 'facts.symptom_status');
  listOk(s.whole_person, ALLOW.whole_person, 'whole_person');
  enumOk(s.goals_discussion_readiness, ALLOW.goals_discussion_readiness, 'goals_discussion_readiness');
  enumOk(s.self_management_readiness, ALLOW.self_management_readiness, 'self_management_readiness');
  enumOk(s.concern_intent, ALLOW.concern_intent, 'concern_intent');
  enumOk(b.med_problem, ALLOW.med_problem, 'branch.med_problem');
  enumOk(b.other_topic, ALLOW.other_topic, 'branch.other_topic');
  if (b.med_focus_ing !== null && b.med_focus_ing !== undefined && !ING[b.med_focus_ing]) e.push('branch.med_focus_ing:' + String(b.med_focus_ing));
  enumOk(b.side_effect, ALLOW.side_effect, 'branch.side_effect');
  ['caregiver_strain', 'care_dependency', 'mood_screen', 'device', 'nutrition_risk', 'cost_skip', 'second_topic'].forEach(function (k) { enumOk(s[k], ALLOW[k], k); });
  ['lvef_value', 'hr_value', 'tsat_value'].forEach(function (k) {
    var v = f[k];
    if (v === null || v === undefined) return;
    if (bandOf(k, v) === null) e.push('facts.' + k + ':' + String(v));
  });
  if (f.med_instances !== null && f.med_instances !== undefined) {
    if (!Array.isArray(f.med_instances)) e.push('facts.med_instances:NOT_ARRAY');
    else f.med_instances.forEach(function (mi, i) {
      if (!mi || typeof mi !== 'object' || Array.isArray(mi)) { e.push('facts.med_instances[' + i + ']:NOT_OBJECT'); return; }
      Object.keys(mi).forEach(function (k) { if (!MED_INSTANCE_KEYS[k]) e.push('facts.med_instances[' + i + '].UNKNOWN_FIELD:' + k); });
      if (!ING[mi.ingredient]) e.push('facts.med_instances[' + i + '].ingredient:' + String(mi.ingredient));
      if (!ALLOW.med_status[mi.status]) e.push('facts.med_instances[' + i + '].status:' + String(mi.status));
      if (mi.source !== undefined && mi.source !== null && mi.source !== 'PATIENT_REPORTED') e.push('facts.med_instances[' + i + '].source:' + String(mi.source));
      ['product', 'strength', 'dose', 'frequency', 'route', 'indication'].forEach(function (k) { if (mi[k] !== undefined && mi[k] !== null) e.push('facts.med_instances[' + i + '].' + k + ':PUBLIC_BUILD_NO_FREE_TEXT'); });
    });
  }
  enumOk(s.preference_source, ALLOW.preference_source, 'preference_source');
  var fm = s.field_meta || {};
  if (typeof fm !== 'object' || Array.isArray(fm)) e.push('field_meta:NOT_OBJECT');
  else Object.keys(fm).forEach(function (k) { enumOk(fm[k], ALLOW.field_meta, 'field_meta.' + k); });
  var tb = s.teach || {};
  if (typeof tb !== 'object' || Array.isArray(tb)) e.push('teach:NOT_OBJECT');
  else Object.keys(tb).forEach(function (k) { enumOk(tb[k], ALLOW.teach, 'teach.' + k); });
  enumOk(s.adherence_barrier_2, ALLOW.branch_adherence_barrier, 'adherence_barrier_2');
  enumOk(s.feasibility, ALLOW.feasibility, 'feasibility');
  enumOk(s.feasibility_barrier, ALLOW.feasibility_barrier, 'feasibility_barrier');
  var w = s.what_matters || {};
  enumOk(w.improve, ALLOW.improve, 'what_matters.improve');
  enumOk(w.worry, ALLOW.worry, 'what_matters.worry');
  var l = s.learning || {};
  Object.keys(l).forEach(function (k) { enumOk(l[k], ALLOW.learning, 'learning.' + k); });
  /* 3.3：醫療團隊個別標準（例如體重門檻）達標 → 至少 SAME_DAY；只接受結構化數值，由連結層依團隊設定計算（ZT-D12-002） */
  var tf = s.team_floor;
  if (tf !== undefined && tf !== null && !validTeamFloor(tf)) e.push('team_floor:BAD');
  var vo = s.verify_only;
  if (vo !== undefined && (typeof vo !== 'object' || vo === null || Array.isArray(vo) || Object.keys(vo).some(function (k) { return vo[k] !== true; }))) e.push('verify_only:BAD');
  if (s.planned !== undefined && !Array.isArray(s.planned)) e.push('planned:NOT_ARRAY');
  return e;
}

/* ---------- 欄位狀態：分辨「還沒問」與「問過但不知道」 ---------- */
function fieldState(s, field) {
  var f = (s && s.facts) || {}, v = f[field];
  var asked = !!((s && s.field_meta) || {})[field];
  if (v === 'NA') return 'NA';
  if (v === 'DECLINED') return 'DECLINED';
  if (v === null || v === undefined) return asked ? 'UNKNOWN' : 'UNASKED';
  if (v === 'UNKNOWN' || v === 'UNSURE') return 'UNKNOWN';
  if (Array.isArray(v)) return v.length ? 'KNOWN' : (asked ? 'UNKNOWN' : 'UNASKED');
  return 'KNOWN';
}
/* 只有 KNOWN 的值可以驅動個別化適用性判斷 */
function knownValue(s, field) { return fieldState(s, field) === 'KNOWN' ? s.facts[field] : null; }

/* ---------- 安全分流 ---------- */
function validTeamFloor(tf) {
  function num(x) { return typeof x === 'number' && isFinite(x); }
  return !!tf && typeof tf === 'object' && !Array.isArray(tf) && tf.code === 'TEAM_WEIGHT_THRESHOLD' && num(tf.gain) && num(tf.th) && tf.th > 0 && tf.gain >= tf.th &&
    num(tf.days) && tf.days >= 1 && tf.days <= 30 && Math.floor(tf.days) === tf.days && Object.keys(tf).every(function (k) { return ['code', 'gain', 'th', 'days'].indexOf(k) >= 0; });
}
function safetyRoute(s) {
  var sf = (s && s.safety) || {};
  var sig = Array.isArray(sf.signals) ? sf.signals.filter(function (x) { return !!SIGNALS[x]; }) : [];
  var levels = toSet(sig.map(function (x) { return SIGNALS[x].level; }));
  var sset = toSet(sig);
  var combo = (C.emergency_combos || []).some(function (c) { return c.every(function (x) { return sset[x]; }); });
  if (levels.EMERGENCY || combo) return { status: 'OK', route: 'EMERGENCY', signals: sig };        // 安全優先：任何狀態下皆成立
  var errs = validate(s);
  if (errs.length) return { status: 'VALIDATION_ERROR', route: null, signals: sig, errors: errs };
  if (sf.status !== 'COMPLETED') return { status: 'NEED_SAFETY_ASSESSMENT', route: null, signals: sig };
  if (levels.URGENT_NOW) return { status: 'OK', route: 'URGENT_NOW', signals: sig };
  if (levels.URGENT_IN_PERSON) return { status: 'OK', route: 'URGENT_IN_PERSON', signals: sig };
  var want = levels.SAME_DAY ? 'SAME_DAY' : (sf.none === true ? 'ROUTINE' : null);
  if (want) { var un = unreviewedGroups(sf, want); if (un.length) return { status: 'NEED_SAFETY_ASSESSMENT', route: null, signals: sig, unreviewed_groups: un }; }
  /* 醫療團隊標準達標：路徑下限 SAME_DAY（與伺服器 WEIGHT_GAIN_TEAM_THRESHOLD 一致）；不會降低任何更急的路徑 */
  var floor = s.team_floor && validTeamFloor(s.team_floor) ? s.team_floor.code : null;
  if (levels.SAME_DAY) return { status: 'OK', route: 'SAME_DAY', signals: sig, floor: floor };
  if (sf.none === true) return floor ? { status: 'OK', route: 'SAME_DAY', signals: [], floor: floor } : { status: 'OK', route: 'ROUTINE', signals: [] };
  return { status: 'NEED_SAFETY_ASSESSMENT', route: null, signals: [] };                  // 沒勾任何項目也沒明確選「都沒有」
}

/* 安全確認必須重做：看到一半不舒服時，舊答案一律作廢（HF-B04-P0-01 / B11-INTERRUPT-01） */
function resetSafety(s) {
  var so = s.safety && Array.isArray(s.safety.scoped_out) ? s.safety.scoped_out.slice() : null;   /* 5.2：重新開始安全確認時，依醫療紀錄不問的組維持不變 */
  s.safety = { status: 'NOT_ASSESSED', signals: [], none: null, step: 0, steps_done: [], reviewed: [] };
  if (so) s.safety.scoped_out = so;
  s.safety_ack = false;
  return s;
}

/* ---------- 分流呈現：畫面唯一的讀取點（ROUTE-PRESENTATION-01） ---------- */
function routeView(route, mode) {
  var u = C.route_ui[route] || null;
  if (!u) return null;
  var cgm = mode === 'CAREGIVER';
  return { route: route, severity: u.severity, timing: u.timing, css: u.css, immediate: !!u.immediate, stop_routine: !!u.stop_routine,
    headline: (cgm && u.headline_caregiver) || u.headline, lead: (cgm && u.lead_caregiver) || u.lead || '',
    badge: u.badge, step_badge: u.step_badge || '',
    needs_ack: u.severity > 0 && !u.stop_routine };
}
/* ---------- 流程下一步 ---------- */
function branchNeeded(s) {
  var p = s.primary_concern, b = s.branch || {};
  if (p === 'MEDICATION') return !b.med_done;
  if (p === 'POST_DISCHARGE') return !b.post_done;
  var f = BRANCH_FIELD_BY_CONCERN[p];
  return f ? !b[f] : false;
}
function nextStep(s) {
  var r = safetyRoute(s);
  if (r.status === 'VALIDATION_ERROR') return 'RESULT';
  if (r.status === 'NEED_SAFETY_ASSESSMENT') return 'SAFETY';
  var rv = routeView(r.route);
  if (rv && rv.stop_routine) return 'RESULT';
  if (rv && rv.needs_ack && !s.safety_ack) return 'SAFETY_RESULT';
  if (!s.recent_change) return 'CHANGE';
  if (!s.primary_concern) return 'CONCERN';
  if (branchNeeded(s)) return 'BRANCH';
  return 'RESULT';
}

/* ---------- 藥物實例（公開版：病人自述的實際使用層） ----------
 * 新資料一律寫 facts.med_instances；舊欄位（recognized_ingredients＋exposure_mode＋stopped）只做相容轉換。 */
function medInstances(f) {
  var out = [], seenIng = {};
  if (Array.isArray(f.med_instances)) {
    f.med_instances.forEach(function (mi, i) {
      if (!mi || !ING[mi.ingredient]) return;
      out.push({ med_instance_id: 'MI-' + (i + 1) + '-' + mi.ingredient, ingredient: mi.ingredient, cls: ING[mi.ingredient].cls,
        status: ALLOW.med_status[mi.status] ? mi.status : 'UNSURE', source: 'PATIENT_REPORTED', truth_layer: 'ACTUAL_USE',
        product: null, strength: null, dose: null, frequency: null, route: null, indication: null,
        duplicate_of: seenIng[mi.ingredient] || null });
      if (!seenIng[mi.ingredient]) seenIng[mi.ingredient] = out[out.length - 1].med_instance_id;
    });
    return out;
  }
  var seen = (f.recognized_ingredients || []).filter(function (x) { return !!ING[x]; });
  var stopped = toSet(f.stopped_ingredients || []);
  var mode = f.ingredient_exposure_mode;
  seen.forEach(function (x, i) {
    var st = stopped[x] ? 'STOPPED' : ((mode === 'ALL_CURRENT' || mode === 'SOME_STOPPED') ? 'CURRENT' : 'UNSURE');
    out.push({ med_instance_id: 'MI-' + (i + 1) + '-' + x, ingredient: x, cls: ING[x].cls, status: st, source: 'PATIENT_REPORTED', truth_layer: 'ACTUAL_USE',
      product: null, strength: null, dose: null, frequency: null, route: null, indication: null, duplicate_of: null });
  });
  return out;
}
/* 用藥關係圖（MED-GRAPH-DUP-01 / MED-TEMPORAL-01）：只用「目前在用」的實例；已停用的不進圖 */
function medGraph(instances) {
  var active = instances.filter(function (mi) { return mi.status === 'CURRENT'; });
  var edges = [];
  for (var i = 0; i < active.length; i++) for (var j = i + 1; j < active.length; j++) {
    var a = active[i], b = active[j];
    if (a.ingredient === b.ingredient) { edges.push({ type: 'SAME_INGREDIENT', a: a.med_instance_id, b: b.med_instance_id, ingredient: a.ingredient }); continue; }
    var ta = ING[a.ingredient].tags || [], tb = ING[b.ingredient].tags || [];
    ta.forEach(function (t) { if (tb.indexOf(t) >= 0) edges.push({ type: 'SHARED_TAG', a: a.med_instance_id, b: b.med_instance_id, tag: t }); });
  }
  return { nodes: active.map(function (mi) { return mi.med_instance_id; }), edges: edges,
    excluded_stopped: instances.filter(function (mi) { return mi.status === 'STOPPED'; }).map(function (mi) { return mi.med_instance_id; }),
    excluded_unsure: instances.filter(function (mi) { return mi.status === 'UNSURE'; }).map(function (mi) { return mi.med_instance_id; }) };
}

/* ---------- 有效事實（SSOT＋衍生） ---------- */
function effectiveFacts(s) {
  var f = s.facts || {}, b = s.branch || {};
  /* 共病分層：病人「想了解」不等於「已經有」（HF-B05-P0-01） */
  var comorbReported = toSet(f.known_comorbidities || []);
  var comorbInterest = {};
  if (s.primary_concern === 'COMORBIDITY' && b.comorbidity_focus) comorbInterest[b.comorbidity_focus] = true;
  /* comorb＝可用於衛教觸發的聯集；臨床規則一律只能用 comorbReported */
  var comorb = {};
  Object.keys(comorbReported).forEach(function (k) { comorb[k] = true; });
  Object.keys(comorbInterest).forEach(function (k) { comorb[k] = true; });
  var cls = toSet(f.recognized_med_classes || []);
  /* HFPC-AUD-0015：「想了解這類藥」不等於「正在用」；只放進 classInterest，不進 condHolds 用的 classes */
  var classInterest = {};
  if (s.primary_concern === 'MEDICATION' && b.med_focus && MEDS[b.med_focus]) classInterest[b.med_focus] = true;
  /* 藥物實例層：「在藥袋上看到」不等於「現在還在吃」；每一顆都有自己的狀態（HF-B02-P0-01 / MED-INSTANCE-01） */
  var instances = medInstances(f);
  var exposure = {}; instances.forEach(function (mi) { exposure[mi.ingredient] = mi.status; });
  var ings = instances.filter(function (mi) { return mi.status === 'CURRENT'; }).map(function (mi) { return mi.ingredient; });   // 目前在用
  var ingsUnsure = instances.filter(function (mi) { return mi.status === 'UNSURE'; }).map(function (mi) { return mi.ingredient; });
  var ingsStopped = instances.filter(function (mi) { return mi.status === 'STOPPED'; }).map(function (mi) { return mi.ingredient; });
  var tags = {};
  var clsDeclared = clone(cls);
  ings.forEach(function (x) { var it = ING[x]; if (MEDS[it.cls]) cls[it.cls] = true; (it.tags || []).forEach(function (t) { tags[t] = true; }); });
  /* 只勾了類別、但沒有指出任何「目前在用」的成分：類別層級未解析（HFPC-AUD-0016/0017/0018 保守觸發用） */
  var clsUnresolved = {};
  Object.keys(clsDeclared).forEach(function (k) { if (!instances.some(function (mi) { return ING[mi.ingredient] && ING[mi.ingredient].cls === k && mi.status === 'CURRENT'; })) clsUnresolved[k] = true; });
  /* 清單完整度：只要還有找不到、沒列出或還不確定的藥，就不算完整（HF-B02-P0-02） */
  var listComplete = (f.med_list_complete === 'YES' && instances.length && !ingsUnsure.length) ? 'COMPLETE'
    : (f.med_list_complete ? 'INCOMPLETE' : 'UNKNOWN_COMPLETENESS');
  var mode = !instances.length ? null : (ingsUnsure.length ? 'UNSURE' : (ingsStopped.length ? 'SOME_STOPPED' : 'ALL_CURRENT'));
  /* 「最近住院」不等於「因為心臟衰竭住院」（HF-B03-P0-01） */
  var discharge = f.recent_hf_discharge;
  if (s.primary_concern === 'POST_DISCHARGE') discharge = 'YES';
  var hfDischarge = (discharge === 'YES' && f.discharge_reason === 'HF') ? 'YES'
    : (discharge === 'YES' ? 'UNCONFIRMED' : (discharge === 'NO' ? 'NO' : 'UNKNOWN'));
  var dischargeWhen = f.discharge_when || null;
  var dischargeRecent = dischargeWhen === 'WITHIN_7D' || dischargeWhen === 'WITHIN_30D';
  var otc = f.uses_otc;
  if (cls.OTC_SUPPLEMENT) otc = 'YES';
  /* LVEF 拆成三個值（P0-LVEF-01）：
   *  lvefReported  病人記得的值（永遠可以顯示、寫進摘要請醫師確認）
   *  lvefWhen      檢查的大概時段
   *  lvefUsability 能不能驅動「目前適用」的窄範圍判斷：只有 CURRENT_USABLE 可以
   * 日期不知道、日期沒回答、來源不確定、超過期限 → 一律不驅動（fail-closed）；規則見 content.js freshness_policy.lvef */
  var lvefValue = typeof f.lvef_value === 'number' ? f.lvef_value : null;
  var lvefRaw = (lvefValue !== null ? bandOf('lvef_value', lvefValue) : null) || (f.lvef_band && f.lvef_band !== 'UNKNOWN' ? f.lvef_band : null);
  var LP = C.freshness_policy.lvef;
  var lvefWhenOk = LP.usable_when.indexOf(f.lvef_when) >= 0;
  var lvefSourceOk = !LP.source_required || LP.source_required.indexOf(f.lvef_source) >= 0;
  var lvefStale = !!lvefRaw && f.lvef_when === 'OVER_12M';
  var lvefDateUnknown = !!lvefRaw && !lvefWhenOk && !lvefStale;
  var lvefSourceUnknown = !!lvefRaw && lvefWhenOk && !lvefSourceOk;
  var lvefUsability = !lvefRaw ? 'NO_VALUE' : (lvefStale ? 'STALE' : (lvefDateUnknown ? 'DATE_UNKNOWN' : (lvefSourceUnknown ? 'SOURCE_UNKNOWN' : 'CURRENT_USABLE')));
  var lvef = lvefUsability === 'CURRENT_USABLE' ? lvefRaw : null;
  var hfType = f.hf_type_told && f.hf_type_told !== 'UNKNOWN' ? f.hf_type_told : null;
  var lvefConflict = !!lvefRaw && hfType === 'PRESERVED' && C.lvef_reduced_bands.indexOf(lvefRaw) >= 0;
  var dx = f.diagnosis_status || null;
  /* 心衰竭身分拆成四件事，不用單一 LVEF 代表全部（B07-P0-02） */
  var currentPhenotype = lvef ? (C.lvef_reduced_bands.indexOf(lvef) >= 0 ? 'REDUCED_LT50' : 'GE50') : 'UNKNOWN';
  var priorReducedEf = (hfType === 'REDUCED' || f.ef_improved === 'YES') ? 'YES' : (hfType === 'PRESERVED' ? 'NO' : 'UNKNOWN');
  var efTrajectory = (currentPhenotype === 'GE50' && priorReducedEf === 'YES') ? 'IMPROVED'
    : (f.ef_improved === 'YES' ? 'IMPROVED' : (currentPhenotype === 'UNKNOWN' ? 'UNKNOWN' : 'NOT_STATED'));
  /* treatment_profile：只決定「核對哪一組核心治療」，不等於病人的完整心衰竭身分
   * 2026 ESC：HFrEF＝LVEF<50%；LVEF≥50% 不自動等於 HFpEF（需醫師以客觀證據確認） */
  var profile = 'UNKNOWN';
  if (lvef) profile = C.lvef_reduced_bands.indexOf(lvef) >= 0 ? 'REDUCED'
    : ((hfType === 'REDUCED' || f.ef_improved === 'YES') ? 'IMPROVED' : (hfType === 'PRESERVED' ? 'PRESERVED_CONFIRMED' : 'EF_GE50_UNCONFIRMED'));
  else if (hfType === 'REDUCED') profile = 'REDUCED';
  else if (hfType === 'PRESERVED') profile = 'PRESERVED_CONFIRMED';
  /* 懷孕：四態；只有明確「沒有這個可能」或「不適用」可通過懷孕敏感的適用性（B07-P0-01） */
  var pregRaw = f.pregnancy_possible;
  var pregnancyGate = (pregRaw === 'NO' || pregRaw === 'NA') ? 'CLEARED'
    : (pregRaw === 'YES' || pregRaw === 'UNSURE' || pregRaw === 'PLANNING') ? 'POSSIBLE' : 'UNASSESSED';   /* 計畫懷孕：semaglutide 須孕前 ≥2 個月停用（Wegovy 仿單 §8.3），不能當作已排除 */
  /* 進階心衰竭必須有明確訊號，不由「有症狀＋住過院」推論（HF-B05-P0-02） */
  var advancedHF = (f.hf_admission_count === 'TWO_PLUS') || (f.rest_dyspnea === 'REST_SYMPTOMS');
  /* 檢驗時效：沒有時間或超過期限，不驅動目前的適用性（HF-B06-P0-03；freshness_policy.tsat） */
  var tsatFresh = C.freshness_policy.tsat.usable_when.indexOf(f.tsat_when) >= 0;
  var tsatValue = typeof f.tsat_value === 'number' ? f.tsat_value : null;
  var tsatBand = (tsatValue !== null ? bandOf('tsat_value', tsatValue) : null) || (f.tsat_band && f.tsat_band !== 'UNKNOWN' ? f.tsat_band : null);
  var hrValue = typeof f.hr_value === 'number' ? f.hr_value : null;
  var hrBand = (hrValue !== null ? bandOf('hr_value', hrValue) : null) || (f.hr_band && f.hr_band !== 'UNKNOWN' ? f.hr_band : null);
  return { comorb: comorb, comorbReported: comorbReported, comorbInterest: comorbInterest,
    hfDischarge: hfDischarge, dischargeWhen: dischargeWhen, dischargeRecent: dischargeRecent,
    classes: cls, classInterest: classInterest, classUnresolved: clsUnresolved, ingredients: ings, ingredientsUnsure: ingsUnsure, ingredientsStopped: ingsStopped,
    instances: instances, exposure: exposure, exposureMode: mode, listComplete: listComplete,
    tags: tags, symptomFocus: (b.symptom_focus || null), discharge: discharge, otc: otc, burden: f.med_burden, recon: f.med_reconciliation,
    lvef: lvef, lvefRaw: lvefRaw, lvefReported: lvefRaw, lvefValue: lvefValue, lvefUsability: lvefUsability,
    lvefStale: lvefStale, lvefDateUnknown: lvefDateUnknown, lvefSourceUnknown: lvefSourceUnknown, lvefConflict: lvefConflict,
    currentPhenotype: currentPhenotype, priorReducedEf: priorReducedEf, efTrajectory: efTrajectory,
    pregnancyGate: pregnancyGate, advancedHF: advancedHF, tsatFresh: tsatFresh,
    restDyspnea: f.rest_dyspnea || null, hfAdmissions: f.hf_admission_count || null, lvefWhen: f.lvef_when || null, dx: dx,
    hfType: hfType, profile: profile, bmi: f.bmi_band === 'UNKNOWN' ? null : (f.bmi_band || null), tsat: tsatFresh ? tsatBand : null, tsatRaw: tsatBand, tsatValue: tsatValue,
    rhythm: f.rhythm === 'UNKNOWN' ? null : (f.rhythm || null), hr: hrBand, hrValue: hrValue,
    symptomStatus: f.symptom_status === 'UNKNOWN' ? null : (f.symptom_status || null),
    medListComplete: f.med_list_complete || null, medChange: f.med_change_recent || null,
    efImproved: f.ef_improved, pregnancy: f.pregnancy_possible };
}
function condHolds(c, ef, sig) {
  function anyIn(list, set) { return list.some(function (x) { return !!set[x]; }); }
  if (c.classes_any && !anyIn(c.classes_any, ef.classes)) return false;
  if (c.classes_any2 && !anyIn(c.classes_any2, ef.classes)) return false;
  if (c.classes_all && !c.classes_all.every(function (x) { return !!ef.classes[x]; })) return false;
  if (c.class_unresolved_any && !anyIn(c.class_unresolved_any, ef.classUnresolved || {})) return false;
  if (c.comorb_any && !anyIn(c.comorb_any, ef.comorbReported)) return false;     // 臨床規則只採自述「有」，不採「想了解」
  if (c.comorb_any2 && !anyIn(c.comorb_any2, ef.comorbReported)) return false;
  if (c.comorb_any_incl_interest && !anyIn(c.comorb_any_incl_interest, ef.comorb)) return false;
  if (c.symptom_focus_in && c.symptom_focus_in.indexOf(ef.symptomFocus) < 0) return false;
  if (c.symptom_status_in && c.symptom_status_in.indexOf(ef.symptomStatus) < 0) return false;
  if (c.otc && ef.otc !== c.otc) return false;
  if (c.burden && ef.burden !== c.burden) return false;
  if (c.discharge && ef.discharge !== c.discharge) return false;
  if (c.hf_discharge && ef.hfDischarge !== c.hf_discharge) return false;
  if (c.discharge_recent && !ef.dischargeRecent) return false;
  if (c.recon_in && c.recon_in.indexOf(ef.recon) < 0) return false;
  if (c.signals_any && !anyIn(c.signals_any, toSet(sig))) return false;
  if (c.tags_any && !anyIn(c.tags_any, ef.tags || {})) return false;
  if (c.tags_all && !c.tags_all.every(function (x) { return !!(ef.tags || {})[x]; })) return false;
  if (c.med_change && ef.medChange !== c.med_change) return false;
  if (c.lvef_in && c.lvef_in.indexOf(ef.lvef) < 0) return false;
  if (c.profile_in && c.profile_in.indexOf(ef.profile) < 0) return false;
  if (c.bmi && ef.bmi !== c.bmi) return false;
  if (c.tsat && ef.tsat !== c.tsat) return false;
  if (c.ef_improved && ef.efImproved !== c.ef_improved) return false;
  if (c.pregnancy && ef.pregnancy !== c.pregnancy) return false;
  if (c.pregnancy_not && c.pregnancy_not.indexOf(ef.pregnancy) >= 0) return false;
  if (c.pregnancy_gate && ef.pregnancyGate !== c.pregnancy_gate) return false;
  if (c.advanced_hf && !ef.advancedHF) return false;
  if (c.exposure_unsure && !ef.ingredientsUnsure.length) return false;
  return true;
}

/* ---------- 卡片實例 ---------- */
function cardFrom(id, origin, reason) {
  var src = C.cards[id]; if (!src) return null;
  var c = clone(src); c.id = id; c.origin = origin; c.reason = reason || ''; return c;
}
function medCard(id, origin, reason, ef) {
  var m = MEDS[id]; if (!m) return null;
  /* 異質類別的提醒：等病人真的選到這一類的某個成分才說（不先丟分類學給病人） */
  var chosen = ((ef && ef.instances) || []).filter(function (mi) { return mi.cls === id && mi.status !== 'STOPPED'; }).map(function (mi) { return ingName(mi.ingredient); });
  return { id: 'MED_' + id, claim_id: 'CLM-MED-' + id, group: origin === 'PRIMARY' ? 'now' : 'discuss', rank: 4, origin: origin, reason: reason || '',
    topic: 'MED_UNDERSTANDING', issue: '想了解' + (m.short || m.label) + '的用途與注意事項', action_key: 'MED_CLASS_REVIEW_' + id,
    title: m.label + '：用途與注意事項', text: m.why, med: clone(m), timing: 'NEXT_VISIT',
    hetero_note: (m.heterogeneous && chosen.length) ? '您選的是 ' + chosen.join('、') + '。這一類裡每種藥差別很大，下面只講這一類共通的部分；' + chosen[0] + ' 自己的注意事項，請藥師針對這一顆說明。' : '', actions: ['確認這類藥在您身上的用途與要追蹤的項目'],
    who: ['PHARMACIST', 'DOCTOR'], when: '下次看診或領藥', escalate: m.urgent === '—' ? '' : m.urgent, do_not: m.do_not,
    ask: '我正在用的' + m.label + '是用來治療什麼？需要追蹤什麼？', evidence: clone(m.evidence),
    check: { q: '使用這類藥後覺得頭暈或不舒服，最好的做法是？', options: [
      ['記下時間與症狀，儘早告訴醫師或藥師', true, '正確。原因與處理方式由醫療團隊判斷。'],
      ['自己先停藥看看', false, '自行停藥可能讓病情變差。請先告訴醫療團隊。'],
      ['自己把劑量減半', false, '請不要自行調整劑量，先告訴醫療團隊。']] } };
}
function label(pairs, key) { for (var i = 0; i < pairs.length; i++) if (pairs[i][0] === key) return pairs[i][1]; return key; }
var ORIGIN_ORDER = { SAFETY: 0, CHANGE: 1, PRIMARY: 2, SECOND: 2.1, COMBO: 2.2, MAP: 2.5, FEAS: 3, RULE: 4, FACT: 5, MODE: 6 };
var GROUP_ORDER = { now: 0, discuss: 1, learn: 2 };
function sortCards(a, b) {
  return (GROUP_ORDER[a.group] - GROUP_ORDER[b.group]) || (ORIGIN_ORDER[a.origin] - ORIGIN_ORDER[b.origin]) || ((a.rank || 9) - (b.rank || 9));
}

/* ---------- 成分層：重複與交互作用（只產生「請核對」的提醒） ---------- */
function ingName(id) { var i = ING[id]; return i ? (i.zh ? i.name + '（' + i.zh + '）' : i.name) : String(id); }
/* ---------- 執行期卡片工廠（makeRuntimeCard） ----------
 * 由成分組合、危險藥物、用藥真相不明產生的卡片，必須和靜態卡片一樣帶齊摘要需要的欄位
 * （topic／issue／issue_key／action_key／question_key／timing／risk），
 * 否則摘要引擎會把它們默默略過（SUM-RUNTIME-CARD-01）。缺欄位直接丟錯，不讓它靜默。 */
var RUNTIME_REQUIRED = ['id', 'claim_id', 'topic', 'issue', 'issue_key', 'timing', 'risk', 'group', 'title', 'text', 'evidence'];
function makeRuntimeCard(spec) {
  var c = clone(spec);
  c.runtime = true;
  c.question_key = c.question_key || c.issue_key;
  c.action_key = c.action_key || c.issue_key;
  RUNTIME_REQUIRED.forEach(function (k) { if (c[k] === undefined || c[k] === null || c[k] === '') throw new Error('RUNTIME_CARD_MISSING:' + (c.id || '?') + '.' + k); });
  return c;
}
/* 勾了成分但沒確認現在是否還在吃：不做重複／交互作用宣稱，只請人核對（HF-B02-P0-01） */
function exposureUnclearCard(ef) {
  if (!ef.ingredientsUnsure.length) return null;
  return makeRuntimeCard({ id: 'MED_EXPOSURE_UNCLEAR', claim_id: 'CLM-MED_EXPOSURE_UNCLEAR', group: 'now', rank: 3, risk: 'IMPORTANT',
    origin: 'COMBO', timing: 'NEXT_VISIT', topic: 'MED_RECONCILIATION', issue_key: 'MED_TRUTH_INCOMPLETE', action_key: 'BRING_MED_LIST',
    issue: '有幾顆藥還不確定現在是不是還在吃', summary_action: '把目前真的在吃的藥袋／藥單一起帶去核對',
    reason: '您選了藥袋上看到的成分，但有幾顆還沒確認現在是不是還在吃：' + ef.ingredientsUnsure.map(ingName).join('、'),
    title: '先確認這幾顆藥現在還在不在吃，我才能幫您看有沒有重複',
    text: '藥袋上看到的，不一定就是現在還在吃的。沒有確認以前，我不會說您同時在用哪些藥，也不會做重複或交互作用的判斷。',
    actions: ['回到上一題，把每一顆標成「現在有吃」「已經停了」或「不確定」', '或把藥袋直接帶去，請藥師當面核對'],
    who: ['PHARMACIST'], when: '下次看診或領藥', escalate: '', do_not: '不要因為這一頁沒提到某個組合，就當作沒問題。',
    ask: '這些藥我現在還需要吃哪些？有沒有已經該停的？',
    evidence: [['HFA_POLY_2025', 'DIRECT'], ['NHI_HEALTHBANK', 'SUPPORTIVE']] });
}
/* 組合檢查只用「目前在用」的實例（medGraph）；需要劑量或途徑才能判斷的組合，公開版資料不足 → 不下結論 */
function comboCards(ef) {
  if (!ef.ingredients.length) return [];
  var ingSet = toSet(ef.ingredients), out = [];
  var graph = medGraph(ef.instances || []);
  graph.edges.filter(function (e) { return e.type === 'SAME_INGREDIENT'; }).forEach(function (e) {
    out.push(makeRuntimeCard({ id: 'COMBO_SAME_INGREDIENT_' + e.ingredient, claim_id: 'CLM-COMBO-SAME_INGREDIENT', group: 'now', rank: 3, risk: 'CRITICAL', origin: 'COMBO',
      timing: 'TODAY', topic: 'MED_INTERACTION', issue_key: 'DUP_' + e.ingredient, action_key: 'BRING_MED_LIST',
      issue: '同一個成分出現了兩次：' + ingName(e.ingredient), summary_action: '今天或下次領藥前，把這兩個藥袋一起拿給藥師核對',
      reason: '同一個成分 ' + ingName(e.ingredient) + ' 在兩個藥袋上都看到',
      title: '同一個成分出現在兩個藥袋上', text: '可能是同一顆藥換了廠牌或藥名，也可能真的重複吃了。請把兩個藥袋一起拿給藥師看。',
      actions: ['今天或下次領藥前，把這兩個藥袋一起拿給藥師核對'], who: ['PHARMACIST', 'DOCTOR'], when: '今天或下次領藥前',
      escalate: '出現第 1 步列出的警訊，照該處指示處理。', do_not: '在核對清楚之前，不要兩個都吃，也不要自己決定停哪一個。',
      ask: '這兩個藥袋是不是同一種藥？我應該吃哪一個？', evidence: [['HFA_POLY_2025', 'DIRECT']] }));
  });
  (C.combo_checks || []).forEach(function (chk) {
    var m = chk.match, hit = false, why = [];
    if (m.tags_all) hit = m.tags_all.every(function (t) { return !!ef.tags[t]; });
    else if (m.tags_any) hit = m.tags_any.some(function (t) { return !!ef.tags[t]; });
    else if (m.ingredients_all) hit = m.ingredients_all.every(function (x) { return !!ingSet[x]; });
    else if (m.count_tag) hit = ef.ingredients.filter(function (x) { return (ING[x].tags || []).indexOf(m.count_tag) >= 0; }).length >= (m.count_min || 2);
    if (!hit) return;
    var related = ef.ingredients.filter(function (x) {
      var t = ING[x].tags || [];
      if (m.ingredients_all) return m.ingredients_all.indexOf(x) >= 0;
      var want = m.tags_all || m.tags_any || (m.count_tag ? [m.count_tag] : []);
      return want.some(function (w) { return t.indexOf(w) >= 0; });
    });
    why = related.map(ingName);
    /* 需要劑量／途徑才能判斷者：公開版沒有這些資料 → 只請人核對，不下「會互相影響」的結論（fail-closed） */
    var needs = (chk.requires_fields || []).filter(function (k) { return k === 'dose' || k === 'route' || k === 'frequency' || k === 'strength'; });
    var insufficient = needs.length > 0;
    var urgent = chk.severity === 'URGENT_REVIEW';
    out.push(makeRuntimeCard({ id: 'COMBO_' + chk.id, claim_id: 'CLM-COMBO-' + chk.id, group: urgent ? 'now' : 'discuss', rank: urgent ? 3 : 1,
      risk: urgent ? 'CRITICAL' : 'IMPORTANT', origin: 'COMBO', reason: '您確認現在有吃的：' + why.join('、'),
      timing: urgent ? 'TODAY' : 'NEXT_VISIT', topic: 'MED_INTERACTION', issue_key: 'COMBO_' + chk.id,
      action_key: 'COMBO_REVIEW_' + chk.id,
      issue: insufficient ? '這幾顆藥要看劑量才能判斷，請藥師核對：' + why.join('、') : chk.title,
      data_sufficiency: insufficient ? 'INSUFFICIENT_' + needs.join('_').toUpperCase() : 'SUFFICIENT_FOR_REVIEW_PROMPT',
      title: insufficient ? '這幾顆藥要看劑量才能判斷：請藥師核對' : chk.title,
      text: insufficient ? '這個組合是否有問題，要看劑量或用法才能判斷；這個網頁沒有這些資料，所以不下結論，請藥師核對。' : chk.body,
      actions: urgent ? ['今天或下次領藥前，把這幾個藥袋一起拿給藥師核對'] : ['下次看診時，請醫師或藥師確認這個組合'],
      who: urgent ? ['PHARMACIST', 'DOCTOR'] : ['DOCTOR', 'PHARMACIST'], when: urgent ? '今天或下次領藥前' : '下次看診',
      escalate: '出現第 1 步列出的警訊，照該處指示處理。', do_not: chk.do_not,
      ask: '我同時在用的這幾個藥，是不是重複或互相影響？', evidence: clone(chk.evidence) }));
  });
  return out;
}
function hazardCards(ef) {
  if (!ef.ingredients.length) return [];
  var groups = {};
  ef.ingredients.forEach(function (x) { var h = ING[x].hf_hazard; if (h) { (groups[h] = groups[h] || []).push(x); } });
  return Object.keys(groups).map(function (h) {
    var reg = C.hazard_registry[h]; if (!reg || reg.review === 'PENDING') return null;   /* 5.1 W51-RXB：待雙審的 hazard 不產生病人卡（公開版沒有模擬病人閘門；院內版醫療端另行提示） */
    return makeRuntimeCard({ id: 'HAZARD_' + h, claim_id: 'CLM-HAZARD-' + h, group: 'now', rank: 5, risk: 'IMPORTANT', origin: 'COMBO',
      timing: 'NEXT_VISIT', topic: 'MED_INTERACTION', issue_key: 'HAZARD_' + h, action_key: 'HAZARD_REVIEW_' + h,
      issue: '正在用的 ' + groups[h].map(ingName).join('、') + ' 在心衰竭要特別確認（' + reg.label + '）',
      reason: '您確認現在有吃的：' + groups[h].map(ingName).join('、'),
      title: '這一類藥在心衰竭要特別確認：' + reg.label,
      text: reg.why + '不代表您一定要停，但一定要讓醫師知道您在用。',
      actions: [reg.action], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診；自己買的請先問過再買',
      escalate: '用了之後更喘、更腫或體重快速上升，當天聯絡醫療團隊。',
      do_not: '不要自己停掉醫師開立的藥；也不要自己再去買同一類的成藥。',
      ask: '我在用的這個藥，對我的心衰竭有影響嗎？有沒有別的選擇？', evidence: clone(reg.evidence) });
  }).filter(Boolean);
}

/* ---------- 主要分析 ---------- */
function analyze(input) {
  var s = input && typeof input === 'object' ? input : {};
  var r = safetyRoute(s);
  var base = { status: r.status, route: r.route, stop: false, errors: r.errors || [], cards: [], supplement_hidden: [], med_reference: [], summary: null };
  if (r.status === 'VALIDATION_ERROR') { base.stop = true; base.cards = [cardFrom('SYS_VALIDATION_ERROR', 'SAFETY')]; return finish(base, s); }
  if (r.status === 'NEED_SAFETY_ASSESSMENT') { base.stop = true; base.cards = [cardFrom('SYS_NEED_SAFETY', 'SAFETY')]; return finish(base, s); }
  var sigLabels = r.signals.map(function (x) { return SIGNALS[x].label; });
  if (r.route === 'EMERGENCY') {
    base.stop = true;
    var emSig = r.signals.filter(function (x) { return SIGNALS[x].level === 'EMERGENCY'; });
    base.cards = [cardFrom('EMERGENCY', 'SAFETY', emSig.length ? '您勾選：' + emSig.map(function (x) { return SIGNALS[x].label; }).join('、') : '您同時勾選：' + r.signals.map(function (x) { return SIGNALS[x].label; }).join('＋') + '（同時出現時就算緊急）')];
    return finish(base, s);
  }
  var out = [], seen = {};
  function push(c) { if (c && !seen[c.id]) { seen[c.id] = true; out.push(c); } }
  function sigReason(level) { return '您勾選：' + r.signals.filter(function (x) { return SIGNALS[x].level === level; }).map(function (x) { return SIGNALS[x].label; }).join('、'); }
  var sigSet = toSet(r.signals);
  if (sigSet.U_PINK) push(cardFrom('URGENT_PINK', 'SAFETY', '您勾選：' + SIGNALS.U_PINK.label));
  if (sigSet.U_BLEED_MAJOR) push(cardFrom('URGENT_BLEED', 'SAFETY', '您勾選：' + SIGNALS.U_BLEED_MAJOR.label));
  if (sigSet.U_CONFUSE) push(cardFrom('URGENT_CONFUSION', 'SAFETY', '您勾選：' + SIGNALS.U_CONFUSE.label));
  if (sigSet.U_HEAD_BLOODTHIN) push(cardFrom('URGENT_HEAD', 'SAFETY', '您勾選：' + SIGNALS.U_HEAD_BLOODTHIN.label));
  if (sigSet.U_PRESYNCOPE) push(cardFrom('URGENT_PRESYNCOPE', 'SAFETY', '您勾選：' + SIGNALS.U_PRESYNCOPE.label));
  var tfr = r.floor === 'TEAM_WEIGHT_THRESHOLD' ? '醫療團隊給您的標準：' + s.team_floor.days + ' 天內增加 ' + s.team_floor.th + ' 公斤以上要通知；這次多了 ' + s.team_floor.gain + ' 公斤' : '';
  if (sigSet.S_BREATH || sigSet.S_SWELL) push(cardFrom('SAME_DAY', 'SAFETY', sigReason('SAME_DAY') + (tfr ? '；' + tfr : '')));
  else if (tfr) push(cardFrom('SAME_DAY', 'SAFETY', tfr));
  if (sigSet.S_ICD) push(cardFrom('SAME_DAY_ICD', 'SAFETY', '您勾選：' + SIGNALS.S_ICD.label));
  if (sigSet.S_PALP) push(cardFrom('SAME_DAY_PALP', 'SAFETY', '您勾選：' + SIGNALS.S_PALP.label));
  if (sigSet.S_SICK) push(cardFrom('SAME_DAY_SICK', 'SAFETY', '您勾選：' + SIGNALS.S_SICK.label));
  if (sigSet.S_BLEED_MINOR || sigSet.S_HEMATURIA) push(cardFrom('SAME_DAY_BLEED_MINOR', 'SAFETY', '您勾選：' + r.signals.filter(function (x) { return x === 'S_BLEED_MINOR' || x === 'S_HEMATURIA'; }).map(function (x) { return SIGNALS[x].label; }).join('、')));
  var safetyCount = out.length;
  /* 「現在就去急診」與 119 一樣停止一般流程：只留安全卡片，不出一般衛教（V100-P0-SAFE-01） */
  if (routeView(r.route).stop_routine) {
    base.stop = true;
    base.cards = out.slice(0, safetyCount);
    return finish(base, s);
  }

  /* 近期變化 */
  if (s.recent_change === 'WORSE' && r.route === 'ROUTINE') push(cardFrom('CONTACT_TODAY', 'CHANGE', '您表示最近整體明顯變差'));
  else if (s.recent_change === 'UNSURE') push(cardFrom('UNCERTAIN_CHANGE', 'CHANGE', '您表示說不上來最近有沒有變差'));
  else if (s.recent_change === 'BETTER' && !(s.facts && s.facts.ef_improved === 'YES')) push(cardFrom('IMPROVED_KEEP_PLAN', 'CHANGE', '您表示最近比較好'));

  /* 主要問題（保留名額） */
  var p = s.primary_concern, b = s.branch || {}, f = s.facts || {};
  var ef0 = effectiveFacts(s);
  var concernLabel = p ? label(C.primary_concerns, p) : '';
  var prim = [];
  function pc(id, why) { var c = cardFrom(id, 'PRIMARY', why || ('您選的主題：' + concernLabel)); if (c) prim.push(c); }
  if (p === 'MEDICATION') {
    var mf = b.med_focus, mp = b.med_problem;
    var mpLabel = mp ? (C.med_problem_options.filter(function (x) { return x.id === mp; })[0] || {}).label : '';
    if (mf && MEDS[mf]) prim.push(medCard(mf, 'PRIMARY', '您最想了解：' + MEDS[mf].label, ef0));
    else if (mf === 'UNKNOWN_NAME') pc('MED_UNKNOWN_NAME', '您表示不知道藥名');
    else if (mf === 'ALL') pc('MED_REVIEW_ALL', '您想把所有藥一起整理');
    (C.med_problem_map[mp] || []).forEach(function (id) {
      if (id === 'MED_RECON' && !(f.med_reconciliation === 'DIFFERENT' || f.med_reconciliation === 'UNSURE')) return;
      if (id === 'MED_REVIEW_ALL' && mf && MEDS[mf]) return;     // 已經有那一顆的說明，就不再放一般整理
      pc(id, '您說吃藥最想先解決：' + mpLabel);
    });
    if (mp === 'TOLERABILITY' && b.side_effect) (C.side_effect_map[b.side_effect] || []).forEach(function (id) { pc(id, '您說吃藥後的不舒服是：' + label(C.side_effect_options, b.side_effect)); });
    if (f.med_reconciliation === 'DIFFERENT' || f.med_reconciliation === 'UNSURE') pc('MED_RECON', f.med_reconciliation === 'DIFFERENT' ? '您表示實際吃法和藥袋／藥單不同' : '您不確定實際吃法和藥袋／藥單是否一致');
    if (!prim.length) pc('MED_REVIEW_ALL');
  } else if (p === 'POST_DISCHARGE') {
    C.primary_map.POST_DISCHARGE.forEach(function (id) {
      if (id === 'POST_MONITOR' && ef0.hfDischarge !== 'YES') return;   // 未確認是心衰竭住院前，不談心衰竭惡化後的追蹤
      pc(id);
    });
  } else if (p && BRANCH_FIELD_BY_CONCERN[p]) {
    var val = b[BRANCH_FIELD_BY_CONCERN[p]];
    var ids = (C.primary_map[p] || {})[val] || [];
    var optLabel = val ? label(C.branches[p].options, val) : '';
    ids.forEach(function (id) { pc(id, '您選的主題：' + concernLabel + (optLabel ? '（' + optLabel + '）' : '')); });
  } else if (p === 'UNDERSTAND' || p === 'NONE') {
    C.primary_map[p].forEach(function (id) { pc(id); });
  }
  /* 運動只在穩定時給（F36）：今天有要處理的警訊或整體變差時，改給「先等穩定」 */
  /* 運動閘門（ESC-EX）：有警訊、最近變差、或說不上來（不知道不等於穩定）都不給一般運動衛教 */
  var unstable = r.route !== 'ROUTINE' || s.recent_change === 'WORSE' || s.recent_change === 'UNSURE';
  function gateActivity(c) { return (c && c.id === 'SELF_ACTIVITY' && unstable) ? cardFrom('ACTIVITY_WAIT', c.origin, c.reason) : c; }
  prim.slice(0, C.config.max_primary_cards).map(gateActivity).forEach(push);
  /* 第二件事（F31）：看完第一件事之後才加，最多兩張、不重複 */
  var st2 = (C.second_topics || []).filter(function (x) { return x.id === s.second_topic; })[0];
  if (st2) st2.cards.slice(0, 2).forEach(function (id) { push(gateActivity(cardFrom(id, 'SECOND', '您加的第二件事：' + st2.label))); });

  /* 2026 ESC 治療地圖（資訊核對，不下醫囑） */
  /* 資料狀態閘門：不猜、不把「不知道」當成正常 */
  if (ef0.dx === 'SUSPECTED' || ef0.dx === 'UNKNOWN') push(cardFrom('SYS_DX_UNCONFIRMED', 'FACT', ef0.dx === 'SUSPECTED' ? '您表示醫師說還在檢查' : '您表示不確定診斷'));
  if (ef0.lvefRaw && ef0.lvefUsability !== 'CURRENT_USABLE') push(cardFrom('SYS_LVEF_STALE', 'FACT', ef0.lvefStale ? '您表示上次心臟超音波超過一年' : (ef0.lvefDateUnknown ? '您記得射出分率，但不確定是什麼時候做的' : '您記得射出分率，但不確定數字是從哪裡看到的')));
  if (ef0.lvefConflict) push(cardFrom('SYS_LVEF_CONFLICT', 'FACT', '您填的射出分率與醫師告知的類型不一致'));
  /* 診斷閘門 fail-closed（ESC-P0-01）：只有病人說「醫師明確說我有心衰竭」才核對心衰竭核心治療；沒回答、不確定、還在檢查都不出 */
  var dxBlocked = ef0.dx !== 'CONFIRMED';
  /* 治療核對表：只有吃了不舒服、又不知道 LVEF 時先不出（避免誤讀成「我的藥不是核心藥」）；只想了解心衰竭時也不主動出 */
  var hasMedInfo = !!((s.facts && s.facts.recognized_med_classes && s.facts.recognized_med_classes.length) || (ef0.instances && ef0.instances.length));
  var mapQuiet = !ef0.lvef && !ef0.hfType && ((p === 'MEDICATION' && b.med_problem === 'TOLERABILITY') || ((p === 'UNDERSTAND' || p === 'NONE') && !hasMedInfo));
  if (!dxBlocked && !mapQuiet && (ef0.lvef || ef0.hfType || p === 'MEDICATION' || p === 'POST_DISCHARGE' || (s.facts && s.facts.recognized_med_classes && s.facts.recognized_med_classes.length))) push(treatmentMap(s, ef0));

  /* 轉銜情境：與「今天最想處理」無關，獨立觸發 */
  if (p !== 'POST_DISCHARGE' && ef0.discharge === 'YES') {
    var why = ef0.hfDischarge === 'YES' ? '您表示最近因為心臟衰竭住院' : '您表示最近住過院';
    C.transition_card.DISCHARGE.forEach(function (id) {
      if (id === 'POST_MONITOR' && ef0.hfDischarge !== 'YES') return;   // 只有心衰竭惡化住院才談核心治療追蹤
      push(cardFrom(id, 'CHANGE', why));
    });
  }
  if (ef0.medChange === 'YES') push(cardFrom('MED_CHANGE_RECENT', 'CHANGE', '您表示最近換藥或調整過劑量'));
  /* 實際吃法與藥單不一致是獨立的用藥安全問題，不受「今天最想處理什麼」影響 */
  if (p !== 'MEDICATION' && !seen.POST_RECON && (ef0.recon === 'DIFFERENT' || ef0.recon === 'UNSURE')) {
    push(cardFrom('MED_RECON', 'CHANGE', ef0.recon === 'DIFFERENT' ? '您表示實際吃法和藥單不同' : '您不確定實際吃法和藥單是否一致'));
  }
  if (ef0.medChange === 'YES' || (s.facts && s.facts.recent_hf_discharge === 'YES') || ef0.discharge === 'YES' || p === 'POST_DISCHARGE' || sigSet.S_SICK) push(cardFrom('SICKDAY_PLAN', 'CHANGE', '生病時的用藥方式需要事先寫下來'));

  /* 生活面：只有病人自己勾了才出現 */
  var wp = Array.isArray(s.whole_person) ? s.whole_person : [];
  wp.forEach(function (k) {
    if (k === 'NONE_OF_THESE') return;
    var id = C.whole_person_card[k];
    if (id) push(cardFrom(id, 'PRIMARY', '您表示想談：' + label(C.whole_person_needs, k)));
  });

  /* 自我管理準備度：不確定突然變差時怎麼做（READINESS-CONSTRUCT-01） */
  if (s.self_management_readiness === 'UNSURE') push(cardFrom('SELF_WORSEN_PLAN', 'FACT', '您表示不太確定突然變差時該怎麼做、找誰'));

  /* 照顧者、心情、裝置：只有回答了才出現（全人照護） */
  if (s.caregiver_strain === 'OFTEN') push(cardFrom('ACC_CARE_SUPPORT', 'FACT', '您表示照顧這件事常常讓您吃不消'));
  if (s.care_dependency === 'DEPENDENT' || s.care_dependency === 'PARTIAL') push(cardFrom('CO_FRAILTY', 'FACT', '您表示病人平常' + (s.care_dependency === 'DEPENDENT' ? '走路、洗澡或吃藥都要人幫忙' : '有些事需要人幫忙')));
  if (s.mood_screen === 'YES') push(cardFrom('CO_MOOD_COG', 'FACT', '您表示最近兩週常常心情低落或提不起勁'));
  if (s.device === 'ICD' || s.device === 'PACER') push(cardFrom('WP_DEVICE', 'FACT', '您表示身上有' + label(C.device_options, s.device)));
  /* 營養風險（F37）與費用造成少吃（F39）：只有回答了才出現 */
  if (s.nutrition_risk === 'WEIGHT_LOSS' || s.nutrition_risk === 'APPETITE' || s.nutrition_risk === 'WEAKER') push(cardFrom('SYM_APPETITE', 'FACT', '您表示' + label(C.nutrition_risk_options, s.nutrition_risk)));
  if (s.nutrition_risk === 'WEAKER') push(cardFrom('CO_FRAILTY', 'FACT', '您表示力氣變小、容易跌倒或站不穩'));
  if (s.cost_skip === 'YES') push(cardFrom('ADH_COST_SKIP', 'FACT', '您表示曾因藥費或拿藥困難少吃或停過藥'));

  /* 進階心衰竭轉介：休息時有症狀＋近期住院 */
  if (ef0.advancedHF) push(cardFrom('ADV_HF_REFERRAL', 'FACT', ef0.hfAdmissions === 'TWO_PLUS' ? '您表示這一年因為心臟衰竭住院 2 次以上' : '您表示休息的時候也會喘，或要墊高才睡得著'));

  /* 補充：第二個用藥困難 */
  var extra = [];
  if (s.adherence_barrier_2 && p === 'ADHERENCE') {
    (C.primary_map.ADHERENCE[s.adherence_barrier_2] || []).forEach(function (id) { var c = cardFrom(id, 'FACT', '您補充的其他用藥困難：' + label(C.branches.ADHERENCE.options, s.adherence_barrier_2)); if (c) extra.push(c); });
  }
  /* 可行性 */
  if (s.feasibility === 'HARD') push(cardFrom('FEAS_SUPPORT', 'FEAS', '您表示「現在先做」的事有困難' + (s.feasibility_barrier ? '：' + label(C.feasibility_barriers, s.feasibility_barrier) : '')));

  /* 組合提醒與補充事實 */
  var ef = effectiveFacts(s);
  C.rules.forEach(function (rule) {
    /* HFPC-AUD-0001：心衰竭專屬的規則只在「醫師明確說有心衰竭」時出現（沒回答、不確定、還在檢查 → 不出；fail-closed） */
    if ((C.rule_scope || {})[rule.id] === 'HF_CONFIRMED' && ef.dx !== 'CONFIRMED') return;
    if (rule.when.some(function (c) { return condHolds(c, ef, r.signals); })) {
      var c = clone(rule.card); c.id = rule.id; c.origin = 'RULE'; c.reason = ruleReason(rule, ef); extra.push(c);
    }
  });
  var expCard = exposureUnclearCard(ef);
  if (expCard) extra.push(expCard);
  comboCards(ef).forEach(function (c) { extra.push(c); });
  hazardCards(ef).forEach(function (c) { extra.push(c); });
  if ((ef.ingredients.length || ef.ingredientsUnsure.length) && ef.listComplete !== 'COMPLETE') {
    extra.push(cardFrom('MED_INCOMPLETE', 'COMBO', ef.listComplete === 'INCOMPLETE' ? '您表示還有藥沒有列進來' : '還沒確認這份清單是不是全部'));
  }
  Object.keys(ef.comorb).forEach(function (k) {
    var id = C.comorbidity_card[k]; var c = cardFrom(id, 'FACT', '您補充的共病：' + label(C.branches.COMORBIDITY.options, k)); if (c) extra.push(c);
  });
  if (s.mode === 'CAREGIVER') extra.push(cardFrom('CAREGIVER_SELF', 'MODE', '您是以照顧者身分使用'));
  extra = extra.filter(function (c) { return c && !seen[c.id]; });
  extra.sort(sortCards);
  var visible = extra.slice(0, C.config.max_visible_supplement_cards);
  base.supplement_hidden = extra.slice(C.config.max_visible_supplement_cards);
  visible.forEach(push);
  base.supplement_hidden = base.supplement_hidden.filter(function (c) { seen[c.id] = true; return true; });

  /* 用藥參考（所有已知類別，不佔名額） */
  var primMed = (p === 'MEDICATION' && MEDS[b.med_focus]) ? b.med_focus : null;
  Object.keys(ef.classes).forEach(function (k) { if (k !== primMed) { var mc = medCard(k, 'FACT', '您勾選認得的藥物', ef); if (mc) base.med_reference.push(mc); } });

  if (!out.length) push(cardFrom('HF_THREE_THINGS', 'PRIMARY', '目前沒有足夠資訊，先提供共同原則'));
  var safetyCards = out.slice(0, safetyCount), rest = out.slice(safetyCount).sort(sortCards);
  base.cards = safetyCards.concat(rest);
  return finish(base, s);
}
function treatmentMap(s, ef) {
  var TM = C.treatment_map, f = s.facts || {};
  var known = f.recognized_med_classes;
  /* 狀態必須反映「確認程度」，不可把「認得」講成「在用」（HF-B02-P0-01） */
  /* 只用「證據角色」判斷，不用藥理類別（ESC-P0-02～04）；每一句都不說「缺」——未勾選不代表沒有 */
  function roleMatch(x, role) {
    var it = ING[x]; if (!it) return false;
    if (role === 'ANY_MRA') return it.cls === 'MRA';
    return (it.hf_roles || []).indexOf(role) >= 0;
  }
  function status(clsIds, role) {
    var cur = ef.ingredients, unsure = ef.ingredientsUnsure;
    var supported = cur.filter(function (x) { return roleMatch(x, role) && ING[x].evidence_status === 'SUPPORTED'; });
    if (supported.length) return { text: '您確認目前在用', state: 'CONFIRMED_CURRENT' };
    var extrap = cur.filter(function (x) { return roleMatch(x, role) && ING[x].evidence_status === 'CLASS_EXTRAPOLATED'; });
    if (extrap.length) return { text: '您在用 ' + ING[extrap[0]].name + '：屬同一類，但不是指引核心治療劑量表列出的成分，是否等同請藥師確認', state: 'SAME_CLASS_NOT_LISTED' };
    var formUnk = cur.filter(function (x) { return roleMatch(x, role) && ING[x].evidence_status === 'FORMULATION_UNKNOWN'; });
    if (formUnk.length) return { text: '您在用 metoprolol：有長效（succinate）與短效（tartrate）兩種，心衰竭研究用的是長效，請藥師確認劑型', state: 'FORMULATION_UNKNOWN' };
    /* 同類但不是心衰竭核心治療的研究用藥（propranolol、atenolol；降低型的 finerenone） */
    var sameClass = cur.filter(function (x) { return clsIds.indexOf(ING[x].cls) >= 0 && !roleMatch(x, role); });
    if (sameClass.length) {
      var it0 = ING[sameClass[0]];
      return { text: '您在用 ' + it0.name + '：' + (it0.ef_scope_note ? it0.ef_scope_note + '，' : '屬同一類，但') + '不是這一型核心治療的研究用藥，是否算您的核心治療請醫師確認', state: 'SAME_CLASS_NOT_HF_FMT' };
    }
    if (unsure.some(function (x) { return roleMatch(x, role); })) return { text: '藥袋上有看到，還沒確認現在是否在吃', state: 'SEEN_NOT_CONFIRMED' };
    if (clsIds.some(function (k) { return ef.classes[k]; })) return { text: '您勾過這一類（未確認是否在用）', state: 'CLASS_ONLY' };
    if (known === null || known === undefined) return { text: '未提供用藥資料', state: 'DATA_NOT_PROVIDED' };
    return { text: '未勾選（不代表沒有）', state: 'NOT_IDENTIFIED' };
  }
  var prof = TM.profiles[ef.profile];
  var fmt = prof.fmt.map(function (it) { var st = status(it.classes, it.role); return { label: it.label, note: it.note || '', status: st.text, state: st.state, role: it.role }; });
  var preg = ef.pregnancy === 'YES' || ef.pregnancy === 'UNSURE' || ef.pregnancy === 'PLANNING';
  /* 適用性三態：符合／目前不符合／資料不足（不把「不知道」當成「不符合」） */
  var AMT_KEYS = ['label', 'note', 'lvef_in', 'profile_in', 'bmi', 'tsat', 'rhythm', 'hr', 'symptoms', 'discharge', 'hf_discharge', 'no_pregnancy', 'prerequisites'];
  var amt = TM.amt.map(function (a) {
    /* 未知的條件欄位不能被默默略過（HFPC-AUD-0002）：直接判為資料不足 */
    var unknownKeys = Object.keys(a).filter(function (k) { return AMT_KEYS.indexOf(k) < 0; });
    if (unknownKeys.length) return { label: a.label, note: a.note, state: 'INSUFFICIENT_DATA', why: '這一項的條件無法由這份問卷判斷' };
    var missing = [], fail = [];
    if (a.lvef_in) { if (!ef.lvef) missing.push(ef.lvefRaw ? '一年內、知道日期與來源的射出分率' : '射出分率'); else if (a.lvef_in.indexOf(ef.lvef) < 0) fail.push('射出分率'); }
    if (a.profile_in) { if (ef.profile === 'UNKNOWN') missing.push('心衰竭類型'); else if (a.profile_in.indexOf(ef.profile) < 0) fail.push('心衰竭類型'); }
    if (a.bmi) { if (!ef.bmi) missing.push('BMI'); else if (ef.bmi !== a.bmi) fail.push('BMI'); }
    if (a.tsat) {
      if (!ef.tsat) missing.push(ef.tsatRaw && !ef.tsatFresh ? '一年內的鐵檢驗（TSAT）' : '鐵的檢驗（TSAT）');
      else if (ef.tsat !== a.tsat) fail.push('鐵的檢驗（TSAT）');
    }
    if (a.rhythm) { if (!ef.rhythm) missing.push('心律是否規律'); else if (ef.rhythm !== a.rhythm) fail.push('心律'); }
    if (a.hr) { if (!ef.hr) missing.push('休息時的心跳'); else if (ef.hr !== a.hr) fail.push('休息時的心跳'); }
    if (a.symptoms) { if (!ef.symptomStatus) missing.push('活動時還會不會喘'); else if (ef.symptomStatus !== a.symptoms) fail.push('目前的症狀狀況'); }
    if (a.hf_discharge) {   /* HFPC-AUD-0002：三態；只說「住過院」但沒確認是心衰竭 → 資料不足 */
      if (ef.hfDischarge === 'YES') { /* pass */ } else if (ef.hfDischarge === 'NO') fail.push('最近的住院狀況'); else missing.push(ef.hfDischarge === 'UNCONFIRMED' ? '最近住院是不是因為心衰竭' : '最近有沒有因心衰竭住院');
    }
    if (a.discharge) { if (!ef.discharge || ef.discharge === 'UNSURE') missing.push('最近有沒有因心衰竭住院'); else if (ef.discharge !== a.discharge) fail.push('最近的住院狀況'); }
    if (a.no_pregnancy) {
      if (ef.pregnancyGate === 'POSSIBLE') return { label: a.label, note: a.note, state: 'NOT_MATCH', why: ef.pregnancy === 'PLANNING' ? '計畫懷孕時不適合開始（例如 semaglutide 要在懷孕前至少 2 個月停用），請由醫師與婦產科安排' : '懷孕或可能懷孕期間不適用，請由醫師與婦產科安排' };
      if (ef.pregnancyGate === 'UNASSESSED') missing.push('是否可能懷孕');
    }
    if (fail.length) return { label: a.label, note: a.note, state: 'NOT_MATCH', why: '依您填的' + fail.join('、') + '，目前的條件不符合' };
    /* HFPC-AUD-0003：前提條件問卷無法判斷 → 最多是「資料不足」，永遠不是「符合」 */
    if (a.prerequisites && a.prerequisites.length) missing = missing.concat(a.prerequisites.map(function (k) { return (TM.prerequisite_text || {})[k] || k; }));
    if (missing.length) return { label: a.label, note: a.note, state: 'INSUFFICIENT_DATA', why: '還缺：' + missing.join('、') + '，所以無法判斷' };
    return { label: a.label, note: a.note, state: 'MATCH', why: '依您填的資料符合討論條件，仍由醫師判斷' };
  });
  var amtMatch = amt.filter(function (a) { return a.state === 'MATCH'; });
  var amtOther = amt.filter(function (a) { return a.state !== 'MATCH'; });
  /* HFPC-AUD-0007：裝置／介入是「一般資訊」，未針對個人評估；已有 ICD 時不再顯示 ICD／CRT 評估句 */
  var gdit = TM.gdit.filter(function (g) { return (!g.lvef_in || g.lvef_in.indexOf(ef.lvef) >= 0) && !(g.suppress_if_device && g.suppress_if_device.indexOf(s.device) >= 0); }).map(function (g) { return g.text; });
  var lvefLabel = ef.lvefRaw ? (ef.lvefValue !== null ? ef.lvefValue + '%' : label(C.lvef_bands, ef.lvefRaw)) + (ef.lvefUsability === 'CURRENT_USABLE' ? '' : '（只當參考）') : null;
  var c = clone(C.cards.TREATMENT_MAP); c.id = 'TREATMENT_MAP'; c.origin = 'MAP';
  c.reason = lvefLabel ? '依您填的射出分率（LVEF）：' + lvefLabel + (ef.hfType ? '；醫師告知：' + label(C.hf_type_options, ef.hfType) : '') : (ef.hfType ? '依醫師告知的類型：' + label(C.hf_type_options, ef.hfType) : '還沒有提供射出分率（LVEF），只顯示不論射出分率多少都適用的部分');
  var conflict = ef.lvefConflict;
  c.map = { pregnancy: preg ? TM.pregnancy_text : '',
    profile_text: prof.text + (ef.profile === 'PRESERVED_CONFIRMED' && !ef.lvef ? TM.preserved_no_lvef_text : '') + (conflict ? TM.conflict_text : '') + (ef.lvefRaw && ef.lvefUsability !== 'CURRENT_USABLE' ? TM.stale_text : '') + ((ef.lvef === '41_44' || ef.lvef === '45_49') && TM.ef41_49_text ? TM.ef41_49_text : ''),
    evidence_band: (ef.lvef === '41_44' || ef.lvef === '45_49') ? 'EF41_49_GUIDELINE_RECOMMENDED_LIMITED_EXCLUSIVE_RCT' : (ef.lvef ? 'DIRECT_RCT_BAND' : 'UNKNOWN'),
    fmt: fmt, fmt_footer: TM.fmt_footer, symptom: TM.symptom_text,
    amt: amtMatch, amt_other: amtOther, amt_footer: TM.amt_footer, gdit: gdit, gdit_information_level: 'GENERAL_INFORMATION',
    classification_basis: TM.classification_basis,
    improved: (ef.efImproved === 'YES' && ef.profile !== 'IMPROVED') ? TM.improved_text : '' };
  return c;
}
function ruleReason(rule, ef) {
  var c = rule.when.filter(function (x) { return condHolds(x, ef, []); })[0] || {};
  var parts = [];
  var clsList = [].concat(c.classes_any || [], c.classes_any2 || [], c.classes_all || []).filter(function (k, i, a) { return ef.classes[k] && a.indexOf(k) === i; });
  if (clsList.length) parts.push('藥物：' + clsList.map(function (k) { return MEDS[k].label; }).join('、'));
  var coList = (c.comorb_any || []).filter(function (k) { return ef.comorb[k]; });
  if (coList.length) parts.push('共病：' + coList.map(function (k) { return label(C.branches.COMORBIDITY.options, k); }).join('、'));
  if (c.otc) parts.push('使用成藥／中草藥／保健品');
  if (c.burden) parts.push('覺得藥很多、難管理');
  if (c.discharge) parts.push('近期因心衰竭住院或出院');
  if (c.lvef_in || c.profile_in) parts.push('射出分率（LVEF）：' + (ef.lvef ? label(C.lvef_bands, ef.lvef) : (ef.hfType ? label(C.hf_type_options, ef.hfType) : '')));
  if (c.bmi) parts.push(label(C.bmi_bands, ef.bmi));
  if (c.tsat) parts.push('TSAT ' + label(C.tsat_bands, ef.tsat));
  if (c.ef_improved) parts.push('射出分率曾進步');
  if (c.pregnancy) parts.push('可能懷孕或計畫懷孕');
  if (c.recon_in) parts.push('實際用藥與藥單' + (ef.recon === 'DIFFERENT' ? '不同' : '不確定是否一致'));
  if (c.hf_discharge || c.discharge_recent) parts.push('最近因心衰竭住院或出院');
  if (c.symptom_status_in) parts.push('活動時還有症狀');
  if (c.symptom_focus_in) parts.push('您選的症狀：' + label(C.branches.SYMPTOM.options, ef.symptomFocus));
  if ((c.comorb_any2 || []).length) { var co2 = c.comorb_any2.filter(function (k) { return (ef.comorbReported || {})[k]; }); if (co2.length) parts.push('共病：' + co2.map(function (k) { return label(C.branches.COMORBIDITY.options, k); }).join('、')); }
  if (c.med_change) parts.push('最近換藥或調整劑量');
  if (c.advanced_hf) parts.push('休息時也會喘，或一年內多次住院');
  if (c.exposure_unsure) parts.push('有藥不確定還有沒有在吃');
  if (c.signals_any) parts.push('您勾選的狀況');
  if (c.tags_any || c.tags_all) {
    var tg = [].concat(c.tags_any || [], c.tags_all || []);
    var tIngs = ef.ingredients.filter(function (x) { return (ING[x].tags || []).some(function (t) { return tg.indexOf(t) >= 0; }); }).map(function (x) { return ING[x].name; });
    parts.push(tIngs.length ? '您目前在用：' + tIngs.join('、') : '您列的藥');
  }
  if (c.class_unresolved_any) {
    var un = c.class_unresolved_any.filter(function (k) { return (ef.classUnresolved || {})[k] && MEDS[k]; });
    if (un.length) parts.push('您勾了' + un.map(function (k) { return '「' + MEDS[k].label + '」'; }).join('、') + '，但還沒指出是哪一種藥');
  }
  if (!parts.length) parts.push('您回答的內容');
  return '依您提供的資料：' + parts.join('；');
}

/* ---------- 資料缺口（明說不知道，不當作沒有） ---------- */
function dataGaps(s) {
  var f = (s && s.facts) || {}, g = [];
  function nul(v) { return v === null || v === undefined || v === 'UNKNOWN' || v === 'UNSURE'; }
  if (nul(f.diagnosis_status)) g.push('還沒確認醫師是否已明確診斷心衰竭');
  var efg = effectiveFacts(s);
  if (!efg.lvefRaw) g.push('沒有最近一次的射出分率');
  else if (efg.lvefUsability === 'STALE') g.push('射出分率是一年多以前的，不能代表現在');
  else if (efg.lvefUsability === 'DATE_UNKNOWN') g.push('不知道射出分率是什麼時候量的');
  else if (efg.lvefUsability === 'SOURCE_UNKNOWN') g.push('不確定射出分率是從哪裡看到的');
  var anyMed = (f.recognized_med_classes && f.recognized_med_classes.length) || efg.instances.length;
  if (!anyMed) g.push('沒有提供用藥資料');
  else if (efg.listComplete !== 'COMPLETE') g.push('用藥清單還不完整，或有幾顆還不確定現在有沒有在吃');
  if (nul(f.med_reconciliation)) g.push('不確定實際吃法和藥單是否一致');
  if (nul(f.recent_hf_discharge)) g.push('不確定最近有沒有因心衰竭住院');
  return g;
}

/* ---------- 摘要（病人回答 vs 系統整理 分開） ---------- */
function answerRows(s) {
  var rows = [], f = s.facts || {}, b = s.branch || {};
  var ef = effectiveFacts(s);
  function medLabel(k) { return MEDS[k] ? MEDS[k].label : String(k); }
  function row(k, v) { rows.push([k, v]); }
  function unk(v, fn) { return v === null || v === undefined ? '未回答' : fn(v); }
  function optLabel(list, id) { var o = list.filter(function (x) { return x.id === id; })[0]; return o ? o.label : id; }
  row('填寫的人', s.mode === 'CAREGIVER' ? '家人／照顧者代為填寫' : (s.mode === 'SELF' ? '病人本人' : '未選擇'));
  var sf = s.safety || {};
  row('安全警訊', sf.status !== 'COMPLETED' ? '未完成' : ((sf.signals || []).length ? sf.signals.map(function (x) { return SIGNALS[x] ? SIGNALS[x].label : x; }).join('、') : (sf.none === true ? '以上都沒有' : '未回答')));
  row('最近和平常相比', unk(s.recent_change, function (v) { return label(C.recent_change_options, v); }));
  if (s.concern_intent) row('今天最想處理', optLabel(C.concern_intents.concat(C.concern_secondary), s.concern_intent));
  else row('今天最想處理', unk(s.primary_concern, function (v) { return label(C.primary_concerns, v); }));
  var p = s.primary_concern;
  if (b.med_problem) row('吃藥最想先解決', optLabel(C.med_problem_options, b.med_problem));
  if (b.other_topic) row('想一起談的', optLabel(C.other_topic_options, b.other_topic));
  if (p === 'MEDICATION' && b.med_focus) row('最想了解的藥', b.med_focus_ing ? ingName(b.med_focus_ing) : (MEDS[b.med_focus] ? MEDS[b.med_focus].label : label(C.med_focus_extra, b.med_focus)));
  if (p && BRANCH_FIELD_BY_CONCERN[p] && b[BRANCH_FIELD_BY_CONCERN[p]]) row(C.branches[p].title.replace(/？$/, ''), label(C.branches[p].options, b[BRANCH_FIELD_BY_CONCERN[p]]));
  if (f.med_reconciliation) row('實際吃法與藥單一致嗎', label(C.med_reconciliation_options, f.med_reconciliation));
  if (ef.instances.length) {
    var st = { CURRENT: '現在有吃', STOPPED: '已經停了', UNSURE: '不確定' };
    row('藥袋上看到的藥', ef.instances.map(function (mi) { return ingName(mi.ingredient) + '（' + st[mi.status] + '）'; }).join('、'));
    row('這些是全部的藥嗎', unk(f.med_list_complete, function (v) { return label(C.med_list_complete_options, v); }));
  } else if (f.recognized_med_classes && f.recognized_med_classes.length) row('認得的藥物類別', f.recognized_med_classes.map(medLabel).join('、'));
  if (Array.isArray(f.known_comorbidities)) row('其他健康問題（自己說的）', f.known_comorbidities.length ? f.known_comorbidities.map(function (k) { return label(C.branches.COMORBIDITY.options, k); }).join('、') : '沒有勾選（不代表沒有）');
  if (p === 'POST_DISCHARGE' || f.recent_hf_discharge) row('最近住院／出院', p === 'POST_DISCHARGE' ? '是（今天最想談的事）' : label(C.tri_state, f.recent_hf_discharge));
  if (f.discharge_reason) row('住院原因', label(C.discharge_reason_options, f.discharge_reason));
  if (f.discharge_when) row('出院多久', label(C.discharge_when_options, f.discharge_when));
  if (f.uses_otc) row('自己買的藥、中草藥或保健品', label(C.tri_state, f.uses_otc));
  if (f.med_burden) row('覺得藥很多、難管理', label(C.tri_state, f.med_burden));
  if (f.med_change_recent) row('最近一個月換過藥', label(C.tri_state, f.med_change_recent));
  if (ef.lvefReported) {
    var use = { CURRENT_USABLE: '用來核對目前的治療', STALE: '超過一年，只當參考', DATE_UNKNOWN: '日期不確定，只當參考', SOURCE_UNKNOWN: '來源不確定，只當參考' };
    row('射出分率（LVEF）', (ef.lvefValue !== null ? ef.lvefValue + '%' : label(C.lvef_bands, ef.lvefReported)) + '｜' + (f.lvef_when ? label(C.lvef_when_options, f.lvef_when) : '日期未回答') + '｜' + use[ef.lvefUsability]);
  } else if (f.lvef_band === 'UNKNOWN' || (s.field_meta || {}).lvef_value) row('射出分率（LVEF）', '不知道');
  if (f.hf_type_told) row('醫師告知的心衰竭類型', label(C.hf_type_options, f.hf_type_told));
  if (f.diagnosis_status) row('醫師是否明確診斷', label(C.diagnosis_options, f.diagnosis_status));
  if (f.ef_improved) row('射出分率曾進步', label(C.tri_state, f.ef_improved));
  if (f.bmi_band) row('BMI', label(C.bmi_bands, f.bmi_band));
  if (ef.tsatRaw) row('TSAT（運鐵蛋白飽和度）', (ef.tsatValue !== null ? ef.tsatValue + '%' : label(C.tsat_bands, ef.tsatRaw)) + (ef.tsatFresh ? '' : '｜日期不確定或超過一年，只當參考'));
  if (ef.hr) row('休息時心跳', ef.hrValue !== null ? ef.hrValue + ' 次／分' : label(C.hr_bands, ef.hr));
  if (f.pregnancy_possible) row('可能懷孕或計畫懷孕', label(C.pregnancy_options, f.pregnancy_possible));
  if (s.self_management_readiness) row('突然變差時知道怎麼做嗎', label(C.self_management_readiness_options, s.self_management_readiness));
  if (b.side_effect) row('吃藥後哪一種不舒服', label(C.side_effect_options, b.side_effect));
  if (s.mood_screen) row('最近兩週常常心情低落或提不起勁', label(C.mood_screen_options, s.mood_screen));
  if (s.caregiver_strain) row('照顧這件事吃得消嗎', label(C.caregiver_strain_options, s.caregiver_strain));
  if (s.care_dependency) row('病人平常需要人幫忙嗎', label(C.care_dependency_options, s.care_dependency));
  if (s.device) row('身上的心臟裝置', label(C.device_options, s.device));
  if (s.nutrition_risk) row('吃的量、體重和力氣', label(C.nutrition_risk_options, s.nutrition_risk));
  if (s.cost_skip) row('曾因藥費或拿藥困難少吃', label(C.cost_skip_options, s.cost_skip));
  if (s.second_topic) row('第二件想整理的事', ((C.second_topics || []).filter(function (x) { return x.id === s.second_topic; })[0] || {}).label || s.second_topic);
  if (s.adherence_barrier_2) row('其他用藥困難', label(C.branches.ADHERENCE.options, s.adherence_barrier_2));
  if (s.feasibility) row('「今天先做」做得到嗎', label(C.feasibility_options, s.feasibility) + (s.feasibility_barrier ? '（' + label(C.feasibility_barriers, s.feasibility_barrier) + '）' : ''));
  var w = s.what_matters || {};
  if (w.improve) row('最希望改善', label(C.what_matters_improve, w.improve));
  if (w.worry) row('最擔心的負擔', label(C.what_matters_worry, w.worry));
  /* 未回答≠沒有：沒有回答的重要欄位列在一起，不假裝是「沒有」 */
  var unanswered = [];
  if (!Array.isArray(f.known_comorbidities)) unanswered.push('其他健康問題');
  if (!ef.instances.length && !(f.recognized_med_classes && f.recognized_med_classes.length)) unanswered.push('正在用的藥');
  if (!f.uses_otc) unanswered.push('自己買的藥或保健品');
  if (!ef.lvefRaw && f.lvef_band !== 'UNKNOWN') unanswered.push('射出分率');
  if (!f.diagnosis_status) unanswered.push('醫師是否明確診斷');
  if (!f.med_reconciliation) unanswered.push('實際吃法和藥單一不一樣');
  if (unanswered.length) row('這次沒有回答', unanswered.join('、') + '（沒有回答不代表沒有）');
  return rows;
}
/* 照顧者版本（F40）：照顧者模式把卡片換成照顧者要做的事；只換文字與行動，不換證據與升級條件 */
function applyCaregiver(c) {
  var v = (C.caregiver_variants || {})[c && c.id];
  if (!v) return c;
  if (v.title) c.title = v.title;
  if (v.text) c.text = v.text;
  if (v.actions) c.actions = v.actions.slice();
  if (v.teach_prompt && c.teach) c.teach = { prompt: v.teach_prompt, hint: c.teach.hint };
  c.cg_applied = true;
  return c;
}
var FLOOR_WEAK = { THIS_WEEK: 1, NEXT_VISIT: 1 };   /* 只改「較晚才處理」的時間；每天持續做（ONGOING）、需要時（AS_NEEDED）不改 */
function finish(res, s) {
  res.cards = res.cards.filter(Boolean);
  if (s && s.mode === 'CAREGIVER') ['cards', 'supplement_hidden', 'med_reference'].forEach(function (k) { (res[k] || []).forEach(applyCaregiver); });
  /* 行動負荷上限：安全卡不受限；其餘「現在先做」最多 max_now_cards 張，超過移到「還可以看的」 */
  if (!res.stop) {
    var kept = [], overflow = [], nowCount = 0;
    res.cards.forEach(function (c) {
      if (c.origin === 'SAFETY' || c.origin === 'PRIMARY' || c.origin === 'SECOND' || c.risk === 'CRITICAL' || c.group !== 'now') { kept.push(c); return; }
      if (nowCount < C.config.max_now_cards) { nowCount++; kept.push(c); } else overflow.push(c);
    });
    res.cards = kept;
    res.supplement_hidden = overflow.concat(res.supplement_hidden || []);
  }
  /* 3.3（ZT-D12-005／C12-REG-020）：路徑已是「今天聯絡」或更急時，其他卡片不得只寫「下次回診」等較弱的時間；
   * 統一改成今天聯絡時一起提（原本的時間保留在 when_original，供稽核）。只改說法，不改卡片排序用的 timing。 */
  var floorTiming = C.route_timing[res.route];
  res.route_floor_cards = [];
  if (!res.stop && (floorTiming === 'TODAY' || floorTiming === 'NOW')) {
    res.cards.concat(res.supplement_hidden || [], res.med_reference || []).forEach(function (c) {
      if (!c || c.origin === 'SAFETY' || !(FLOOR_WEAK[c.timing])) return;
      c.route_floor = res.route; c.when_original = c.when || null;
      c.when = '今天聯絡醫療團隊時一起說' + (c.when_original ? '（原本：' + c.when_original + '）' : '');
      res.route_floor_cards.push(c.id);
    });
  }
  var all = res.cards.concat(res.supplement_hidden, res.med_reference);
  res.claim_ids = all.map(function (c) { return c.claim_id; });
  /* route 與安全卡片的行動時間必須一致，不得分歧（HF-B04-P0-02）；時間只來自 route_ui */
  var wantTiming = C.route_timing[res.route];
  res.route_action_consistent = true;
  if (wantTiming) {
    var safetyCards = res.cards.filter(function (c) { return c.origin === 'SAFETY'; });
    var maxTiming = safetyCards.some(function (c) { return c.timing === 'NOW'; }) ? 'NOW' : 'TODAY';
    res.route_action_consistent = safetyCards.length > 0 && maxTiming === wantTiming;
  }
  /* 需要確認理解的卡（高風險優先，且有 teach 欄位才問） */
  res.teach_targets = res.cards.filter(function (c) { return c.teach && (c.risk === 'CRITICAL' || c.origin === 'SAFETY'); }).slice(0, 1);
  /* 資料缺口：完整紀錄（第三層）用；第一層只由摘要引擎的 GapResolver 決定 */
  res.gaps = res.status === 'VALIDATION_ERROR' ? [] : dataGaps(s);
  /* 舊版平行選擇器（plan／questions／handoff）已停用：病人看到的「今天先做」與「看診先問」
   * 只有一個來源＝res.projection（DecisionOutput，R3-B Action/Question SSOT） */
  var answers;
  if (res.status === 'VALIDATION_ERROR') answers = [['資料狀態', '無法判讀，請重新開始']];
  else { try { answers = answerRows(s); } catch (e) { answers = [['資料狀態', '無法判讀，請重新開始']]; } }
  res.summary = { answers: answers, version: C.config.version, content_updated: C.config.content_updated, evidence_reviewed: C.config.evidence_reviewed };
  /* 本次摘要由投影層產生；卡片不得自己決定要不要進第一層 */
  var SUM = root.HFPC_SUMMARY || (typeof require !== 'undefined' ? require('./summary.js') : null);
  if (SUM) { try { res.projection = SUM.build(s, res, res.status === 'VALIDATION_ERROR' ? { listComplete: 'UNKNOWN_COMPLETENESS' } : effectiveFacts(s)); } catch (e) { res.projection = null; res.projection_error = String(e && e.message || e); } }
  res.decision = res.projection;
  return res;
}

var API = { unreviewedGroups: unreviewedGroups, FACT_KEYS: Object.keys(FACT_KEYS), makeRuntimeCard: makeRuntimeCard, medGraph: medGraph, medInstances: medInstances, bandOf: bandOf, routeView: routeView, newState: newState, validate: validate, safetyRoute: safetyRoute, resetSafety: resetSafety, nextStep: nextStep, analyze: analyze, effectiveFacts: effectiveFacts, medCard: medCard, fieldState: fieldState, knownValue: knownValue, comboCards: comboCards, hazardCards: hazardCards, dataGaps: dataGaps, ALLOW: ALLOW, BRANCH_FIELD_BY_CONCERN: BRANCH_FIELD_BY_CONCERN };
root.HFPC_ENGINE = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);

/* =====================================================================
 * 心衰竭照護對話｜問題登錄（Question Registry）與「下一個最值得問的一題」
 * ---------------------------------------------------------------------
 * 規則（NBQ-*）：
 *  1. 一次只問一題；需要緊密相依的補充（例如 EF 的日期）放在下一個畫面，只在上一題有答案時才問。
 *  2. 每一題都要登錄 consumers（誰會用到這個答案），而且在「現在這個人」身上，
 *     至少有一種答案會改變輸出（卡片、治療核對狀態或本次摘要），才有資格被問。
 *     這一點用實際模擬判斷（simulate），不是靠人工宣稱（QGRAPH-NO-OUTPUT-CHANGE-NO-ASK-01）。
 *  3. 不顯示「還有幾題」，只說「再補一題，可以讓這次整理更精準」。
 *  4. 略過＝問過但不知道（UNKNOWN），不當成「沒有」。
 *  5. 數字由病人輸入，分級留在後端（numeric → band）。
 * 純函式：不碰 DOM、不連網、不儲存。
 * ===================================================================== */
(function (root) {
'use strict';
var C = root.HFPC_CONTENT, E = root.HFPC_ENGINE;
if (typeof require !== 'undefined' && (!C || !E)) { E = require('./engine.js'); C = root.HFPC_CONTENT || require('./meds.js'); }

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function pairs(key) { return C[key]; }

/* kind：choice 單選（點一下就存）｜numeric 數字＋「不知道」｜multi 複選｜med_picker 找藥（工具型頁面）｜bmi 身高體重
 * field：寫入的欄位（facts.xxx 或最上層 xxx）
 * depends_on：前一題的答案讓這一題有意義時才問（qualifier）
 * consumers：用到這個答案的規則或卡片（建置與測試會檢查存在）
 * weight：同樣會改變輸出時的基本順序（數字大者先問）
 * simulate：拿來模擬的答案；false 表示改用 impact() 判斷 */
var Q = [
  { id: 'Q_DX', kind: 'choice', field: 'facts.diagnosis_status', options: 'diagnosis_options', weight: 80,
    label: '醫師有明確說過您有心衰竭嗎？', label_cg: '醫師有明確說過病人有心衰竭嗎？',
    hint: '還在檢查的話，治療核對會先等確診再做。', consumers: ['TREATMENT_MAP', 'SYS_DX_UNCONFIRMED'] },
  { id: 'Q_LVEF_VALUE', kind: 'numeric', field: 'facts.lvef_value', numeric: 'lvef_value', weight: 78,
    band_fallback: { field: 'facts.lvef_band', options: 'lvef_bands', label: '只記得大概的範圍' },
    unknown: { field: 'facts.lvef_band', value: 'UNKNOWN', label: '不知道／沒有報告' },
    label: '如果知道，最近一次心臟超音波的射出分率（EF）是多少？', label_cg: '如果知道，病人最近一次心臟超音波的射出分率（EF）是多少？',
    hint: '檢查報告或出院病歷摘要上寫 LVEF 或 EF（射出分率），後面跟一個百分比。知道的話，我可以把要帶去問醫師的重點整理得更準。不知道就略過。',
    consumers: ['TREATMENT_MAP.profile', 'TREATMENT_MAP.amt', 'RULE_GLP1_ELIGIBLE', 'SYS_LVEF_STALE', 'SYS_LVEF_CONFLICT'], simulate: [30, 45, 58] },
  { id: 'Q_LVEF_WHEN', kind: 'choice', field: 'facts.lvef_when', options: 'lvef_when_options', weight: 77,
    depends_on: function (s, ef) { return !!ef.lvefRaw; },
    joint: { field: 'facts.lvef_source', value: 'REPORT' },   /* 日期和來源要一起成立才可用：模擬時假設來源已知 */
    label: '那次心臟超音波大概是什麼時候做的？', label_cg: '那次心臟超音波大概是什麼時候做的？',
    hint: '太久以前或不知道時間的數字，不拿來判斷現在適合的治療。', consumers: ['freshness_policy.lvef', 'SYS_LVEF_STALE'] },
  { id: 'Q_LVEF_SOURCE', kind: 'choice', field: 'facts.lvef_source', options: 'lvef_source_options', weight: 76,
    depends_on: function (s, ef) { return !!ef.lvefRaw && C.freshness_policy.lvef.usable_when.indexOf(s.facts.lvef_when) >= 0; },
    label: '這個數字是從哪裡知道的？', label_cg: '這個數字是從哪裡知道的？', hint: '', consumers: ['freshness_policy.lvef.source_required'] },
  { id: 'Q_HF_TYPE', kind: 'choice', field: 'facts.hf_type_told', options: 'hf_type_options', weight: 60,
    depends_on: function (s, ef) { return !ef.lvef || ef.currentPhenotype === 'GE50'; },
    label: '醫師有沒有說過是哪一型心衰竭？', label_cg: '醫師有沒有說過病人是哪一型心衰竭？', hint: '', consumers: ['TREATMENT_MAP.profile', 'SYS_LVEF_CONFLICT'] },
  { id: 'Q_EF_IMPROVED', kind: 'choice', field: 'facts.ef_improved', options: 'tri_state', weight: 55,
    depends_on: function (s, ef) { return ef.currentPhenotype === 'GE50'; },
    label: '醫師有沒有說過射出分率比以前進步？', label_cg: '醫師有沒有說過病人的射出分率比以前進步？', hint: '', consumers: ['RULE_EF_IMPROVED', 'TREATMENT_MAP.profile'] },
  { id: 'Q_SYMPTOM_STATUS', kind: 'choice', field: 'facts.symptom_status', options: 'symptom_status_options', weight: 50,
    label: '平常活動的時候，還會不會喘或特別累？', label_cg: '病人平常活動的時候，還會不會喘或特別累？', hint: '', consumers: ['TREATMENT_MAP.amt.symptoms', 'RULE_SUPPORTIVE_TRIGGER', 'RULE_GLP1_ELIGIBLE'] },
  { id: 'Q_REST_DYSPNEA', kind: 'choice', field: 'facts.rest_dyspnea', options: 'rest_dyspnea_options', weight: 49,
    depends_on: function (s) { return s.facts.symptom_status === 'SYMPTOMS'; },
    label: '坐著休息的時候呢？', label_cg: '病人坐著休息的時候呢？', hint: '休息時也會喘，是需要讓醫師知道的訊號。', consumers: ['ADV_HF_REFERRAL'] },
  { id: 'Q_RHYTHM', kind: 'choice', field: 'facts.rhythm', options: 'rhythm_options', weight: 45,
    label: '醫師有說過心律規不規律嗎？', label_cg: '醫師有說過病人的心律規不規律嗎？', hint: '', consumers: ['TREATMENT_MAP.amt.rhythm'] },
  { id: 'Q_HR_VALUE', kind: 'numeric', field: 'facts.hr_value', numeric: 'hr_value', weight: 44,
    unknown: { field: 'facts.hr_band', value: 'UNKNOWN', label: '沒量過或不知道' },
    label: '休息的時候，心跳大概每分鐘幾下？', label_cg: '病人休息的時候，心跳大概每分鐘幾下？', hint: '有量血壓的機器通常會一起顯示心跳。',
    consumers: ['TREATMENT_MAP.amt.hr'], simulate: [60, 80] },
  { id: 'Q_BMI', kind: 'bmi', field: 'facts.bmi_band', weight: 42,
    unknown: { field: 'facts.bmi_band', value: 'UNKNOWN', label: '不知道身高體重' },
    label: '身高和體重大概多少？', label_cg: '病人的身高和體重大概多少？', hint: '只用來算 BMI（身體質量指數），數字不會存下來。',
    consumers: ['TREATMENT_MAP.amt.bmi', 'RULE_GLP1_ELIGIBLE', 'RULE_WEIGHT_FRAILTY'], simulate: ['GE30', 'LT30'] },
  { id: 'Q_TSAT_VALUE', kind: 'numeric', field: 'facts.tsat_value', numeric: 'tsat_value', weight: 41,
    unknown: { field: 'facts.tsat_band', value: 'UNKNOWN', label: '不知道／沒驗過' },
    label: '抽血的「運鐵蛋白飽和度（TSAT）」是多少？', label_cg: '病人抽血的「運鐵蛋白飽和度（TSAT）」是多少？', hint: '這是判斷缺鐵的檢驗，報告上常寫 TSAT 或 Transferrin saturation。',
    consumers: ['TREATMENT_MAP.amt.tsat', 'RULE_IRON_TSAT'], simulate: [12, 30] },
  { id: 'Q_TSAT_WHEN', kind: 'choice', field: 'facts.tsat_when', options: 'lab_when_options', weight: 40,
    depends_on: function (s, ef) { return !!ef.tsatRaw; },
    label: '那次抽血大概是什麼時候？', label_cg: '那次抽血大概是什麼時候？', hint: '太久以前的數值不拿來判斷現在的情況。', consumers: ['freshness_policy.tsat'] },
  { id: 'Q_PREGNANCY', kind: 'choice', field: 'facts.pregnancy_possible', options: 'pregnancy_options', weight: 70,
    label: '有沒有可能懷孕，或正在計畫懷孕？', label_cg: '病人有沒有可能懷孕，或正在計畫懷孕？',
    hint: '有幾種藥懷孕時不能用。沒有回答的話，我不會替您假設「沒有這個可能」。', consumers: ['TREATMENT_MAP.amt.no_pregnancy', 'RULE_PREGNANCY', 'RULE_GLP1_ELIGIBLE'], simulate: ['NO'],
    strict: true   /* 只有「回答了就會讓某個治療從資料不足變成可討論」時才問，不對每個人都問懷孕 */ },
  { id: 'Q_MEDS', kind: 'med_picker', field: 'facts.med_instances', weight: 58,
    label: '藥袋上有看到哪些藥？', label_cg: '病人的藥袋上有看到哪些藥？',
    hint: '可以打字找，也可以依類別找。只選真的看到的；每一顆會再問一下現在還有沒有在吃。',
    consumers: ['TREATMENT_MAP.fmt.status', 'combo_checks', 'hazard_registry', 'rules.classes_any'], simulate: false,
    impact: function (s, ef) { return !ef.instances.length; } },
  { id: 'Q_MED_COMPLETE', kind: 'choice', field: 'facts.med_list_complete', options: 'med_list_complete_options', weight: 74,
    depends_on: function (s, ef) { return ef.instances.length > 0; },
    label: '這樣選完，已經是全部的藥了嗎？', label_cg: '這樣選完，已經是病人全部的藥了嗎？', hint: '包括其他科、診所、自己買的藥。', consumers: ['listComplete', 'MED_INCOMPLETE', 'GAP.MED_LIST'] },
  { id: 'Q_RECON', kind: 'choice', field: 'facts.med_reconciliation', options: 'med_reconciliation_options', weight: 65,
    relevant: function (s, ef) { return ef.instances.length > 0 || ef.discharge === 'YES' || s.facts.med_change_recent === 'YES' || s.primary_concern === 'MEDICATION' || s.primary_concern === 'ADHERENCE'; },
    label: '實際吃的藥，和藥袋／藥單上寫的一樣嗎？', label_cg: '病人實際吃的藥，和藥袋／藥單上寫的一樣嗎？', hint: '', consumers: ['MED_RECON', 'RULE_DISCHARGE_RECON'] },
  { id: 'Q_DISCHARGE', kind: 'choice', field: 'facts.recent_hf_discharge', options: 'tri_state', weight: 52,
    depends_on: function (s) { return s.primary_concern !== 'POST_DISCHARGE'; },
    label: '最近 3 個月內有住院或剛出院嗎？', label_cg: '病人最近 3 個月內有住院或剛出院嗎？', hint: '', consumers: ['transition_card.DISCHARGE', 'TREATMENT_MAP.amt.discharge'] },
  { id: 'Q_DISCHARGE_REASON', kind: 'choice', field: 'facts.discharge_reason', options: 'discharge_reason_options', weight: 61,
    depends_on: function (s, ef) { return ef.discharge === 'YES'; },
    label: '那次住院主要是因為心衰竭嗎？', label_cg: '那次住院主要是因為心衰竭嗎？', hint: '因為心衰竭住院，和因為別的原因住院，後續要注意的事不一樣。', consumers: ['POST_MONITOR', 'hfDischarge'] },
  { id: 'Q_DISCHARGE_WHEN', kind: 'choice', field: 'facts.discharge_when', options: 'discharge_when_options', weight: 60,
    depends_on: function (s, ef) { return ef.discharge === 'YES'; },
    label: '大約多久以前出院的？', label_cg: '大約多久以前出院的？', hint: '', consumers: ['dischargeRecent', 'RULE_REHAB_AFTER_DHF'] },
  { id: 'Q_HF_ADMISSIONS', kind: 'choice', field: 'facts.hf_admission_count', options: 'hf_admission_count_options', weight: 48,
    depends_on: function (s, ef) { return ef.hfDischarge === 'YES'; },
    label: '這一年因為心衰竭住院過幾次？', label_cg: '病人這一年因為心衰竭住院過幾次？', hint: '', consumers: ['ADV_HF_REFERRAL'] },
  { id: 'Q_SELF_MGMT', kind: 'choice', field: 'self_management_readiness', options: 'self_management_readiness_options', weight: 56,
    label: '如果突然變差，您知道下一步要做什麼、找誰嗎？', label_cg: '如果病人突然變差，您知道下一步要做什麼、找誰嗎？', hint: '', consumers: ['SELF_WORSEN_PLAN'], simulate: ['UNSURE'] },
  { id: 'Q_MED_CHANGE', kind: 'choice', field: 'facts.med_change_recent', options: 'tri_state', weight: 47,
    relevant: function (s, ef) { return ef.instances.length > 0 || s.primary_concern === 'MEDICATION' || s.primary_concern === 'SYMPTOM'; },
    label: '最近一個月內有換藥、加量或停掉哪一顆藥嗎？', label_cg: '病人最近一個月內有換藥、加量或停掉哪一顆藥嗎？', hint: '', consumers: ['MED_CHANGE_RECENT', 'SICKDAY_PLAN'] },
  { id: 'Q_OTC', kind: 'choice', field: 'facts.uses_otc', options: 'tri_state', weight: 46,
    label: '有在用自己買的成藥、止痛藥、中草藥或保健品嗎？', label_cg: '病人有在用自己買的成藥、止痛藥、中草藥或保健品嗎？', hint: '', consumers: ['RULE_NSAID', 'RULE_ANTITHROMBOTIC_OTC'] },
  { id: 'Q_COMORB', kind: 'multi', field: 'facts.known_comorbidities', options_branch: 'COMORBIDITY', weight: 35,
    label: '醫師說過您有以下哪些狀況？', label_cg: '醫師說過病人有以下哪些狀況？', hint: '沒勾不代表沒有，只代表這次沒有提供。', consumers: ['rules.comorb_any', 'comorbidity_card'] },
  { id: 'Q_MED_BURDEN', kind: 'choice', field: 'facts.med_burden', options: 'tri_state', weight: 30,
    relevant: function (s, ef) { return ef.instances.length >= 3 || s.primary_concern === 'ADHERENCE'; },
    label: '覺得藥很多、很難管理嗎？', label_cg: '覺得病人的藥很多、很難管理嗎？', hint: '', consumers: ['RULE_POLY_BURDEN'] },
  { id: 'Q_CG_ADL', kind: 'choice', field: 'care_dependency', options: 'care_dependency_options', weight: 43,
    relevant: function (s) { return s.mode === 'CAREGIVER'; },
    label: '平常走路、洗澡或吃藥，需要人幫忙嗎？', label_cg: '病人平常走路、洗澡或吃藥，需要人幫忙嗎？', hint: '需要人幫忙的長輩，跌倒、吃錯藥的風險比較高，照顧方式也不一樣。',
    consumers: ['CO_FRAILTY'], simulate: ['DEPENDENT'] },
  { id: 'Q_CG_STRAIN', kind: 'choice', field: 'caregiver_strain', options: 'caregiver_strain_options', weight: 42,
    relevant: function (s) { return s.mode === 'CAREGIVER'; },
    label: '照顧這件事，最近讓您覺得吃不消嗎？', label_cg: '照顧這件事，最近讓您覺得吃不消嗎？', hint: '照顧的人撐得住，病人才顧得好。吃不消的話，有專線和長照資源可以幫忙。',
    consumers: ['ACC_CARE_SUPPORT'], simulate: ['OFTEN'] },
  { id: 'Q_MOOD', kind: 'choice', field: 'mood_screen', options: 'mood_screen_options', weight: 40,
    label: '最近兩週，常常心情低落，或對事情提不起勁嗎？', label_cg: '最近兩週，病人常常心情低落，或對事情提不起勁嗎？',
    hint: '心情也是照顧心臟的一部分；說出來，醫療團隊才能一起幫忙。', consumers: ['CO_MOOD_COG'], simulate: ['YES'] },
  { id: 'Q_DEVICE', kind: 'choice', field: 'device', options: 'device_options', weight: 30,
    label: '身上有沒有裝心臟的裝置，例如去顫器或心律調節器？', label_cg: '病人身上有沒有裝心臟的裝置，例如去顫器或心律調節器？',
    hint: '有裝置的人，日常有幾件事要特別注意。', consumers: ['WP_DEVICE'], simulate: ['ICD'] },
  { id: 'Q_COST_SKIP', kind: 'choice', field: 'cost_skip', options: 'cost_skip_options', weight: 45,
    relevant: function (s, ef) { return ef.instances.length > 0 || s.primary_concern === 'MEDICATION' || s.primary_concern === 'ADHERENCE' || s.primary_concern === 'ACCESS'; },
    label: '過去一個月，有沒有因為藥費或拿藥困難，少吃或停過藥？', label_cg: '過去一個月，病人有沒有因為藥費或拿藥困難，少吃或停過藥？',
    hint: '很多人都遇過，說出來才能一起找辦法。', consumers: ['ADH_COST_SKIP'], simulate: ['YES'] },
  { id: 'Q_NUTRITION', kind: 'choice', field: 'nutrition_risk', options: 'nutrition_risk_options', weight: 38,
    label: '最近幾個月，有沒有下面這些情況？', label_cg: '最近幾個月，病人有沒有下面這些情況？',
    hint: '選最明顯的一個。營養和力氣也是照顧心臟的一部分。', consumers: ['SYM_APPETITE', 'CO_FRAILTY'], simulate: ['WEIGHT_LOSS', 'WEAKER'] },
  { id: 'Q_LIFE', kind: 'multi', field: 'whole_person', options: 'whole_person_needs', weight: 20,
    label: '除了病，生活上有哪些事想一起談？', label_cg: '除了病，生活上有哪些事想一起談？', hint: '門診常常來不及講。勾起來，會一起整理進資料。', consumers: ['whole_person_card'] }
];
var BY_ID = {}; Q.forEach(function (q) { BY_ID[q.id] = q; });

/* 依這次的主要問題與摘要缺口，調整誰先問（只調順序，不增加題目） */
function boost(q, s, res) {
  var b = 0, p = s.primary_concern, br = s.branch || {};
  var proj = res && res.projection;
  if (proj && proj.blocking_gap && proj.blocking_gap.field_id === 'lvef' && /^Q_LVEF/.test(q.id)) b += 40;
  if (proj && proj.bring_item && q.id === 'Q_MEDS') b += 25;
  if ((p === 'MEDICATION' || p === 'ADHERENCE' || p === 'POST_DISCHARGE') && (q.id === 'Q_MEDS' || q.id === 'Q_MED_COMPLETE')) b += 20;
  if (p === 'COMORBIDITY' && br.comorbidity_focus === 'OBESITY' && (q.id === 'Q_BMI' || /^Q_LVEF/.test(q.id))) b += 30;
  if ((p === 'COMORBIDITY' && br.comorbidity_focus === 'ANEMIA_IRON') || (p === 'SYMPTOM' && br.symptom_focus === 'FATIGUE')) { if (/^Q_TSAT/.test(q.id)) b += 35; }
  if (p === 'UNDERSTAND' && (q.id === 'Q_DX' || /^Q_LVEF/.test(q.id))) b += 10;
  /* 診斷閘門 fail-closed（ESC-P0-01）：治療核對表要等「醫師明確診斷」才出；有用藥或射出分率資料而診斷未答時，先問這一題 */
  var f0 = s.facts || {};
  if (q.id === 'Q_DX' && !f0.diagnosis_status && (p === 'MEDICATION' || f0.lvef_band || f0.lvef_value || (f0.med_instances && f0.med_instances.length))) b += 60;
  if (q.id === 'Q_DX' && !f0.diagnosis_status && p === 'POST_DISCHARGE' && s.mode !== 'CAREGIVER') b += 30;
  /* 依病人選的主題，先問跟這個主題有關的（NBQ-CONCERN-BOOST-01） */
  if (p === 'SELF_CARE' && (q.id === 'Q_SELF_MGMT' || q.id === 'Q_LIFE')) b += 40;
  if (p === 'SELF_CARE' && br.self_care_topic === 'DAILY' && q.id === 'Q_DEVICE') b += 20;
  if (p === 'GOALS' && (q.id === 'Q_SYMPTOM_STATUS' || q.id === 'Q_REST_DYSPNEA' || q.id === 'Q_HF_ADMISSIONS' || q.id === 'Q_LIFE')) b += 30;
  if (p === 'GOALS' && q.id === 'Q_MOOD') b += 25;
  if (p === 'NONE' && (q.id === 'Q_SELF_MGMT' || q.id === 'Q_LIFE')) b += 30;
  if (p === 'NONE' && q.id === 'Q_MOOD') b += 20;
  if (p === 'SYMPTOM' && br.symptom_focus === 'FATIGUE' && q.id === 'Q_MOOD') b += 30;
  if (s.mode === 'CAREGIVER' && (q.id === 'Q_CG_ADL' || q.id === 'Q_CG_STRAIN')) b += (p === 'POST_DISCHARGE' ? 45 : 30);
  if ((p === 'ADHERENCE' || p === 'ACCESS') && q.id === 'Q_COST_SKIP') b += 30;
  if (((p === 'SYMPTOM' && (br.symptom_focus === 'FATIGUE' || br.symptom_focus === 'APPETITE')) || (p === 'COMORBIDITY' && br.comorbidity_focus === 'FRAILTY') || (p === 'SELF_CARE' && br.self_care_topic === 'NUTRITION')) && q.id === 'Q_NUTRITION') b += 35;
  if (s.mode === 'CAREGIVER' && q.id === 'Q_NUTRITION') b += 15;
  return b;
}

function getField(s, path) { var p = path.split('.'); return p.length === 2 ? (s[p[0]] || {})[p[1]] : s[p[0]]; }
function setField(s, path, v) { var p = path.split('.'); if (p.length === 2) s[p[0]][p[1]] = v; else s[p[0]] = v; }
function metaKey(path) { var p = path.split('.'); return p[p.length - 1]; }
function answered(s, q) {
  var v = getField(s, q.field);
  if (v !== null && v !== undefined) return true;
  if ((s.field_meta || {})[metaKey(q.field)]) return true;
  if (q.unknown && getField(s, q.unknown.field) === q.unknown.value) return true;
  if (q.band_fallback) { var bv = getField(s, q.band_fallback.field); if (bv !== null && bv !== undefined) return true; }
  return false;
}
/* 輸出的「指紋」：卡片、治療核對狀態、本次摘要。答案改變指紋，才算真的有用 */
function signature(res, strict) {
  var ids = (res.cards || []).concat(res.supplement_hidden || [], res.med_reference || []).map(function (c) { return c.id; }).sort();
  var map = (res.cards || []).concat(res.supplement_hidden || []).filter(function (c) { return c.id === 'TREATMENT_MAP'; })[0];
  var ms = map && map.map ? [map.map.profile_text, map.map.fmt.map(function (x) { return x.label + x.status; }), (map.map.amt || []).map(function (a) { return a.label; }), (map.map.amt_other || []).map(function (a) { return a.label + a.state + (strict ? '' : a.why); }), map.map.pregnancy] : null;
  var p = res.projection || {};
  return JSON.stringify([res.route, ids, ms, p.primary_issue, p.primary_action, (p.visit_questions || []).map(function (q) { return q.text; }), p.blocking_gap && p.blocking_gap.gap_id, p.bring_item && p.bring_item.gap_id]);
}
function simulateValues(q) {
  if (q.simulate === false) return null;
  if (q.simulate) return q.simulate;
  if (q.kind === 'multi') return (q.options_branch ? C.branches[q.options_branch].options : pairs(q.options)).map(function (o) { return [o[0]]; }).filter(function (v) { return v[0] !== 'NONE_OF_THESE'; });
  return pairs(q.options).map(function (o) { return o[0]; });
}
function withAnswer(s, q, v) {
  var t = clone(s);
  if (q.kind === 'bmi') setField(t, 'facts.bmi_band', v);
  else setField(t, q.field, v);
  t.field_meta = t.field_meta || {}; t.field_meta[metaKey(q.field)] = 'ASKED';
  if (q.joint && (getField(t, q.joint.field) === null || getField(t, q.joint.field) === undefined)) setField(t, q.joint.field, q.joint.value);
  return t;
}
/* 這一題對「現在這個人」會不會改變輸出 */
function changesOutput(s, q, ef, base) {
  if (q.simulate === false) return !!(q.impact && q.impact(s, ef, base));
  var sig0 = signature(base, q.strict);
  var vals = simulateValues(q) || [];
  for (var i = 0; i < vals.length; i++) {
    var r = E.analyze(withAnswer(s, q, vals[i]));
    if (r.status === 'OK' && signature(r, q.strict) !== sig0) return true;
  }
  return false;
}
function candidates(s, skipped, base) {
  skipped = skipped || {};
  base = base || E.analyze(s);
  if (base.status !== 'OK' || base.stop) return [];
  var ef = E.effectiveFacts(s);
  var out = [];
  Q.forEach(function (q, i) {
    if (skipped[q.id] || answered(s, q)) return;
    if (q.depends_on && !q.depends_on(s, ef)) return;
    if (q.relevant && !q.relevant(s, ef)) return;
    if (!changesOutput(s, q, ef, base)) return;
    out.push({ id: q.id, score: q.weight + boost(q, s, base), order: i });
  });
  out.sort(function (a, b) { return (b.score - a.score) || (a.order - b.order); });
  return out;
}
function next(s, skipped, base) { var c = candidates(s, skipped, base); return c.length ? BY_ID[c[0].id] : null; }

/* 寫入答案（UI 與測試共用，確保同一套語意） */
function apply(s, qid, answer) {
  var q = BY_ID[qid]; if (!q) return s;
  s.field_meta = s.field_meta || {};
  s.field_meta[metaKey(q.field)] = 'ASKED';
  if (answer && answer.unknown && q.unknown) { setField(s, q.unknown.field, q.unknown.value); if (q.kind === 'numeric') setField(s, q.field, null); s.field_meta[metaKey(q.unknown.field)] = 'ASKED'; return s; }
  if (answer && answer.band && q.band_fallback) { setField(s, q.band_fallback.field, answer.band); setField(s, q.field, null); s.field_meta[metaKey(q.band_fallback.field)] = 'ASKED'; return s; }
  if (q.kind === 'numeric') {
    var n = Number(answer && answer.value);
    if (E.bandOf(q.numeric, n) === null) return null;           // 不合理的數字：不寫入，由畫面提示
    setField(s, q.field, n);
    var spec = C.numeric_inputs[q.numeric]; setField(s, 'facts.' + spec.band_field, E.bandOf(q.numeric, n));
    return s;
  }
  if (q.kind === 'bmi') { setField(s, 'facts.bmi_band', answer.value); return s; }
  setField(s, q.field, answer.value);
  return s;
}
/* 略過：問過、但不知道（不是「沒有」） */
function skip(s, qid) { var q = BY_ID[qid]; if (!q) return s; s.field_meta = s.field_meta || {}; s.field_meta[metaKey(q.field)] = 'ASKED'; return s; }
function optionsOf(q) { if (q.options_branch) return C.branches[q.options_branch].options; return q.options ? pairs(q.options) : []; }

var API = { REGISTRY: Q, BY_ID: BY_ID, next: next, candidates: candidates, apply: apply, skip: skip, answered: answered,
  signature: signature, changesOutput: changesOutput, optionsOf: optionsOf, withAnswer: withAnswer };
root.HFPC_QUESTIONS = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);

