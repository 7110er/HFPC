/* =====================================================================
 * 心衰竭照護對話｜設定、來源登錄、安全警訊、可選欄位（內容 SSOT 之一）
 * ---------------------------------------------------------------------
 * 寫作原則（全站適用，建置時會檢查）：
 *  1. 先說「現在要做什麼」，再說原因；專有名詞、指引名稱、數值門檻放第二層。
 *  2. 用照護人員對病人說話的語氣：具體、直接、不責怪、不用安慰套語。
 *  3. 不出現系統／模型／規則引擎用語，也不出現分流代碼與優先等級。
 *  4. 不寫固定限水量、體重公斤門檻、固定抽血日期，也不出現自行停藥、加減量的指示。
 *     唯一例外：CONTENT.weight_reference（有來源、明寫「以醫療團隊給的數字為準」，只在「我的照護計畫」出現；建置會檢查）。
 *  5. 每一句臨床敘述都要能追到 sources 內的來源，且角色（DIRECT／SUPPORTIVE）要符合。
 *  6. 照護者語氣（HUMAN_CARE_VOICE，F52）：卡片固定四段——跟您有關的原因（只引用使用者真的填過的）→ 現在怎麼做
 *     → 為什麼 → 什麼情況要馬上處理／找誰。不假裝是真人、不說「已經通知」、不說「放心／一定沒事」、
 *     不用「系統判斷」代替理由（建置時檢查）。
 *  7. 專有名詞第一次出現時，畫面自動加白話解釋（CONTENT.glossary，F46）；卡片第一層文字不超過 150 字（F21）。
 * ===================================================================== */
(function (root) {
'use strict';
var CONTENT = {};

/* ---------- 1. 全域設定 ---------- */
CONTENT.config = {
  app_title: '心衰竭照護對話',
  tagline: '陪您把今天最重要的事整理清楚',
  version: '1.6.0',
  content_updated: '2026-10-17',
  evidence_reviewed: '2026-09-26',
  /* 執行模式：本建置只有公開匿名版（完全不儲存、不傳送）。院內縱向版是另一個建置產物與部署專案，
   * 不以同一包內的開關切換（RUNTIME-BUNDLE-SEPARATION-01），規格見 docs/INSTITUTIONAL_MODE.md */
  runtime_mode: 'PUBLIC_NO_STORAGE',
  runtime_scope: 'PATIENT_EDUCATION_WITH_SAFETY_ROUTING',
  patient_action_boundary: 'NO_AUTONOMOUS_MEDICATION_CHANGE',
  /* 行動負荷上限（人因審核 B07-ACTIONLOAD-01 / B01-PRIORITY-01） */
  max_now_cards: 3,                 // 現在先做：1 主要 + 最多 2 支援（安全卡不受限）
  max_primary_cards: 3,
  max_visible_supplement_cards: 4,
  max_visit_questions_visible: 3,
  max_today_actions: 1,
  max_week_actions: 2,
  /* 資料時效政策見 CONTENT.freshness_policy（依欄位、依用途；是治理預設，不是指引的固定追蹤間隔） */
  /* 本次摘要（帶去看診）的硬性資訊預算：最大值不是最低值，沒有東西就不要補 */
  summary_budget: {
    first_viewport_units: 3,     // route ＋ 最重要的一件 ＋ 今天先做
    total_units: 6,              // 預設展開後的全部訊息單元
    primary_issue: 1,
    primary_action: 1,
    medication_signal: 1,        // 0–1；沒有 actionable signal 就整區不出現
    visit_decisions: 2,          // 0–2；第 3 題必須是另一個獨立高影響主題
    visit_decisions_max: 3,
    blocking_gap: 1,             // 0–1；只有真的卡住本次決定才顯示
    generic_education: 0,        // 第一層固定為 0
    supporting_actions: 2        // 預設收合，不參與第一屏競爭
  },
  /* 院所在地化（選填）：沒填就只顯示職類，不會虛構任何單位或電話 */
  institution_name: '',
  local_contacts: []
};

/* ---------- 1b. 資料狀態（missingness semantics） ----------
 * UNASKED  還沒問過（不是「沒有」）
 * KNOWN    有值
 * UNKNOWN  問過，本人不知道
 * NA       問過，對這位病人不適用
 * DECLINED 問過，選擇不回答
 * 只有 KNOWN 才能驅動個別化適用性判斷；其餘一律 fail-closed。 */
CONTENT.field_states = ['UNASKED', 'KNOWN', 'UNKNOWN', 'NA', 'DECLINED'];
CONTENT.decline_option = ['DECLINED', '不想回答'];
CONTENT.na_option = ['NA', '不適用'];

/* ---------- 1c. 資料時效政策（FRESHNESS-PURPOSE-01） ----------
 * 每一項都由 engine.js 的 usability() 讀取；沒有被讀取的設定不得放在這裡。
 * purpose NARROW_ELIGIBILITY：用來判斷「哪些依條件的治療可以和醫師討論」這種窄範圍適用性。
 * 日期不知道、來源不明、超過期限 → 不驅動 narrow eligibility，但病人填的值仍會顯示並請醫師確認。 */
CONTENT.freshness_policy = {
  lvef: { purpose: 'NARROW_ELIGIBILITY', usable_when: ['WITHIN_6M', 'M6_12'], source_required: ['REPORT', 'TOLD'],
    note: '心臟超音波 12 個月內且知道數字從哪裡來，才用來判斷目前適用的治療；這是本工具的治理預設。' },
  tsat: { purpose: 'NARROW_ELIGIBILITY', usable_when: ['WITHIN_12M'], source_required: null,
    note: '一年內驗過的鐵檢驗才用來判斷；這是本工具的治理預設。' }
};
/* 數值輸入 → 後端分級（病人不用替規則分組） */
CONTENT.numeric_inputs = {
  lvef_value: { unit: '%', min: 5, max: 85, band_field: 'lvef_band',
    bands: [[35, 'LE35'], [40, '36_40'], [44, '41_44'], [49, '45_49'], [100, 'GE50']] },
  hr_value: { unit: '次／分', min: 30, max: 200, band_field: 'hr_band', bands: [[69, 'LT70'], [300, 'GE70']] },
  tsat_value: { unit: '%', min: 1, max: 100, band_field: 'tsat_band', bands: [[19.999, 'LT20'], [100, 'GE20']] }
};

/* ---------- 2. 職類與責任層級 ---------- */
/* tier: PRIMARY 主要負責｜SUPPORT 協助｜ESCALATE 升級管道 */
CONTENT.roles = {
  EMS: { label: '119 救護', tier: 'ESCALATE' },
  ED: { label: '急診', tier: 'ESCALATE' },
  DOCTOR: { label: '您的心臟科或原開藥醫師', tier: 'PRIMARY' },
  HF_TEAM: { label: '心衰竭個管師或門診護理師（若院所有）', tier: 'PRIMARY' },
  PHARMACIST: { label: '藥師（醫院藥物諮詢或住家附近健保藥局）', tier: 'PRIMARY' },
  NURSE: { label: '護理師', tier: 'SUPPORT' },
  DIETITIAN: { label: '營養師', tier: 'SUPPORT' },
  REHAB: { label: '心臟復健或復健團隊', tier: 'SUPPORT' },
  SOCIAL: { label: '醫院社工師', tier: 'SUPPORT' },
  PALLIATIVE: { label: '安寧緩和照護團隊', tier: 'SUPPORT' },
  MENTAL: { label: '身心科或心理師', tier: 'SUPPORT' },
  OBGYN: { label: '婦產科醫師', tier: 'SUPPORT' },
  LTC_1966: { label: '1966 長照服務專線', tier: 'SUPPORT' },
  CAREGIVER_LINE: { label: '家庭照顧者關懷專線 0800-507272', tier: 'SUPPORT' },
  MENTAL_1925: { label: '1925 安心專線（24 小時）', tier: 'ESCALATE' }
};

/* ---------- 3. 來源登錄 ----------
 * allowed_roles：此來源可在病人卡片擔任的角色；runtime:false 只供治理，不得出現在病人端。
 * verification：本 session 查證狀態。標【未經查證】者代表無法逐字複核全文。 */
var V_SEC = 'AI 建置時以官方新聞稿或多個二手摘要交叉確認';
var V_AUD = '依使用者提供的 2026 ESC 全文審核納入；AI 建置時無法開啟全文逐字複核【未經查證】';
var V_PAGE = 'AI 建置時實際開啟該頁面確認';
CONTENT.sources = {
  TW_NFA_119: { title: '119、112 緊急電話說明', org: '內政部消防署', year: 2026, url: 'https://www.nfa.gov.tw/cht/index.php?code=list&flag=detail&ids=66&article_id=795', type: 'OFFICIAL_PUBLIC_SAFETY', jurisdiction: 'TW', source_scope: 'EMERGENCY_ACCESS', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-25', verification: 'AI 建置時實際開啟該頁面確認：119 用於緊急救護；112 在收訊不佳時使用，無 SIM 卡、只要任何一家業者有訊號即可撥打，經語音選單按 9 轉接 119', rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  MOHW_STROKE_2022: { title: '識別腦中風：微笑、舉手、說你好', org: '衛生福利部國民健康署', year: 2022, url: 'https://www.mohw.gov.tw/cp-5273-72139-1.html', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'TW', source_scope: 'STROKE_RECOGNITION', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  NHS_HF: { title: 'Heart failure：症狀與何時求助', org: 'NHS', year: 2026, url: 'https://www.nhs.uk/conditions/heart-failure/', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'UK', source_scope: 'SYMPTOM_ESCALATION', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, note: 'NHS 把粉紅泡沫痰列為緊急（urgent）；講不出話的喘、嘴唇發紫（發紺）、昏倒列為撥 999。本工具依臨床審查決定，把粉紅泡沫痰提高為當天就要當面評估。', rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  MAYO_PULMONARY_EDEMA: { title: 'Pulmonary edema：症狀與原因', org: 'Mayo Clinic', year: 2026, url: 'https://www.mayoclinic.org/diseases-conditions/pulmonary-edema/symptoms-causes/syc-20377009', type: 'ACADEMIC_PATIENT_GUIDANCE', jurisdiction: 'US', source_scope: 'SYMPTOM_ESCALATION', allowed_roles: ['SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  NHS_APIXABAN_SE: { title: 'Side effects of apixaban：出血警訊', org: 'NHS', year: 2026, url: 'https://www.nhs.uk/medicines/apixaban/side-effects-of-apixaban/', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'UK', source_scope: 'ANTICOAGULANT_BLEEDING', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  NHS_RAMIPRIL_SE: { title: 'Side effects of ramipril：臉、嘴唇、舌頭腫脹', org: 'NHS', year: 2026, url: 'https://www.nhs.uk/medicines/ramipril/side-effects-of-ramipril/', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'UK', source_scope: 'ANGIOEDEMA', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  MEDLINEPLUS_ICD: { title: '植入式去顫器：出院後注意事項', org: 'MedlinePlus（美國國家醫學圖書館）', year: 2026, url: 'https://medlineplus.gov/ency/patientinstructions/000108.htm', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'US', source_scope: 'ICD_SHOCK', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'PUBLIC_DOMAIN_US_GOV', patient_language: true },
  ESC_HF_2026: { title: '2026 ESC 心衰竭治療指引', org: 'European Society of Cardiology', year: 2026, url: 'https://doi.org/10.1093/eurheartj/ehag100', type: 'GUIDELINE', jurisdiction: 'EU_GLOBAL', source_scope: 'TREATMENT_AND_CARE_GUIDELINE', allowed_roles: ['DIRECT', 'SUPPORTIVE'], version: '2026', publication_status: 'ADVANCE_ARTICLE_2026-08', supersession: '取代 ESC 2021 與 2023 focused update 的現行分類；歷史研究族群仍用原分類', runtime: true, last_verified: '2026-09-23', verification: '分類（<50%／≥50%）、FMT/AMT/GDIT、MRA 不論 LVEF Class I、semaglutide/tirzepatide 於保留型 EF＋肥胖 IIa、穩定病人個別化運動 I B1：' + V_SEC + '。其餘細節（GLP-1 精確門檻、TSAT<20%、限水、NSAID III B2、EF 改善續用、各藥 EF 條件）：' + V_AUD, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  ESC_CR_2026: { title: '2026 ESC 心臟復健指引', org: 'European Society of Cardiology', year: 2026, url: 'https://doi.org/10.1093/eurheartj/ehag099', type: 'GUIDELINE', jurisdiction: 'EU_GLOBAL', source_scope: 'CARDIAC_REHABILITATION', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-23', verification: 'AI 建置時確認為 2026 首部 ESC 心臟復健指引、涵蓋 Phase II 復健之適應症與核心要素；逐條建議【未經查證】', rights: 'LINK_AND_PARAPHRASE_ONLY' },
  ESC_CKD_2026: { title: '2026 ESC 心血管疾病與慢性腎臟病指引', org: 'European Society of Cardiology／European Renal Association', year: 2026, url: 'https://doi.org/10.1093/eurheartj/ehag098', type: 'GUIDELINE', jurisdiction: 'EU_GLOBAL', source_scope: 'CARDIORENAL', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-23', verification: 'AI 建置時確認存在並建議心臟病人篩檢腎臟病；逐條建議【未經查證】', rights: 'LINK_AND_PARAPHRASE_ONLY' },
  ACC_HOSP_HF_2024: { title: '2024 ACC 住院心衰竭病人處置共識（focused update）', org: 'American College of Cardiology', year: 2024, url: 'https://doi.org/10.1016/j.jacc.2024.06.002', type: 'EXPERT_CONSENSUS', jurisdiction: 'US', source_scope: 'HOSPITALIZATION_AND_TRANSITION', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-23', verification: 'AI 建置時確認文獻存在（JACC 2024）；出院交接逐條內容【未經查證】', rights: 'LINK_AND_PARAPHRASE_ONLY' },
  AHA_HF_2022: { title: '2022 AHA/ACC/HFSA 心衰竭處置指引', org: 'AHA/ACC/HFSA', year: 2022, url: 'https://doi.org/10.1161/CIR.0000000000001063', type: 'GUIDELINE', jurisdiction: 'US_GLOBAL', source_scope: 'TREATMENT_AND_CARE_GUIDELINE', allowed_roles: ['DIRECT', 'SUPPORTIVE'], supersession: '藥物路徑部分由 2024 ACC HFrEF 與 2026 ACC HFpEF 共識更新', runtime: true, last_verified: '2026-09-22', verification: V_SEC, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  UDHF_2026: { title: '心衰竭第二版全球共同定義（2026）', org: 'AHA/ACC/ESC/WHF', year: 2026, url: 'https://doi.org/10.1161/CIR.0000000000001455', type: 'EXPERT_CONSENSUS', jurisdiction: 'GLOBAL', source_scope: 'DEFINITION_AND_TRAJECTORY_ONLY', allowed_roles: ['SUPPORTIVE'], consumer_allowlist: ['DEFINITION', 'TRAJECTORY_CONCEPT'], runtime: true, last_verified: '2026-09-22', verification: V_SEC, note: '文件說明本身不是治療指引；只能用來支持定義與病程說明。', rights: 'LINK_AND_PARAPHRASE_ONLY' },
  ACC_HFREF_2024: { title: '2024 ACC 射出分率降低型心衰竭治療共識', org: 'American College of Cardiology', year: 2024, url: 'https://doi.org/10.1016/j.jacc.2023.12.024', type: 'EXPERT_CONSENSUS', jurisdiction: 'US', source_scope: 'HFrEF_TREATMENT_PATHWAY', phenotype_scope: 'HFrEF（ACC 定義 LVEF≤40%）', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_SEC, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  ACC_HFPEF_2026: { title: '2026 ACC 射出分率保留型心衰竭處置共識', org: 'American College of Cardiology', year: 2026, url: 'https://doi.org/10.1016/j.jacc.2026.06.018', type: 'EXPERT_CONSENSUS', jurisdiction: 'US', source_scope: 'HFpEF_TREATMENT_PATHWAY', allowed_roles: ['DIRECT', 'SUPPORTIVE'], publication_status: 'PUBLISHED_ONLINE_2026-07', runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  TSOC_CHF_2023: { title: '2023 台灣心臟學會慢性心衰竭藥物治療共識', org: '台灣心臟學會', year: 2023, url: 'https://doi.org/10.6515/ACS.202305_39(3).20230301A', type: 'TAIWAN_CONSENSUS', jurisdiction: 'TW', source_scope: 'TAIWAN_TREATMENT_CONTEXT', allowed_roles: ['SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_SEC, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  TSOC_HFPEF_2024: { title: '2024 台灣心臟學會 HFpEF 指引', org: '台灣心臟學會', year: 2024, url: 'https://doi.org/10.6515/ACS.202403_40(2).20240206A', type: 'TAIWAN_GUIDELINE', jurisdiction: 'TW', source_scope: 'TAIWAN_TREATMENT_CONTEXT', allowed_roles: ['SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_SEC, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  HFA_POLY_2025: { title: '心衰竭多重用藥處理共識（HFA/ESC）', org: 'Heart Failure Association of the ESC', year: 2025, url: 'https://doi.org/10.1002/ejhf.3642', type: 'CONSENSUS_STATEMENT', jurisdiction: 'EU_GLOBAL', source_scope: 'POLYPHARMACY_MEDICATION_REVIEW', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  HFA_ADHERENCE_2025: { title: '心衰竭治療遵從性科學聲明（HFA/ESC）', org: 'Heart Failure Association of the ESC', year: 2025, url: 'https://doi.org/10.1002/ejhf.70090', type: 'SCIENTIFIC_STATEMENT', jurisdiction: 'EU_GLOBAL', source_scope: 'ADHERENCE', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  HFA_SODIUM_FLUID_2024: { title: '心衰竭鈉與水分攝取共識（HFA/ESC）', org: 'Heart Failure Association of the ESC', year: 2024, url: 'https://doi.org/10.1002/ejhf.3244', type: 'CONSENSUS_STATEMENT', jurisdiction: 'EU_GLOBAL', source_scope: 'SODIUM_FLUID', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_SEC, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  FRESH_UP_2025: { title: 'FRESH-UP：慢性心衰竭自由飲水與限水的隨機試驗', org: 'Nature Medicine', year: 2025, url: 'https://doi.org/10.1038/s41591-025-03628-4', type: 'RANDOMIZED_TRIAL', jurisdiction: 'NL', population: 'NYHA II–III 穩定門診；排除 3 個月內住院、GFR<30、低血鈉', outcome_domain: 'KCCQ 健康狀態（主要結果未達顯著）', allowed_roles: ['SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  AHA_DRUGS_HF_2016: { title: '可能造成或加重心衰竭的藥物（AHA 科學聲明）', org: 'American Heart Association', year: 2016, url: 'https://doi.org/10.1161/CIR.0000000000000426', type: 'SCIENTIFIC_STATEMENT', jurisdiction: 'US_GLOBAL', source_scope: 'DRUG_DISEASE_INTERACTION', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_SEC, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  ESC_AF_2024: { title: '2024 ESC 心房顫動指引', org: 'European Society of Cardiology', year: 2024, url: 'https://doi.org/10.1093/eurheartj/ehae176', type: 'GUIDELINE', jurisdiction: 'EU_GLOBAL', source_scope: 'AF_ANTICOAGULATION_RHYTHM', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  ESC_ACS_2023: { title: '2023 ESC 急性冠心症指引', org: 'European Society of Cardiology', year: 2023, url: 'https://doi.org/10.1093/eurheartj/ehad191', type: 'GUIDELINE', jurisdiction: 'EU_GLOBAL', source_scope: 'ANTIPLATELET_AFTER_ACS_PCI', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  KDIGO_DM_CKD_2022: { title: 'KDIGO 2022 慢性腎臟病糖尿病處置指引', org: 'KDIGO', year: 2022, url: 'https://www.kidney-international.org/article/S0085-2538(22)00507-5/fulltext', type: 'GUIDELINE', jurisdiction: 'GLOBAL', source_scope: 'SGLT2I_SICK_DAY_CKD_DM', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  AHA_PALLIATIVE_2025: { title: '成人心血管疾病的緩和照護（AHA 科學聲明）', org: 'American Heart Association', year: 2025, url: 'https://doi.org/10.1161/CIR.0000000000001323', type: 'SCIENTIFIC_STATEMENT', jurisdiction: 'US_GLOBAL', source_scope: 'PALLIATIVE_SDM_CAREGIVER', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_SEC, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  AHRQ_TEACHBACK: { title: 'Teach-Back 衛教確認法（AHRQ 工具包 Tool 5）', org: 'AHRQ', year: 2024, url: 'https://www.ahrq.gov/health-literacy/improve/precautions/tool5.html', type: 'OFFICIAL_TOOLKIT', jurisdiction: 'US', source_scope: 'HEALTH_LITERACY', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'PUBLIC_DOMAIN_US_GOV', patient_language: true },
  JAMA_PHARM_2024: { title: '藥師主導照護模式與用藥遵從性隨機試驗', org: 'JAMA Network Open', year: 2024, url: 'https://doi.org/10.1001/jamanetworkopen.2024.53976', type: 'RANDOMIZED_TRIAL', jurisdiction: 'CN', outcome_domain: '用藥遵從（PDC）；硬臨床結局未顯著', allowed_roles: ['SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  ZHENG_META_2023: { title: '藥師與護理主導之心衰竭治療優化統合分析', org: 'Journal of Cardiac Failure', year: 2023, url: 'https://doi.org/10.1016/j.cardfail.2023.03.012', type: 'SYSTEMATIC_REVIEW_META_ANALYSIS', jurisdiction: 'GLOBAL', outcome_domain: '治療啟動與調整；死亡／住院信賴區間跨 1', allowed_roles: ['SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  POCKET_COST_HF_2025: { title: 'POCKET-COST-HF：費用資訊與醫病討論試驗', org: 'Circulation: Cardiovascular Quality and Outcomes', year: 2025, url: 'https://doi.org/10.1161/CIRCOUTCOMES.124.011273', type: 'CLUSTER_RANDOMIZED_TRIAL', jurisdiction: 'US', outcome_domain: '費用討論次數（過程指標）', allowed_roles: ['SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'LINK_AND_PARAPHRASE_ONLY' },
  NHI_HEALTHBANK: { title: '健康存摺：查詢就醫、用藥與檢驗紀錄', org: '衛生福利部中央健康保險署', year: 2026, url: 'https://www.nhi.gov.tw/ch/np-2704-1.html', type: 'OFFICIAL_TW_SERVICE', jurisdiction: 'TW', source_scope: 'MEDICATION_RECORD_ACCESS', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  NHI_CHRONIC_RX: { title: '慢性病連續處方箋規定', org: '衛生福利部中央健康保險署', year: 2026, url: 'https://www.nhi.gov.tw/ch/cp-6315-ac37b-3255-1.html', type: 'OFFICIAL_TW_REGULATION', jurisdiction: 'TW', source_scope: 'MEDICATION_ACCESS', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  MOHW_1966: { title: '1966 長照服務專線', org: '衛生福利部', year: 2026, url: 'https://1966.gov.tw/', type: 'OFFICIAL_TW_SERVICE', jurisdiction: 'TW', source_scope: 'LONG_TERM_CARE_ACCESS', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  MOHW_CAREGIVER_LINE: { title: '家庭照顧者關懷專線 0800-507272', org: '衛生福利部', year: 2024, url: 'https://www.mohw.gov.tw/cp-16-79309-1.html', type: 'OFFICIAL_TW_SERVICE', jurisdiction: 'TW', source_scope: 'CAREGIVER_SUPPORT', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  MOHW_1925: { title: '1925 安心專線（24 小時免付費）', org: '衛生福利部', year: 2026, url: 'https://dep.mohw.gov.tw/DOMHAOH/cp-4906-54077-107.html', type: 'OFFICIAL_TW_SERVICE', jurisdiction: 'TW', source_scope: 'MENTAL_HEALTH_SUPPORT', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_SEC, rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  TW_PATIENT_AUTONOMY_ACT: { title: '病人自主權利法（預立醫療照護諮商）', org: '全國法規資料庫', year: 2019, url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=L0020189', type: 'TW_LAW', jurisdiction: 'TW', source_scope: 'ADVANCE_CARE_PLANNING', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_SEC, rights: 'PUBLIC_LAW_TW' },
  TW_CDC: { title: '衛生福利部疾病管制署（當期疫苗資訊）', org: '衛生福利部疾病管制署', year: 2026, url: 'https://www.cdc.gov.tw/', type: 'OFFICIAL_TW_PUBLIC_HEALTH', jurisdiction: 'TW', source_scope: 'VACCINATION_ELIGIBILITY', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_SEC, rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  FDA_LABEL_SEMAGLUTIDE: { title: 'WEGOVY（semaglutide）美國 FDA 仿單 §8.1 Pregnancy', org: 'Novo Nordisk／美國 FDA（DailyMed）', year: 2026, url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ee06186f-2aa3-4990-a760-757579d8f77b', type: 'OFFICIAL_DRUG_LABEL', jurisdiction: 'US', source_scope: 'DRUG_PREGNANCY', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-28', verification: '建置時開啟官方仿單頁面確認懷孕相關條文（AI 讀取；逐字全文核對待藥師登錄）【未經查證】：§8.1 用於減重者發現懷孕時停用；§8.3 用於降低心血管風險或減重者，計畫懷孕至少 2 個月前停用（半衰期長；仿單修訂 2026-06）', note: '台灣仿單（TFDA）條文可能不同，以開藥醫師依台灣仿單為準', rights: 'LINK_AND_PARAPHRASE_ONLY' },
  FDA_LABEL_TIRZEPATIDE: { title: 'ZEPBOUND（tirzepatide）美國 FDA 仿單 §8.1 Pregnancy、§8.3', org: 'Eli Lilly／美國 FDA', year: 2026, url: 'https://pi.lilly.com/us/zepbound-uspi.pdf', type: 'OFFICIAL_DRUG_LABEL', jurisdiction: 'US', source_scope: 'DRUG_PREGNANCY', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-28', verification: '建置時開啟官方仿單頁面確認懷孕相關條文（AI 讀取；逐字全文核對待藥師登錄）【未經查證】：§8.1 發現懷孕時停用（未規定孕前停藥期）；§8.3 使用口服避孕藥者，開始用藥及每次加量後 4 週內改用非口服避孕或加上屏障法（仿單修訂 2026-08）', note: '台灣仿單（TFDA）條文可能不同，以開藥醫師依台灣仿單為準', rights: 'LINK_AND_PARAPHRASE_ONLY' },
  FDA_LABEL_WARFARIN: { title: 'Warfarin sodium 美國 FDA 仿單 §4 Contraindications、§8.1 Pregnancy', org: 'Amneal Pharmaceuticals／美國 FDA（DailyMed）', year: 2022, url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=541c9a70-adaf-4ef3-94ba-ad4e70dfa057', type: 'OFFICIAL_DRUG_LABEL', jurisdiction: 'US', source_scope: 'DRUG_PREGNANCY', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-28', verification: '建置時開啟官方仿單頁面確認懷孕相關條文（AI 讀取；逐字全文核對待藥師登錄）【未經查證】：§4 懷孕禁用，但裝有機械瓣膜、血栓風險高的孕婦例外', note: '台灣仿單（TFDA）條文可能不同，以開藥醫師依台灣仿單為準', rights: 'LINK_AND_PARAPHRASE_ONLY' },
  CFS_HK_KCL_SALT: { title: '鉀鹽作為食鹽代替品的角色', org: '香港食物安全中心', year: 2024, url: 'https://www.cfs.gov.hk/tc_chi/multimedia/multimedia_pub/multimedia_pub_fsf_213_03.html', type: 'OFFICIAL_FOOD_SAFETY', jurisdiction: 'HK', source_scope: 'POTASSIUM_SALT_SUBSTITUTE', allowed_roles: ['SUPPORTIVE'], runtime: true, last_verified: '2026-09-22', verification: V_PAGE, rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },

  /* ---- 2026-09-26 再審新增：本 session 實際開啟頁面確認 ---- */
  HFA_WEIGHT: { title: 'Weight gain in heart failure：什麼時候是警訊', org: '歐洲心臟學會心衰竭協會（HFA/ESC）病人網站 heartfailurematters.org', year: 2026, url: 'https://www.heartfailurematters.org/understanding-heart-failure/weight-gain/', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'EU_GLOBAL', source_scope: 'WEIGHT_MONITORING', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：「3 天內體重增加超過 2 公斤，要告訴醫師」', rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  MEDLINEPLUS_HF_HOME: { title: '心衰竭：水分、利尿劑與每天量體重', org: 'MedlinePlus（美國國家醫學圖書館）', year: 2026, url: 'https://medlineplus.gov/ency/patientinstructions/000112.htm', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'US', source_scope: 'HOME_MONITORING', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：每天早上起床、上完廁所、吃東西前用同一台秤量；心跳很快、很慢或不規則要聯絡醫療人員', rights: 'PUBLIC_DOMAIN_US_GOV', patient_language: true },
  NHS_CONFUSION: { title: 'Confusion：突然變糊塗要立即就醫', org: 'NHS', year: 2026, url: 'https://www.nhs.uk/symptoms/confusion/', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'UK', source_scope: 'ACUTE_CONFUSION', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：someone suddenly becomes confused → 999 或急診', rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  NHS_HEAD_INJURY: { title: 'Head injury：吃抗凝血藥的人撞到頭要去急診', org: 'NHS', year: 2026, url: 'https://www.nhs.uk/conditions/head-injury-and-concussion/', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'UK', source_scope: 'HEAD_INJURY_ANTICOAGULANT', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：頭部受傷且吃會讓血變稀的藥 → 急診；叫不醒、抽搐 → 999', rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  NHI_HOSPICE: { title: '安寧療護：收案疾病與照護方式', org: '衛生福利部中央健康保險署', year: 2026, url: 'https://www.nhi.gov.tw/ch/cp-7805-59024-3255-1.html', type: 'OFFICIAL_TW_SERVICE', jurisdiction: 'TW', source_scope: 'PALLIATIVE_ACCESS', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：非癌症收案含「心臟衰竭」；照護方式有安寧住院、安寧居家、安寧共同照護', rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  MOHW_ACP: { title: '病人自主權利法配套：預立醫療照護諮商與健保卡註記', org: '衛生福利部', year: 2018, url: 'https://www.mohw.gov.tw/cp-16-44221-1.html', type: 'OFFICIAL_TW_SERVICE', jurisdiction: 'TW', source_scope: 'ADVANCE_CARE_PLANNING', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：經預立醫療照護諮商立下書面預立醫療決定，並上傳健保卡註記；諮商費用由醫療機構公告', rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  TW_HOSPICE_FOUNDATION_ACP: { title: '病人自主權利法重點（諮商參與者、預立醫療決定要件）', org: '財團法人中華民國安寧照顧基金會', year: 2026, url: 'https://www.hospice.org.tw/care/law', type: 'NONPROFIT_PATIENT_GUIDANCE', jurisdiction: 'TW', source_scope: 'ADVANCE_CARE_PLANNING', allowed_roles: ['SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：諮商由本人、二親等內親屬至少一人、醫療委任代理人參與；預立醫療決定需諮商核章、公證或二人見證、健保卡註記', rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  HPA_SODIUM: { title: '減鹽秘笈手冊：成人每日鈉攝取建議', org: '衛生福利部國民健康署', year: 2020, url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=1161&pid=6648', type: 'OFFICIAL_TW_PUBLIC_HEALTH', jurisdiction: 'TW', source_scope: 'GENERAL_ADULT_SODIUM', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：「成人每日鈉總攝取量不要超過 2400 毫克（即食鹽 6 公克）」；對象是一般成人，不是心衰竭的治療目標', rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  TW_CDC_ZOSTER: { title: '帶狀疱疹疫苗（接種建議）', org: '衛生福利部疾病管制署', year: 2023, url: 'https://www.cdc.gov.tw/Category/Page/WzNj0ONng_AdPtlJc4XDhA', type: 'OFFICIAL_TW_PUBLIC_HEALTH', jurisdiction: 'TW', source_scope: 'ADULT_ZOSTER_VACCINE', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：50 歲以上成人、18 歲以上免疫不全或免疫功能低下者，建議接種 2 劑非活性基因重組疫苗，間隔 2–6 個月（頁面更新 2023-06-14）；屬成人預防保健，不是心衰竭專屬建議', rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  MOHW_BETEL: { title: '檳榔是一級致癌物：拒檳三招', org: '衛生福利部', year: 2021, url: 'https://www.mohw.gov.tw/cp-5014-58752-1.html', type: 'OFFICIAL_TW_PUBLIC_HEALTH', jurisdiction: 'TW', source_scope: 'BETEL_NUT', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：「檳榔子」是第一類致癌物，即使不加添加物也會致癌', rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },
  HFA_EXERCISE: { title: 'Activity and exercise with heart failure', org: '歐洲心臟學會心衰竭協會（HFA/ESC）病人網站 heartfailurematters.org', year: 2026, url: 'https://www.heartfailurematters.org/what-you-can-do/activity-and-exercise/', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'EU_GLOBAL', source_scope: 'EXERCISE', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：開始或改變運動前先和醫師或護理師談；運動時還能說話（說不出話就是太用力）；從每天走路開始、慢慢增加；喘、頭暈、胸痛、噁心、冒冷汗立刻停；可詢問心臟復健', rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  HFA_FLUIDS: { title: 'Managing fluids in heart failure', org: '歐洲心臟學會心衰竭協會（HFA/ESC）病人網站 heartfailurematters.org', year: 2026, url: 'https://www.heartfailurematters.org/what-you-can-do/adjusting-your-diet-fluids/', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'EU_GLOBAL', source_scope: 'SODIUM_FLUID', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：控制喝水量「可能對部分病人重要」，每天喝多少由醫師或護理師個別建議；很熱、發燒或腹瀉時需要的水分會增加', rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  HFA_INFECTION: { title: 'Infections and heart failure', org: '歐洲心臟學會心衰竭協會（HFA/ESC）病人網站 heartfailurematters.org', year: 2026, url: 'https://www.heartfailurematters.org/heart-failure-causes-and-other-common-medical-conditions/infection/', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'EU_GLOBAL', source_scope: 'INFECTION_SICK_DAY', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：感染（尤其細菌）造成發燒，可能讓心衰竭變差、常需住院；肺炎最常見，會讓喘更嚴重', rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  NIDIRECT_AKI: { title: 'Acute kidney injury (AKI)', org: 'nidirect（北愛爾蘭政府公共服務網站）', year: 2026, url: 'https://www.nidirect.gov.uk/conditions/acute-kidney-injury-aki', type: 'OFFICIAL_PATIENT_GUIDANCE', jurisdiction: 'UK', source_scope: 'KIDNEY_SAFETY_URINE', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：急性腎損傷表現包括尿量減少；脫水、嚴重嘔吐或腹瀉、心衰竭、利尿劑、ACE 抑制劑、消炎止痛藥都會增加風險；嘔吐或尿很少是警訊，要儘早就醫檢查', rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  CLEVELAND_CACHEXIA: { title: 'Cardiac cachexia：心衰竭的體重與肌肉流失', org: 'Cleveland Clinic', year: 2026, url: 'https://my.clevelandclinic.org/health/diseases/24770-cardiac-cachexia', type: 'ACADEMIC_PATIENT_GUIDANCE', jurisdiction: 'US', source_scope: 'NUTRITION_CACHEXIA', allowed_roles: ['SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：一年內沒有刻意卻瘦很多、肌肉無力、食慾差；少量多餐、較軟的食物；蛋白質補充由醫療團隊開立；運動與心臟復健；和營養師合作', rights: 'LINK_AND_PARAPHRASE_ONLY', patient_language: true },
  MOHW_QUITLINE: { title: '免費戒菸專線 0800-636363', org: '衛生福利部', year: 2026, url: 'https://www.mohw.gov.tw/cp-3160-24864-1.html', type: 'OFFICIAL_TW_SERVICE', jurisdiction: 'TW', source_scope: 'SMOKING_CESSATION', allowed_roles: ['DIRECT', 'SUPPORTIVE'], runtime: true, last_verified: '2026-09-26', verification: V_PAGE + '：免付費、諮商完全免費', rights: 'PUBLIC_OFFICIAL_LINK_AND_PARAPHRASE', patient_language: true },

  /* 僅供設計與治理，不得出現在病人卡片 */
  TURGEON_SDM_2024: { title: '心衰竭藥物決策需求質性研究', org: 'Circulation: Heart Failure', year: 2024, url: 'https://doi.org/10.1161/CIRCHEARTFAILURE.123.011445', type: 'QUALITATIVE_STUDY', allowed_roles: ['DESIGN_ONLY'], runtime: false, verification: V_PAGE },
  AHRQ_HL_UP: { title: 'Health Literacy Universal Precautions Toolkit', org: 'AHRQ', year: 2024, url: 'https://www.ahrq.gov/health-literacy/improve/precautions/toolkit.html', type: 'IMPLEMENTATION_TOOLKIT', allowed_roles: ['DESIGN_ONLY'], runtime: false, verification: V_PAGE },
  CDC_CCI: { title: 'CDC Clear Communication Index', org: 'US CDC', year: 2024, url: 'https://www.cdc.gov/ccindex/', type: 'COMMUNICATION_STANDARD', allowed_roles: ['DESIGN_ONLY'], runtime: false, verification: '設計標準用途；AI 建置時未逐項開啟頁面【未經查證】' },
  ONYEBEKE_2024: { title: '住院心衰竭病人多重用藥與治療啟動', org: 'JACC Advances', year: 2024, url: 'https://doi.org/10.1016/j.jacadv.2024.101126', type: 'OBSERVATIONAL_COHORT', allowed_roles: ['BACKGROUND'], runtime: false, verification: V_PAGE },
  SUKUMAR_2022: { title: '高齡心衰竭病人的多重用藥', org: 'Current Heart Failure Reports', year: 2022, url: 'https://doi.org/10.1007/s11897-022-00559-w', type: 'NARRATIVE_REVIEW', allowed_roles: ['BACKGROUND'], runtime: false, verification: V_PAGE },
  KERAMIDA_POLYPILL_2025: { title: '心衰竭複方單錠（polypill）回顧', org: 'Heart Failure Reviews', year: 2025, url: 'https://doi.org/10.1007/s10741-025-10559-2', type: 'NARRATIVE_REVIEW_PROPOSAL', allowed_roles: ['BACKGROUND'], runtime: false, verification: V_PAGE },
  CHIEN_APPLE_HF_2025: { title: 'APPLE-HF 藥師主導計畫（研究計畫書）', org: 'Patient Preference and Adherence', year: 2025, url: 'https://doi.org/10.2147/PPA.S527419', type: 'STUDY_PROTOCOL', allowed_roles: ['DESIGN_ONLY'], runtime: false, verification: V_PAGE },
  ZHONG_2025: { title: '高齡心衰竭多重用藥與不良結果世代研究', org: 'BMC Geriatrics', year: 2025, url: 'https://doi.org/10.1186/s12877-025-06948-9', type: 'RETROSPECTIVE_COHORT', allowed_roles: ['BACKGROUND'], runtime: false, verification: V_PAGE }
};

/* ---------- 3b. 使用權治理（EVID-RIGHTS-01 / V100-P0-RIGHTS-01） ----------
 * rights（舊欄位）只是內部描述「只連結與改寫」，不等於軟體使用授權。
 * 正式欄位：rights_owner／reuse_type／software_use_rights／license_required／license_status／
 *           license_ref／production_allowed／last_rights_reviewed_at／reviewed_by
 * 規則：
 *  - 政府公開資訊（台灣官方、美國聯邦政府公有領域）→ 可連結改寫，production_allowed=true。
 *  - ESC 指引：ESC 官方聲明納入軟體、演算法需正式授權 → LICENSE_REQUIRED／NOT_CONFIRMED，production_allowed=false。
 *  - 其他期刊或學會文件：本次未審閱其軟體使用條款 → NOT_REVIEWED，production_allowed=false。
 *  PRODUCTION 建置時，任何 runtime 來源 production_allowed !== true 一律建置失敗（tools/build.py）。 */
var RIGHTS_REVIEWED_AT = '2026-09-25';
Object.keys(CONTENT.sources).forEach(function (id) {
  var s = CONTENT.sources[id];
  var gov = /^PUBLIC_OFFICIAL|^PUBLIC_DOMAIN_US_GOV|^PUBLIC_LAW_TW/.test(s.rights || '');
  var esc = /European Society of Cardiology/.test(s.org || '') && s.type === 'GUIDELINE';
  s.rights_owner = s.rights_owner || s.org;
  s.reuse_type = s.runtime ? 'SOFTWARE_ALGORITHM_AND_PARAPHRASE' : 'DESIGN_OR_BACKGROUND_ONLY';
  if (gov) {
    s.software_use_rights = 'PUBLIC_INFORMATION'; s.license_required = false; s.license_status = 'NOT_REQUIRED'; s.production_allowed = true;
  } else if (esc) {
    s.software_use_rights = 'LICENSE_REQUIRED'; s.license_required = true; s.license_status = 'NOT_CONFIRMED'; s.production_allowed = false;
  } else {
    s.software_use_rights = 'NOT_REVIEWED'; s.license_required = null; s.license_status = 'NOT_REVIEWED'; s.production_allowed = false;
  }
  s.license_ref = s.license_ref || null;
  s.last_rights_reviewed_at = RIGHTS_REVIEWED_AT;
  s.reviewed_by = 'CONTENT_BUILD_REVIEW（非法務簽核）';
});

/* ---------- 4. 安全警訊 ---------- */
/* level：EMERGENCY（打 119）／URGENT_NOW（現在就去急診）／URGENT_IN_PERSON（今天當面看）／SAME_DAY（今天聯絡）
 * tier：安全確認分成三段呈現，一頁只問一種嚴重度（HF-P0-01） */
CONTENT.safety_signals = [
  { id: 'E_BREATH', level: 'EMERGENCY', label: '喘到說不出完整句子、快喘不過氣', hint: '像在用力掙扎呼吸' },
  { id: 'E_BLUE', level: 'EMERGENCY', label: '嘴唇或臉色發紫、發灰', hint: '尤其同時很喘或意識變差' },
  { id: 'E_NEURO', level: 'EMERGENCY', label: '昏倒、叫不太醒，或突然意識不清', hint: '' },
  { id: 'E_CHEST', level: 'EMERGENCY', label: '新的胸痛或胸口壓迫感持續不退', hint: '或同時喘、冒冷汗、噁心、快昏倒' },
  { id: 'E_STROKE', level: 'EMERGENCY', label: '突然嘴歪、一邊手腳沒力、講話不清楚', hint: '微笑、舉手、說你好，任一項不對勁' },
  { id: 'E_ANGIOEDEMA', level: 'EMERGENCY', label: '臉、嘴唇、舌頭或喉嚨突然腫起來', hint: '或吞東西、呼吸變困難' },
  { id: 'E_ICD', level: 'EMERGENCY', label: '去顫器（ICD）電擊後還是很不舒服，或昏倒', hint: '' },
  { id: 'E_PINK_SEVERE', level: 'EMERGENCY', label: '咳出粉紅色或帶血的泡沫痰，而且很喘', hint: '肺部可能積水' },
  { id: 'E_BLEED_SHOCK', level: 'EMERGENCY', label: '出血合併頭暈快昏倒、冒冷汗或意識改變', hint: '' },
  { id: 'U_PINK', level: 'URGENT_IN_PERSON', label: '新出現粉紅色或帶血的泡沫痰（現在還不太喘）', hint: '如果同時比平常更喘，等於要打 119 的情況' },
  { id: 'U_BLEED_MAJOR', level: 'URGENT_NOW', label: '吐血、咳血、解黑便或血便，或出血一直止不住', hint: '正在吃抗凝血或抗血小板藥的人特別要注意' },
  { id: 'U_PRESYNCOPE', level: 'URGENT_IN_PERSON', label: '快要昏倒、眼前一黑（但沒有真的昏過去）', hint: '尤其是站起來或活動時' },
  { id: 'U_CONFUSE', level: 'URGENT_NOW', label: '這一兩天突然變得糊塗、答非所問，或認不得人', hint: '慢慢變健忘不算；是「突然」和平常不一樣' },
  { id: 'U_HEAD_BLOODTHIN', level: 'URGENT_NOW', label: '正在吃抗凝血藥，跌倒或撞到頭', hint: '就算現在看起來沒事，也要現在讓醫師檢查' },
  { id: 'S_BREATH', level: 'SAME_DAY', label: '比平常明顯更喘', hint: '躺平就喘、半夜喘醒，或以前走得動的距離現在會喘' },
  { id: 'S_SWELL', level: 'SAME_DAY', label: '這幾天腳或肚子腫得比較厲害，或體重很快上升', hint: '醫療團隊若給過您個人的體重警戒值，以那個為準' },
  { id: 'S_SICK', level: 'SAME_DAY', label: '一直吐、拉肚子，或幾乎吃不下、喝不下', hint: '尿也變得比平常少很多時，更要今天聯絡；生病時有些心臟、腎臟、糖尿病的藥需要醫師個別處理' },
  { id: 'S_HEMATURIA', level: 'SAME_DAY', label: '尿變紅、有血色，或一個小傷口斷斷續續一直在滲血', hint: '量不多、人還好；若量多或頭暈，請改勾上面那一組的「出血止不住」' },
  { id: 'S_BLEED_MINOR', level: 'SAME_DAY', label: '新出現的小出血：刷牙時牙齦流血、身上瘀青變多', hint: '' },
  { id: 'S_ICD', level: 'SAME_DAY', label: '去顫器（ICD）電擊過一次，現在人還好', hint: '每一次電擊都要讓心臟科知道' },
  { id: 'S_PALP', level: 'SAME_DAY', label: '心跳一直很快、很慢，或亂跳不規則', hint: '如果同時快昏倒、胸痛或很喘，請改勾上面那一組' }
];
/* 單項未到緊急、但同時出現時視為緊急 */
CONTENT.emergency_combos = [['U_PINK', 'S_BREATH'], ['U_BLEED_MAJOR', 'U_PRESYNCOPE']];
CONTENT.route_order = ['EMERGENCY', 'URGENT_NOW', 'URGENT_IN_PERSON', 'SAME_DAY', 'ROUTINE'];
/* ---------- 4b. 分流呈現（唯一 SSOT：ROUTE-PRESENTATION-01） ----------
 * 安全確認、分流結果頁、結果頁頁首、主要行動列、本次摘要、列印、複製、螢幕報讀宣告
 * 全部只能讀這一份，畫面程式不得再自己寫 route 的 if／else。
 * severity：數字愈大愈急｜timing：行動時間，必須與安全卡片的 timing 一致
 * stop_routine：true＝不顯示一般衛教，也沒有「繼續看其他衛教」按鈕
 * immediate：true＝在安全確認頁一勾就立刻跳到行動頁，不用按「下一步」 */
CONTENT.route_ui = {
  EMERGENCY: { severity: 4, timing: 'NOW', css: 'em', immediate: true, stop_routine: true,
    headline: '現在請打 119', lead: '先求救，這一頁之後再看就好。',
    lead_caregiver: '先幫病人求救，這一頁之後再看就好。',
    badge: '需要立刻求救', step_badge: '現在打 119' },
  URGENT_NOW: { severity: 3, timing: 'NOW', css: 'urg-now', immediate: true, stop_routine: true,
    headline: '現在請去急診', lead: '請人陪您現在去最近的急診，把藥袋或藥單一起帶去。這件事處理完以前，其他衛教先不用看。',
    lead_caregiver: '請現在陪病人去最近的急診，把藥袋或藥單一起帶去。這件事處理完以前，其他衛教先不用看。',
    badge: '現在就要去急診', step_badge: '現在去急診' },
  URGENT_IN_PERSON: { severity: 2, timing: 'TODAY', css: 'urg', immediate: false, stop_routine: false,
    headline: '今天請人陪您去看醫師', headline_caregiver: '今天請陪病人去看醫師',
    lead: '先把這件事處理掉，其他內容等一下再看。', badge: '今天要有人當面看', step_badge: '今天要當面看' },
  SAME_DAY: { severity: 1, timing: 'TODAY', css: 'day', immediate: false, stop_routine: false,
    headline: '今天請聯絡您的醫療團隊', headline_caregiver: '今天請聯絡病人的醫療團隊',
    lead: '先打這通電話，其他內容等一下再看。', badge: '今天要聯絡醫療團隊', step_badge: '今天聯絡' },
  ROUTINE: { severity: 0, timing: null, css: 'neutral', immediate: false, stop_routine: false,
    headline: '為您整理好了', headline_caregiver: '為病人整理好了',
    lead: '', badge: '這次沒有勾到需要立刻處理的警訊', step_badge: '' }
};
/* 每個分流對應的行動時間：由 route_ui 衍生，不另外手寫（HF-B04-P0-02） */
CONTENT.route_timing = {};
Object.keys(CONTENT.route_ui).forEach(function (k) { CONTENT.route_timing[k] = CONTENT.route_ui[k].timing; });
/* 安全確認的三段分頁：一次只看一種嚴重度，避免整頁 17 項一起掃（HF-P0-01） */
CONTENT.safety_steps = [
  { id: 'SAFETY_NOW', levels: ['EMERGENCY', 'URGENT_NOW', 'URGENT_IN_PERSON'],
    title: '先看一下：您現在有沒有需要立刻處理的情況？',
    title_caregiver: '先看一下：病人現在有沒有需要立刻處理的情況？',
    hint: '打開跟您狀況有關的那一組，有的就勾。標「現在打 119」或「現在去急診」的，一勾就會直接告訴您怎麼做，不用把這一頁看完。',
    hint_caregiver: '打開跟病人狀況有關的那一組，有的就勾。標「現在打 119」或「現在去急診」的，一勾就會直接告訴您怎麼做，不用把這一頁看完。',
    none: '上面這些現在都沒有', done_label: '現在需要立刻處理的情況：都沒有' },
  { id: 'SAFETY_TODAY', levels: ['SAME_DAY'],
    title: '最近幾天有沒有這些變化？',
    title_caregiver: '病人最近幾天有沒有這些變化？',
    hint: '這些今天讓醫療團隊知道就可以。',
    hint_caregiver: '這些今天讓醫療團隊知道就可以。',
    none: '這些也沒有', done_label: '需要今天處理的變化：都沒有' }
];
/* 安全確認的視覺分組（只是畫面上的分組，不改任何警訊 ID、等級或分流）：每一個警訊剛好屬於一組（建置檢查） */
CONTENT.safety_groups = [
  { id: 'G_BREATH', step: 'SAFETY_NOW', label: '呼吸突然很困難、臉色不對、臉或喉嚨腫', signals: ['E_BREATH', 'E_BLUE', 'E_PINK_SEVERE', 'E_ANGIOEDEMA', 'U_PINK'] },
  { id: 'G_CHEST', step: 'SAFETY_NOW', label: '胸口很痛或有壓迫感', signals: ['E_CHEST'] },
  { id: 'G_NEURO', step: 'SAFETY_NOW', label: '昏倒、快昏倒、突然糊塗、嘴歪或手腳沒力', signals: ['E_NEURO', 'E_STROKE', 'U_PRESYNCOPE', 'U_CONFUSE'] },
  { id: 'G_BLEED', step: 'SAFETY_NOW', label: '出血、或吃抗凝血藥時撞到頭', signals: ['E_BLEED_SHOCK', 'U_BLEED_MAJOR', 'U_HEAD_BLOODTHIN'] },
  { id: 'G_ICD', step: 'SAFETY_NOW', label: '去顫器（ICD）電擊', signals: ['E_ICD'] },
  { id: 'G_S_CONGEST', step: 'SAFETY_TODAY', label: '比平常更喘、更腫、體重上升', signals: ['S_BREATH', 'S_SWELL'] },
  { id: 'G_S_SICK', step: 'SAFETY_TODAY', label: '一直吐、拉肚子、吃不下', signals: ['S_SICK'] },
  { id: 'G_S_BLEED', step: 'SAFETY_TODAY', label: '小出血、尿有血', signals: ['S_HEMATURIA', 'S_BLEED_MINOR'] },
  { id: 'G_S_HEART', step: 'SAFETY_TODAY', label: '心跳不對、去顫器電擊過', signals: ['S_ICD', 'S_PALP'] }
];
/* 組合警訊的追問（順序無關：勾到其中一項，就在原位置先問另一項，不管另一項在哪一段） */
CONTENT.combo_prompts = {
  'U_PINK|S_BREATH': '現在是不是也比平常更喘？',
  'S_BREATH|U_PINK': '有沒有同時咳出粉紅色或帶血的泡沫痰？',
  'U_BLEED_MAJOR|U_PRESYNCOPE': '同時有沒有快要昏倒、眼前一黑？',
  'U_PRESYNCOPE|U_BLEED_MAJOR': '同時有沒有吐血、咳血、解黑便或血便，或出血止不住？'
};
CONTENT.combo_prompt_hint = '不確定就選「不確定」，會先當作有，寧可早一點求救。';

/* ---------- 5. 核心三步與分支選項 ---------- */
CONTENT.recent_change_options = [
  ['WORSE', '比平常差很多'], ['SAME', '和平常差不多'], ['BETTER', '比平常好一些'], ['UNSURE', '說不上來']
];
/* 比較基準（KPI-COMPARISON-REFERENCE-01）：公開版每次都是第一次，只能和「平常」比，
 * 不能推論「比上次改善」。院內縱向版改用 PREVIOUS_ASSESSMENT 與 5 級方向＋不確定。
 * public_to_longitudinal 讓未來匯入時語意不走樣；runtime 會把 comparison_reference 寫進摘要投影。 */
CONTENT.recent_change_meta = {
  comparison_reference: 'USUAL_BASELINE',
  longitudinal_enum: ['MUCH_BETTER', 'BETTER', 'SAME', 'WORSE', 'MUCH_WORSE', 'UNSURE'],
  public_to_longitudinal: { WORSE: 'MUCH_WORSE', SAME: 'SAME', BETTER: 'BETTER', UNSURE: 'UNSURE' }
};
/* 後端主要問題代碼（引擎使用；維持分開，不因前端合併而混用） */
CONTENT.primary_concerns = [
  ['MEDICATION', '我的藥：用途、副作用、怎麼吃'],
  ['ADHERENCE', '常忘記吃、藥太多或很難照著吃'],
  ['ACCESS', '藥費、領藥、回診交通或人手的困難'],
  ['SYMPTOM', '最近身體的變化（喘、腫、累、頭暈）'],
  ['POST_DISCHARGE', '最近住院或剛出院'],
  ['COMORBIDITY', '我還有其他毛病，要怎麼一起顧'],
  ['SELF_CARE', '吃、喝、活動這些日常怎麼做'],
  ['GOALS', '我在意的生活，和治療怎麼取捨'],
  ['UNDERSTAND', '我想先了解心衰竭是什麼'],
  ['NONE', '今天沒有特別的問題']
];
/* 病人看到的第一層：6 個生活語言的意圖＋2 個次要連結（R1-B Concern IA）
 * to：直接對應的後端代碼｜sub：還要再問一題才能決定後端代碼 */
CONTENT.concern_intents = [
  { id: 'SYMPTOM', label: '身體不舒服，或最近有變化', to: 'SYMPTOM' },
  { id: 'MEDICATION', label: '吃藥遇到問題', sub: 'med_problem' },
  { id: 'POST_DISCHARGE', label: '剛出院，或最近住過院', to: 'POST_DISCHARGE' },
  { id: 'SELF_CARE', label: '每天怎麼照顧自己', to: 'SELF_CARE' },
  { id: 'ACCESS', label: '看病、領藥或照顧上有困難', to: 'ACCESS' },
  { id: 'OTHER_HEALTH', label: '其他健康問題，或治療上的選擇想一起談', sub: 'other_topic' }
];
CONTENT.concern_secondary = [
  { id: 'UNDERSTAND', label: '我想先了解心衰竭是什麼', to: 'UNDERSTAND' },
  { id: 'NONE', label: '今天沒有特別的問題', to: 'NONE' }
];
/* 吃藥問題：問題導向，不要病人先當藥師選 14 類藥（R1-C Medication problem-first）
 * to：後端主要問題代碼｜med_problem：MEDICATION 底下的問題型態｜follow：還要追問的那一題（沒有就直接出結果） */
CONTENT.med_problem_options = [
  { id: 'UNDERSTAND', label: '不知道這些藥是做什麼的', to: 'MEDICATION', follow: 'MED_PICK' },
  { id: 'ADMINISTRATION', label: '不確定怎麼吃、什麼時候吃', to: 'MEDICATION' },
  { id: 'ADHERENCE', label: '常忘記，或藥太多很難記', to: 'ADHERENCE' },
  { id: 'TOLERABILITY', label: '吃了不舒服', to: 'MEDICATION', follow: 'MED_PICK' },
  { id: 'RECONCILIATION', label: '最近換藥、停藥，和藥單對不上', to: 'MEDICATION', follow: 'RECON' },
  { id: 'SAFETY_REVIEW', label: '想確認哪些藥要特別注意', to: 'MEDICATION' },
  { id: 'ACCESS', label: '藥費、領藥或回診有困難', to: 'ACCESS' },
  { id: 'UNKNOWN_MED', label: '不知道藥名也沒關係，想先整理', to: 'MEDICATION' }
];
CONTENT.other_topic_options = [
  { id: 'COMORB', label: '我還有其他健康問題，想知道怎麼一起照顧', to: 'COMORBIDITY' },
  { id: 'WHAT_MATTERS', label: '我最在意的生活，和治療怎麼取捨', to: 'GOALS', goals_topic: 'WHAT_MATTERS' },
  { id: 'SYMPTOM_SUPPORT', label: '希望症狀和生活品質被多照顧一些', to: 'GOALS', goals_topic: 'SYMPTOM_SUPPORT' },
  { id: 'ACP', label: '如果以後病情變重，我希望怎麼被照顧', to: 'GOALS', goals_topic: 'ACP' }
];
CONTENT.branches = {
  ADHERENCE: { field: 'adherence_barrier', title: '哪一種最接近您的情況？', options: [
    ['FORGET', '常常忘記'], ['SIDE_EFFECT', '吃了不舒服'], ['COMPLEX', '藥太多、時間太複雜'], ['BELIEF', '不知道為什麼要吃，覺得沒差'],
    ['SWALLOW', '吞不下去、眼睛看不清楚或手不好拿'], ['LITERACY', '藥袋上的字看不懂'], ['CAREGIVER', '需要家人幫忙才做得到'],
    ['COST_SKIP', '因為藥費或拿藥困難，少吃或停過'], ['SELF_STOPPED', '自己停了、減量，或不確定還要不要吃'], ['OTHER', '其他，說不上來']] },
  ACCESS: { field: 'access_barrier', title: '哪一項最讓您為難？', options: [
    ['COST', '藥費負擔'], ['PICKUP', '領藥要一直跑醫院'], ['TRANSPORT', '回診的交通'],
    ['CARE_SUPPORT', '家裡人手不夠、照顧者很累'], ['INFO', '資料太多看不懂'], ['OTHER', '其他']] },
  SYMPTOM: { field: 'symptom_focus', title: '最近哪一項最困擾您？', options: [
    ['BREATH', '喘'], ['SWELL', '腫或體重增加'], ['FATIGUE', '沒力氣、很累'], ['DIZZY', '頭暈，站起來會暈'],
    ['NIGHT_BREATH', '躺平會喘、半夜喘醒要坐起來'], ['SNORING', '打呼很大聲、睡覺時像停住呼吸'], ['APPETITE', '吃不下、體重一直掉'],
    ['PALP', '心跳很快、很慢或亂跳'], ['MOOD', '心情低落、睡不好、提不起勁']] },
  COMORBIDITY: { field: 'comorbidity_focus', title: '您有、而且這次最想先一起照顧的是哪一項？', options: [
    ['CKD', '腎臟不好、血鉀的問題'], ['AF', '心律不整（心房顫動）'], ['DM', '糖尿病'], ['CAD_HTN', '冠心症、裝過支架或高血壓'],
    ['OBESITY', '體重過重'], ['FRAILTY', '體力變差、容易跌倒'], ['ANEMIA_IRON', '貧血或長期疲倦'], ['SLEEP_LUNG', '睡眠呼吸中止、氣喘或慢性肺病'],
    ['VALVE', '心臟瓣膜的問題'], ['MOOD_COG', '心情低落、焦慮或記性變差'], ['PAIN_GOUT', '痛風或關節痛，常要止痛'], ['AMYLOID', '心臟類澱粉沉積症'],
    ['CANCER_TX', '正在或曾經接受癌症治療'], ['CARDIOMYOPATHY', '心肌病變，或家族有人年輕時心臟就出問題']] },
  SELF_CARE: { field: 'self_care_topic', title: '今天想先看哪一項？', options: [
    ['DAILY', '每天怎麼觀察自己'], ['ACTIVITY', '可以怎麼動、心臟復健'], ['NUTRITION', '吃的方面'], ['FLUID', '水要不要控制'],
    ['OTC', '自己買的藥、止痛藥、中藥、保健品'], ['VACCINE', '疫苗'], ['LIFESTYLE', '菸、酒、睡眠'], ['HEAT', '天氣熱或感冒生病的時候'],
    ['DEVICE', '身上有去顫器或心律調節器，日常要注意什麼']] },
  GOALS: { field: 'goals_topic', title: '這次最想談哪一件？', options: [
    ['WHAT_MATTERS', '我最在意的生活，和治療怎麼取捨'], ['SYMPTOM_SUPPORT', '希望症狀和生活品質被多照顧一些'],
    ['ACP', '如果以後病情變重，我希望怎麼被照顧']] }
};
/* 「最近住院」不等於「因為心衰竭住院」 */
CONTENT.discharge_reason_options = [
  ['HF', '因為心臟衰竭（喘、水腫、心臟的問題）'],
  ['OTHER', '因為別的原因'],
  ['UNSURE', '不確定是什麼原因']
];
CONTENT.discharge_when_options = [
  ['WITHIN_7D', '一週內'], ['WITHIN_30D', '一個月內'], ['OVER_30D', '超過一個月'], ['UNKNOWN', '不記得了']
];
CONTENT.med_focus_extra = [['UNKNOWN_NAME', '我不知道藥名'], ['ALL', '想把所有的藥一起整理']];
CONTENT.med_reconciliation_options = [['MATCH', '一樣'], ['DIFFERENT', '有不一樣'], ['UNSURE', '不確定']];
CONTENT.tri_state = [['YES', '是'], ['NO', '否'], ['UNSURE', '不確定']];
/* 懷孕：只有明確「否」才可通過懷孕敏感的適用性判斷；未問、不知道、不適用一律不通過 */
CONTENT.pregnancy_options = [['NO', '沒有這個可能'], ['YES', '有可能或已經懷孕'], ['PLANNING', '目前沒有懷孕，但計畫懷孕'], ['UNSURE', '不確定'], ['NA', '不適用']];

/* ---------- 6. 選填的臨床資料（漸進式；不知道就不填） ---------- */
CONTENT.lvef_bands = [['LE35', '35% 以下'], ['36_40', '36–40%'], ['41_44', '41–44%'], ['45_49', '45–49%'], ['GE50', '50% 以上'], ['UNKNOWN', '不知道／沒有報告']];
CONTENT.lvef_reduced_bands = ['LE35', '36_40', '41_44', '45_49'];
CONTENT.lvef_when_options = [['WITHIN_6M', '半年內'], ['M6_12', '半年到一年'], ['OVER_12M', '超過一年'], ['UNKNOWN', '不記得']];
CONTENT.lvef_source_options = [['REPORT', '檢查報告或病歷上看到的'], ['TOLD', '醫師口頭告訴我的'], ['UNSURE', '不太確定']];
CONTENT.hf_type_options = [['REDUCED', '收縮功能比較差的那一型'], ['PRESERVED', '收縮功能還可以的那一型'], ['UNKNOWN', '醫師沒說或我不記得']];
CONTENT.diagnosis_options = [['CONFIRMED', '醫師明確說我有心衰竭'], ['SUSPECTED', '還在檢查、醫師說可能是'], ['UNKNOWN', '我不確定']];
CONTENT.bmi_bands = [['GE30', 'BMI 30 以上'], ['LT30', 'BMI 未滿 30'], ['UNKNOWN', '不知道']];
CONTENT.tsat_bands = [['LT20', '低於 20%'], ['GE20', '20% 以上'], ['UNKNOWN', '不知道／沒驗過']];
CONTENT.rhythm_options = [['SINUS', '醫師說是規律的（竇性心律）'], ['AF', '有心房顫動'], ['UNKNOWN', '不知道']];
CONTENT.hr_bands = [['GE70', '大多 70 次以上'], ['LT70', '大多不到 70 次'], ['UNKNOWN', '沒量過或不知道']];
CONTENT.symptom_status_options = [['SYMPTOMS', '活動時還是會喘或特別累'], ['NO_SYMPTOMS', '日常活動大致沒問題'], ['UNKNOWN', '說不上來']];
/* 休息時也會喘：進階心衰竭的明確訊號之一，不由「有症狀＋住過院」推論 */
CONTENT.rest_dyspnea_options = [['REST_SYMPTOMS', '坐著休息也會喘，或要墊高才睡得著'], ['ON_EXERTION_ONLY', '只有活動時會喘'], ['UNKNOWN', '說不上來']];
CONTENT.hf_admission_count_options = [['NONE', '沒有'], ['ONE', '1 次'], ['TWO_PLUS', '2 次以上'], ['UNKNOWN', '不確定']];
/* 檢驗時效：沒有時間就不當作目前的資料 */
CONTENT.lab_when_options = [['WITHIN_12M', '一年內驗過'], ['OVER_12M', '超過一年'], ['UNKNOWN', '不記得／沒驗過']];
/* 藥袋上勾到的，現在是不是還在吃 */
CONTENT.med_exposure_options = [
  ['ALL_CURRENT', '都還在吃'],
  ['SOME_STOPPED', '有幾個已經停了'],
  ['UNSURE', '不確定']
];
/* 清單完整度：只要還有找不到的藥，就不算完整 */
CONTENT.med_list_complete_options = [
  ['YES', '這些就是全部了'],
  ['UNMAPPED', '還有藥，但上面找不到'],
  ['NO', '還有別的藥沒列'],
  ['UNSURE', '不確定']
];
/* 共病的資料層級：想了解 ≠ 已確診 */
CONTENT.comorbidity_certainty = ['INTEREST', 'SELF_REPORT', 'CONFIRMED'];

/* ---------- 7. 可行性、偏好與決策準備 ---------- */
CONTENT.feasibility_options = [['EASY', '可以做到'], ['HARD', '有困難，需要幫忙'], ['UNSURE', '還不確定']];
CONTENT.feasibility_barriers = [['TIME', '沒時間或會忘記'], ['COST', '費用'], ['TRANSPORT', '交通'], ['UNDERSTAND', '還不太懂怎麼做'], ['NO_HELPER', '沒有人可以幫忙'], ['OTHER', '其他']];
/* 「最在意的事」（F45）：常見選項結構化；想用自己的話說，在列印時寫在「這次看診我想問」（只在這台裝置的畫面上，不會保存） */
CONTENT.what_matters_improve = [['BREATH', '喘少一點'], ['ENERGY', '有體力做想做的事'], ['SLEEP', '睡得好'], ['HOSPITAL', '少住院'], ['HOME', '待在家裡過日子'],
  ['INDEPENDENT', '生活能自理'], ['FAMILY', '陪伴或照顧家人'], ['WORK', '繼續工作'], ['ACTIVITY', '參加宗教、社團或喜歡的活動'], ['OTHER', '其他（可以在列印時寫下來）']];
CONTENT.what_matters_worry = [['SIDE_EFFECT', '副作用'], ['PILL_BURDEN', '藥太多、次數太多'], ['COST', '費用'], ['VISITS', '回診抽血太頻繁'], ['DIET', '吃的方面限制太多'],
  ['BURDEN_FAMILY', '拖累家人'], ['UNKNOWN_FUTURE', '不知道以後會怎樣'], ['OTHER', '其他（可以在列印時寫下來）']];
/* READINESS-CONSTRUCT-01：這一題問的是「現在想不想談在意的事」，不是自我管理準備度，故正名 */
CONTENT.goals_discussion_readiness_options = [['READY_NOW', '現在就想了解'], ['DISCUSS_LATER', '下次回診再談'], ['NOT_TODAY', '今天先不談']];
/* 自我管理準備度：突然變差時，知不知道下一步、找誰 */
CONTENT.self_management_readiness_options = [['KNOWS_NEXT_STEP', '知道，也知道要找誰'], ['UNSURE', '不太確定']];
CONTENT.preference_source_options = [['PATIENT', '病人自己說的'], ['CAREGIVER_PROXY', '照顧者代為推測'], ['SHARED', '兩人一起討論後的想法']];

/* ---------- 7b. 體重的參考數字（寫作原則 4 的唯一例外） ----------
 * 只出現在「我的照護計畫」；一定先寫個人數字的空格，參考數字標明出處與「以醫療團隊為準」。 */
CONTENT.weight_reference = {
  text: '如果醫療團隊還沒給您個人數字：歐洲心臟學會心衰竭協會給病人的說明是「3 天內體重增加超過 2 公斤，要告訴醫師」。有個人數字時，一律以醫療團隊給的為準。',
  source_id: 'HFA_WEIGHT', personal_first: true
};
/* ---------- 7c. 鹽量參考（一般成人，F-SALT 雙層標示；寫作原則 4 的第二個例外） ----------
 * 只出現在飲食卡片的第二層；一定寫明「一般成人參考」、「不是每位心衰竭病人的固定治療目標」、「以醫療團隊為準」（建置檢查）。 */
CONTENT.salt_reference = {
  text: '台灣給一般成人的參考量：每天鈉不超過 2400 毫克，大約是食鹽 6 公克。這是給一般成人的建議，不是每位心衰竭病人的固定治療目標；醫療團隊給您個別的量時，以醫療團隊為準。',
  source_id: 'HPA_SODIUM', general_population: true, attach_to: 'SELF_NUTRITION'
};
/* 營養風險（F37）：只篩三件事，不給一體適用的蛋白質公克數 */
CONTENT.nutrition_risk_options = [['WEIGHT_LOSS', '沒有刻意減肥，體重卻一直掉'], ['APPETITE', '吃得比以前少很多'], ['WEAKER', '力氣變小、容易跌倒或站不穩'], ['NONE', '都沒有'], ['UNSURE', '說不上來']];
/* 費用或拿藥困難是否造成少吃（F39） */
CONTENT.cost_skip_options = [['YES', '有，少吃或停過'], ['NO', '沒有'], ['UNSURE', '不確定']];
/* 第二件事（F31）：看完第一件事之後才問，不增加開始時的負擔 */
CONTENT.second_topics = [
  { id: 'DAILY', label: '每天怎麼觀察自己（量體重、看腫）', cards: ['SELF_DAILY', 'SYM_SWELL'] },
  { id: 'MEDS', label: '把所有的藥整理一次', cards: ['MED_REVIEW_ALL'] },
  { id: 'SICK', label: '生病、發燒或天氣熱時怎麼辦', cards: ['SELF_HEAT', 'SICKDAY_PLAN'] },
  { id: 'ACTIVITY', label: '可以怎麼動、心臟復健', cards: ['SELF_ACTIVITY'] },
  { id: 'FOOD', label: '吃的方面、鹽和水', cards: ['SELF_NUTRITION', 'SELF_FLUID'] },
  { id: 'COST', label: '藥費、領藥或回診交通', cards: ['ACC_COST', 'ACC_PICKUP'] },
  { id: 'MOOD', label: '心情、睡眠或記性', cards: ['CO_MOOD_COG'] },
  { id: 'PREVENT', label: '疫苗、菸、酒、檳榔', cards: ['SELF_VACCINE', 'SELF_LIFESTYLE'] },
  { id: 'FUTURE', label: '以後病情變重時，希望怎麼被照顧', cards: ['GOALS_ACP'] }
];
/* 共病分組（F32）：先選大類，再展開，避免一次 14 個選項 */
CONTENT.comorbidity_groups = [
  { id: 'HEART', label: '心臟、血管、血壓', items: ['AF', 'CAD_HTN', 'VALVE', 'CARDIOMYOPATHY', 'AMYLOID'] },
  { id: 'METABOLIC', label: '腎臟、血糖、體重、貧血', items: ['CKD', 'DM', 'OBESITY', 'ANEMIA_IRON'] },
  { id: 'BODY_MIND', label: '體力、跌倒、心情、睡眠呼吸', items: ['FRAILTY', 'MOOD_COG', 'SLEEP_LUNG'] },
  { id: 'OTHER_TX', label: '疼痛、癌症治療', items: ['PAIN_GOUT', 'CANCER_TX'] }
];
/* ---------- 7c2. 病人畫面首屏最多 6 個選項（P1-01）：超過的清單先顯示這幾個，其餘收在「更多」；只影響畫面順序，不改任何代碼 ---------- */
CONTENT.option_first = {
  ADHERENCE: ['FORGET', 'SIDE_EFFECT', 'COMPLEX', 'COST_SKIP', 'SELF_STOPPED'],
  SYMPTOM: ['BREATH', 'SWELL', 'FATIGUE', 'DIZZY', 'PALP'],
  SELF_CARE: ['DAILY', 'ACTIVITY', 'NUTRITION', 'OTC', 'HEAT'],
  med_problem: ['UNDERSTAND', 'ADMINISTRATION', 'ADHERENCE', 'TOLERABILITY', 'RECONCILIATION'],
  second_topics: ['DAILY', 'MEDS', 'SICK', 'FOOD', 'COST']
};
CONTENT.option_more_label = '更多情況';
/* 「什麼時候要求救」精簡版：每一級只先顯示代表例（完整清單可展開；列印同樣預設精簡） */
CONTENT.ladder_examples = { EMERGENCY: ['E_BREATH', 'E_NEURO', 'E_CHEST', 'E_STROKE'], URGENT_NOW: ['U_BLEED_MAJOR', 'U_CONFUSE', 'U_HEAD_BLOODTHIN'], URGENT_IN_PERSON: ['U_PRESYNCOPE', 'U_PINK'], SAME_DAY: ['S_BREATH', 'S_SWELL', 'S_SICK'] };
CONTENT.result_done_text = '這次主要的整理已經完成。您可以把上面的摘要帶去看診；想再補資料或了解更多，再往下看就好。';
CONTENT.result_done_text_cg = '這次主要的整理已經完成。您可以把上面的摘要帶去陪病人看診；想再補資料或了解更多，再往下看就好。';
CONTENT.ask_escape_label = '不知道／先略過';
CONTENT.ask_enough_text = '已經補了 3 題，這份整理已經夠用了。想再補，再按一次就好。';

/* ---------- 7d. 名詞白話解釋（F46）：第一次出現時自動加在後面；只做定義，不含個人建議 ---------- */
CONTENT.glossary = [
  { term: '射出分率', aliases: ['LVEF'], plain: '心臟每跳一下，把血打出去的比例；醫師用它分心衰竭的類型' },
  { term: '利尿劑', aliases: [], plain: '俗稱排水藥，幫身體排掉多餘的水分' },
  { term: 'SGLT2 inhibitor', aliases: [], plain: '一類心衰竭長期治療藥，原本也用來降血糖，例如 dapagliflozin、empagliflozin' },
  { term: 'ARNI', aliases: [], plain: '一類心衰竭長期治療藥，例如 sacubitril/valsartan' },
  { term: 'ACEI', aliases: [], plain: '一類降血壓、保護心臟的藥，藥名常以 -pril 結尾' },
  { term: 'ARB', aliases: [], plain: '一類降血壓、保護心臟的藥，藥名常以 -sartan 結尾' },
  { term: 'MRA', aliases: [], plain: '一類保護心臟、也有排水作用的藥，例如 spironolactone；要追蹤血鉀' },
  { term: 'Beta-blocker', aliases: [], plain: '讓心跳慢一點、保護心臟的藥，藥名常以 -olol 結尾' },
  { term: 'NSAIDs', aliases: [], plain: '消炎止痛藥，例如 ibuprofen；可能讓身體留住水分' },
  { term: 'GLP-1', aliases: [], plain: '一類降血糖、也能幫助減重的藥，例如 semaglutide' },
  { term: 'BMI', aliases: [], plain: '身體質量指數，用身高和體重算出來' },
  { term: 'TSAT', aliases: [], plain: '運鐵蛋白飽和度，抽血看身體缺不缺鐵' },
  { term: '去顫器', aliases: ['ICD'], plain: '裝在身上的小機器，心跳太危險時會自動電擊' },
  { term: '心律調節器', aliases: [], plain: '裝在身上的小機器，心跳太慢時幫忙維持心跳' },
  { term: '心房顫動', aliases: [], plain: '常見的心律不整，心跳會亂跳、不規則' },
  { term: '乾體重', aliases: [], plain: '身體沒有多餘水分時的體重，由醫療團隊判斷' },
  { term: '抗凝血藥', aliases: [], plain: '讓血比較不容易凝固、預防血栓的藥，例如 warfarin、apixaban' },
  { term: '抗血小板藥', aliases: [], plain: '預防血管再塞住的藥，例如 aspirin、clopidogrel' },
  { term: '預立醫療照護諮商', aliases: [], plain: '和醫療團隊、家人一起談萬一病重時希望怎麼被照顧，可以依法寫成文件' },
  { term: '安寧緩和照護', aliases: [], plain: '以減少不舒服、照顧生活品質為目標的照護，不等於放棄治療' },
  { term: '心臟復健', aliases: [], plain: '由醫療團隊帶著做的運動訓練和衛教課程' },
  { term: '血鉀', aliases: [], plain: '血液裡鉀的濃度，太高或太低都會影響心跳' },
  { term: '腎功能', aliases: [], plain: '腎臟清除廢物的能力，抽血可以看' },
  { term: '慢性病連續處方箋', aliases: [], plain: '病情穩定時，一次開好、可以分次領藥的處方' },
  { term: '失代償', aliases: [], plain: '心衰竭突然變嚴重、需要住院處理' },
  { term: '硝酸鹽類', aliases: [], plain: '擴張血管、緩解胸痛的藥，例如舌下含片' },
  { term: '心電圖', aliases: [], plain: '在身上貼貼片量心臟的電流，看心跳規不規律' }
];
/* ---------- 7e. 照護者語氣的固定用語（F52）：畫面上的承接句都從這裡取，建置時一起檢查 ---------- */
CONTENT.voice = {
  unknown_ok: '不知道也可以，先不要猜。這一項會記成「不知道」，不會被當成正常；看診時再問醫療團隊就好。',
  unknown_ok_cg: '不確定也可以，先不要替病人猜。這一項會記成「不知道」，不會被當成正常；陪病人看診時再一起問。',
  result_lead: '因為您剛選了「{ctx}」，下面先把今天最需要做的一件事放在最前面；其他的，等一下再看就好。',
  result_lead_cg: '因為您剛選了「{ctx}」，下面先把今天您可以幫病人做的一件事放在最前面；其他的，等一下再看就好。',
  result_lead_none: '您這次沒有勾到需要立刻處理的警訊。下面是趁穩定時值得準備的幾件事。',
  result_lead_change: '您說最近和平常比變差，或說不上來；下面先把今天要做的事放在最前面。',
  second_topic_already: '這件事的內容已經在上面的提醒裡了，不用再另外看一次。',
  meds_not_all: '您先不用把所有藥名都找齊，先處理現在最困擾的那一件事。',
  second_topic_q: '還有另一件事想一起整理嗎？',
  second_topic_hint: '選一件就好；會加在下面，不會改掉前面的內容。',
  save_not_notify: '這個網頁不會把任何內容送給醫療團隊；需要聯絡時，請自己打電話。'
};

/* 「吃了不舒服」再問一題：哪一種不舒服（不同不舒服，處理方式不同） */
CONTENT.side_effect_options = [
  ['DIZZY', '頭暈，站起來會暈'], ['COUGH', '一直乾咳'], ['FATIGUE', '很累、沒力氣'], ['OTHER', '其他，說不上來']
];
/* 照顧者：照顧這件事吃不吃得消（照顧者負荷，只在照顧者模式問） */
CONTENT.caregiver_strain_options = [['OK', '還好，應付得來'], ['SOMETIMES', '有時候覺得吃不消'], ['OFTEN', '常常覺得吃不消']];
/* 照顧者：病人平常需要人幫忙嗎（衰弱、跌倒、用藥監督的線索） */
CONTENT.care_dependency_options = [['INDEPENDENT', '大多自己來'], ['PARTIAL', '有些事需要人幫忙'], ['DEPENDENT', '走路、洗澡或吃藥都要人幫忙']];
/* 心情：最近兩週，常常心情低落或提不起勁（白話篩問，不是診斷） */
CONTENT.mood_screen_options = [['YES', '常常這樣'], ['SOMETIMES', '偶爾'], ['NO', '沒有']];
/* 有沒有裝心臟裝置（去顫器、心律調節器、再同步裝置） */
CONTENT.device_options = [['ICD', '去顫器（ICD），或有電擊功能的裝置'], ['PACER', '心律調節器（只調心跳）'], ['NONE', '沒有'], ['UNSURE', '不確定']];

/* ---------- 8. 生活與支持（只在病人選了才出現） ---------- */
CONTENT.whole_person_needs = [
  ['WORK', '工作或回到工作'],
  ['TRAVEL', '出遠門或旅行'],
  ['INTIMACY', '親密關係、性生活'],
  ['SOCIAL', '一個人住或支持不夠'],
  ['CULTURE_FAITH', '家庭決策方式、宗教或信仰'],
  ['HEAT_INFECTION', '天氣熱或感冒生病時怎麼顧'],
  ['NONE_OF_THESE', '這些目前都不需要']
];

root.HFPC_CONTENT = CONTENT;
if (typeof module !== 'undefined' && module.exports) module.exports = CONTENT;
})(typeof window !== 'undefined' ? window : globalThis);

/* =====================================================================
 * 心衰竭精準照護助手｜衛教卡片、用藥教學、組合提醒（內容 SSOT 第二部分）
 * ---------------------------------------------------------------------
 * 卡片欄位（Action Card Contract）：
 *   id / claim_id      唯一代碼（不要改；改內容不必改代碼）
 *   group              now＝現在先做｜discuss＝這次看診帶去談｜learn＝有空再了解
 *   rank               同組排序（數字小者在前）
 *   title / text       標題與說明（病人語言）
 *   actions[]          具體可做的事（會出現在「我準備做的事」勾選清單）
 *   who[]              找誰（對應 content.js roles）
 *   when               什麼時候做
 *   escalate           什麼情況要升級處理
 *   do_not             不要自己做的事
 *   ask                帶去問醫療團隊的問題（自動進入摘要）
 *   evidence[[id,角色]] 至少一個 DIRECT
 *   check              （選填）「確認我知道下一步」自我確認題
 * ===================================================================== */
(function (root) {
'use strict';
var C = root.HFPC_CONTENT || (typeof require !== 'undefined' ? require('./content.js') : null);
var D = 'DIRECT', S = 'SUPPORTIVE';
var NO_SELF_CHANGE = '不要因為本頁內容自行開始、停用、換藥或改變劑量。';

C.cards = {
/* ================= 安全路徑 ================= */
MED_HOWTO: { claim_id: 'CLM-MED_HOWTO', topic: 'ADHERENCE_FEASIBILITY', group: 'now', rank: 4, risk: 'IMPORTANT', title: '不確定怎麼吃：請藥師幫您排一張「一天的吃藥時間表」',
  text: '每一顆藥什麼時候吃、飯前還是飯後、漏吃了怎麼辦，每種藥不一樣，不要用猜的。請藥師依您實際的作息，把全部的藥排成一張時間表；看不懂的地方請他再說一次，您用自己的話講一遍確認。',
  actions: ['把所有藥袋帶去，請藥師排一張一天的吃藥時間表', '問清楚「漏吃一次時怎麼辦」'],
  who: ['PHARMACIST'], when: '下次領藥或看診', timing: 'NEXT_VISIT', escalate: '', do_not: NO_SELF_CHANGE,
  ask: '可以依我的作息，幫我把藥排成一張時間表嗎？漏吃一次要怎麼辦？',
  evidence: [['HFA_ADHERENCE_2025', D], ['AHRQ_TEACHBACK', S]] },
SELF_WORSEN_PLAN: { claim_id: 'CLM-SELF_WORSEN_PLAN', topic: 'SELF_MANAGEMENT_PLAN', group: 'discuss', rank: 2, risk: 'IMPORTANT', title: '突然變差時：先把「下一步做什麼、找誰」寫下來',
  text: '您說不太確定突然變差時該怎麼做。這一點值得在下次看診時請醫療團隊寫給您：哪些變化要當天聯絡、打哪支電話、晚上或假日找誰，以及什麼情況直接打 119。寫在紙上貼在家裡，家人也看得到。',
  actions: ['下次看診請醫療團隊寫下「變差時怎麼做」和聯絡電話', '把這張紙貼在家人看得到的地方'],
  who: ['HF_TEAM', 'DOCTOR', 'NURSE'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '出現本頁「什麼時候要求救」列出的情況，照那裡寫的時間處理。', do_not: '',
  ask: '我突然變差時，哪些情況要當天聯絡？打哪支電話？晚上或假日找誰？',
  evidence: [['AHA_HF_2022', D], ['NHS_HF', S], ['ESC_HF_2026', S]] },
EMERGENCY: { claim_id: 'CLM-EMERGENCY', topic: 'SAFETY_URGENT', group: 'now', rank: 0, risk: 'CRITICAL', title: '現在請打 119',
  text: '您勾到的情況可能有生命危險。先打電話求救，這一頁之後再看就好。',
  actions: ['現在撥 119；手機打不通就改撥 112', '不要自己開車或騎車去醫院', '記下是幾點開始不舒服的', '請身邊的人陪著，順手帶上藥袋或用藥清單'],
  who: ['EMS'], when: '現在', timing: 'NOW', escalate: '', do_not: '除了醫師開給您、也交代過怎麼用的舌下含片以外，不要臨時加吃或停掉藥來試試看。',
  evidence: [['TW_NFA_119', D], ['NHS_HF', D], ['MOHW_STROKE_2022', D], ['NHS_RAMIPRIL_SE', S], ['MEDLINEPLUS_ICD', S], ['MAYO_PULMONARY_EDEMA', S]] },
URGENT_PINK: { claim_id: 'CLM-URGENT-PINK', topic: 'SAFETY_URGENT', group: 'now', rank: 1, risk: 'CRITICAL', title: '今天一定要有人當面看您',
  text: '新出現粉紅色或帶血的泡沫痰，可能是肺裡積了水。就算現在還不太喘，也要今天讓醫師當面檢查，不能只打電話等回覆。',
  actions: ['今天到原本看診的醫院門診或急診', '帶著藥袋或用藥清單', '請家人陪您去，不要自己開車'],
  who: ['ED', 'DOCTOR'], when: '今天，愈早愈好', timing: 'TODAY', escalate: '若同時出現很喘、嘴唇發紫、昏倒、意識改變或持續胸痛，立即撥 119。',
  do_not: '不要自己多吃一顆排水藥，然後在家等看看。', ask: '這次的泡沫痰是否代表肺部積水？需要調整治療嗎？',
  evidence: [['NHS_HF', D], ['MAYO_PULMONARY_EDEMA', S], ['TW_NFA_119', S]],
  check: { q: '如果等一下開始喘到講不出完整句子，應該怎麼做？', options: [
    ['立即撥打 119', true, '正確。出現嚴重喘時，不要等門診，直接撥 119。'],
    ['等到明天門診再說', false, '這樣可能延誤。嚴重喘時請直接撥 119。'],
    ['自己先多吃一顆利尿劑', false, '請不要自行加藥。嚴重喘時請直接撥 119。']] } },
URGENT_BLEED: { claim_id: 'CLM-URGENT-BLEED', topic: 'SAFETY_URGENT', group: 'now', rank: 1, risk: 'CRITICAL', title: '現在就到急診：這種出血不能等門診',
  text: '吐血、咳血、解黑便或血便、出血一直止不住，都需要現在就查清楚出血在哪裡、嚴不嚴重。正在吃抗凝血藥或抗血小板藥的人更要立刻去。',
  actions: ['現在到急診，請家人陪您去', '把所有藥袋帶著，特別是抗凝血藥、抗血小板藥和止痛藥', '記一下出血是幾點開始的、大概多少'],
  who: ['ED', 'DOCTOR'], when: '現在', timing: 'NOW', escalate: '出血量大、頭暈快昏倒、意識改變，或突然劇烈頭痛、嘴歪、單側無力，立即撥 119。',
  do_not: '不要只靠這個網頁決定下一劑怎麼處理。現在先去急診，把藥袋或藥單一起帶去，讓現場醫師決定。', ask: '出血原因是什麼？目前的抗凝血／抗血小板藥要怎麼處理？',
  evidence: [['ESC_AF_2024', D], ['NHS_APIXABAN_SE', S], ['TW_NFA_119', S]] },
SAME_DAY: { claim_id: 'CLM-SAME-DAY', topic: 'SAFETY_URGENT', group: 'now', rank: 2, risk: 'CRITICAL', title: '今天打一通電話給您的醫療團隊',
  text: '您勾到的變化，今天就要讓醫療團隊知道，由他們決定要不要提早回診或調整治療。',
  detail: '您提供的資訊只夠判斷「要不要今天聯絡」，不足以判斷原因；原因要由當面評估與檢查決定。',
  actions: ['今天打給原本看診的心臟科門診或心衰竭個管師，或直接回診', '講三件事：哪裡不舒服、從哪天開始、和平常差多少；最近有沒有換藥也要講', '如果聯絡不上、又越來越不舒服，今天就近先去看'],
  who: ['HF_TEAM', 'DOCTOR'], when: '今天', timing: 'TODAY', escalate: '出現講不出完整句子的喘、嘴唇發紫、昏倒或持續胸痛，立即撥 119。',
  do_not: '除非醫療團隊事先寫給您個人的調整方式，不然不要自己把排水藥加倍或停掉。', ask: '這次變化需要提早回診、抽血或調整藥物嗎？',
  evidence: [['NHS_HF', D], ['ESC_HF_2026', S], ['TW_NFA_119', S]],
  check: { q: '今天聯絡不上醫療團隊，而且越來越喘，應該怎麼做？', options: [
    ['今天就近就醫；若喘到講不出完整句子就撥 119', true, '正確。不要無限期等待原團隊回覆。'],
    ['繼續等，明天再打電話', false, '症狀加重時不要等待。今天就近就醫，嚴重時撥 119。'],
    ['自己把利尿劑加倍', false, '沒有醫療團隊的個人計畫時，請不要自行調整。']] } },
SAME_DAY_SICK: { claim_id: 'CLM-SAME-DAY-SICK', topic: 'SAFETY_URGENT', group: 'now', rank: 2, risk: 'CRITICAL', title: '一直吐、拉肚子：今天先確認藥要怎麼吃',
  text: '持續嘔吐、腹瀉或吃喝不下時，身體容易缺水。部分利尿劑、SGLT2 inhibitor、ARNI／ACEI／ARB、MRA 與降血糖藥，在這種時候可能需要醫療團隊個別判斷要不要暫停或調整。',
  actions: ['今天聯絡醫療團隊或藥師，說明吃喝的量與嘔吐腹瀉次數', '若醫療團隊事先給過「生病時用藥方式」，照該計畫做', '有糖尿病者留意血糖'],
  who: ['DOCTOR', 'PHARMACIST', 'HF_TEAM'], when: '今天', timing: 'TODAY', escalate: '幾乎沒有尿、嚴重頭暈快昏倒、意識混亂或呼吸急促，立即就醫或撥 119。',
  do_not: '沒有個人計畫時，不要自己決定哪顆藥要停。', ask: '以後生病吃不下時，哪些藥要暫停、何時恢復？請幫我寫下來。',
  evidence: [['KDIGO_DM_CKD_2022', D], ['ACC_HFREF_2024', S], ['HFA_POLY_2025', S]],
  check: { q: '一直吐、拉肚子、幾乎吃不下，藥要怎麼辦？', options: [
    ['今天打電話問醫療團隊哪些藥要先暫停或照常吃', true, '對。生病時有些藥要問過才吃，今天就要問。'],
    ['所有藥照常吃就好，不用問', false, '生病脫水時有些藥可能要暫停，今天要先問醫療團隊。'],
    ['自己把所有藥停掉', false, '不要全部停掉。今天打電話問，由醫療團隊決定。']] } },
SAME_DAY_ICD: { claim_id: 'CLM-SAME-DAY-ICD', topic: 'SAFETY_URGENT', group: 'now', rank: 2, risk: 'CRITICAL', title: '去顫器電擊過一次：今天讓心臟科知道',
  text: '植入式去顫器每一次電擊都需要讓心臟科或裝置追蹤門診知道，由他們判斷是否需要檢查或調整。',
  actions: ['今天聯絡心臟科或裝置追蹤門診', '記下電擊的時間、當時在做什麼、電擊前後的感覺'], who: ['DOCTOR', 'HF_TEAM'], when: '今天', timing: 'TODAY',
  escalate: '電擊後仍不舒服、胸痛、很喘或昏倒，或短時間內又被電擊，立即撥 119。', do_not: '不要自行調整心律或心臟藥物。',
  ask: '這次電擊的原因是什麼？需要調整治療或裝置嗎？', evidence: [['MEDLINEPLUS_ICD', D], ['TW_NFA_119', S]],
  check: { q: '去顫器電擊了一次，現在人還好，應該怎麼做？', options: [
    ['今天聯絡心臟科；再電擊或不舒服就撥 119', true, '對。每一次電擊都要讓心臟科知道。'],
    ['人沒事就不用說', false, '每一次電擊都要今天讓心臟科知道。'],
    ['自己把心臟的藥停掉', false, '不要自己停藥。今天聯絡心臟科。']] } },
CONTACT_TODAY: { claim_id: 'CLM-CONTACT_TODAY', topic: 'SAFETY_URGENT', group: 'now', rank: 3, risk: 'IMPORTANT', title: '最近整個人變差：今天先打電話說一聲',
  text: '您沒有勾到緊急警訊，但整個人比平常差很多。這種時候先講一聲，由醫療團隊決定要不要提早回診，比自己硬撐安全。',
  actions: ['今天聯絡原就醫院所或心衰竭個管師', '說明哪裡變差、從什麼時候開始'],
  who: ['HF_TEAM', 'DOCTOR'], when: '今天', timing: 'TODAY', escalate: '出現嚴重喘、嘴唇發紫、昏倒或持續胸痛，立即撥 119。',
  do_not: NO_SELF_CHANGE, ask: '最近變差的原因可能是什麼？需要提早檢查嗎？',
  evidence: [['NHS_HF', D], ['TW_NFA_119', S]],
  check: { q: '聯絡醫療團隊之前，突然喘到講不出完整句子，應該？', options: [
    ['立即撥打 119', true, '正確。緊急警訊出現時，直接撥 119。'],
    ['先等醫療團隊回電', false, '緊急警訊不能等，請直接撥 119。']] } },
UNCERTAIN_CHANGE: { claim_id: 'CLM-UNCERTAIN_CHANGE', topic: 'WORSENING_CONGESTION', group: 'discuss', rank: 1, risk: 'GENERAL', title: '說不上來有沒有變差？和「自己的平常」比就好',
  text: '把最近幾天的喘、平躺睡覺、腫脹、體重、活動力和食慾，和自己平常比較。只要您很擔心或變化很快，寧可提早聯絡醫療團隊。',
  actions: ['記下最近 3 天和平常不同的地方', '看診時把紀錄給醫療團隊看'],
  who: ['HF_TEAM', 'DOCTOR'], when: '這幾天', timing: 'THIS_WEEK', escalate: '出現本頁「什麼時候要求救」列出的情況，照那裡寫的時間處理。', do_not: '',
  ask: '我這幾天的變化需要處理嗎？', evidence: [['NHS_HF', D]] },
IMPROVED_KEEP_PLAN: { claim_id: 'CLM-IMPROVED_KEEP_PLAN', topic: 'SYMPTOM_OTHER', group: 'learn', rank: 5, risk: 'IMPORTANT', title: '覺得變好了，藥更要繼續吃',
  text: '症狀改善，或心臟超音波顯示射出分率進步，常是治療發揮作用的結果。國際心衰竭指引建議即使症狀已消失或射出分率已經改善，仍繼續可耐受的核心長期治療；是否調整藥物只由醫師決定。這不代表心衰竭已經好了，也不是停藥的訊號。',
  actions: ['繼續照目前的用藥與追蹤計畫'], who: ['DOCTOR'], when: '下次回診', timing: 'NEXT_VISIT', escalate: '', do_not: '不要因為覺得變好或檢查進步就自行停藥。',
  ask: '我的狀況進步了，之後的治療和追蹤計畫是什麼？', evidence: [['ESC_HF_2026', D], ['AHA_HF_2022', S], ['UDHF_2026', S]],
  esc: { cor: 'I', loe: 'C', population: 'HF_with_improved_or_asymptomatic', statement: 'continue highest tolerated FMT', verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } },
/* ================= 用藥 ================= */
MED_UNKNOWN_NAME: { claim_id: 'CLM-MED_UNKNOWN_NAME', topic: 'MED_RECONCILIATION', group: 'now', rank: 4, risk: 'GENERAL', title: '不知道藥名沒關係，我們有兩個方法找出來',
  text: '手機下載「全民健保行動快易通｜健康存摺」App，登入後可查詢自己的就醫與用藥紀錄；也可以把藥袋全部拍照。看診或領藥時拿給醫師或藥師看，比憑記憶準確。',
  actions: ['打開健康存摺查看近期用藥，或請家人協助', '把所有藥袋（含其他科、診所）拍照或裝袋帶去', '請藥師幫您整理成一份用藥清單'],
  who: ['PHARMACIST'], when: '下次看診或領藥時', timing: 'NEXT_VISIT', escalate: '', do_not: '', ask: '可以幫我整理一份完整的用藥清單嗎？',
  evidence: [['NHI_HEALTHBANK', D], ['HFA_POLY_2025', D]] },
MED_REVIEW_ALL: { claim_id: 'CLM-MED_REVIEW_ALL', topic: 'MED_RECONCILIATION', group: 'discuss', rank: 1, risk: 'IMPORTANT', title: '把所有的藥擺在一起，請藥師整理一次',
  text: '處方藥、其他科與診所的藥、成藥、止痛藥、中草藥與保健品都算。整理時逐一確認：為什麼吃、現在是否仍需要、有沒有重複、有沒有交互作用，以及怎麼吃最容易做到。',
  actions: ['把所有正在用的東西裝袋帶去看診（包括中藥與保健品）', '請藥師或醫師逐項確認用途與吃法'],
  who: ['PHARMACIST', 'DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: NO_SELF_CHANGE, ask: '我的藥有沒有重複或互相影響的？有沒有可以簡化的方式？',
  evidence: [['HFA_POLY_2025', D], ['NHI_HEALTHBANK', S]] },
MED_RECON: { claim_id: 'CLM-MED_RECON', topic: 'MED_RECONCILIATION', group: 'now', rank: 4, risk: 'CRITICAL', title: '先確認：您實際在吃的，和藥單上寫的一不一樣',
  text: '藥名、顆數、時段、家中舊藥或不同科別的藥單彼此不一致，或您不確定是否一致時，先把差異列出來，請藥師或醫療團隊核對。差異釐清前，不需要自己猜哪顆要停、要補或要恢復。',
  actions: ['列出哪裡不一樣（哪顆藥、哪個時段、幾顆）', '帶著藥袋與實際在吃的藥，請藥師核對'],
  who: ['PHARMACIST', 'DOCTOR'], when: '這週內；若剛出院或剛換藥，儘早', timing: 'THIS_WEEK', escalate: '若差異涉及抗凝血藥、利尿劑或胰島素，儘早聯絡醫療團隊。',
  do_not: '差異釐清前，不要自行停藥、補藥或恢復舊藥。', ask: '我實際在吃的和藥單不一樣，哪一個才是正確的？',
  evidence: [['HFA_POLY_2025', D], ['JAMA_PHARM_2024', S]],
  check: { q: '發現家裡的藥和新藥單不一樣時，最好的做法是？', options: [
    ['先列出差異，請藥師或醫師核對', true, '正確。核對前不需要自己猜。'],
    ['兩種都吃比較保險', false, '可能造成重複或過量。請先請藥師核對。'],
    ['先全部停掉', false, '突然停藥可能讓病情變差。請先請藥師核對。']] } },

/* ================= 用藥困難 ================= */
ADH_FORGET: { claim_id: 'CLM-ADH_FORGET', topic: 'ADHERENCE_FEASIBILITY', group: 'now', rank: 5, risk: 'IMPORTANT', title: '常忘記：先找出最常漏掉的時間點',
  text: '找出最容易忘記的情境（例如中午不在家、晚上太累），再把吃藥綁在固定的日常事件上，或使用分格藥盒、手機提醒。如果還是常忘記，如實告訴醫療團隊最有幫助，大家才能一起找更容易做到的方法。',
  actions: ['找出最常漏掉的一個時段', '試用分格藥盒或手機鬧鐘', '漏吃怎麼補，先問藥師（不同藥規則不同）'],
  who: ['PHARMACIST', 'HF_TEAM'], when: '這週開始', timing: 'THIS_WEEK', escalate: '', do_not: '漏吃時不要自己一次吃兩倍劑量。', ask: '我哪一顆藥漏吃時要補、哪一顆不用補？',
  evidence: [['HFA_ADHERENCE_2025', D], ['JAMA_PHARM_2024', S]] },
ADH_SIDE: { claim_id: 'CLM-ADH_SIDE', topic: 'ADHERENCE_FEASIBILITY', group: 'now', rank: 5, risk: 'IMPORTANT', title: '吃了不舒服：先記下時間關係，再請團隊判斷',
  text: '記下什麼不舒服、何時開始、和哪一顆藥或哪個時段最接近，以及當時血壓、心跳、體重或水腫有沒有變化。不舒服不一定是藥造成的，交給醫療團隊判斷原因與處理方式。',
  actions: ['記下症狀、時間、和哪顆藥有關', '有血壓計的話記下當時血壓與心跳', '儘早告訴醫師或藥師'],
  who: ['PHARMACIST', 'DOCTOR'], when: '這週內；症狀嚴重時提前', timing: 'THIS_WEEK', escalate: '臉、嘴唇或舌頭突然腫起來、呼吸困難，立即撥 119。',
  do_not: '不要自行停用所有心衰竭藥。', ask: '這個不舒服和哪顆藥有關？有沒有替代方式？',
  evidence: [['HFA_ADHERENCE_2025', D], ['HFA_POLY_2025', S]] },
ADH_COMPLEX: { claim_id: 'CLM-ADH_COMPLEX', topic: 'ADHERENCE_FEASIBILITY', group: 'discuss', rank: 2, risk: 'GENERAL', title: '時段太多、太複雜：可以請團隊一起想簡化方式',
  text: '把實際吃藥的時間與困難告訴醫師或藥師，一起看看能否在安全前提下減少服藥次數，或配合您的作息。簡化的目標是更容易正確使用，不是只追求少幾顆。',
  actions: ['寫下一天實際吃藥的時間表', '看診時請醫師或藥師檢視能否簡化'],
  who: ['PHARMACIST', 'DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '不要自行合併、減少或停掉藥物。', ask: '我的吃藥時間可以簡化嗎？',
  evidence: [['HFA_ADHERENCE_2025', D], ['HFA_POLY_2025', D]] },
ADH_BELIEF: { claim_id: 'CLM-ADH_BELIEF', topic: 'ADHERENCE_FEASIBILITY', group: 'discuss', rank: 2, risk: 'GENERAL', title: '感覺不到效果時，先問清楚每顆藥的目的',
  text: '部分心衰竭藥物的價值在於降低未來惡化或住院的風險，吃了不一定馬上有感覺。可以請醫療團隊說明每顆藥的用途、預期好處、可能副作用與需要追蹤什麼，再一起討論。',
  actions: ['挑一顆最想了解的藥，問清楚它的用途'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '',
  do_not: '不要因為沒感覺就自行停藥。', ask: '這顆藥對我的好處是什麼？不吃的話會怎樣？',
  evidence: [['HFA_ADHERENCE_2025', D], ['ACC_HFREF_2024', S]] },
ADH_SWALLOW: { claim_id: 'CLM-ADH_SWALLOW', topic: 'ADHERENCE_FEASIBILITY', group: 'now', rank: 5, risk: 'IMPORTANT', title: '吞藥有困難：先問藥師這顆藥能不能剝半或磨粉',
  text: '每種藥的劑型不同，有的可以剝半或磨粉，有的不行（例如長效錠、腸溶錠）。吞藥有困難時，先請藥師確認，必要時由醫師改成其他劑型。',
  actions: ['把最難吞的藥拿給藥師看', '請藥師確認可不可以剝半、磨粉或打開膠囊'],
  who: ['PHARMACIST'], when: '下次領藥或看診', timing: 'NEXT_VISIT', escalate: '若因吞不下而停藥，儘早告訴醫療團隊。', do_not: '確認前不要自行磨粉、剝半或打開膠囊。',
  ask: '這顆藥可以剝半或磨粉嗎？有沒有別的劑型？', evidence: [['HFA_ADHERENCE_2025', D]] },
ADH_COST_SKIP: { claim_id: 'CLM-ADH_COST_SKIP', topic: 'ACCESS_COST', group: 'now', rank: 4, risk: 'IMPORTANT', title: '因為藥費或拿藥困難少吃過：說出來，一起找辦法',
  text: '少吃或停掉的，可能正是保護心臟的藥。這不是您的錯；說出來，醫療團隊才能一起想辦法，例如換成負擔得起的選擇、評估能不能開慢性病連續處方箋，或請社工師協助。',
  actions: ['看診時直接說：「這顆藥的費用我負擔有困難」', '問：在確認替代方案或協助以前，我原本的藥要怎麼處理？', '問：這件事由誰負責回覆我？大約多久？（藥師、社工師或個管師）'],
  who: ['DOCTOR', 'PHARMACIST', 'SOCIAL'], when: '這週；已經停了心臟的藥，就先打電話問', timing: 'THIS_WEEK', escalate: '停藥後更喘、更腫或體重很快上升，今天聯絡醫療團隊。',
  do_not: '不要為了省錢自己挑幾顆不吃、減量或換藥，先和醫療團隊討論。', ask: '這顆藥的費用我負擔有困難。可以幫我確認健保、自費、替代方案或協助方案嗎？在確認以前，我原本的藥要怎麼處理？由誰回覆我、大約多久？',
  evidence: [['HFA_ADHERENCE_2025', D], ['POCKET_COST_HF_2025', S], ['NHI_CHRONIC_RX', S]] },
ADH_SELF_STOPPED: { claim_id: 'CLM-ADH_SELF_STOPPED', topic: 'ADHERENCE_FEASIBILITY', group: 'now', rank: 4, risk: 'IMPORTANT', title: '自己停了、減量，或不確定還要不要吃：先問清楚',
  text: '有些心臟的藥吃了沒什麼感覺，卻是在保護心臟；也有些藥真的可以停。哪一顆能停、要不要恢復、怎麼恢復，要由醫師或藥師看過您全部的藥再決定。',
  actions: ['把停掉或減量的藥挑出來，記下從什麼時候開始、為什麼', '這週打電話或回診時問：這顆藥要恢復嗎？怎麼恢復？'],
  who: ['DOCTOR', 'PHARMACIST'], when: '這週', timing: 'THIS_WEEK', escalate: '停藥後更喘、更腫、心跳很快或頭暈，今天聯絡醫療團隊。',
  do_not: '確認前，不要自己一次把停掉的藥全部吃回來，也不要再停其他藥。', ask: '我停掉（或減量）的這顆藥，要恢復嗎？怎麼恢復？',
  evidence: [['HFA_ADHERENCE_2025', D], ['HFA_POLY_2025', S]] },
ACTIVITY_WAIT: { claim_id: 'CLM-ACTIVITY_WAIT', topic: 'SELF_CARE_EDUCATION', group: 'discuss', rank: 2, risk: 'GENERAL', title: '先處理今天的變化，運動等穩定了再開始',
  text: '您這次有需要今天處理的變化，或覺得最近比平常差。這種時候先不要開始新的運動或加量；等醫療團隊看過、病情穩定了，再一起訂適合您的活動計畫。',
  actions: ['先照上面「今天先做」處理', '穩定之後，問醫師什麼時候可以開始、適不適合心臟復健'],
  who: ['DOCTOR', 'REHAB'], when: '病情穩定之後', timing: 'NEXT_VISIT', escalate: '出現本頁「什麼時候要求救」列出的情況，照那裡寫的時間處理。',
  do_not: '身體正在變差時，不要硬撐著運動。', ask: '我什麼時候可以開始運動？適合心臟復健嗎？',
  evidence: [['HFA_EXERCISE', D], ['ESC_HF_2026', S]] },
ADH_LITERACY: { claim_id: 'CLM-ADH_LITERACY', topic: 'ADHERENCE_FEASIBILITY', group: 'now', rank: 5, risk: 'IMPORTANT', title: '看不懂藥袋，不是您的問題',
  text: '可以請醫師或藥師一次先說清楚三件事：這顆藥做什麼、怎麼用、什麼情況要回報。最後用自己的話說一次，確認雙方理解一致。',
  actions: ['請藥師用簡單的話說明三件事', '用自己的話說一次給藥師聽'], who: ['PHARMACIST', 'NURSE'], when: '下次領藥或看診', timing: 'NEXT_VISIT', escalate: '', do_not: '',
  ask: '可以用簡單的方式再說明一次嗎？我說一次給您聽，看看對不對。', evidence: [['AHRQ_TEACHBACK', D], ['HFA_ADHERENCE_2025', S]] },
ADH_CARE: { claim_id: 'CLM-ADH_CARE', topic: 'ADHERENCE_FEASIBILITY', group: 'discuss', rank: 3, risk: 'GENERAL', title: '需要家人協助時：大家用同一份藥單',
  text: '經您同意後，可以由固定的照顧者一起核對藥物、症狀與回診問題，避免不同家人各自用不同版本的藥單。',
  actions: ['決定一位主要協助的家人', '請藥師提供一份最新用藥清單給大家共用'], who: ['PHARMACIST', 'NURSE'], when: '這週', timing: 'THIS_WEEK', escalate: '', do_not: '',
  ask: '可以給我們一份最新的用藥清單嗎？', evidence: [['HFA_ADHERENCE_2025', D]] },
ADH_GENERIC: { claim_id: 'CLM-ADH_GENERIC', topic: 'ADHERENCE_FEASIBILITY', group: 'discuss', rank: 3, risk: 'GENERAL', title: '先找出最影響您用藥的原因，再一起找方法',
  text: '忘記、不舒服、費用、領藥不便、藥太多、吞嚥困難或不清楚用途，各有不同的解法；原因也可能不只一個，會隨時間改變。',
  actions: ['想一想最影響您的一個原因', '看診時直接說出來'], who: ['PHARMACIST', 'HF_TEAM'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '',
  ask: '我用藥上的困難可以怎麼改善？', evidence: [['HFA_ADHERENCE_2025', D]] },

/* ================= 費用與取得 ================= */
ACC_COST: { claim_id: 'CLM-ACC_COST', topic: 'ACCESS_COST', group: 'now', rank: 5, risk: 'IMPORTANT', title: '藥費有負擔：直接說出來，才能一起納入決定',
  text: '費用會影響能不能持續治療，醫療團隊需要知道。實際健保給付與自付金額因人、因院所而異，本工具無法估算。可以直接問三個問題。',
  actions: ['問：這個藥健保有給付嗎？我大約每個月要自付多少？', '問：如果負擔太重，有沒有安全可行的替代或協助方案？在確認以前，原本的藥要怎麼處理？', '問：這件事由誰負責回覆我、大約多久？'],
  who: ['DOCTOR', 'PHARMACIST', 'SOCIAL'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '不要因為費用自行停藥或減量，先和醫療團隊討論。',
  ask: '這個藥健保有給付嗎？自付大約多少？負擔太重時有沒有替代或協助方案？確認以前原本的藥怎麼處理？由誰回覆我？', evidence: [['ACC_HFREF_2024', D], ['POCKET_COST_HF_2025', S]] },
ACC_PICKUP: { claim_id: 'CLM-ACC_PICKUP', topic: 'ACCESS_COST', group: 'discuss', rank: 2, risk: 'GENERAL', title: '領藥不方便：可以問是否適合慢性病連續處方箋',
  text: '病情穩定的慢性病人，醫師可依病情開立「慢性病連續處方箋」，第二次以後可到住家附近的健保特約藥局領藥，由藥師調劑並提供用藥諮詢。是否適合由醫師判斷。',
  actions: ['看診時問醫師是否適合開慢性病連續處方箋', '找一家住家附近固定的健保藥局'],
  who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '', ask: '我適合開慢性病連續處方箋嗎？',
  evidence: [['NHI_CHRONIC_RX', D]] },
ACC_TRANSPORT: { claim_id: 'CLM-ACC_TRANSPORT', topic: 'ACCESS_COST', group: 'discuss', rank: 2, risk: 'GENERAL', title: '回診交通有困難：可以詢問長照與社工資源',
  text: '符合資格者，長照服務包含交通接送等項目；可以撥打 1966 長照服務專線詢問。也可以請醫院社工師協助了解可用資源，或請醫師評估能否減少往返次數（例如慢性病連續處方箋）。',
  actions: ['撥打 1966 詢問交通接送等服務資格', '請醫院社工師協助'], who: ['LTC_1966', 'SOCIAL'], when: '這週', timing: 'THIS_WEEK', escalate: '', do_not: '不要因為交通不便而中斷回診或停藥，先說出來。',
  ask: '有沒有交通或回診上的協助資源？', evidence: [['MOHW_1966', D], ['NHI_CHRONIC_RX', S]] },
ACC_CARE_SUPPORT: { claim_id: 'CLM-ACC_CARE_SUPPORT', topic: 'ACCESS_COST', group: 'discuss', rank: 2, risk: 'GENERAL', title: '照顧人手不足、家人很累：可以找這些支持',
  text: '1966 長照服務專線可詢問居家照顧、喘息服務等長照資源；家庭照顧者關懷專線 0800-507272 提供照顧者諮詢與支持。醫院社工師也能協助連結資源。',
  actions: ['撥打 1966 詢問長照服務', '照顧者可撥 0800-507272', '請醫院社工師協助評估'], who: ['LTC_1966', 'CAREGIVER_LINE', 'SOCIAL'], when: '這週', timing: 'THIS_WEEK', escalate: '', do_not: '',
  ask: '我們家的照顧情況，可以申請哪些協助？', evidence: [['MOHW_1966', D], ['MOHW_CAREGIVER_LINE', D]] },
ACC_INFO: { claim_id: 'CLM-ACC_INFO', topic: 'ACCESS_COST', group: 'discuss', rank: 2, risk: 'GENERAL', title: '資訊太多看不懂：一次只抓三件事',
  text: '請醫療團隊一次先說明三件最重要的事：現在最需要做什麼、藥怎麼用、什麼情況要回報。用自己的話說一次，確認理解一致；也可以請家人一起聽。',
  actions: ['看診時請醫師或護理師先講最重要的三件事', '把本頁的摘要列印帶去'], who: ['NURSE', 'PHARMACIST', 'DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '',
  ask: '我現在最重要的三件事是什麼？', evidence: [['AHRQ_TEACHBACK', D]] },
ACC_OTHER: { claim_id: 'CLM-ACC_OTHER', topic: 'ACCESS_COST', group: 'discuss', rank: 3, risk: 'GENERAL', title: '其他影響治療的困難，也可以找社工師',
  text: '工作、經濟、居住或家庭等問題，都可能影響能不能持續照護。醫院社工師可以協助了解可用的資源。',
  actions: ['請醫療團隊轉介社工師'], who: ['SOCIAL'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '', ask: '可以幫我轉介社工師嗎？',
  evidence: [['ESC_HF_2026', D], ['MOHW_1966', S]] },

/* ================= 症狀 ================= */
SYM_BREATH: { claim_id: 'CLM-SYM_BREATH', topic: 'WORSENING_CONGESTION', group: 'now', rank: 5, risk: 'IMPORTANT', title: '喘：看「和平常比」有沒有變差',
  text: '留意同樣的活動是否比平常更喘、躺平是否更喘、夜裡是否喘醒。喘不一定都是心衰竭造成，也可能來自肺部、貧血、感染或其他原因，需要醫療團隊判斷。',
  actions: ['記下什麼活動會喘、平躺時是否更喘', '回診時告訴醫療團隊變化'], who: ['HF_TEAM', 'DOCTOR'], when: '這幾天記錄；明顯變差時當天聯絡', timing: 'THIS_WEEK',
  escalate: '喘到講不出完整句子、嘴唇發紫，立即撥 119；比平常明顯更喘，當天聯絡醫療團隊。', do_not: '不要自行加減利尿劑，除非已有個人調整計畫。',
  ask: '我的喘是心衰竭造成的嗎？需要調整治療嗎？', evidence: [['NHS_HF', D], ['ESC_HF_2026', S]] },
SYM_SWELL: { claim_id: 'CLM-SYM_SWELL', topic: 'WORSENING_CONGESTION', group: 'now', rank: 5, risk: 'IMPORTANT', title: '水腫或體重增加：固定方式量體重，看趨勢',
  text: '每天早上起床、上完廁所、吃早餐前，用同一台體重計量體重並記錄。短時間體重明顯上升或腫脹增加，可能是體內積水。每個人的警戒值不同，請以醫療團隊給您的個人計畫為準。',
  actions: ['每天固定時間量體重並寫下來', '請醫療團隊告訴您個人的體重警戒值'], who: ['HF_TEAM', 'DOCTOR'], when: '每天', timing: 'ONGOING',
  escalate: '這幾天明顯更腫或體重突然上升，當天聯絡醫療團隊。', do_not: '沒有個人計畫時，不要自行加倍利尿劑。',
  ask: '我的體重增加多少要聯絡你們？', evidence: [['NHS_HF', D], ['MEDLINEPLUS_HF_HOME', D], ['HFA_WEIGHT', S], ['AHA_HF_2022', S]],
  teach: { prompt: '明天早上，您會在什麼時候、怎麼量體重？', hint: '起床、上完廁所、吃東西前，用同一台秤，量完寫下來。' } },
SYM_FATIGUE: { claim_id: 'CLM-SYM_FATIGUE', topic: 'SYMPTOM_OTHER', group: 'discuss', rank: 2, risk: 'GENERAL', title: '疲倦沒力氣：原因可能不只一個',
  text: '心衰竭、貧血或缺鐵、睡眠問題、情緒、甲狀腺、藥物副作用或營養不足，都可能讓人疲倦。可以請醫療團隊一起找原因，例如是否需要檢查鐵的狀態。',
  actions: ['記下疲倦從什麼時候開始、影響哪些活動', '問醫師是否需要抽血檢查（例如貧血、鐵）'], who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '突然明顯變差、合併胸痛或昏倒，照本頁「什麼時候要求救」處理。',
  do_not: '不要自行購買補品或補鐵劑來試。', ask: '我的疲倦可能是什麼原因？需要檢查鐵或貧血嗎？', evidence: [['ESC_HF_2026', D], ['AHA_HF_2022', S]] },
SYM_DIZZY: { claim_id: 'CLM-SYM_DIZZY', topic: 'SYMPTOM_OTHER', group: 'now', rank: 5, risk: 'IMPORTANT', title: '頭暈、站起來會暈：慢慢起身，並記下血壓',
  text: '頭暈可能和血壓偏低、水分不足、心跳太慢或太快、藥物有關。從躺或坐到站起來時，先坐一下再慢慢站。有血壓計的話，記下頭暈時的血壓與心跳。',
  actions: ['起身前先坐 1 分鐘再站', '頭暈時量血壓與心跳並記錄', '儘早告訴醫療團隊'], who: ['DOCTOR', 'PHARMACIST'], when: '這週內', timing: 'THIS_WEEK',
  escalate: '昏倒、快昏倒合併胸痛或心跳很快很慢，撥 119。', do_not: '不要自行停掉降血壓或心臟藥物。',
  ask: '我的頭暈和藥物有關嗎？需要調整嗎？', evidence: [['HFA_POLY_2025', D], ['NHS_HF', S]] },
SYM_NIGHT_BREATH: { claim_id: 'CLM-SYM_NIGHT_BREATH', topic: 'WORSENING_CONGESTION', group: 'now', rank: 4, risk: 'IMPORTANT', title: '躺平會喘、半夜喘醒：這是要讓醫療團隊知道的變化',
  text: '躺下去就喘、半夜被喘醒要坐起來、或睡覺要多墊枕頭，常和身體積水有關，是心衰竭在變化的訊號之一。這和打呼是兩件不同的事。',
  detail: '臨床上稱為端坐呼吸（orthopnea）與陣發性夜間呼吸困難（PND），與睡眠呼吸中止的機轉不同，處理方式也不一樣。',
  actions: ['記下這幾天睡覺需要墊幾個枕頭、有沒有被喘醒', '如果比以前嚴重，今天就聯絡醫療團隊'], who: ['HF_TEAM', 'DOCTOR'], when: '今天；沒有變嚴重則下次看診', timing: 'TODAY',
  escalate: '喘到坐著也不能緩解、講不出完整句子，立刻打 119。', do_not: '不要自己吃安眠藥來對付半夜喘醒。', ask: '我半夜喘醒是不是積水造成的？需要調整治療嗎？',
  evidence: [['NHS_HF', D], ['ESC_HF_2026', D], ['ACC_HFPEF_2026', S]] },
SYM_SNORING: { claim_id: 'CLM-SYM_SNORING', topic: 'SYMPTOM_OTHER', group: 'discuss', rank: 2, risk: 'GENERAL', title: '打呼很大聲、睡覺像停住呼吸：問醫師要不要做睡眠檢查',
  text: '大聲打呼、旁邊的人看到您睡覺時呼吸停住、白天很想睡，可能是睡眠呼吸中止。這在心衰竭病人不少見，可以檢查，也有處理方式。',
  actions: ['請家人觀察並記下有沒有呼吸停住', '下次看診問：我需要做睡眠檢查嗎'], who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT',
  escalate: '如果同時開始躺平就喘、半夜喘醒，那比較像積水，請當天聯絡醫療團隊。', do_not: '不要自己買止鼾產品就當作處理完了。', ask: '我需要做睡眠呼吸檢查嗎？',
  evidence: [['ACC_HFPEF_2026', D], ['ESC_HF_2026', S]] },
SYM_APPETITE: { claim_id: 'CLM-SYM_APPETITE', topic: 'SYMPTOM_OTHER', group: 'discuss', rank: 2, risk: 'GENERAL', title: '吃不下、體重莫名下降：營養也是治療的一部分',
  text: '沒有刻意減肥卻一直瘦、吃得比以前少、力氣變小，都要讓醫療團隊知道；這可能是營養不夠或肌肉流失，也可能是肚子積水讓人吃不下。少量多餐、選軟一點的食物，比較不會吃到喘。要吃多少蛋白質，請營養師依您的腎功能個別建議。',
  actions: ['記下這個月吃的量和體重變化', '先試試少量多餐，每一餐都有一點豆、魚、蛋或肉', '請醫療團隊轉介營養師；也問能不能做肌力或復健運動'], who: ['DIETITIAN', 'DOCTOR', 'REHAB'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '幾乎吃不下喝不下，當天聯絡醫療團隊。',
  do_not: '不要自行採用非常嚴格的飲食限制；腎臟不好的人，不要自己大量補充蛋白質。', ask: '我需要營養師評估嗎？我適合吃多少蛋白質、做哪些肌力運動？', evidence: [['ESC_HF_2026', D], ['HFA_SODIUM_FLUID_2024', S], ['CLEVELAND_CACHEXIA', S]] },

/* ================= 出院後 ================= */
POST_RECON: { claim_id: 'CLM-POST_RECON', topic: 'TRANSITION_POST_DISCHARGE', group: 'now', rank: 4, risk: 'IMPORTANT', title: '剛出院第一件事：核對出院藥單和家中的藥',
  text: '住院期間常會新增、停用、暫停或改變劑量。請對照出院藥單確認：每一顆藥是新增、停用、暫停還是改劑量，原因是什麼，暫停的藥何時、由誰決定恢復。',
  actions: ['拿出院藥單和家中所有藥逐一比對', '不清楚的地方打電話問出院醫院的藥師或護理師', '把住院前的舊藥先收起來，不要混用'],
  who: ['PHARMACIST', 'HF_TEAM', 'DOCTOR'], when: '出院當天到 3 天內', timing: 'THIS_WEEK', escalate: '發現抗凝血藥、利尿劑或胰島素有疑問，當天詢問。',
  do_not: '不要自行把住院前的舊藥全部恢復。', ask: '住院時暫停的藥，什麼時候、由誰決定要不要恢復？如果這次是因為心衰竭住院：我的長期心衰竭藥是否已經重新檢查完整？',
  evidence: [['HFA_POLY_2025', D], ['ACC_HFREF_2024', S]],
  check: { q: '出院後發現住院前的舊藥還在家裡，應該？', options: [
    ['先收起來，對照出院藥單並請藥師確認', true, '正確。舊藥是否恢復，要由醫療團隊決定。'],
    ['和新藥一起吃', false, '可能重複或過量。請先核對。']] } },
POST_MONITOR: { claim_id: 'CLM-POST_MONITOR', topic: 'TRANSITION_POST_DISCHARGE', group: 'discuss', rank: 1, risk: 'GENERAL', title: '心衰竭惡化住院後：確認要追蹤哪些項目與核心治療',
  text: '心衰竭惡化（失代償）住院後的前幾週是容易再變化的時期。請依出院醫囑確認何時量血壓與體重、是否需要追蹤腎功能或血鉀；也可以問住院期間是否已評估核心長期治療（例如 SGLT2 inhibitor（保護心腎的排糖藥）），以及出院後怎麼逐步調整。資料沒寫清楚時，請向原照護團隊確認。',
  actions: ['確認要每天量體重、血壓嗎', '確認下次抽血是哪一天', '問：住院期間是否已評估或開始核心長期治療'], who: ['HF_TEAM', 'DOCTOR', 'PHARMACIST'], when: '出院一週內', timing: 'THIS_WEEK', escalate: '體重快速上升、更喘或更腫，當天聯絡。',
  do_not: '不要自行調整利尿劑或其他藥物，除非醫療團隊已給您書面計畫。', ask: '出院後我要量哪些東西？下次抽血是什麼時候？住院期間有沒有評估 SGLT2 inhibitor 等核心治療？',
  evidence: [['ESC_HF_2026', D], ['ACC_HOSP_HF_2024', D], ['ACC_HFREF_2024', S]],
  esc: { cor: 'I', loe: 'B1', population: 'DHF_after_stabilization', statement: 'in-hospital SGLT2i initiation; early follow-up', verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } },
POST_FOLLOW: { claim_id: 'CLM-POST_FOLLOW', topic: 'TRANSITION_POST_DISCHARGE', group: 'now', rank: 4, risk: 'IMPORTANT', title: '出院後：知道「下一個聯絡點」',
  text: '確認下一次回診的日期與科別、誰負責追蹤您的心衰竭，以及症狀變差時要找誰、打哪支電話。安排不清楚時，主動向原照護團隊確認。',
  actions: ['確認下次回診日期與科別', '把醫院或個管師的聯絡電話記在手機'], who: ['HF_TEAM', 'DOCTOR'], when: '出院前或出院後幾天內', timing: 'THIS_WEEK', escalate: '', do_not: '',
  ask: '出院後誰負責追蹤我？有狀況要打哪支電話？', evidence: [['ACC_HFREF_2024', D], ['ESC_HF_2026', S]] },

/* ================= 共病 ================= */
CO_CKD: { claim_id: 'CLM-CO_CKD', topic: 'MONITORING_LAB', group: 'discuss', rank: 3, risk: 'GENERAL', title: '腎功能與血鉀：要和血壓、體液一起看',
  text: '心衰竭與腎臟常互相影響。開始或調整部分心衰竭藥物後，腎功能或血鉀可能出現可預期的變化，需要醫師放回整體情況判讀，不宜只憑一次抽血數值自行停藥。',
  actions: ['知道自己下一次抽血的時間', '回診時問抽血結果的意思'], who: ['DOCTOR', 'PHARMACIST'], when: '每次抽血後', timing: 'NEXT_VISIT', escalate: '尿量比平常明顯少，又吐、拉肚子或吃喝不下，今天聯絡醫療團隊。',
  do_not: '不要只看一次腎功能指數（eGFR 或肌酸酐）就自行停藥；不要自行使用含鉀代鹽。', ask: '我的腎功能和血鉀，目前需要調整藥物嗎？',
  evidence: [['NIDIRECT_AKI', S], ['ESC_CKD_2026', D], ['ACC_HFREF_2024', D], ['ACC_HFPEF_2026', D], ['ESC_HF_2026', S]] },
CO_AF: { claim_id: 'CLM-CO_AF', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 3, risk: 'GENERAL', title: '心房顫動：心跳、中風預防與心衰竭要一起看',
  text: '心房顫動照護通常包括控制心跳或心律、評估是否需要抗凝血藥預防中風，以及整合腎功能與出血風險。心悸、喘或頭暈變化都可以告訴醫師。',
  actions: ['記下心悸發生的時間與感覺', '確認自己是否在使用抗凝血藥'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT',
  escalate: '突然嘴歪、單側無力、說話不清，立即撥 119。', do_not: '不要自行停用抗凝血藥。', ask: '我需要抗凝血藥嗎？心跳控制得如何？',
  evidence: [['ESC_AF_2024', D], ['ESC_HF_2026', S]] },
CO_DM: { claim_id: 'CLM-CO_DM', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 3, risk: 'GENERAL', title: '糖尿病、腎臟與心衰竭：同一張治療地圖',
  text: '同一類藥物（例如 SGLT2 inhibitor）可能同時照顧血糖、心衰竭與腎臟。部分糖尿病藥（例如 pioglitazone）可能讓水腫或心衰竭變差；若正在使用，請回診時確認是否仍適合。各科的藥請放在同一份清單。',
  actions: ['把糖尿病藥與心臟藥列在同一份清單', '確認生病吃不下時降血糖藥怎麼處理'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '低血糖導致意識不清，撥 119。',
  do_not: '不要自行停用正在使用的糖尿病藥。', ask: '我的糖尿病藥對心衰竭有沒有影響？',
  evidence: [['AHA_HF_2022', D], ['AHA_DRUGS_HF_2016', D], ['ACC_HFPEF_2026', S]] },
CO_CAD_HTN: { claim_id: 'CLM-CO_CAD_HTN', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 3, risk: 'GENERAL', title: '冠心症、支架與高血壓：也是心衰竭照護的一部分',
  text: '冠心症與血壓會影響症狀與藥物選擇。裝過支架者，抗血小板藥的療程由心臟科醫師決定。使用硝酸鹽類藥物（例如 isosorbide、舌下 nitroglycerin）時，不可合併威而鋼類藥物（sildenafil 等）。',
  actions: ['記錄家中血壓', '確認抗血小板藥還要吃多久'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '持續胸痛或胸口壓迫感，撥 119。',
  do_not: '不要因為一次血壓數值自行改藥；裝支架後不要自行停用抗血小板藥。', ask: '我的抗血小板藥還要吃多久？血壓目標是多少？',
  evidence: [['ESC_ACS_2023', D], ['AHA_DRUGS_HF_2016', S], ['ESC_HF_2026', S]] },
CO_OBESITY: { claim_id: 'CLM-CO_OBESITY', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 3, risk: 'GENERAL', title: '體重過重：減重也是心衰竭照護的一部分',
  text: '體重過重的心衰竭病人，減重可能改善活動能力和生活品質；有些人適合和醫師討論減重的藥。減重也要保住肌力和營養，年紀大或體力差的人更要注意。不知道自己的射出分率或 BMI，可以在「再補一題」填寫或略過。',
  detail: '2026 歐洲心臟學會（ESC）指引建議：有症狀心衰竭、LVEF（射出分率）45% 以上且 BMI 30 以上者，醫療團隊可考慮 semaglutide 或 tirzepatide，以減重並改善活動能力與生活品質，有無糖尿病都適用；這項建議只針對這兩種藥。',
  actions: ['和醫師討論適合自己的體重目標與方法', '詢問營養師或心臟復健'], who: ['DOCTOR', 'DIETITIAN', 'REHAB'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '不要自行購買或使用來源不明的減重藥或針劑。',
  ask: '以我的 LVEF（射出分率）和 BMI，適合討論 semaglutide 或 tirzepatide 嗎？健保是否給付？', evidence: [['ESC_HF_2026', D], ['ACC_HFPEF_2026', S], ['TSOC_HFPEF_2024', S]],
  esc: { cor: 'IIa', loe: 'B1', population: 'symptomatic_HF', lvef_rule: '>=45', bmi_rule: '>=30', drug_scope: 'semaglutide,tirzepatide', verification: 'SAME_STATEMENT_AS_LEDGER_SEQ4/6_SUPPORTED_2026-09-27（CLM-MED-GLP1、CLM-RULE_GLP1_ELIGIBLE；ESC 2026 Table 5 p.12、Rec Table 18 p.65）' } },
CO_FRAILTY: { claim_id: 'CLM-CO_FRAILTY', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 3, risk: 'GENERAL', title: '衰弱、頭暈或跌倒：把功能和用藥一起評估',
  text: '衰弱涉及體力、營養、認知、情緒與社會支持，不是只看年齡或一次跌倒。站起來頭暈、站不穩或最近跌倒，請把發生時間、血壓、喝水與用藥情況一起告訴醫療團隊，必要時轉介復健。',
  actions: ['記下跌倒或頭暈的時間與情境', '詢問是否適合復健或居家安全評估'], who: ['DOCTOR', 'PHARMACIST', 'REHAB'], when: '下次看診；跌倒受傷時當天', timing: 'NEXT_VISIT',
  escalate: '使用抗凝血藥時跌倒撞到頭，即使沒有症狀，也請儘快到急診評估；頭痛加劇、嘔吐、嗜睡或意識改變，撥 119。', do_not: '不要為了怕跌倒而自行停掉全部心衰竭藥。', ask: '我的頭暈跌倒和藥有關嗎？可以做復健嗎？',
  evidence: [['HFA_POLY_2025', D], ['ESC_HF_2026', S]] },
CO_ANEMIA_IRON: { claim_id: 'CLM-CO_ANEMIA_IRON', topic: 'MONITORING_LAB', group: 'discuss', rank: 3, risk: 'GENERAL', title: '長期疲倦：心衰竭的缺鐵不等於貧血',
  text: '缺鐵可以發生在血紅素正常的心衰竭病人。2026 ESC 支持以運鐵蛋白飽和度（TSAT）低於 20% 作為判定心衰竭缺鐵較合適的標準；ferritin 仍會一起檢驗，但容易受發炎影響，不宜單獨判斷。若有持續疲倦、活動耐受變差，或曾經缺鐵，可以問醫師是否驗過 TSAT 與 ferritin。',
  actions: ['問醫師是否驗過 TSAT 與 ferritin'], who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '解黑便或血便，現在到急診。', do_not: '不要自行長期服用補鐵劑，先由醫師評估。',
  ask: '我需要驗 TSAT 和 ferritin 嗎？', evidence: [['ESC_HF_2026', D], ['AHA_HF_2022', S]],
  esc: { definition: 'HF iron deficiency = TSAT<20%; ferritin contextual', verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } },
CO_SLEEP_LUNG: { claim_id: 'CLM-CO_SLEEP_LUNG', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 3, risk: 'GENERAL', title: '睡眠與肺部疾病：喘不一定都來自心臟',
  text: '明顯打鼾、睡眠中呼吸中止、白天嗜睡，或同時有 COPD、氣喘，都可能讓喘與疲倦更複雜。告訴醫療團隊，避免所有症狀都只歸因於心衰竭。',
  actions: ['把吸入劑也列入用藥清單'], who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '', ask: '我的喘有沒有肺部或睡眠的原因？',
  evidence: [['ACC_HFPEF_2026', D], ['ESC_HF_2026', S]] },
CO_VALVE: { claim_id: 'CLM-CO_VALVE', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 3, risk: 'GENERAL', title: '瓣膜疾病：症狀變化要和心臟超音波一起追蹤',
  text: '瓣膜疾病的嚴重度與處理時機，需要依症狀、心臟超音波與整體狀況判斷。症狀變化時告訴醫師，並按時回診追蹤檢查。',
  actions: ['確認下次心臟超音波的時間'], who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '昏倒或胸痛，撥 119。', do_not: '', ask: '我的瓣膜需要處理嗎？多久追蹤一次？',
  evidence: [['ESC_HF_2026', D]] },
CO_MOOD_COG: { claim_id: 'CLM-CO_MOOD_COG', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 3, risk: 'GENERAL', title: '情緒與記憶也會影響照護',
  text: '明顯的憂鬱、焦慮、記憶變差或難以管理多項指示，都值得告訴醫療團隊；必要時可以讓固定的照顧者一起參與照護計畫。情緒很低落時，可撥 1925 安心專線（24 小時）。',
  actions: ['告訴醫療團隊最近的情緒或記憶困難', '需要時請家人一起參與'], who: ['DOCTOR', 'MENTAL', 'NURSE', 'MENTAL_1925'], when: '下次看診；很難受時立即撥 1925', timing: 'NEXT_VISIT', escalate: '有傷害自己的念頭時，立即撥 1925 或 119。',
  do_not: '', ask: '我的情緒或記憶問題可以找誰協助？', evidence: [['MOHW_1925', D], ['HFA_ADHERENCE_2025', D], ['AHA_PALLIATIVE_2025', S]] },
CO_PAIN_GOUT: { claim_id: 'CLM-CO_PAIN_GOUT', topic: 'MED_TOLERABILITY', group: 'now', rank: 5, risk: 'IMPORTANT', title: '常需要止痛藥：先讓醫師或藥師選擇',
  text: '消炎止痛藥（NSAIDs，成分例如 ibuprofen、naproxen、diclofenac、celecoxib）可能讓身體留水、傷腎，讓心衰竭變差，一般不建議使用。痛風或關節痛需要止痛時，先讓醫師或藥師挑適合您的方式；不是所有止痛方式都不能用。',
  detail: 'celecoxib 屬 COX-2 類。口服或全身性使用可能造成水分滯留、腎功能惡化或心衰竭變差。',
  actions: ['把目前用的止痛藥（含自己買的）告訴醫師或藥師', '問痛風發作時該怎麼處理'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診；發作前先問好', timing: 'NEXT_VISIT', escalate: '',
  do_not: '不要自行購買或使用消炎止痛藥；也不要自行停掉醫師已開立的藥。', ask: '我痛風或關節痛時，可以用哪一種止痛方式？',
  evidence: [['ESC_HF_2026', D], ['AHA_HF_2022', S], ['AHA_DRUGS_HF_2016', D]], esc: { cor: 'III', loe: 'B2', drug_scope: 'NSAIDs,COX-2', verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } },
/* ================= 日常自我照護 ================= */
SELF_DAILY: { claim_id: 'CLM-SELF_DAILY', topic: 'SELF_CARE_EDUCATION', group: 'learn', rank: 1, risk: 'GENERAL', title: '每天注意「和自己平常有沒有不同」',
  text: '不用記很多數字。例如原本走到廁所不會喘，這兩天走同樣距離卻明顯更喘，就值得記下來，並依變化程度聯絡醫療團隊。若醫療團隊給過您個人的體重或症狀警戒值，以該計畫為準。',
  actions: ['每天留意呼吸、平躺、腫脹、活動力', '固定時間量體重'], who: ['HF_TEAM'], when: '每天', timing: 'ONGOING', escalate: '出現本頁「什麼時候要求救」列出的情況，照那裡寫的時間處理。', do_not: '',
  ask: '我的個人警戒值是什麼？', evidence: [['NHS_HF', D], ['ESC_HF_2026', S]] },
SELF_ACTIVITY: { claim_id: 'CLM-SELF_ACTIVITY', topic: 'SELF_CARE_EDUCATION', group: 'learn', rank: 2, risk: 'GENERAL', title: '病情穩定時，個別化運動是心衰竭治療的一部分',
  text: '病情穩定時，適合自己的運動是治療的一部分。先和醫師談、從每天走一小段開始，慢慢增加；運動時還能說話的程度剛好，說不出話就是太用力。可以問問看能不能參加心臟復健。',
  detail: '沒有運動禁忌、病情穩定時，國際心衰竭指引建議在心臟復健團隊指導下進行個別化運動訓練；即使沒有參加正式心臟復健，也建議和醫療團隊討論可以長期維持的個別化活動方式，可改善活動能力與生活品質。若最近因心衰竭惡化住院，等病情穩定並經醫療團隊確認安全後，可儘早詢問開始心臟復健。',
  actions: ['開始或加量之前，先問醫師或護理師', '從每天走一小段開始，運動時還能說完整句子', '問醫師是否適合轉介心臟復健'], who: ['DOCTOR', 'REHAB'], when: '病情穩定時', timing: 'ONGOING',
  escalate: '運動中喘、頭暈、胸痛、噁心或冒冷汗，立刻停下來；休息後還是不舒服就聯絡醫療團隊，胸痛不退或喘到說不出話打 119。正在變喘、發燒或快速惡化時，先不要運動。',
  do_not: '不要自行套用別人的運動強度；不要在吃很飽或空腹時運動。', ask: '我適合做心臟復健嗎？平常可以做哪些活動、做到什麼程度？', evidence: [['ESC_HF_2026', D], ['HFA_EXERCISE', D]],
  esc: { cor: 'I', loe: 'B1 (rehab) / B2 (long-term)', population: 'stable_HF', verification: 'I B1 SECONDARY_SOURCES_CONFIRMED；I B2 與 DHF IIa B1 USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } },
SELF_NUTRITION: { claim_id: 'CLM-SELF_NUTRITION', topic: 'SELF_CARE_EDUCATION', group: 'learn', rank: 2, risk: 'GENERAL', title: '飲食：避免太鹹，同時吃得夠、吃得均衡',
  text: '避免過量鹽分（例如醃漬品、加工食品、湯汁、沾醬），同時要吃得夠、吃得均衡。不要自行套用非常嚴格的低鹽餐單。食慾差、體重持續下降或肌力變差，請告訴醫療團隊或營養師。',
  actions: ['少喝湯汁、少沾醬、少吃醃漬與加工食品', '買東西時看營養標示上的「鈉」，同一類挑鈉比較少的', '外食時湯不要喝完、醬汁另外放', '需要時請營養師提供個別建議'], who: ['DIETITIAN'], when: '日常', timing: 'ONGOING', escalate: '', do_not: '腎功能或血鉀有問題者，使用低鈉鹽（含鉀代鹽）前先問醫師。',
  ask: '我需要特別限制哪些食物嗎？', evidence: [['AHA_HF_2022', D], ['HFA_SODIUM_FLUID_2024', D], ['MEDLINEPLUS_HF_HOME', S], ['CFS_HK_KCL_SALT', S], ['HPA_SODIUM', S]] },
SELF_FLUID: { claim_id: 'CLM-SELF_FLUID', topic: 'SELF_CARE_EDUCATION', group: 'learn', rank: 2, risk: 'GENERAL', title: '慢性心衰竭：不需要例行套用固定限水量',
  text: '大多數病情穩定的心衰竭病人，不需要一律限水。醫療團隊因為血鈉偏低、剛出院或其他原因，給您個人的喝水量時，就照那個量。沒有限水，也不代表要刻意多喝；天氣很熱、發燒或拉肚子時需要的水會變多，先問醫療團隊。',
  detail: '2026 歐洲心臟學會（ESC）心衰竭指引指出，慢性心衰竭沒有證據支持一律固定限水；是否限水、限多少，由醫療團隊依血鈉、體液狀態等個別決定。',
  actions: ['問醫療團隊您是否有個人飲水計畫'], who: ['DOCTOR', 'HF_TEAM'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '不要自行大幅限水，也不要刻意大量飲水；以個人計畫為準。',
  ask: '我需要特別限水嗎？', evidence: [['ESC_HF_2026', D], ['HFA_FLUIDS', D], ['HFA_SODIUM_FLUID_2024', S], ['FRESH_UP_2025', S]],
  esc: { statement: 'no evidence for routine fluid restriction in chronic HF', verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } },
SELF_OTC: { claim_id: 'CLM-SELF_OTC', topic: 'SELF_CARE_EDUCATION', group: 'now', rank: 6, risk: 'IMPORTANT', title: '心衰竭時，不要自行使用消炎止痛藥（NSAIDs）',
  text: '消炎止痛藥（NSAIDs，盒子上的成分例如 ibuprofen、naproxen、diclofenac、celecoxib）可能讓身體留住水分、傷腎，讓心衰竭變差，不建議自己買來吃。需要止痛時，請醫師或藥師挑合適的方法；不是所有止痛方式都不能用。',
  detail: '上面列的是常見成分，celecoxib 屬 COX-2 類。口服或全身性使用可能造成水分滯留、腎功能惡化或心衰竭變差，增加住院風險。感冒藥、中草藥與保健品也可能影響血壓、電解質或抗凝血藥，請列入同一份用藥清單。',
  actions: ['購買前告訴藥師您有心衰竭與目前的用藥', '把成藥、中草藥、保健品列入用藥清單'], who: ['PHARMACIST'], when: '購買前', timing: 'AS_NEEDED', escalate: '', do_not: '不要自行使用消炎止痛藥；也不要自行停掉醫師已開立的藥。',
  ask: '我可以用哪一種止痛藥或感冒藥？', evidence: [['ESC_HF_2026', D], ['AHA_DRUGS_HF_2016', D], ['AHA_HF_2022', S], ['HFA_POLY_2025', S]],
  esc: { cor: 'III', loe: 'B2', drug_scope: 'NSAIDs,COX-2', verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' },
  check: { q: '有心衰竭的人想買止痛藥時，最好的做法是？', options: [
    ['先問藥師，選擇較適合自己的止痛方式', true, '正確。消炎止痛藥一般不建議，但仍有其他止痛方式可以選。'],
    ['所有止痛藥都不能用，痛就忍著', false, '不需要一律忍痛。請藥師或醫師幫您選擇。'],
    ['自己買消炎止痛藥吃', false, '消炎止痛藥可能讓心衰竭變差，請先問藥師。']] } },
SELF_VACCINE: { claim_id: 'CLM-SELF_VACCINE', topic: 'SELF_CARE_EDUCATION', group: 'learn', rank: 3, risk: 'GENERAL', title: '疫苗：預防感染讓心衰竭不穩定',
  text: '感染可能使心衰竭變得不穩定。國際心衰竭指引建議心衰竭病人考慮流感與肺炎鏈球菌疫苗；新冠肺炎與年長者的呼吸道融合病毒（RSV）等疫苗，是否適合與接種資格、時程，請依衛生福利部疾病管制署的最新公告，並和醫療團隊確認。',
  actions: ['帶疫苗紀錄去看診', '問醫療團隊今年適合打哪些疫苗'], who: ['DOCTOR', 'NURSE'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '',
  detail: '另外一種成人預防保健（不是心衰竭專屬的建議）：疾病管制署建議 50 歲以上成人、18 歲以上免疫功能低下的人，可以和醫師討論帶狀疱疹（皮蛇）非活性疫苗，共 2 劑，間隔 2 到 6 個月。',
  ask: '我今年適合打哪些疫苗？帶狀疱疹疫苗適合我嗎？', evidence: [['ESC_HF_2026', D], ['TW_CDC', D], ['TW_CDC_ZOSTER', S], ['AHA_HF_2022', S]] },
SELF_LIFESTYLE: { claim_id: 'CLM-SELF_LIFESTYLE', topic: 'SELF_CARE_EDUCATION', group: 'learn', rank: 3, risk: 'GENERAL', title: '菸、酒、檳榔與睡眠',
  text: '戒菸對心臟有益，醫療院所的戒菸門診可以協助，也可以撥免費戒菸專線 0800-636363。酒精可能影響心臟、血壓與藥物，飲酒量請和醫師討論；部分心衰竭與酒精有關的病人需要完全戒酒。檳榔子本身就是一級致癌物，有嚼的話也可以一起說。',
  actions: ['想戒菸：撥免費戒菸專線 0800-636363，或問戒菸門診', '和醫師討論自己適合的飲酒量', '有嚼檳榔的話，看診時說出來，一起討論怎麼戒'], who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '', ask: '我需要戒酒嗎？可以轉介戒菸門診嗎？',
  evidence: [['AHA_HF_2022', D], ['MOHW_QUITLINE', D], ['MOHW_BETEL', D], ['ESC_HF_2026', S]] },

/* ================= 目標與未來照護 ================= */
GOALS_WHAT_MATTERS: { claim_id: 'CLM-GOALS_WHAT_MATTERS', topic: 'PATIENT_PRIORITY_QOL', group: 'discuss', rank: 1, risk: 'GENERAL', title: '治療也要符合您想過的生活',
  text: '做治療決定時，不只看藥物可能帶來的好處，也要把副作用、吃藥負擔、費用，以及您最在意的生活目標一起談清楚。下方可以選出「最希望改善的事」和「最擔心的負擔」，會寫進摘要讓您帶去看診。',
  actions: ['選出最希望改善的一件事', '選出最擔心的一種治療負擔'], who: ['DOCTOR', 'PHARMACIST', 'HF_TEAM'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '',
  ask: '以我最在意的事來看，哪些治療最重要？有哪些選擇？', evidence: [['AHA_PALLIATIVE_2025', D], ['AHA_HF_2022', S]] },
GOALS_SUPPORT: { claim_id: 'CLM-GOALS_SUPPORT', topic: 'PATIENT_PRIORITY_QOL', group: 'discuss', rank: 1, risk: 'GENERAL', title: '緩和照護不等於放棄治療',
  text: '當症狀或治療負擔明顯影響生活時，緩和照護可以和心衰竭治療同時進行，著重症狀緩解、生活品質、溝通與照顧者支持；不需要等到病情末期才提出。',
  detail: '健保的安寧療護不限癌症，收案疾病包括心臟衰竭；可以是住院、居家，或由安寧團隊和原本的醫療團隊一起照顧（共同照護），由醫師評估是否符合。',
  actions: ['告訴醫療團隊最困擾您的症狀', '詢問是否適合安寧緩和團隊共同照護或居家照護'], who: ['DOCTOR', 'PALLIATIVE'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '',
  ask: '我的症狀困擾，可以請緩和照護團隊一起協助嗎？我符合健保安寧共同照護或居家照護嗎？', evidence: [['AHA_PALLIATIVE_2025', D], ['NHI_HOSPICE', D], ['ESC_HF_2026', S]] },
GOALS_ACP: { claim_id: 'CLM-GOALS_ACP', topic: 'PATIENT_PRIORITY_QOL', group: 'discuss', rank: 1, risk: 'GENERAL', title: '想談未來的照護方式：可以先從一次對話開始',
  text: '您可以先想一想：如果未來病情變嚴重，最希望怎麼被照顧、誰最適合替您表達意見。台灣依《病人自主權利法》，可以到提供「預立醫療照護諮商」的醫院，和醫療團隊及家人一起討論。這是選擇，不需要在今天做任何決定，也不代表停止現在的治療。',
  detail: '依《病人自主權利法》：預立醫療照護諮商由本人、至少一位二親等內的家人，以及您指定的醫療委任代理人一起參加。簽好的「預立醫療決定」要有諮商醫院核章、經公證或兩位見證人見證，並註記在健保卡。諮商費用各醫院不同，可以先問。',
  actions: ['想一想誰最適合替您表達意見（醫療委任代理人），先跟他聊聊', '詢問醫院是否提供預立醫療照護諮商、費用多少', '有裝去顫器的人，可以問：病情很重時，電擊功能要怎麼安排'],
  who: ['DOCTOR', 'PALLIATIVE', 'SOCIAL'], when: '您準備好時；下次看診可以先提', timing: 'NEXT_VISIT', escalate: '', do_not: '',
  ask: '我想了解預立醫療照護諮商，可以怎麼安排？', evidence: [['TW_PATIENT_AUTONOMY_ACT', D], ['MOHW_ACP', D], ['AHA_PALLIATIVE_2025', D], ['TW_HOSPICE_FOUNDATION_ACP', S]] },

/* ================= 初學者 ================= */
HF_BASICS: { claim_id: 'CLM-HF_BASICS', topic: 'SELF_CARE_EDUCATION', group: 'learn', rank: 1, risk: 'GENERAL', title: '心衰竭是什麼：心臟無法有效應付身體需要',
  text: '心衰竭是心臟沒辦法好好應付身體需要，會出現喘、累、水腫等情況；原因和嚴重度每個人不一樣。不同類型適合的藥不完全相同，所以別人的藥單不一定適合您。不知道自己的類型也沒關係，不影響怎麼顧好自己。',
  detail: '最新國際指引依最近一次的射出分率（LVEF）分為兩型：低於 50% 為射出分率降低型，50% 以上為射出分率保留型；保留型還需要症狀與其他心臟檢查的客觀證據，不是只看 LVEF。',
  actions: ['問醫師：我的心衰竭是什麼原因、屬於哪一型、最近一次 LVEF 多少'], who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '不要參考別人的藥單自行加藥或停藥。',
  ask: '我的心衰竭是什麼原因造成的？屬於哪一型？最近一次 LVEF 是多少？', evidence: [['ESC_HF_2026', D], ['UDHF_2026', S]] },
HF_THREE_THINGS: { claim_id: 'CLM-HF_THREE_THINGS', topic: 'SELF_CARE_EDUCATION', group: 'learn', rank: 1, risk: 'GENERAL', title: '每天最重要的三件事',
  text: '一、照處方用藥，有疑問先問，不自行停藥。二、每天留意和自己平常比有沒有變化（喘、腫、體重、活動力）。三、知道什麼情況要當天聯絡醫療團隊，什麼情況要撥 119。',
  actions: ['把本頁「什麼時候要求救」那一欄拍照存起來，或印出來貼在家裡'], who: ['HF_TEAM'], when: '每天', timing: 'ONGOING', escalate: '出現緊急警訊，撥 119。', do_not: '',
  ask: '我什麼情況要聯絡你們？電話是？', evidence: [['ESC_HF_2026', D], ['NHS_HF', D]],
  teach: { prompt: '哪些情況要直接打 119？', hint: '例如喘到講不出完整句子、嘴唇發紫發灰、昏倒叫不醒、胸痛一直不退。' } },
CARE_TEAM: { claim_id: 'CLM-CARE_TEAM', topic: 'SELF_CARE_EDUCATION', group: 'learn', rank: 2, risk: 'GENERAL', title: '不同問題，可以找不同專業',
  text: '藥物與交互作用可以找藥師，飲食可以找營養師，活動與體力可以找復健團隊，照顧與資源可以找社工師；症狀變化與治療決定，回到主治醫師與心衰竭團隊。最重要的是大家使用同一份最新用藥清單。',
  actions: ['把最新用藥清單帶給每一位看診的醫師'], who: ['DOCTOR', 'PHARMACIST', 'DIETITIAN', 'REHAB', 'SOCIAL'], when: '每次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '',
  ask: '我這個問題應該找哪一位專業人員？', evidence: [['ESC_HF_2026', D], ['ZHENG_META_2023', S]] },

/* ================= 系統保護（fail-closed） ================= */
SYS_NEED_SAFETY: { claim_id: 'CLM-SYS_NEED_SAFETY', topic: 'SAFETY_URGENT', group: 'now', rank: 0, risk: 'CRITICAL', title: '先回第 1 步，我們才知道您現在安不安全',
  text: '還沒做完安全確認，所以先不顯示其他內容。請回第 1 步勾選符合的狀況，或選「以上都沒有」。',
  actions: ['回到第 1 步完成安全確認'], who: [], when: '現在', timing: 'NOW', escalate: '若現在有嚴重喘、胸痛、昏倒或中風徵象，立即撥 119。', do_not: '',
  evidence: [['TW_NFA_119', D], ['NHS_HF', S]] },
SYS_VALIDATION_ERROR: { claim_id: 'CLM-SYS_VALIDATION_ERROR', topic: 'SAFETY_URGENT', group: 'now', rank: 0, risk: 'CRITICAL', title: '這次的資料我看不懂，請重新開始一次',
  text: '看不懂的資料不能拿來給建議，所以這裡先停住。請按「重新開始」再回答一次。',
  actions: ['按「重新開始」重新回答'], who: [], when: '現在', timing: 'NOW', escalate: '若現在有嚴重喘、胸痛、昏倒或中風徵象，立即撥 119。', do_not: '',
  evidence: [['TW_NFA_119', D], ['NHS_HF', S]] },

/* ================= 2026 ESC 治療地圖（內容由 C.treatment_map 產生） ================= */
TREATMENT_MAP: { claim_id: 'CLM-TREATMENT_MAP', topic: 'TREATMENT_REVIEW', group: 'discuss', rank: 1, risk: 'IMPORTANT', title: '帶去看診核對：我目前的心衰竭治療有哪些？',
  text: '這是依您填的資料整理出來的核對清單，給您看診時一項一項對。上面有的不代表您該吃，沒有的也不代表您漏了，都要由醫師依您的血壓、腎功能和過去的反應判斷。',
  detail: '內容依 2026 ESC 心衰竭指引的核心長期治療（FMT）、依條件的附加治療（AMT）與裝置治療（GDIT）架構整理。',
  actions: ['帶著用藥清單，看診時逐項和醫師或藥師核對'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '',
  do_not: '這是資訊核對，不是處方；不要依此自行開始、停用或更換任何藥物。', ask: '依 2026 ESC，我的核心長期治療有哪些？沒有使用的原因是什麼？',
  evidence: [['ESC_HF_2026', D], ['TSOC_CHF_2023', S], ['TSOC_HFPEF_2024', S]],
  esc: { cor: 'I', loe: 'A', population: 'symptomatic_HF', statement: 'FMT HFrEF=BB+ACEI/ARNI/ARB+MRA+SGLT2i; HFpEF=MRA+SGLT2i; phenotype HFrEF<50/HFpEF>=50', patient_projection: 'DISCUSS_WITH_CLINICIAN', self_action_allowed: false, taiwan_overlay_required: true, verification: 'SECONDARY_SOURCES_CONFIRMED；AMT 個別 EF 條件 USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } },
CO_AMYLOID: { claim_id: 'CLM-CO_AMYLOID', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 3, risk: 'GENERAL', title: '已確診心臟類澱粉沉積症：由專科團隊追蹤特定治療',
  text: '轉甲狀腺素蛋白型心臟類澱粉沉積症（ATTR）已有針對疾病本身的藥物（例如 tafamidis、acoramidis、vutrisiran），是否適合依類型、病程與專科評估而定。部分心衰竭藥物在類澱粉沉積症的耐受性不同，調整請由心臟科決定。',
  actions: ['確認自己的類澱粉沉積症類型與專科追蹤時間'], who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '昏倒或胸痛，撥 119。', do_not: '不要自行調整心臟藥物。',
  ask: '我的類澱粉沉積症是哪一型？適合哪些針對疾病的治療？', evidence: [['ESC_HF_2026', D]],
  esc: { population: 'confirmed_ATTR_CM', verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } },

/* ================= 可行性支持 ================= */
FEAS_SUPPORT: { claim_id: 'CLM-FEAS_SUPPORT', topic: 'ACCESS_COST', group: 'now', rank: 7, risk: 'IMPORTANT', title: '做不到不是您的錯：把困難說出來',
  text: '知道該做什麼，和能不能做到是兩回事。把最主要的困難告訴醫療團隊，他們可以調整方式或連結資源。照顧資源可以詢問 1966 長照服務專線；照顧者可以撥 0800-507272。',
  actions: ['把困難寫進摘要，看診時拿給醫療團隊看'], who: ['HF_TEAM', 'SOCIAL', 'LTC_1966'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '',
  ask: '這件事我做起來有困難，可以怎麼調整？', evidence: [['HFA_ADHERENCE_2025', D], ['MOHW_1966', S]] },
CAREGIVER_SELF: { claim_id: 'CLM-CAREGIVER_SELF', topic: 'PATIENT_PRIORITY_QOL', group: 'learn', rank: 4, risk: 'GENERAL', title: '給照顧者：您的狀況也很重要',
  text: '照顧者參與辨識警訊、核對用藥、陪同回診與討論照護目標。照顧壓力大時，可以撥家庭照顧者關懷專線 0800-507272，或 1966 詢問喘息服務等長照資源。',
  actions: ['把本頁「什麼時候要求救」那一欄拍照存在手機', '需要時撥 0800-507272'], who: ['CAREGIVER_LINE', 'LTC_1966'], when: '需要時', timing: 'AS_NEEDED', escalate: '', do_not: '',
  ask: '家人可以怎麼協助照護？', evidence: [['MOHW_CAREGIVER_LINE', D], ['MOHW_1966', D], ['HFA_ADHERENCE_2025', S]] },

/* ================= v0.9.0 新增：安全細分 ================= */
URGENT_PRESYNCOPE: { claim_id: 'CLM-URGENT_PRESYNCOPE', topic: 'SAFETY_URGENT', group: 'now', rank: 1, risk: 'CRITICAL',
  title: '今天就要有人當面看您：快昏倒不能只用電話處理',
  text: '眼前一黑、快要昏倒，可能是血壓太低、心跳太慢或太快，也可能是出血或脫水。這些原因用電話問不出來，需要今天當面量血壓、心跳，必要時做心電圖。',
  detail: '臨床上稱為前暈厥（presyncope）。在心衰竭病人，常見原因包括姿勢性低血壓、心律不整、體液不足與藥物作用。',
  actions: ['今天到原就醫的醫院門診或急診，請人陪同', '路上不要自己開車或騎車', '把藥袋帶著，特別是血壓藥、心臟藥、利尿劑'],
  who: ['ED', 'DOCTOR'], when: '今天', timing: 'TODAY', escalate: '真的昏過去、合併胸痛、心跳很快或很慢、講話不清楚，立刻打 119。',
  do_not: '不要因為「站一下就好了」就當作沒事；也不要自己停掉血壓或心臟的藥。',
  ask: '我這種快昏倒的情況，是血壓、心跳還是藥物造成的？',
  evidence: [['NHS_HF', D], ['HFA_POLY_2025', D], ['TW_NFA_119', S]],
  check: { q: '站起來眼前一黑、快昏倒，應該怎麼做？', options: [
    ['今天請人陪您當面看醫師；真的昏倒或胸痛就撥 119', true, '對。快昏倒要今天當面看，不能只打電話。'],
    ['自己把血壓藥停掉', false, '不要自己停藥。今天當面看醫師，由醫師調整。'],
    ['等下次回診', false, '快昏倒不能等到下次回診，今天要當面看。']] },
  teach: { prompt: '等一下您要怎麼去醫院？', hint: '重點是：今天去、有人陪、不要自己騎車開車。' } },
URGENT_CONFUSION: { claim_id: 'CLM-URGENT_CONFUSION', topic: 'SAFETY_URGENT', group: 'now', rank: 1, risk: 'CRITICAL',
  title: '現在就到急診：突然變糊塗要立刻找原因',
  text: '和平常比，這一兩天突然變得糊塗、答非所問或認不得人，原因有很多，有些需要馬上處理，不能等門診。請現在陪病人到急診。',
  actions: ['現在請人陪同到最近的急診', '把藥袋或用藥清單帶著', '記下是從什麼時候開始變得不一樣'],
  who: ['ED', 'DOCTOR'], when: '現在', timing: 'NOW', escalate: '叫不醒、抽搐、嘴歪或一邊手腳沒力、講話不清楚，立刻打 119。',
  do_not: '不要先在家觀察到明天；也不要自己加減任何藥。', ask: '突然變糊塗的原因是什麼？和目前的藥有關嗎？',
  evidence: [['NHS_CONFUSION', D], ['MOHW_STROKE_2022', S], ['TW_NFA_119', S]] },
URGENT_HEAD: { claim_id: 'CLM-URGENT_HEAD', topic: 'SAFETY_URGENT', group: 'now', rank: 1, risk: 'CRITICAL',
  title: '現在就到急診：吃抗凝血藥又撞到頭',
  text: '正在吃會讓血比較不容易凝固的藥（抗凝血藥），跌倒或撞到頭，就算現在看起來沒事，也要現在到急診讓醫師檢查。',
  actions: ['現在請人陪同到急診，不要自己開車或騎車', '把抗凝血藥的藥袋帶著', '記下撞到的時間'],
  who: ['ED', 'DOCTOR'], when: '現在', timing: 'NOW', escalate: '叫不醒、眼睛睜不開、抽搐，立刻打 119。',
  do_not: '下一劑抗凝血藥要不要吃，請急診醫師決定，不要自己決定。', ask: '這次撞到頭需要做哪些檢查？抗凝血藥要怎麼處理？',
  evidence: [['NHS_HEAD_INJURY', D], ['NHS_APIXABAN_SE', S], ['TW_NFA_119', S]] },
SAME_DAY_PALP: { claim_id: 'CLM-SAME_DAY_PALP', topic: 'SAFETY_URGENT', group: 'now', rank: 2, risk: 'CRITICAL',
  title: '心跳一直很快、很慢或亂跳：今天打電話給醫療團隊',
  text: '心跳一直很快、很慢或不規則，今天就要讓醫療團隊知道，由他們決定要不要當面檢查或做心電圖。有血壓計的話，先記下當下的血壓和心跳次數。',
  actions: ['今天打電話給原就醫的醫院或心臟科', '有血壓計的話，記下當下的血壓和心跳', '說清楚從什麼時候開始、會不會喘或頭暈'],
  who: ['HF_TEAM', 'DOCTOR'], when: '今天', timing: 'TODAY', escalate: '同時快昏倒、胸痛不退、喘到講不出完整句子，或昏倒，立刻打 119。',
  do_not: '不要自己多吃或停掉心臟的藥來試試看。', ask: '我的心跳這樣需要做心電圖或調整治療嗎？',
  evidence: [['MEDLINEPLUS_HF_HOME', D], ['ESC_AF_2024', S], ['TW_NFA_119', S]],
  check: { q: '心跳一直很快或亂跳，人還好，應該怎麼做？', options: [
    ['今天聯絡醫療團隊；若同時快昏倒、胸痛或很喘，就撥 119', true, '對。今天讓醫療團隊知道，變嚴重就求救。'],
    ['等下次回診再說', false, '心跳一直不對，今天就要讓醫療團隊知道。'],
    ['自己多吃一顆心臟的藥', false, '不要自己加藥。今天聯絡醫療團隊。']] } },
SYM_PALP: { claim_id: 'CLM-SYM_PALP', topic: 'SYMPTOM_OTHER', group: 'now', rank: 5, risk: 'IMPORTANT',
  title: '心跳快、慢或亂跳：記下發生的時間和當下的心跳',
  text: '心跳很快、很慢或不規則，可能和心律不整、甲狀腺、貧血、脫水或藥物有關，需要醫療團隊判斷。持續不停的，今天就打電話；偶爾一下的，記下來帶去看診。',
  actions: ['記下發生的日期、時間、持續多久、當時在做什麼', '有血壓計的話，記下當下的血壓和心跳'],
  who: ['DOCTOR', 'HF_TEAM'], when: '發生時記下；持續不停今天聯絡', timing: 'THIS_WEEK',
  escalate: '同時快昏倒、胸痛、很喘或昏倒，立刻打 119。', do_not: '不要自己加減心臟或血壓的藥。',
  ask: '我的心跳快慢不規則，需要做心電圖或長時間的心電圖紀錄嗎？', evidence: [['MEDLINEPLUS_HF_HOME', D], ['ESC_AF_2024', S]] },
ADH_COUGH: { claim_id: 'CLM-ADH_COUGH', topic: 'MED_TOLERABILITY', group: 'now', rank: 5, risk: 'IMPORTANT',
  title: '一直乾咳：可能和某些血壓心臟藥有關，請醫師評估',
  text: '有些降血壓、保護心臟的藥（多半藥名以 -pril 結尾）常見一直乾咳，一般的咳嗽藥通常沒有用。如果咳嗽一直不好、很困擾或影響睡覺，告訴醫師，可能有別的藥可以換。',
  detail: '心衰竭本身也可能造成咳嗽，尤其是晚上躺平時咳、咳出粉紅色泡沫痰；這兩種情況請照本頁「什麼時候要求救」處理。',
  actions: ['記下咳嗽從哪天開始、是乾咳還是有痰、晚上躺平會不會更嚴重', '回診時帶著藥袋，問是不是藥物引起'],
  who: ['DOCTOR', 'PHARMACIST'], when: '這一兩週內', timing: 'THIS_WEEK', escalate: '咳出粉紅色泡沫痰，或躺平咳到要坐起來、很喘，照本頁「什麼時候要求救」處理。',
  do_not: '不要因為咳嗽就自己停藥；換不換藥由醫師決定。', ask: '我的乾咳可能是藥引起的嗎？有沒有別的藥可以換？',
  evidence: [['NHS_RAMIPRIL_SE', D], ['NHS_HF', S]] },
STABLE_CHECKUP: { claim_id: 'CLM-STABLE_CHECKUP', topic: 'SELF_CARE_EDUCATION', group: 'now', rank: 3, risk: 'GENERAL',
  title: '今天沒有新問題：趁穩定時，把這幾件事準備好',
  text: '病情穩定的時候，是把照護計畫準備好的最好時機。下面幾件事，下次看診時一次問清楚，寫在「我的照護計畫」上，家人也看得到。',
  actions: ['確認下次回診、下次抽血的日期', '帶一份最新的用藥清單（或所有藥袋）', '請醫療團隊寫下：體重增加多少、哪些變化要打電話，和白天、晚上的聯絡電話', '問今年適合打哪些疫苗'],
  who: ['HF_TEAM', 'DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '出現本頁「什麼時候要求救」列出的情況，照那裡寫的時間處理。', do_not: '',
  ask: '可以幫我在「我的照護計畫」寫下體重警戒和聯絡電話嗎？我下次抽血是什麼時候？',
  evidence: [['AHA_HF_2022', D], ['MEDLINEPLUS_HF_HOME', S], ['TW_CDC', S]] },
POST_FIRST_WEEK: { claim_id: 'CLM-POST_FIRST_WEEK', topic: 'TRANSITION_POST_DISCHARGE', group: 'now', rank: 5, risk: 'IMPORTANT',
  title: '出院第一週：每天量體重，大約一週內要有第一次追蹤',
  text: '從出院隔天起，每天早上起床、上完廁所、吃東西前，用同一台秤量體重並寫下來；出院那天的體重就是比較的基準。出院後大約一週內，應該有第一次回診或電話追蹤，出院單上沒寫就打電話問。',
  actions: ['每天早上量體重，寫在「14 天自我觀察表」', '確認出院後第一次回診或追蹤的日期', '請醫療團隊寫下：體重增加多少要打電話'],
  who: ['HF_TEAM', 'DOCTOR', 'NURSE'], when: '出院後第一週', timing: 'THIS_WEEK', escalate: '體重很快上升、更喘或更腫，今天就聯絡醫療團隊。',
  do_not: '不要自己加減利尿劑，除非醫療團隊已經給您書面計畫。', ask: '出院後第一次回診是哪一天？我的體重增加多少要打電話？',
  evidence: [['AHA_HF_2022', D], ['MEDLINEPLUS_HF_HOME', D]],
  teach: { prompt: '明天早上，您會在什麼時候、怎麼量體重？', hint: '起床、上完廁所、吃東西前，用同一台秤，量完寫下來。' } },
WP_DEVICE: { claim_id: 'CLM-WP_DEVICE', topic: 'SELF_CARE_EDUCATION', group: 'learn', rank: 2, risk: 'GENERAL',
  title: '身上有去顫器（ICD）時，日常要注意的事',
  text: '隨時帶著裝置卡。手機不要放在和裝置同一側的口袋，講電話用另一邊的耳朵。過機場安檢時，出示裝置卡並請安檢人員改用人工檢查。每一次電擊，都要讓心臟科知道。要做核磁共振或其他檢查前，先告訴醫師您有裝置。',
  detail: '裝的是只調心跳的心律調節器，注意事項大致相似，細節請問幫您追蹤裝置的心臟科。什麼時候可以開車，請直接問心臟科醫師。',
  actions: ['把裝置卡放在皮夾或手機殼裡', '問心臟科：我什麼時候可以開車、有沒有遠距監測'], who: ['DOCTOR'], when: '日常', timing: 'ONGOING',
  escalate: '電擊後還是很不舒服或昏倒，立刻打 119；電擊過一次、人還好，今天聯絡心臟科。', do_not: '',
  ask: '我什麼時候可以開車？有沒有遠距監測？哪些檢查要先告訴你們？', evidence: [['MEDLINEPLUS_ICD', D]] },
SAME_DAY_BLEED_MINOR: { claim_id: 'CLM-SAME_DAY_BLEED_MINOR', topic: 'SAFETY_URGENT', group: 'now', rank: 2, risk: 'CRITICAL',
  title: '今天打電話給醫療團隊：新出現的出血也要講',
  text: '尿變紅或有血色、小傷口一直滲血，以及刷牙流血、瘀青變多，在使用抗凝血藥或抗血小板藥的人身上，可能代表藥效太強或有別的出血點。尿有血色要今天就講，不要等下次門診；由醫療團隊決定要不要抽血、驗尿或調整。',
  actions: ['今天打電話給原就醫的醫院或心臟科', '說清楚哪裡出血、從哪天開始、大概多少', '把抗凝血藥、抗血小板藥、止痛藥都帶著或拍照'],
  who: ['HF_TEAM', 'DOCTOR', 'PHARMACIST'], when: '今天', timing: 'TODAY',
  escalate: '變成吐血、咳血、解黑便或血便，或頭暈快昏倒，現在就到急診；合併意識改變、冒冷汗，打 119。',
  do_not: '不要只靠這個網頁決定下一劑怎麼處理，今天先問醫療團隊；突然停掉抗凝血藥也可能造成中風或血管阻塞。',
  ask: '我這樣的出血需要驗血或調整藥嗎？', evidence: [['NHS_APIXABAN_SE', D], ['ESC_AF_2024', D], ['TW_NFA_119', S]],
  check: { q: '刷牙牙齦流血、瘀青變多，人還好，應該怎麼做？', options: [
    ['今天讓醫療團隊知道，藥照常吃，不自己停', true, '對。小出血今天要說，但不要自己停藥。'],
    ['自己先停抗凝血藥觀察', false, '不要自己停藥，停藥可能造成血栓。今天讓醫療團隊知道。'],
    ['不用理它', false, '小出血也要今天讓醫療團隊知道，尤其正在吃抗凝血藥。']] } },
SICKDAY_PLAN: { claim_id: 'CLM-SICKDAY_PLAN', topic: 'TRANSITION_POST_DISCHARGE', group: 'discuss', rank: 1, risk: 'IMPORTANT',
  title: '請醫療團隊寫一張「生病時怎麼吃藥」給您收著',
  text: '發燒、上吐下瀉、吃不下的時候，有幾類藥需要暫時調整，但每個人不一樣，不能照別人的做。趁現在身體還好，先請醫師或藥師寫下來，貼在藥盒或拍照存手機。',
  detail: '通常需要個別交代的包括利尿劑、SGLT2 抑制劑、ARNI／ACEI／ARB、MRA 與部分降血糖藥；實際名單與恢復時機由您的醫療團隊決定。',
  actions: ['下次看診時請醫師或藥師寫下：生病時哪幾顆先停、什麼情況恢復、要不要回診'],
  who: ['DOCTOR', 'PHARMACIST', 'HF_TEAM'], when: '下次看診', timing: 'NEXT_VISIT',
  escalate: '還沒拿到這張紙就先生病了，當天打電話問，不要自己猜。',
  do_not: '沒有這張紙以前，不要自己決定停哪一顆。',
  ask: '可以幫我寫一張「生病時的用藥方式」嗎？', evidence: [['KDIGO_DM_CKD_2022', D], ['HFA_POLY_2025', D], ['ACC_HFREF_2024', S]],
  teach: { prompt: '如果明天開始上吐下瀉，您第一步會做什麼？', hint: '重點是：先聯絡醫療團隊或照他們寫下來的方式，不是自己決定停哪一顆。' } },

/* ================= v0.9.0 新增：用藥真相 ================= */
MED_INCOMPLETE: { claim_id: 'CLM-MED_INCOMPLETE', topic: 'MED_RECONCILIATION', group: 'now', rank: 4, risk: 'IMPORTANT',
  title: '您只勾了認得的藥，這份整理就先當作「不完整」',
  text: '沒有勾到，不代表您沒有在吃。所以下面的提醒只能看作「要拿去核對的問題」，不是完整的用藥檢查。真正的檢查要由藥師看過您全部的藥。',
  actions: ['把所有藥袋（含別科、診所、成藥、中藥、保健品）拍照或裝袋帶去', '請藥師幫您做一次完整的用藥整理'],
  who: ['PHARMACIST'], when: '下次看診或領藥時', timing: 'NEXT_VISIT', escalate: '', do_not: '不要因為這頁沒提到某顆藥，就以為那顆藥沒問題。',
  ask: '可以幫我把全部的藥核對一次、列成一張清單嗎？', evidence: [['HFA_POLY_2025', D], ['NHI_HEALTHBANK', S]] },
MED_CHANGE_RECENT: { claim_id: 'CLM-MED_CHANGE_RECENT', topic: 'MED_RECONCILIATION', group: 'now', rank: 3, risk: 'IMPORTANT',
  title: '剛換藥或剛加量：這兩週特別注意身體的反應',
  text: '開始一種新藥、加量或停掉一種藥之後的頭幾週，身體常會有變化，抽血也可能需要追。把變化記下來，比事後回想準確。',
  detail: '這段期間常安排的追蹤包括血壓、心跳、體重、腎功能與血鉀；實際項目與時間由您的醫療團隊決定。',
  actions: ['記下換了哪一顆、從哪天開始', '這兩週固定量血壓、心跳和體重'],
  who: ['DOCTOR', 'PHARMACIST', 'HF_TEAM'], when: '換藥後兩週內', timing: 'THIS_WEEK',
  escalate: '換藥後明顯更喘、更腫、頭暈快昏倒或體重快速上升，當天聯絡醫療團隊；嚴重時打 119。',
  do_not: '不要因為一開始不舒服就自己停掉，先聯絡醫療團隊。',
  ask: '這次換藥後，我要注意什麼？什麼時候要回來抽血？',
  evidence: [['HFA_POLY_2025', D], ['ACC_HFREF_2024', D], ['ESC_HF_2026', S]] },

/* ================= v0.9.0 新增：生活面（只在您選了才出現） ================= */
SELF_HEAT: { claim_id: 'CLM-SELF_HEAT', topic: 'SELF_CARE_EDUCATION', group: 'learn', rank: 2, risk: 'GENERAL',
  title: '天氣很熱或感冒生病時，先把「找誰」想好',
  text: '感冒、肺炎、尿道發炎這些感染，可能讓心衰竭變差。流很多汗、發燒、吃不下時，身體的水分會變動，有些藥需要醫療團隊個別判斷；先問，不要自己調整。發燒又比平常更喘、吃喝不下或尿變很少，今天就聯絡或就醫。',
  actions: ['天氣熱時避開最熱的時段外出', '生病時照醫療團隊寫給您的方式處理，沒有就打電話問'],
  who: ['HF_TEAM', 'PHARMACIST', 'DOCTOR'], when: '需要時', timing: 'AS_NEEDED',
  escalate: '發燒又更喘、吃喝不下或尿變很少，今天聯絡醫療團隊或就醫；喘到說不出話、頭暈快昏倒或意識不清，打 119。',
  do_not: '不要自己加減利尿劑；也不要因為怕水腫就刻意不喝水。',
  ask: '天氣熱或生病的時候，我的水分和藥要怎麼調整？',
  evidence: [['HFA_INFECTION', D], ['NIDIRECT_AKI', S], ['HFA_SODIUM_FLUID_2024', D], ['ESC_HF_2026', D], ['NHS_HF', S]] },
WP_WORK: { claim_id: 'CLM-WP_WORK', topic: 'PATIENT_PRIORITY_QOL', group: 'discuss', rank: 2, risk: 'GENERAL',
  title: '想回去工作：請醫師幫您把「可以做到什麼程度」講清楚',
  text: '能不能工作、做多重的工作，要看您的症狀、心臟功能和工作內容，不是一句能或不能。請醫師依您的情況說明，需要時開立書面說明給公司。',
  actions: ['把您的工作內容具體描述給醫師聽（搬多重、站多久、有沒有輪班）', '問是否需要先做運動能力評估或心臟復健'],
  who: ['DOCTOR', 'REHAB', 'SOCIAL'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '工作時出現胸痛、很喘或快昏倒，立刻停下來求助。',
  do_not: '不要自己硬撐，也不要因為別人做得到就認為自己一定可以。',
  ask: '以我現在的狀況，可以做哪一類工作？需要先做什麼評估？',
  evidence: [['ESC_HF_2026', D], ['ESC_CR_2026', D], ['AHA_HF_2022', S]] },
WP_TRAVEL: { claim_id: 'CLM-WP_TRAVEL', topic: 'PATIENT_PRIORITY_QOL', group: 'discuss', rank: 2, risk: 'GENERAL',
  title: '要出遠門：出發前先準備藥、紀錄和當地的就醫方式',
  text: '出門在外最常遇到的問題是藥不夠、藥被放在託運行李，以及臨時不舒服時沒有人知道您的病史。這些都可以事先準備好。',
  actions: ['帶足夠的藥，隨身放，不要全部託運', '帶一份最新用藥清單和最近的檢查摘要', '問醫師：長途搭車搭機、高溫或高海拔對我有沒有需要注意的地方'],
  who: ['DOCTOR', 'PHARMACIST'], when: '出發前', timing: 'AS_NEEDED',
  escalate: '旅途中明顯變喘、胸痛、腳腫得很厲害或快昏倒，就近就醫；嚴重時打當地的緊急電話。',
  do_not: '不要為了旅行方便自己少吃或跳過利尿劑。',
  ask: '我出遠門要注意什麼？藥要怎麼準備？', evidence: [['ESC_HF_2026', D], ['NHS_HF', S]] },
WP_INTIMACY: { claim_id: 'CLM-WP_INTIMACY', topic: 'PATIENT_PRIORITY_QOL', group: 'discuss', rank: 2, risk: 'GENERAL',
  title: '親密關係可以問，而且有一個必須先確認的藥物問題',
  text: '心衰竭病人常擔心性生活會不會危險，也常因為吃藥後的變化不敢開口。這是可以在門診談的事。其中一件一定要先確認：如果您在用硝酸鹽類藥物或 vericiguat，就不能合併壯陽藥，血壓可能掉到危險程度。',
  detail: '硝酸鹽類包括 isosorbide、舌下 nitroglycerin；壯陽藥指 sildenafil、tadalafil 這一類的磷酸二酯酶第五型抑制劑。',
  actions: ['看診時直接問，或先寫在紙條上交給醫師', '確認自己有沒有在用硝酸鹽類藥物或 vericiguat'],
  who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT',
  escalate: '活動時出現胸痛、很喘或快昏倒，停下來休息；不緩解打 119。',
  do_not: '不要自己買壯陽藥來用；也不要自己停掉心臟的藥。',
  ask: '以我的狀況，性生活需要注意什麼？我可以用那類藥嗎？',
  evidence: [['ESC_HF_2026', D], ['ESC_ACS_2023', D], ['ACC_HFREF_2024', S]] },
WP_SOCIAL: { claim_id: 'CLM-WP_SOCIAL', topic: 'PATIENT_PRIORITY_QOL', group: 'discuss', rank: 2, risk: 'IMPORTANT',
  title: '一個人住或身邊沒人幫忙：先安排好「出事時誰會知道」',
  text: '心衰竭最怕的是變差的時候沒有人發現。可以先安排固定的聯絡方式，也可以請社工師評估能用的資源。',
  actions: ['找一位每天或隔天會聯絡您的人', '把緊急聯絡方式和用藥清單放在家裡明顯的位置', '請醫療團隊轉介社工師，或打 1966 問長照服務'],
  who: ['SOCIAL', 'LTC_1966', 'HF_TEAM'], when: '這週', timing: 'THIS_WEEK', escalate: '突然很喘、胸痛或快昏倒，先打 119，再通知家人。',
  do_not: '', ask: '我一個人住，可以申請哪些協助？',
  evidence: [['MOHW_1966', D], ['ESC_HF_2026', D], ['AHA_PALLIATIVE_2025', S]] },
WP_CULTURE_FAITH: { claim_id: 'CLM-WP_CULTURE_FAITH', topic: 'PATIENT_PRIORITY_QOL', group: 'discuss', rank: 2, risk: 'GENERAL',
  title: '家裡的決定方式、宗教或信仰，也可以寫進照護計畫',
  text: '有些人希望由家人一起決定，有些人有齋戒、進補或民俗療法的習慣。這些說出來，醫療團隊才能把治療安排得合得來，不會彼此衝突。',
  actions: ['告訴醫療團隊：希望誰一起參與決定', '把正在用的中藥、補品、外用或民俗療法一起列進用藥清單'],
  who: ['DOCTOR', 'NURSE', 'PHARMACIST', 'SOCIAL'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '',
  do_not: '不要因為要進補或齋戒就自己停掉心臟的藥。',
  ask: '我的飲食或信仰習慣，和目前的治療有沒有衝突？',
  evidence: [['AHA_PALLIATIVE_2025', D], ['ESC_HF_2026', D], ['HFA_ADHERENCE_2025', S]] },
ADV_HF_REFERRAL: { claim_id: 'CLM-ADV_HF_REFERRAL', topic: 'ADVANCED_HF_GOALS', group: 'discuss', rank: 1, risk: 'IMPORTANT',
  title: '一再住院、藥已經加不上去：可以問要不要轉給心衰竭專責團隊',
  text: '如果最近反覆因為心衰竭住院、休息時就會喘，或因為血壓、腎功能而幾種核心藥都加不上去，代表值得由心衰竭專責或進階治療團隊再看一次。這是多一個評估，不是放棄治療。',
  detail: '進階評估可能包括再次評估病因、裝置治療、機械輔助循環或移植的適應症，以及症狀與生活品質的支持。',
  actions: ['問醫師：我適合轉介心衰竭專責團隊或進階心衰竭評估嗎', '把近一年的住院紀錄和目前用藥整理好帶去'],
  who: ['DOCTOR', 'HF_TEAM'], when: '下次看診', timing: 'NEXT_VISIT',
  escalate: '休息時就很喘、需要坐著睡、體重快速上升，當天聯絡醫療團隊。',
  do_not: '不要自己上網找機構或療法就先去做。',
  ask: '我需要轉介心衰竭專責團隊或進階評估嗎？',
  evidence: [['ESC_HF_2026', D], ['AHA_HF_2022', D], ['ACC_HFREF_2024', S], ['AHA_PALLIATIVE_2025', S]] },

CO_CANCER_TX: { claim_id: 'CLM-CO_CANCER_TX', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 3, risk: 'IMPORTANT',
  title: '做過或正在做癌症治療：心臟要一起追蹤',
  text: '有些癌症治療會影響心臟功能，可能在治療中或治療後好幾年才顯現。這不代表不能治療癌症，而是心臟科和腫瘤科要一起看著，有需要時調整。',
  detail: '常見需要留意的包括 anthracycline 類化療、HER2 標靶治療、部分免疫治療與胸部放射治療；追蹤方式依用藥種類、累積劑量與個人風險而定。',
  actions: ['把癌症治療的藥名與時間整理好，看診時給心臟科看', '問：我需要多久追蹤一次心臟超音波'],
  who: ['DOCTOR', 'HF_TEAM'], when: '下次看診', timing: 'NEXT_VISIT',
  escalate: '治療期間出現新的喘、腳腫、心跳很快或胸痛，當天聯絡醫療團隊。',
  do_not: '不要因為心臟的問題就自己停掉癌症治療；兩邊要一起討論。',
  ask: '我用過的癌症治療會影響心臟嗎？心臟要怎麼追蹤？',
  evidence: [['ESC_HF_2026', D], ['AHA_HF_2022', D]] },
CO_CARDIOMYOPATHY: { claim_id: 'CLM-CO_CARDIOMYOPATHY', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 3, risk: 'GENERAL',
  title: '心肌病變或家族裡有人年輕就出問題：值得問清楚原因',
  text: '心衰竭的原因會影響治療方式，也可能影響家人。如果醫師說是心肌病變，或家裡有人年輕時就心臟衰竭、猝死、裝過去顫器，把這件事講出來，醫師才能判斷要不要進一步檢查。',
  actions: ['整理家族裡心臟病史：誰、幾歲、什麼狀況', '問醫師：我的心衰竭原因查清楚了嗎？家人需要檢查嗎'],
  who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '昏倒或心悸合併快昏倒，當天就醫。',
  do_not: '不要自己上網買基因檢查就下結論。',
  ask: '我的心衰竭原因是什麼？需要做心肌病變或家族相關的檢查嗎？',
  evidence: [['ESC_HF_2026', D], ['AHA_HF_2022', S]] },

/* ================= v0.9.0 新增：資料狀態（不猜、不當作正常） ================= */
SYS_LVEF_STALE: { claim_id: 'CLM-SYS_LVEF_STALE', topic: 'DIAGNOSIS_PHENOTYPE', group: 'discuss', rank: 0, risk: 'IMPORTANT',
  title: '您記得的射出分率先當參考：請醫師確認最近一次的結果和日期',
  text: '心臟功能會隨著治療改變，所以數字是什麼時候量的、從哪裡看到的都很重要。太久以前、不知道什麼時候做的，或不確定從哪裡看到的數值，我不會拿來判斷現在適合討論哪些治療；您填的數字仍會寫進摘要，請醫師確認。',
  actions: ['看診時問：我最近一次心臟超音波是什麼時候？射出分率多少？'],
  who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '不要拿舊的數值去比對別人的藥單。',
  ask: '我最近一次的心臟超音波是什麼時候？結果如何？需要再做嗎？',
  evidence: [['AHA_HF_2022', D], ['ESC_HF_2026', S]] },
SYS_LVEF_CONFLICT: { claim_id: 'CLM-SYS_LVEF_CONFLICT', topic: 'DIAGNOSIS_PHENOTYPE', group: 'discuss', rank: 0, risk: 'IMPORTANT',
  title: '您填的數值和醫師說的那一型對不起來，請以醫師最新判斷為準',
  text: '您填的射出分率，和您記得醫師說的心衰竭類型不一致。可能是換了時間點，也可能是記憶有出入。這一頁不會替您判斷哪個對，請帶著這個問題去問醫師。',
  actions: ['看診時直接問：我現在算哪一型？最近一次射出分率多少？'],
  who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '不要依照這頁的任何一種推測自行調整用藥。',
  ask: '我目前屬於哪一型心衰竭？最近一次的射出分率是多少？',
  evidence: [['ESC_HF_2026', D], ['UDHF_2026', S]] },
SYS_DX_UNCONFIRMED: { claim_id: 'CLM-SYS_DX_UNCONFIRMED', topic: 'DIAGNOSIS_PHENOTYPE', group: 'discuss', rank: 0, risk: 'IMPORTANT',
  title: '診斷還沒確定：先看安全的部分，治療清單等確診再核對',
  text: '您表示還在檢查、醫師還沒明確說是心衰竭。警訊怎麼處理、藥怎麼核對這些都適用；但「該用哪些心衰竭藥」要等診斷確定才有意義。',
  actions: ['問醫師：目前檢查到哪裡？什麼時候會知道結果？'],
  who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '出現本頁「什麼時候要求救」列出的情況，照那裡寫的時間處理。',
  do_not: '不要在診斷確定前，自己開始或停用任何心臟藥物。',
  ask: '我目前的檢查結果是什麼？診斷確定了嗎？',
  evidence: [['ESC_HF_2026', D], ['UDHF_2026', S]] }
};

/* ================= 組合提醒（個別化精準規則） =================
 * when：陣列中任一條件物件成立即觸發（OR）；同一物件內所有欄位都要成立（AND）。
 *   classes_any / classes_all：已知藥物類別｜comorb_any：已知共病｜
 *   otc / burden / discharge：YES｜recon_in：核對狀態｜signals_any：安全警訊
 * 規則只產生「提醒與要問的問題」，不產生停藥或調整指示。 */
C.rules = [
  { id: 'RULE_DISCHARGE_RECON', when: [{ discharge: 'YES', recon_in: ['DIFFERENT', 'UNSURE'] }],
    card: { claim_id: 'CLM-RULE_DISCHARGE_RECON', topic: 'MED_RECONCILIATION', group: 'now', rank: 3, risk: 'IMPORTANT', title: '剛出院且藥單不一致：優先核對',
      text: '出院後前幾週是用藥最容易出錯的時期。您表示實際用藥和藥單不同或不確定，請儘早請藥師或出院醫院核對。',
      actions: ['這幾天內帶出院藥單與家中藥物請藥師核對'], who: ['PHARMACIST', 'HF_TEAM'], when: '3 天內', timing: 'THIS_WEEK', escalate: '涉及抗凝血藥、利尿劑或胰島素時當天詢問。',
      do_not: '核對前不要自行恢復住院前的舊藥。', ask: '出院藥單和我在吃的不一樣，要以哪個為準？', evidence: [['HFA_POLY_2025', D], ['ACC_HFREF_2024', S]] } },
  { id: 'RULE_K_RISK', when: [{ classes_any: ['MRA', 'RAAS_ARNI'], comorb_any: ['CKD'] }, { tags_any: ['K_SUPPLEMENT'], comorb_any: ['CKD'] }, { class_unresolved_any: ['POTASSIUM'], comorb_any: ['CKD'] }, { classes_all: ['MRA', 'RAAS_ARNI'] }],   /* HFPC-AUD-0018：鉀離子結合劑（K_BINDER）是降鉀，不再因「鉀相關類別」觸發高鉀風險卡；只勾類別、沒指出成分時仍保守觸發 */
    card: { claim_id: 'CLM-RULE_K_RISK', topic: 'MONITORING_LAB', group: 'discuss', rank: 1, risk: 'GENERAL', title: '血鉀與腎功能：您用的這幾種藥需要按時抽血追蹤',
      text: '您勾選的藥或疾病（例如 MRA（保鉀型的心臟保護藥）、ARNI／ACEI／ARB（減輕心臟負擔的藥），或和血鉀有關的藥又合併腎功能不好），可能讓血鉀偏高或偏低，需要按時抽血追蹤；血鉀異常常沒有感覺。低鈉鹽多用鉀取代鈉，腎功能不好或使用這些藥時，使用前先問醫師。',
      actions: ['確認下次抽血的時間', '家裡若用低鈉鹽，看診時告訴醫師'], who: ['DOCTOR', 'PHARMACIST'], when: '依醫療團隊安排的抽血時間', timing: 'NEXT_VISIT',
      escalate: '明顯肌肉無力或心跳不規則合併頭暈，立即就醫。', do_not: '不要自行使用含鉀代鹽或鉀補充品。', ask: '我的血鉀要多久追蹤一次？可以改用低鈉鹽嗎（低鈉鹽多半含鉀）？',
      evidence: [['ACC_HFREF_2024', D], ['CFS_HK_KCL_SALT', S]] } },
  { id: 'RULE_NSAID', when: [{ otc: 'YES' }, { classes_any: ['OTC_SUPPLEMENT'] }, { comorb_any: ['PAIN_GOUT'] }],
    card: { claim_id: 'CLM-RULE_NSAID', topic: 'MED_TOLERABILITY', group: 'now', rank: 5, risk: 'IMPORTANT', title: '您有使用成藥或常需止痛：不要自行使用消炎止痛藥',
      text: '心衰竭病人一般不建議使用消炎止痛藥（NSAIDs，例如 ibuprofen、naproxen、diclofenac）與 COX-2 類（例如 celecoxib），可能讓水分滯留、腎功能惡化或心衰竭變差。不是所有止痛方式都不能用，請藥師幫您挑選，並把成藥、中草藥、保健品列入用藥清單。',
      actions: ['把正在用的成藥、中草藥、保健品拍照給藥師看'], who: ['PHARMACIST'], when: '下次領藥或購買前', timing: 'NEXT_VISIT', escalate: '', do_not: '不要自行使用口服或全身性消炎止痛藥（短期也一樣）；醫師開立的低劑量 aspirin 不要自行停用。',
      ask: '我正在用的成藥或保健品，會不會影響心臟或其他藥？', evidence: [['ESC_HF_2026', D], ['AHA_DRUGS_HF_2016', D], ['AHA_HF_2022', S]], esc: { cor: 'III', loe: 'B2', verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } } },
  { id: 'RULE_BLEED_COMBO', when: [{ classes_all: ['ANTICOAG', 'ANTIPLATELET'] }],
    card: { claim_id: 'CLM-RULE_BLEED_COMBO', topic: 'MED_TOLERABILITY', group: 'discuss', rank: 1, risk: 'GENERAL', title: '同時使用抗凝血藥與抗血小板藥：確認療程',
      text: '兩類藥一起使用時出血風險較高，通常只在特定期間（例如裝支架後）合併，之後由心臟科醫師評估是否調整。請確認兩者是否都仍需要、要吃到什麼時候。',
      actions: ['確認兩種藥各自的用途與預計療程'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '出血警訊照本頁「什麼時候要求救」處理。',
      do_not: '不要自行停掉其中一種。', ask: '我同時吃抗凝血藥和抗血小板藥，要吃到什麼時候？', evidence: [['ESC_AF_2024', D], ['ESC_ACS_2023', S]] } },
  { id: 'RULE_ANTITHROMBOTIC_OTC', when: [{ classes_any: ['ANTICOAG', 'ANTIPLATELET'], otc: 'YES' }, { classes_all: ['ANTICOAG', 'OTC_SUPPLEMENT'] }, { classes_all: ['ANTIPLATELET', 'OTC_SUPPLEMENT'] }],
    card: { claim_id: 'CLM-RULE_ANTITHROMBOTIC_OTC', topic: 'MED_TOLERABILITY', group: 'now', rank: 5, risk: 'IMPORTANT', title: '抗凝血／抗血小板藥＋成藥或保健品：出血風險要先確認',
      text: '消炎止痛藥與部分中草藥、保健品可能增加出血風險，或影響抗凝血藥的效果。購買或使用前，請先讓藥師確認。',
      actions: ['把正在用的成藥與保健品給藥師檢查'], who: ['PHARMACIST'], when: '這週或下次領藥', timing: 'THIS_WEEK', escalate: '出血警訊照本頁「什麼時候要求救」處理。',
      do_not: '不要自行停用抗凝血藥或抗血小板藥。', ask: '我正在用的保健品或成藥，會增加出血風險嗎？', evidence: [['ESC_AF_2024', D], ['AHA_DRUGS_HF_2016', S], ['NHS_APIXABAN_SE', S]] } },
  { id: 'RULE_SICKDAY', when: [{ classes_any: ['SGLT2I', 'DIURETIC', 'RAAS_ARNI', 'MRA'] }],
    card: { claim_id: 'CLM-RULE_SICKDAY', topic: 'TRANSITION_POST_DISCHARGE', group: 'discuss', rank: 2, risk: 'GENERAL', title: '事先問好「生病吃不下時」的用藥方式',
      text: '您使用的部分藥物（利尿劑、SGLT2 inhibitor、ARNI／ACEI／ARB、MRA），在嘔吐、腹瀉、吃喝不下或手術前後，可能需要個別處理。現在沒生病時先問好，請醫療團隊寫下您的個人計畫。',
      actions: ['請醫療團隊寫下「生病時哪些藥暫停、何時恢復」'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '持續嘔吐腹瀉或吃不下，當天聯絡。',
      do_not: '沒有個人計畫時，不要自己決定停哪顆藥。', ask: '我生病吃不下時，哪些藥要暫停？何時恢復？', evidence: [['KDIGO_DM_CKD_2022', D], ['ACC_HFREF_2024', S]] } },
  { id: 'RULE_HYPO', when: [{ tags_any: ['HYPO_RISK'], comorb_any: ['DM', 'CKD', 'FRAILTY'] }, { tags_any: ['HYPO_RISK'], classes_any: ['SGLT2I'] }, { class_unresolved_any: ['DIABETES_OTHER'], comorb_any: ['DM', 'CKD', 'FRAILTY'] }],   /* HFPC-AUD-0017：只有胰島素／磺醯尿素類（HYPO_RISK）觸發；metformin、DPP-4 不觸發；只勾類別未指出成分時保守觸發 */
    card: { claim_id: 'CLM-RULE_HYPO', topic: 'MED_TOLERABILITY', group: 'discuss', rank: 2, risk: 'GENERAL', title: '降血糖藥與吃得少：留意低血糖',
      text: '使用胰島素或磺醯尿素類時，若吃得比平常少、腎功能較差或體力變弱，低血糖風險會提高。請事先問好吃不下時怎麼調整，並知道低血糖的表現。',
      actions: ['身上帶糖果或含糖飲料', '問清楚吃不下時的調整方式'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '低血糖導致意識不清，撥 119。',
      do_not: '不要自行猜測劑量。', ask: '我吃不下時，降血糖藥要怎麼調？', evidence: [['KDIGO_DM_CKD_2022', D]] } },
  { id: 'RULE_GLP1_FLUID', when: [{ classes_all: ['GLP1', 'DIURETIC'] }, { classes_all: ['GLP1', 'SGLT2I'] }],
    card: { claim_id: 'CLM-RULE_GLP1_FLUID', topic: 'MED_TOLERABILITY', group: 'discuss', rank: 2, risk: 'GENERAL', title: '減重或降血糖的 GLP-1 藥＋排水藥：留意脫水',
      text: 'GLP-1 類藥物可能造成噁心、嘔吐或腹瀉，和利尿劑或 SGLT2 inhibitor 一起使用時，較容易缺水而影響腎功能。腸胃症狀持續時請聯絡醫療團隊。',
      actions: ['腸胃症狀持續超過一天，聯絡醫療團隊'], who: ['DOCTOR', 'PHARMACIST'], when: '症狀出現時', timing: 'AS_NEEDED', escalate: '幾乎喝不下或尿量很少，當天就醫。',
      do_not: '不要自行加量 GLP-1 類藥物。', ask: '我同時用這幾種藥，腸胃不適時要怎麼辦？', evidence: [['ESC_HF_2026', D], ['KDIGO_DM_CKD_2022', S]] } },
  { id: 'RULE_FALL', when: [{ comorb_any: ['FRAILTY'], classes_any: ['DIURETIC', 'BETA_BLOCKER', 'RAAS_ARNI', 'OTHER_HF', 'DIABETES_OTHER'] }],
    card: { claim_id: 'CLM-RULE_FALL', topic: 'MED_TOLERABILITY', group: 'discuss', rank: 2, risk: 'GENERAL', title: '衰弱或跌倒＋降血壓、利尿或降血糖藥：一起檢視',
      text: '這些藥物對心衰竭可能很重要，但也可能和頭暈、跌倒有關。請把跌倒或頭暈的情況告訴醫師或藥師，一起檢視用藥時間、劑量與居家安全。',
      actions: ['記下頭暈或跌倒的時間，以及當時吃了哪些藥'], who: ['DOCTOR', 'PHARMACIST', 'REHAB'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '跌倒撞到頭且使用抗凝血藥，當天就醫。',
      do_not: '不要自行停掉心衰竭藥物。', ask: '我的頭暈跌倒和哪些藥有關？可以怎麼調整？', evidence: [['HFA_POLY_2025', D]] } },
  { id: 'RULE_DIGOXIN', when: [{ classes_any: ['DIGOXIN'], comorb_any: ['CKD'] }, { classes_any: ['DIGOXIN'], tags_any: ['AMIODARONE'] }, { classes_any: ['DIGOXIN'], class_unresolved_any: ['ANTIARRHYTHMIC'] }],   /* HFPC-AUD-0016 */
    card: { claim_id: 'CLM-RULE_DIGOXIN', topic: 'MONITORING_LAB', group: 'discuss', rank: 1, risk: 'GENERAL', title: 'Digoxin＋腎功能不好或抗心律不整藥：留意藥量過高',
      text: '腎功能較差或同時使用 amiodarone 等藥物時，digoxin 在體內的濃度可能升高。請知道過量的表現（噁心、食慾差、看東西變黃綠、心跳很慢或不規則、意識混亂），並依醫師安排抽血。',
      actions: ['確認是否需要抽血測 digoxin 濃度'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '出現過量表現，今天就醫。',
      do_not: '不要自行加量。', ask: '我需要測 digoxin 濃度嗎？', evidence: [['ACC_HFREF_2024', D], ['AHA_DRUGS_HF_2016', S]] } },
  { id: 'RULE_AMIO', when: [{ tags_any: ['AMIODARONE'], classes_any2: ['ANTICOAG', 'DIGOXIN'] }, { class_unresolved_any: ['ANTIARRHYTHMIC'], classes_any2: ['ANTICOAG', 'DIGOXIN'] }],   /* HFPC-AUD-0016：sotalol 等其他抗心律不整藥不套用 amiodarone 的交互作用文字；只勾類別未指出成分時保守觸發 */
    card: { claim_id: 'CLM-RULE_AMIO', topic: 'MONITORING_LAB', group: 'discuss', rank: 1, risk: 'GENERAL', title: '抗心律不整藥和其他藥物：交互作用要請藥師檢查',
      text: 'amiodarone 等抗心律不整藥可能改變 warfarin、digoxin 或其他藥物的濃度。新增或停用任何藥物前，請醫師或藥師檢查交互作用；使用 warfarin 者可能需要更密集驗 INR。',
      actions: ['請藥師做一次交互作用檢查'], who: ['PHARMACIST', 'DOCTOR'], when: '下次看診或領藥', timing: 'NEXT_VISIT', escalate: '出血警訊照本頁「什麼時候要求救」處理。',
      do_not: NO_SELF_CHANGE, ask: '我的抗心律不整藥和其他藥有交互作用嗎？', evidence: [['ESC_AF_2024', D], ['AHA_DRUGS_HF_2016', S]] } },
  { id: 'RULE_HF_DRUG_CAUTION', when: [{ comorb_any: ['DM', 'AF', 'CAD_HTN', 'PAIN_GOUT'] }, { classes_any: ['DIABETES_OTHER', 'ANTIARRHYTHMIC'] }],
    card: { claim_id: 'CLM-RULE_HF_DRUG_CAUTION', topic: 'MED_TOLERABILITY', group: 'learn', rank: 1, risk: 'GENERAL', title: '有些常見藥可能讓心衰竭變差：請醫師確認',
      text: '以下藥品在部分心衰竭病人可能造成水腫、心衰竭變差或其他風險：消炎止痛藥（NSAIDs）、pioglitazone、saxagliptin 或 alogliptin、diltiazem 或 verapamil（射出分率降低者）、cilostazol（心衰竭病人一般不建議使用）、dronedarone 與部分抗心律不整藥。如果您正在使用，請不要自行停藥，下次看診時請醫師或藥師確認是否仍適合。',
      actions: ['對照藥袋，看看有沒有上面的藥名'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '不要自行停用正在使用的藥。',
      ask: '我正在用的藥裡，有沒有可能讓心衰竭變差的？', evidence: [['AHA_HF_2022', D], ['AHA_DRUGS_HF_2016', D]] } },
  { id: 'RULE_NITRATE_PDE5', when: [{ classes_any: ['OTHER_HF'] }, { comorb_any: ['CAD_HTN'] }],
    card: { claim_id: 'CLM-RULE_NITRATE_PDE5', topic: 'MED_TOLERABILITY', group: 'learn', rank: 2, risk: 'GENERAL', title: '用硝酸鹽類或 vericiguat：不要自己併用威而鋼類',
      text: '若您使用硝酸鹽類（例如 isosorbide、舌下 nitroglycerin），與威而鋼類藥物（sildenafil、tadalafil 等）併用可能造成血壓嚴重下降；vericiguat 也不建議與這類藥物併用。若有需要，請先和醫師討論。沒有使用這些藥物的人可略過。',
      actions: ['確認自己是否使用硝酸鹽類'], who: ['DOCTOR', 'PHARMACIST'], when: '使用前', timing: 'AS_NEEDED', escalate: '', do_not: '不要自行併用。',
      ask: '我的藥可以和威而鋼類藥物一起用嗎？', evidence: [['ESC_ACS_2023', D], ['ACC_HFREF_2024', S]] } },
  /* 2026-09-27：ESC 2026 Recommendation Table 18 的族群是「有症狀」HF＋LVEF ≥45%＋BMI ≥30；補上有症狀條件，與治療地圖 amt 項目一致（先前規則卡未檢查症狀，族群較證據寬） */
  { id: 'RULE_GLP1_ELIGIBLE', when: [{ lvef_in: ['45_49', 'GE50'], bmi: 'GE30', symptom_status_in: ['SYMPTOMS'], pregnancy_gate: 'CLEARED' }],   /* 懷孕狀態未回答 → 不顯示（與治療地圖 INSUFFICIENT_DATA 一致；獨立審查 2026-09-27） */
    card: { claim_id: 'CLM-RULE_GLP1_ELIGIBLE', topic: 'TREATMENT_REVIEW', group: 'discuss', rank: 1, risk: 'GENERAL', title: '符合條件時，可以和醫師討論減重的 GLP-1 類藥',
      text: '國際心衰竭指引建議醫療團隊可考慮對有症狀心衰竭、LVEF 45% 以上且 BMI 30 以上的病人使用 semaglutide 或 tirzepatide，以減重並改善活動能力與生活品質；有無糖尿病都適用，其他腸泌素類不在此建議內。台灣健保給付與仿單規定可能不同，是否適合與費用請和醫師、藥師確認。',
      actions: ['看診時提出討論'], who: ['DOCTOR', 'PHARMACIST'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '', do_not: '不要自行購買或使用來源不明的減重針劑。',
      ask: '我適合 semaglutide 或 tirzepatide 嗎？健保是否給付、費用大約多少？', evidence: [['ESC_HF_2026', D]],
      esc: { cor: 'IIa', loe: 'B1', lvef_rule: '>=45', bmi_rule: '>=30', drug_scope: 'semaglutide,tirzepatide', patient_projection: 'DISCUSS_WITH_CLINICIAN', self_action_allowed: false, taiwan_overlay_required: true, verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } } },
  { id: 'RULE_IRON_TSAT', when: [{ tsat: 'LT20' }],
    card: { claim_id: 'CLM-RULE_IRON_TSAT', topic: 'MONITORING_LAB', group: 'discuss', rank: 1, risk: 'GENERAL', title: 'TSAT 低於 20%：符合心衰竭缺鐵的判定標準',
      text: '請和醫師討論缺鐵的原因（例如腸胃道出血、飲食或藥物）與補充方式。射出分率降低型病人，靜脈鐵劑可改善症狀與生活品質，也可能降低心衰竭住院；射出分率保留型的治療證據目前較少，由醫師個別評估。',
      actions: ['看診時討論缺鐵原因與補充方式'], who: ['DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '解黑便或血便，現在到急診。', do_not: '不要自行長期服用補鐵劑，先由醫師評估。',
      ask: '我的缺鐵原因是什麼？適合靜脈鐵劑嗎？', evidence: [['ESC_HF_2026', D]],
      esc: { definition: 'TSAT<20%', cor: 'I (symptoms/QoL) / IIa (HFH) in HFrEF', loe: 'B1', verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } } },
  { id: 'RULE_EF_IMPROVED', when: [{ ef_improved: 'YES' }],
    card: { claim_id: 'CLM-RULE_EF_IMPROVED', topic: 'TREATMENT_REVIEW', group: 'discuss', rank: 2, risk: 'GENERAL', title: '射出分率進步了：仍繼續核心長期治療',
      text: '射出分率進步通常代表治療有效。國際心衰竭指引建議即使症狀已消失或射出分率已經改善，仍繼續可耐受的核心長期治療；只有少數情況，醫師才會在密切追蹤下討論調整。',
      actions: ['繼續照目前的用藥與追蹤計畫'], who: ['DOCTOR'], when: '下次回診', timing: 'NEXT_VISIT', escalate: '', do_not: '不要因為檢查進步就自行停藥或減量。',
      ask: '射出分率進步後，我的治療和追蹤計畫是什麼？', evidence: [['ESC_HF_2026', D], ['AHA_HF_2022', S]],
      esc: { cor: 'I', loe: 'C', verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } } },
  { id: 'RULE_REHAB_AFTER_DHF', when: [{ hf_discharge: 'YES' }],
    card: { claim_id: 'CLM-RULE_REHAB_AFTER_DHF', topic: 'TRANSITION_POST_DISCHARGE', group: 'learn', rank: 2, risk: 'GENERAL', title: '心衰竭惡化住院後：穩定時可詢問心臟復健',
      text: '心衰竭惡化住院後，等病情穩定並經醫療團隊確認安全時，可以儘早詢問開始心臟復健；運動強度由專業團隊依您的情況安排。',
      actions: ['回診時詢問心臟復健'], who: ['DOCTOR', 'REHAB'], when: '病情穩定後', timing: 'ONGOING', escalate: '更喘、更腫或胸痛時先不要運動，照本頁「什麼時候要求救」處理。', do_not: '不要自行套用別人的運動強度。',
      ask: '我什麼時候可以開始心臟復健？', evidence: [['ESC_HF_2026', D]], esc: { cor: 'IIa', loe: 'B1', verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】' } } },
  { id: 'RULE_PREGNANCY', when: [{ pregnancy: 'YES' }, { pregnancy: 'UNSURE' }, { pregnancy: 'PLANNING' }],
    card: { claim_id: 'CLM-RULE_PREGNANCY', topic: 'TREATMENT_REVIEW', group: 'now', rank: 2, risk: 'IMPORTANT', title: '可能懷孕或計畫懷孕：儘快告訴開藥醫師',
      text: '減輕心臟負擔的藥（ARNI／ACEI／ARB）、保鉀型的心臟保護藥（MRA）、保護心腎的排糖藥（SGLT2 inhibitor）、ivabradine、warfarin 懷孕時不適用（warfarin 的機械瓣膜例外由醫師安排）；減重用的 semaglutide、tirzepatide 發現懷孕要停用，計畫懷孕也要先問醫師何時停藥。懷孕本身也會增加心臟負擔。請儘快告訴開藥醫師與婦產科醫師，由他們安排用藥、避孕與追蹤。',
      detail: '依美國 FDA 仿單（台灣仿單可能不同，以開藥醫師為準）：warfarin 懷孕時禁用，只有裝機械瓣膜、血栓風險高的孕婦例外。semaglutide：用來減重的，發現懷孕時要停用；用來減重或降低心血管風險的，計畫懷孕要在懷孕前至少 2 個月停用（藥效在體內留很久）。tirzepatide：發現懷孕時要停用；它會影響口服避孕藥，開始使用和每次加量後的 4 週內，要改用非口服的避孕方法或另外加上保險套等屏障法。',
      actions: ['已確定懷孕：儘快聯絡開藥醫師（不要自行停藥）', '可能懷孕：儘快驗孕並告知醫師', '計畫懷孕：停止避孕前，先和開藥醫師、婦產科討論用藥'], who: ['DOCTOR'], when: '儘快', timing: 'NOW', escalate: '懷孕期間更喘、更腫或胸痛，照本頁「什麼時候要求救」處理。', do_not: '心臟藥不要自行停藥，由醫師安排替代或調整。',
      ask: '我可能懷孕或想懷孕，目前的藥物需要怎麼安排？', evidence: [['ESC_HF_2026', D], ['FDA_LABEL_SEMAGLUTIDE', D], ['FDA_LABEL_TIRZEPATIDE', D], ['FDA_LABEL_WARFARIN', D], ['AHA_HF_2022', S]], esc: { verification: 'USER_FULLTEXT_AUDIT_2026-09-22_【未經查證】；2026-09-28 補 semaglutide／tirzepatide／warfarin 的仿單來源（ESC 2026 懷孕建議未列這三藥）；同日依仿單 §8.3 補計畫懷孕（孕前 2 個月停用）與口服避孕藥 4 週規定' } } },
  { id: 'RULE_POLY_BURDEN', when: [{ burden: 'YES' }],
    card: { claim_id: 'CLM-RULE_POLY_BURDEN', topic: 'ADHERENCE_FEASIBILITY', group: 'discuss', rank: 1, risk: 'GENERAL', title: '藥很多不代表一定要減藥：先完整檢查一次',
      text: '多重疾病常需要多種藥。請藥師或醫師逐項確認：每一種藥為什麼使用、現在是否仍需要、有沒有重複、交互作用或造成不舒服，再決定哪些保留或調整，也可以討論怎麼吃比較簡單。',
      actions: ['預約或詢問藥物整合諮詢', '把所有藥（含其他科與成藥）帶去'], who: ['PHARMACIST', 'DOCTOR'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '',
      do_not: '不要因為藥太多就自行挑幾顆停掉。', ask: '我的藥可以幫我全部檢查一次嗎？有沒有可以簡化的？', evidence: [['HFA_POLY_2025', D]] } },
  { id: 'RULE_WEIGHT_FRAILTY', when: [{ comorb_any: ['OBESITY'], comorb_any2: ['FRAILTY'] }, { comorb_any: ['OBESITY'], symptom_focus_in: ['APPETITE'] }],
    card: { claim_id: 'CLM-RULE_WEIGHT_FRAILTY', topic: 'COMORBIDITY_RELEVANT', group: 'discuss', rank: 1, risk: 'IMPORTANT', title: '想減重，但體力和食慾也在下降：這兩件要一起看',
      text: '體重過重和肌肉、體力流失可能同時存在。這種情況下，單純把體重降下來不一定對您好；重點是保住肌肉和體力，同時控制心衰竭。請讓醫師和營養師一起看，不要自己節食。',
      actions: ['看診時同時說：想減重，但最近也覺得沒力氣或吃不下', '請醫療團隊轉介營養師一起評估'],
      who: ['DOCTOR', 'DIETITIAN', 'REHAB'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '體重在沒有刻意減重的情況下一直掉，當次看診就要講。',
      do_not: '不要自己採用很嚴格的節食或斷食。', ask: '以我現在的體力和營養狀況，適合減重嗎？要怎麼做才安全？',
      evidence: [['ESC_HF_2026', D], ['AHA_HF_2022', D], ['HFA_POLY_2025', S]] } },
  { id: 'RULE_SUPPORTIVE_TRIGGER', when: [{ symptom_status_in: ['SYMPTOMS'], discharge: 'YES' }, { symptom_status_in: ['SYMPTOMS'], burden: 'YES' }],
    card: { claim_id: 'CLM-RULE_SUPPORTIVE_TRIGGER', topic: 'PATIENT_PRIORITY_QOL', group: 'discuss', rank: 1, risk: 'IMPORTANT', title: '症狀一直影響生活：可以請團隊一起顧症狀和生活品質',
      text: '活動就會喘、又剛住過院或覺得治療負擔很重的時候，可以請醫療團隊把症狀緩解和生活品質也放進照護計畫。這是在原本的治療之上再加人手，不是停掉治療。',
      actions: ['看診時說出最困擾您的一個症狀', '問：可以請緩和照護或心衰竭團隊一起協助嗎'],
      who: ['DOCTOR', 'HF_TEAM', 'PALLIATIVE'], when: '下次看診', timing: 'NEXT_VISIT', escalate: '休息時就很喘、需要坐著睡，當天聯絡醫療團隊。',
      do_not: '', ask: '我的症狀可以請誰一起幫忙照顧？', evidence: [['AHA_PALLIATIVE_2025', D], ['ESC_HF_2026', D]] } },
  { id: 'RULE_CAREGIVER_COG', when: [{ comorb_any: ['MOOD_COG'], burden: 'YES' }, { comorb_any: ['MOOD_COG'], recon_in: ['DIFFERENT', 'UNSURE'] }],
    card: { claim_id: 'CLM-RULE_CAREGIVER_COG', topic: 'ADHERENCE_FEASIBILITY', group: 'discuss', rank: 2, risk: 'GENERAL', title: '記憶或情緒困難＋用藥管理：可以讓家人一起參與',
      text: '記憶或情緒困難時，管理多種藥物更不容易。經您同意，可以讓一位固定的家人一起核對藥物，並請藥師提供分格藥盒或簡化的用藥表。',
      actions: ['決定一位協助的家人', '請藥師提供簡化用藥表'], who: ['PHARMACIST', 'NURSE'], when: '這週', timing: 'THIS_WEEK', escalate: '', do_not: '',
      ask: '可以給我一張簡單的用藥時間表嗎？', evidence: [['HFA_ADHERENCE_2025', D], ['HFA_POLY_2025', S]] } }
];

/* 主要問題 → 主要卡片對應（engine 使用） */
C.primary_map = {
  ADHERENCE: { FORGET: ['ADH_FORGET'], SIDE_EFFECT: ['ADH_SIDE'], COMPLEX: ['ADH_COMPLEX'], BELIEF: ['ADH_BELIEF'], SWALLOW: ['ADH_SWALLOW'], LITERACY: ['ADH_LITERACY'], CAREGIVER: ['ADH_CARE'],
    COST_SKIP: ['ADH_COST_SKIP', 'ACC_COST'], SELF_STOPPED: ['ADH_SELF_STOPPED', 'MED_REVIEW_ALL'], OTHER: ['ADH_GENERIC'] },
  ACCESS: { COST: ['ACC_COST'], PICKUP: ['ACC_PICKUP'], TRANSPORT: ['ACC_TRANSPORT'], CARE_SUPPORT: ['ACC_CARE_SUPPORT'], INFO: ['ACC_INFO'], OTHER: ['ACC_OTHER'] },
  SYMPTOM: { BREATH: ['SYM_BREATH', 'SELF_DAILY'], SWELL: ['SYM_SWELL', 'SELF_DAILY'], FATIGUE: ['SYM_FATIGUE', 'CO_ANEMIA_IRON'], DIZZY: ['SYM_DIZZY', 'CO_FRAILTY'], NIGHT_BREATH: ['SYM_NIGHT_BREATH', 'SYM_SWELL'], SNORING: ['SYM_SNORING', 'CO_SLEEP_LUNG'], APPETITE: ['SYM_APPETITE', 'SELF_NUTRITION'], PALP: ['SYM_PALP', 'CO_AF'], MOOD: ['CO_MOOD_COG', 'SYM_FATIGUE'] },
  COMORBIDITY: { CKD: ['CO_CKD'], AF: ['CO_AF'], DM: ['CO_DM'], CAD_HTN: ['CO_CAD_HTN'], OBESITY: ['CO_OBESITY'], FRAILTY: ['CO_FRAILTY'], ANEMIA_IRON: ['CO_ANEMIA_IRON'], SLEEP_LUNG: ['CO_SLEEP_LUNG'], VALVE: ['CO_VALVE'], MOOD_COG: ['CO_MOOD_COG'], PAIN_GOUT: ['CO_PAIN_GOUT'], AMYLOID: ['CO_AMYLOID'], CANCER_TX: ['CO_CANCER_TX'], CARDIOMYOPATHY: ['CO_CARDIOMYOPATHY'] },
  SELF_CARE: { DAILY: ['SYM_SWELL', 'SELF_DAILY', 'HF_THREE_THINGS'], ACTIVITY: ['SELF_ACTIVITY'], NUTRITION: ['SELF_NUTRITION'], FLUID: ['SELF_FLUID', 'SELF_NUTRITION'], OTC: ['SELF_OTC'], VACCINE: ['SELF_VACCINE'], LIFESTYLE: ['SELF_LIFESTYLE'], HEAT: ['SELF_HEAT'], DEVICE: ['WP_DEVICE'] },
  GOALS: { WHAT_MATTERS: ['GOALS_WHAT_MATTERS'], SYMPTOM_SUPPORT: ['GOALS_SUPPORT'], ACP: ['GOALS_ACP', 'GOALS_SUPPORT'] },
  POST_DISCHARGE: ['POST_RECON', 'POST_FIRST_WEEK', 'POST_MONITOR', 'POST_FOLLOW'],
  UNDERSTAND: ['HF_BASICS', 'HF_THREE_THINGS', 'CARE_TEAM'],
  NONE: ['STABLE_CHECKUP', 'HF_THREE_THINGS']
};
/* 生活面需求 → 卡片（只在病人自己勾選時才出現） */
C.whole_person_card = { WORK: 'WP_WORK', TRAVEL: 'WP_TRAVEL', INTIMACY: 'WP_INTIMACY', SOCIAL: 'WP_SOCIAL', CULTURE_FAITH: 'WP_CULTURE_FAITH', HEAT_INFECTION: 'SELF_HEAT' };
/* 轉銜情境 → 卡片（與主要問題無關，獨立觸發） */
C.transition_card = { DISCHARGE: ['POST_RECON', 'POST_FIRST_WEEK', 'POST_MONITOR', 'POST_FOLLOW'], MED_CHANGE: ['MED_CHANGE_RECENT'], SICKDAY: ['SICKDAY_PLAN'] };
C.comorbidity_card = { CKD: 'CO_CKD', AF: 'CO_AF', DM: 'CO_DM', CAD_HTN: 'CO_CAD_HTN', OBESITY: 'CO_OBESITY', FRAILTY: 'CO_FRAILTY', ANEMIA_IRON: 'CO_ANEMIA_IRON', SLEEP_LUNG: 'CO_SLEEP_LUNG', VALVE: 'CO_VALVE', MOOD_COG: 'CO_MOOD_COG', PAIN_GOUT: 'CO_PAIN_GOUT', AMYLOID: 'CO_AMYLOID', CANCER_TX: 'CO_CANCER_TX', CARDIOMYOPATHY: 'CO_CARDIOMYOPATHY' };


/* ================= 2026 ESC 治療地圖設定（FMT／AMT／GDIT） =================
 * 病人端用語：核心長期治療（FMT）｜依條件的附加治療（AMT）｜裝置或介入治療（GDIT）
 * 只做資訊核對，不產生「應開始／應停用」的指示。 */
C.treatment_map = {
  profiles: {
    UNKNOWN: { text: '目前還不知道您的 LVEF（射出分率）。2026 ESC 中，MRA（保鉀型的心臟保護藥）與 SGLT2 inhibitor（保護心腎的排糖藥）是有症狀心衰竭不論射出分率都適用的核心長期治療；其他核心治療是否適用，需要知道 LVEF。可以請醫師告訴您最近一次心臟超音波的 LVEF。',
      fmt: [{ label: 'MRA', note: '不同的 MRA（保鉀型的心臟保護藥）適用的人不同（射出分率降低型主要用 spironolactone、eplerenone），請藥師確認您用的是否屬於心衰竭核心治療', classes: ['MRA'], role: 'ANY_MRA' }, { label: 'SGLT2 inhibitor（dapagliflozin、empagliflozin）', classes: ['SGLT2I'], role: 'HF_SGLT2I' }] },
    REDUCED: { text: '依您提供的資料，2026 ESC 歸類為射出分率降低型（LVEF 低於 50%）。核心長期治療有四類：',
      fmt: [{ label: 'ARNI／ACEI／ARB', classes: ['RAAS_ARNI'], role: 'HFrEF_RAAS' }, { label: 'Beta-blocker', classes: ['BETA_BLOCKER'], role: 'HFrEF_BB' },
            { label: 'MRA', note: '此型的主要研究證據來自 spironolactone、eplerenone', classes: ['MRA'], role: 'HFrEF_MRA' }, { label: 'SGLT2 inhibitor（dapagliflozin、empagliflozin）', classes: ['SGLT2I'], role: 'HF_SGLT2I' }] },
    PRESERVED_CONFIRMED: { text: '醫師已告知為射出分率保留型（LVEF 50% 以上）。2026 ESC 的核心長期治療有兩類：',
      fmt: [{ label: 'MRA', note: '研究證據包含 spironolactone 等與 finerenone；選哪一種依腎功能、血鉀與醫師判斷', classes: ['MRA'], role: 'HFpEF_MRA' }, { label: 'SGLT2 inhibitor（dapagliflozin、empagliflozin）', classes: ['SGLT2I'], role: 'HF_SGLT2I' }] },
    EF_GE50_UNCONFIRMED: { text: '您填的射出分率（LVEF）為 50% 以上。射出分率保留型的診斷除了射出分率，還需要症狀與其他心臟檢查的客觀證據，請以醫師判斷為準。2026 ESC 中，以下兩類是不論射出分率都適用的核心長期治療：',
      fmt: [{ label: 'MRA', note: '不同的 MRA（保鉀型的心臟保護藥）適用的人不同（射出分率降低型主要用 spironolactone、eplerenone），請藥師確認您用的是否屬於心衰竭核心治療', classes: ['MRA'], role: 'ANY_MRA' }, { label: 'SGLT2 inhibitor（dapagliflozin、empagliflozin）', classes: ['SGLT2I'], role: 'HF_SGLT2I' }] },
    IMPROVED: { text: '您的射出分率曾經降低、現在已進步。國際心衰竭指引建議繼續原本可耐受的核心長期治療（四類），不要因數值進步而自行停藥；是否調整只由醫師決定。',
      fmt: [{ label: 'ARNI／ACEI／ARB', classes: ['RAAS_ARNI'], role: 'HFrEF_RAAS' }, { label: 'Beta-blocker', classes: ['BETA_BLOCKER'], role: 'HFrEF_BB' },
            { label: 'MRA', classes: ['MRA'], role: 'HFrEF_MRA' }, { label: 'SGLT2 inhibitor（dapagliflozin、empagliflozin）', classes: ['SGLT2I'], role: 'HF_SGLT2I' }] }
  },
  ef41_49_text: '（您的射出分率在 41–49%：2026 歐洲心臟學會指引把這一段和 40% 以下一起歸為降低型並給同樣的核心治療建議，但專門只研究這一段的大型試驗較少，是否每一類都適合請醫師依您的情況判斷。）',
  stale_text: '（您記得的射出分率已超過一年、不確定是什麼時候量的，或不確定從哪裡看到的，所以下面只列出不分心臟功能都適用的部分；請先問醫師最近一次的結果。）',
  preserved_no_lvef_text: '若您最近一次 LVEF（射出分率）其實低於 50%，2026 ESC 歸類為射出分率降低型，核心治療有四類，請和醫師確認。',
  pregnancy_text: '您表示可能懷孕或計畫懷孕：以下多種藥物懷孕期間不適用，請以開藥醫師與婦產科的安排為準，不要自行停藥。',
  conflict_text: '（您填的 LVEF 低於 50%，與醫師先前告知的保留型不同；2026 ESC 已改以 50% 為界，請以醫師最新判斷為準。）',
  fmt_footer: '以上是 2026 ESC 列為核心的長期治療。上面有的不代表您該吃，沒有的也不代表您漏了：是否適合、為什麼沒用（血壓、腎功能、血鉀或副作用），都要由醫師或藥師依您的情況判斷。沒勾到不等於沒有在用。',
  symptom_text: '利尿劑（排水藥）用來改善積水症狀，不屬於核心長期治療；用量依體液狀態由醫療團隊調整。',
  amt: [
    /* 4.9.3 WP-D（LIT-12）：心跳門檻維持 GE70（含 70）——ESC 2026 §6.1.5.1 p.34 正文（SHIFT 入選）為 ≥70 b.p.m.，Rec Table 5 p.38 寫 >70 b.p.m.，指引內部不一致；
       前提條件依 Rec Table 5 p.38 補「核心治療（ACE-I/ARNI、MRA、SGLT2-I、BB）都已調整到可耐受劑量」；前提問卷無法判斷 → 永遠不給「符合」 */
    { label: 'ivabradine', lvef_in: ['LE35'], rhythm: 'SINUS', hr: 'GE70', prerequisites: ['BB_MAX_TOLERATED', 'FMT_OPTIMIZED'], note: '心律規律（竇性）、休息時心跳仍偏快，而且讓心跳慢下來的藥已加到可耐受的最高量時，醫師可能會評估' },
    { label: 'digoxin', lvef_in: ['LE35', '36_40'], symptoms: 'SYMPTOMS', prerequisites: ['FMT_OPTIMIZED'], note: '核心治療都用了、症狀還是明顯時，醫師可能會評估' },
    /* 4.9.3 WP-D（LIT-11）：ESC 2026 Table 6 p.14、§6.1.5.2 p.34、Rec Table 5 p.38：symptomatic HFrEF and LVEF <45% despite optimal FMT（IIb B1）；不再要求近期惡化住院 */
    { label: 'vericiguat', lvef_in: ['LE35', '36_40', '41_44'], symptoms: 'SYMPTOMS', prerequisites: ['FMT_OPTIMIZED'], note: '射出分率低於 45%、核心治療都已調整到可耐受劑量但仍有症狀時，醫師可能會評估' },
    { label: 'semaglutide 或 tirzepatide', lvef_in: ['45_49', 'GE50'], bmi: 'GE30', symptoms: 'SYMPTOMS', no_pregnancy: true, note: '活動時仍有症狀、而且 BMI 30 以上時可以和醫師討論；有沒有糖尿病都適用' },
    { label: '靜脈鐵劑', profile_in: ['REDUCED'], tsat: 'LT20', note: '射出分率降低型合併缺鐵（TSAT 低於 20%），可改善症狀與生活品質' }
  ],
  /* HFPC-AUD-0003：前提條件（劑量是否已到可耐受最高量、核心治療是否都已用上）問卷無法判斷 → 永遠不給「符合」 */
  prerequisite_text: { BB_MAX_TOLERATED: '讓心跳慢下來的藥（β 阻斷劑）是否已加到可耐受的最高量', FMT_OPTIMIZED: '核心長期治療是否都已用上並調整到可耐受的劑量' },
  /* HFPC-AUD-0908：治療地圖的分型依據；不等同 UDHF 2026 的定義分類（UDHF 只作定義與病程參考） */
  classification_basis: { source_id: 'ESC_HF_2026', scheme: 'TREATMENT_PROFILE_LVEF_50', not_equivalent_to: 'UDHF_2026', note: '治療核對表以 LVEF（射出分率）50% 為界（2026 ESC）；這不是完整的心衰竭分類，也不是診斷' },
  amt_footer: '附加治療通常在核心長期治療已盡量調整後才考慮，只在特定條件下使用，是否適合由醫師依心跳、心律、腎功能、血壓與其他情況判斷；台灣健保給付與仿單可能與國際指引不同。',
  gdit: [
    { lvef_in: ['LE35'], suppress_if_device: ['ICD'], information_level: 'GENERAL_INFORMATION', text: '左心室射出分率（LVEF）35% 以下，且最佳藥物治療約 3 個月後仍未改善時，心臟科可能依心電圖等評估植入式去顫器（ICD）或心臟再同步治療（CRT）。' },
    { information_level: 'GENERAL_INFORMATION', text: '瓣膜或其他介入治療，依個別心臟檢查結果由心臟科評估。' }
  ],
  improved_text: '您表示射出分率曾進步：2026 ESC 仍建議繼續可耐受的核心長期治療，是否調整只由醫師決定。'
};

/* ================= 本次摘要專用文字（explicit microcopy） =================
 * issue：「這次最重要」要說的問題本身（不是祈使句，不從標題切字）
 * summary_action：摘要裡「今天先做」的說法（沒有就用卡片第一個行動）
 * action_key：語意相同的行動用同一個 key，摘要裡只出現一次（SUM-SEMANTIC-DEDUP-01） */
C.summary_microcopy = {
  ADH_COST_SKIP: { issue: '曾因藥費或拿藥困難少吃或停過藥' },
  ADH_SELF_STOPPED: { issue: '有藥自己停了、減量，或不確定還要不要吃' },
  ACTIVITY_WAIT: { issue: '有需要今天處理的變化，運動先等穩定' },
  EMERGENCY: { issue: '您勾到可能有生命危險的情況' },
  URGENT_PINK: { issue: '新出現粉紅色或帶血的泡沫痰，可能是肺部積水' },
  URGENT_BLEED: { issue: '有吐血、咳血、黑便或血便，或出血止不住' },
  SAME_DAY: { issue: '最近比平常更喘、更腫，或體重上升得快' },
  SAME_DAY_SICK: { issue: '一直吐、拉肚子或吃喝不下，有些藥可能需要醫療團隊個別處理' },
  SAME_DAY_ICD: { issue: '去顫器（ICD）電擊過一次' },
  CONTACT_TODAY: { issue: '您覺得最近整個人比平常差很多' },
  UNCERTAIN_CHANGE: { issue: '說不上來最近有沒有變差' },
  IMPROVED_KEEP_PLAN: { issue: '最近覺得比較好，要確認哪些藥要繼續吃' },
  MED_UNKNOWN_NAME: { issue: '還不知道自己在吃哪些藥', summary_action: '把目前真的在吃的藥袋／藥單一起帶去核對', action_key: 'BRING_MED_LIST' },
  MED_REVIEW_ALL: { issue: '想把所有的藥一起檢查一次', summary_action: '把目前真的在吃的藥袋／藥單一起帶去核對', action_key: 'BRING_MED_LIST' },
  MED_RECON: { issue: '實際在吃的藥和藥單可能不一樣', summary_action: '把目前真的在吃的藥袋／藥單一起帶去核對', action_key: 'BRING_MED_LIST' },
  MED_HOWTO: { issue: '不確定每一顆藥怎麼吃、什麼時候吃', action_key: 'BRING_MED_LIST' },
  ADH_FORGET: { issue: '常常忘記吃藥' },
  ADH_SIDE: { issue: '吃藥後覺得不舒服' },
  ADH_COMPLEX: { issue: '吃藥的時段太多、太複雜' },
  ADH_BELIEF: { issue: '不確定每顆藥為什麼要吃' },
  ADH_SWALLOW: { issue: '吞藥有困難' },
  ADH_LITERACY: { issue: '藥袋上的說明看不太懂' },
  ADH_CARE: { issue: '吃藥需要家人協助' },
  ADH_GENERIC: { issue: '照著吃藥有困難，原因還說不上來' },
  ACC_COST: { issue: '藥費有負擔' },
  ACC_PICKUP: { issue: '領藥不方便' },
  ACC_TRANSPORT: { issue: '回診的交通有困難' },
  ACC_CARE_SUPPORT: { issue: '家裡照顧人手不夠、照顧者很累' },
  ACC_INFO: { issue: '資訊太多，看不太懂' },
  ACC_OTHER: { issue: '有其他影響治療的困難' },
  SYM_BREATH: { issue: '最近的喘' },
  SYM_SWELL: { issue: '水腫或體重增加' },
  SYM_FATIGUE: { issue: '很容易累、沒力氣' },
  SYM_DIZZY: { issue: '頭暈、站起來會暈' },
  SYM_NIGHT_BREATH: { issue: '躺平會喘，或半夜喘醒要坐起來' },
  SYM_SNORING: { issue: '打呼很大聲、睡覺時像停住呼吸' },
  SYM_APPETITE: { issue: '吃不下、體重一直掉' },
  POST_RECON: { issue: '剛出院，出院藥單和家裡的藥還沒核對', summary_action: '把目前真的在吃的藥袋／藥單一起帶去核對', action_key: 'BRING_MED_LIST' },
  POST_MONITOR: { issue: '心衰竭惡化住院後，出院後的追蹤項目和核心治療還要確認' },
  POST_FOLLOW: { issue: '出院後的下一次回診和聯絡窗口還不確定' },
  CO_CKD: { issue: '腎功能與血鉀要和心衰竭一起追蹤' },
  CO_AF: { issue: '心房顫動與心衰竭要一起照顧' },
  CO_DM: { issue: '糖尿病與心衰竭要一起照顧' },
  CO_CAD_HTN: { issue: '冠心症或高血壓與心衰竭要一起照顧' },
  CO_OBESITY: { issue: '體重過重與心衰竭要一起照顧' },
  CO_FRAILTY: { issue: '體力變差、容易跌倒' },
  CO_ANEMIA_IRON: { issue: '長期疲倦，可能和缺鐵有關' },
  CO_SLEEP_LUNG: { issue: '睡眠或肺部的問題也可能讓人喘' },
  CO_VALVE: { issue: '心臟瓣膜的問題要和心衰竭一起追蹤' },
  CO_MOOD_COG: { issue: '心情或記性的變化' },
  CO_PAIN_GOUT: { issue: '常需要止痛藥' },
  CO_AMYLOID: { issue: '已確診心臟類澱粉沉積症' },
  CO_CANCER_TX: { issue: '做過或正在做癌症治療，心臟要一起追蹤' },
  CO_CARDIOMYOPATHY: { issue: '心肌病變，或家族有人年輕時心臟就出問題' },
  GOALS_WHAT_MATTERS: { issue: '希望治療也符合自己想過的生活' },
  GOALS_SUPPORT: { issue: '症狀和生活品質希望被多照顧一些' },
  GOALS_ACP: { issue: '想談以後病情變重時希望怎麼被照顧' },
  TREATMENT_MAP: { issue: '目前的心衰竭核心治療還沒有逐項核對' },
  FEAS_SUPPORT: { issue: '今天建議的事做起來有困難' },
  CAREGIVER_SELF: { issue: '照顧者自己的狀況也需要被照顧' },
  URGENT_PRESYNCOPE: { issue: '快要昏倒、眼前一黑' },
  URGENT_CONFUSION: { issue: '這一兩天突然變得糊塗、答非所問' },
  URGENT_HEAD: { issue: '吃抗凝血藥時跌倒或撞到頭' },
  SAME_DAY_PALP: { issue: '心跳一直很快、很慢或亂跳' },
  SYM_PALP: { issue: '心跳快、慢或不規則' },
  ADH_COUGH: { issue: '吃藥後一直乾咳' },
  STABLE_CHECKUP: { issue: '今天沒有新問題，可以趁穩定時把照護計畫準備好' },
  POST_FIRST_WEEK: { issue: '剛出院第一週：每天量體重、確認第一次追蹤的日期' },
  SAME_DAY_BLEED_MINOR: { issue: '新出現的出血（尿有血色、牙齦流血或瘀青變多）' },
  SICKDAY_PLAN: { issue: '生病吃不下時，藥要怎麼處理還沒有書面計畫' },
  MED_INCOMPLETE: { issue: '目前列出的藥還不是全部', summary_action: '把目前真的在吃的藥袋／藥單一起帶去核對', action_key: 'BRING_MED_LIST' },
  MED_CHANGE_RECENT: { issue: '最近剛換藥或調整劑量' },
  WP_WORK: { issue: '想回去工作' },
  WP_TRAVEL: { issue: '準備出遠門' },
  WP_INTIMACY: { issue: '想問親密關係與用藥' },
  WP_SOCIAL: { issue: '一個人住或身邊支持不夠' },
  WP_CULTURE_FAITH: { issue: '家庭決定方式或信仰要納入照護' },
  ADV_HF_REFERRAL: { issue: '一再住院或休息時也會喘，可能需要心衰竭專責團隊評估' },
  SYS_LVEF_STALE: { issue: '心臟超音波的射出分率沒有近期、可確認的日期' },
  SYS_LVEF_CONFLICT: { issue: '填的射出分率和醫師說的類型對不起來' },
  SYS_DX_UNCONFIRMED: { issue: '心衰竭的診斷還沒有確定' },
  SELF_WORSEN_PLAN: { issue: '不太確定突然變差時該怎麼做、找誰' },
  RULE_DISCHARGE_RECON: { issue: '剛出院，而且實際吃的藥和藥單可能不一樣', summary_action: '把目前真的在吃的藥袋／藥單一起帶去核對', action_key: 'BRING_MED_LIST' },
  RULE_K_RISK: { issue: '您用的這幾種藥需要按時追蹤血鉀和腎功能' },
  RULE_NSAID: { issue: '有在用成藥或常需要止痛藥，消炎止痛藥可能讓心衰竭變差' },
  RULE_BLEED_COMBO: { issue: '同時用抗凝血藥與抗血小板藥，療程需要確認' },
  RULE_ANTITHROMBOTIC_OTC: { issue: '抗凝血或抗血小板藥加上成藥或保健品，出血風險要先確認' },
  RULE_SICKDAY: { issue: '生病吃不下時的用藥方式還沒有事先問好' },
  RULE_HYPO: { issue: '用降血糖藥又吃得少，要留意低血糖' },
  RULE_GLP1_FLUID: { issue: 'GLP-1 類藥物加上利尿劑或 SGLT2 inhibitor，要留意脫水' },
  RULE_FALL: { issue: '容易跌倒，又在用降血壓、利尿或降血糖的藥' },
  RULE_DIGOXIN: { issue: '用 digoxin，又有腎功能不好或抗心律不整藥' },
  RULE_AMIO: { issue: '抗心律不整藥和其他藥可能互相影響' },
  RULE_HF_DRUG_CAUTION: { issue: '有些正在用的藥可能讓心衰竭變差' },
  RULE_NITRATE_PDE5: { issue: '用硝酸鹽類或 vericiguat，不能自行併用威而鋼類藥物' },
  RULE_GLP1_ELIGIBLE: { issue: '依您填的資料，可以和醫師討論 semaglutide 或 tirzepatide' },
  RULE_IRON_TSAT: { issue: '鐵的檢驗（TSAT）低於 20%' },
  RULE_EF_IMPROVED: { issue: '射出分率進步了，核心治療要繼續' },
  RULE_REHAB_AFTER_DHF: { issue: '心衰竭住院後，穩定時可以問心臟復健' },
  RULE_PREGNANCY: { issue: '可能懷孕或計畫懷孕，有些心臟藥需要醫師重新安排' },
  RULE_POLY_BURDEN: { issue: '藥很多、很難管理' },
  RULE_WEIGHT_FRAILTY: { issue: '想減重，但體力和食慾也在下降' },
  RULE_SUPPORTIVE_TRIGGER: { issue: '症狀一直影響生活' },
  RULE_CAREGIVER_COG: { issue: '記憶或情緒的困難影響用藥管理' }
};
Object.keys(C.summary_microcopy).forEach(function (id) {
  var m = C.summary_microcopy[id];
  var target = C.cards[id] || (C.rules.filter(function (r) { return r.id === id; })[0] || {}).card;
  if (!target) return;
  target.issue = m.issue;
  if (m.summary_action) target.summary_action = m.summary_action;
  if (m.action_key) target.action_key = m.action_key;
});
/* 吃藥問題 → 卡片（MEDICATION 底下；ADHERENCE／ACCESS 已轉回各自的後端代碼） */
/* 「吃了不舒服」細分：side_effect → 追加的卡片（ADH_SIDE 仍保留） */
C.side_effect_map = { DIZZY: ['SYM_DIZZY'], COUGH: ['ADH_COUGH'], FATIGUE: ['SYM_FATIGUE'], OTHER: [] };
C.med_problem_map = {
  UNDERSTAND: ['MED_REVIEW_ALL'],
  ADMINISTRATION: ['MED_HOWTO', 'ADH_LITERACY'],
  TOLERABILITY: ['ADH_SIDE'],
  RECONCILIATION: ['MED_RECON'],
  SAFETY_REVIEW: ['MED_REVIEW_ALL'],
  UNKNOWN_MED: ['MED_UNKNOWN_NAME']
};

/* ================= 照顧者版本（F40）：不是把「您」換成「病人」，而是換成照顧者真正要做的事 =================
 * 只覆蓋 title／text／actions／teach_prompt；其他欄位（證據、找誰、升級條件）沿用原卡。
 * 引擎在照顧者模式把這裡的內容套到卡片上（card.cg_applied = true），建置檢查至少 15 張、文字與行動都要真的不同。 */
C.caregiver_variants = {
  EMERGENCY: { title: '現在請幫病人打 119',
    text: '病人的情況可能有生命危險。先打電話求救，陪在病人身邊，這一頁之後再看就好。',
    actions: ['現在撥 119；手機打不通就改撥 112，說清楚地址和病人的狀況', '讓病人坐著或半躺、不要走動；不要讓病人自己開車或騎車', '記下病人幾點開始不舒服', '把藥袋或用藥清單準備好，交給救護人員'] },
  URGENT_PINK: { title: '今天一定要帶病人給醫師當面看',
    text: '病人新出現粉紅色或帶血的泡沫痰，可能是肺裡積了水。就算現在還不太喘，也要今天當面檢查，不能只打電話等回覆。',
    actions: ['今天陪病人到原本看診的醫院門診或急診', '帶著病人的藥袋或用藥清單', '路上留意病人有沒有變得更喘、嘴唇發紫'] },
  URGENT_BLEED: { title: '現在帶病人去急診：這種出血不能等門診',
    text: '病人吐血、咳血、解黑便或血便，或出血一直止不住，需要現在就查清楚出血在哪裡。吃抗凝血藥或抗血小板藥的人更要立刻去。',
    actions: ['現在陪病人去急診，病人不要自己開車或騎車', '帶上所有藥袋，特別是抗凝血藥、抗血小板藥和止痛藥', '記下出血幾點開始、大概多少，拍照也可以'] },
  URGENT_PRESYNCOPE: { title: '今天帶病人給醫師當面看：快昏倒不能只用電話處理',
    text: '病人眼前一黑、快要昏倒，原因可能是血壓太低、心跳太慢或太快、出血或脫水，要今天當面量血壓、心跳，必要時做心電圖。',
    actions: ['今天陪病人到原就醫的醫院門診或急診', '讓病人先坐下或躺下，起身時扶著', '把藥袋帶著，特別是血壓藥、心臟藥、利尿劑'],
    teach_prompt: '等一下您要怎麼帶病人去醫院？' },
  URGENT_CONFUSION: { title: '現在帶病人去急診：突然變糊塗要立刻找原因',
    text: '和平常比，病人這一兩天突然變得糊塗、答非所問或認不得人，原因有很多，有些需要馬上處理，不能等門診。',
    actions: ['現在陪病人到最近的急診，不要讓病人一個人', '把藥袋或用藥清單帶著', '告訴醫師病人平常的樣子，和從什麼時候開始不一樣'] },
  URGENT_HEAD: { title: '現在帶病人去急診：吃抗凝血藥又撞到頭',
    text: '病人正在吃讓血比較不容易凝固的藥，跌倒或撞到頭，就算現在看起來沒事，也要現在到急診檢查。',
    actions: ['現在陪病人去急診，病人不要自己開車或騎車', '把抗凝血藥的藥袋帶著', '記下撞到的時間；路上留意病人會不會越來越想睡、吐或講話不清楚'] },
  SAME_DAY: { title: '今天幫病人打一通電話給醫療團隊',
    text: '病人這次的變化，今天就要讓醫療團隊知道，由他們決定要不要提早回診或調整治療。家人看到的變化，常常很重要。',
    actions: ['今天打給病人原本看診的心臟科門診或心衰竭個管師，或陪病人回診', '講三件事：哪裡不舒服、從哪天開始、和平常差多少；最近有沒有換藥也要講', '聯絡不上、病人又越來越不舒服，今天就近帶去看'] },
  SAME_DAY_SICK: { title: '病人一直吐、拉肚子：今天先確認藥要怎麼吃',
    text: '病人持續嘔吐、腹瀉或吃喝不下時，身體容易缺水。有幾類心臟、腎臟和降血糖的藥，這時候可能需要醫療團隊個別判斷要不要暫停。',
    actions: ['今天聯絡醫療團隊或藥師，說明病人吃喝的量、吐和拉的次數', '病人有醫療團隊寫的「生病時用藥方式」，照著幫他準備藥', '留意病人的尿量是不是比平常少很多；有糖尿病的話幫忙量血糖'] },
  SAME_DAY_PALP: { title: '病人心跳一直很快、很慢或亂跳：今天打電話給醫療團隊',
    text: '病人心跳一直很快、很慢或不規則，今天就要讓醫療團隊知道，由他們決定要不要當面檢查或做心電圖。',
    actions: ['今天幫病人打電話給原就醫的醫院或心臟科', '有血壓計的話，幫病人量一次血壓和心跳並寫下來', '說清楚從什麼時候開始、病人會不會喘或頭暈'] },
  CONTACT_TODAY: { title: '病人最近整個人變差：今天先打電話說一聲',
    text: '病人沒有勾到緊急警訊，但整個人比平常差很多。先打電話講一聲，由醫療團隊決定要不要提早回診，比讓病人硬撐安全。',
    actions: ['今天聯絡病人原就醫的院所或心衰竭個管師', '說明您看到哪裡變差（吃、睡、走路、講話、喘），從什麼時候開始'] },
  MED_RECON: { title: '先確認：病人實際吃的，和藥單上寫的一不一樣',
    text: '藥名、顆數、時段、家裡的舊藥或不同科的藥單對不起來，或您不確定時，先把差異列出來，請藥師核對。釐清以前，不用自己猜哪顆要停、要補或要恢復。',
    actions: ['把病人現在真的在吃的藥和藥單一格一格對，列出哪裡不一樣', '把藥袋和實際的藥一起帶去，請藥師核對'] },
  MED_HOWTO: { title: '不確定怎麼吃：請藥師幫病人排一張一天的吃藥時間表',
    text: '每一顆藥什麼時候吃、飯前還是飯後、漏吃了怎麼辦，每種藥不一樣，不要用猜的。請藥師依病人的作息排時間表，也問清楚哪些藥您可以先幫忙分裝。',
    actions: ['把病人所有藥袋帶去，請藥師依病人的作息排時間表', '問清楚漏吃一次時怎麼辦，也問哪些藥您可以幫忙分裝'] },
  ADH_FORGET: { title: '病人常忘記吃藥：先找出最常漏掉的時間點',
    text: '先看看病人最常在什麼情況漏掉（例如中午家裡沒人、晚上太累），再把吃藥綁在固定的日常事件上，或用分格藥盒、手機提醒。',
    actions: ['觀察一週，找出病人最常漏掉的一個時段', '一起準備分格藥盒，或在那個時段打電話、設提醒', '漏吃怎麼補，先問藥師（不同藥規則不同）'] },
  ADH_SIDE: { title: '病人吃了不舒服：先記下時間關係，再請團隊判斷',
    text: '記下病人哪裡不舒服、什麼時候開始、和哪顆藥或哪個時段最接近。不舒服不一定是藥造成的，交給醫療團隊判斷原因和處理方式。',
    actions: ['記下病人哪裡不舒服、什麼時候開始、和哪顆藥最接近', '有血壓計的話，幫病人量當時的血壓和心跳', '儘早告訴醫師或藥師'] },
  SYM_SWELL: { title: '病人水腫或體重增加：固定方式量體重，看趨勢',
    text: '每天早上病人起床、上完廁所、吃早餐前，用同一台體重計量並記下來。短時間體重明顯上升或腳越來越腫，可能是體內積水。每個人的警戒值不同，以醫療團隊給的計畫為準。',
    actions: ['每天固定時間幫病人量體重並寫下來', '看一下病人的腳踝、小腿，按下去會不會凹一個洞', '請醫療團隊告訴您病人的體重警戒值'],
    teach_prompt: '明天早上，您會在什麼時候、怎麼幫病人量體重？' },
  POST_RECON: { title: '病人剛出院第一件事：核對出院藥單和家裡的藥',
    text: '住院期間常會新增、停用、暫停或改變劑量。和病人一起對照出院藥單：每一顆是新增、停用、暫停還是改劑量，暫停的藥何時、由誰決定恢復。',
    actions: ['拿出院藥單和家裡所有的藥，和病人一起逐一比對', '不清楚的地方打電話問出院醫院的藥師或護理師', '把住院前的舊藥先收到另一個地方，避免病人拿錯'] },
  POST_FIRST_WEEK: { title: '病人出院第一週：每天量體重，一週內要有第一次追蹤',
    text: '從出院隔天起，每天早上幫病人量體重並寫下來；出院那天的體重就是比較的基準。出院後大約一週內，應該有第一次回診或電話追蹤，出院單上沒寫就打電話問。',
    actions: ['每天早上幫病人量體重，寫在「14 天自我觀察表」', '確認出院後第一次回診或追蹤的日期，安排好誰陪病人去', '請醫療團隊寫下：體重增加多少要打電話'],
    teach_prompt: '明天早上，您會在什麼時候、怎麼幫病人量體重？' },
  SELF_DAILY: { title: '每天注意病人「和平常有沒有不同」',
    text: '不用記很多數字。例如病人原本走到廁所不會喘，這兩天走同樣距離卻明顯更喘，或吃得少、比較愛睡、腳比較腫，都值得記下來。',
    actions: ['每天看一下病人的呼吸、能不能躺平睡、腳腫、活動力和精神', '固定時間幫病人量體重'] },
  HF_THREE_THINGS: { title: '照顧心衰竭的家人：每天最重要的三件事',
    text: '一、確認病人照處方用藥，有疑問先問，不自行停藥。二、每天看病人和平常比有沒有變化（喘、腫、體重、活動力、精神）。三、您自己也要知道什麼情況要當天聯絡醫療團隊，什麼情況要撥 119。',
    actions: ['把本頁「什麼時候要求救」那一欄拍照存在您的手機，也給其他家人一份'],
    teach_prompt: '哪些情況要直接幫病人打 119？' },
  SICKDAY_PLAN: { title: '請醫療團隊寫一張「病人生病時怎麼吃藥」',
    text: '病人發燒、上吐下瀉、吃不下時，有幾類藥需要暫時調整，但每個人不一樣，不能照別人的做。趁現在病人還好，先請醫師或藥師寫下來，貼在藥盒旁。',
    actions: ['下次陪病人看診時，請醫師或藥師寫下：生病時哪幾顆先停、什麼情況恢復、要不要回診', '把這張紙貼在病人的藥盒旁，也拍照存在您的手機'],
    teach_prompt: '如果病人明天開始上吐下瀉，您第一步會做什麼？' },
  CO_FRAILTY: { title: '病人容易頭暈或跌倒：把體力和用藥一起評估',
    text: '衰弱和跌倒不是只看年紀。病人站起來頭暈、站不穩或最近跌倒過，請記下發生的時間和情況，連同血壓、喝水和用藥情況，一起告訴醫療團隊。',
    actions: ['記下病人跌倒或頭暈的時間，和當時在做什麼', '病人起身時陪著，先坐一下再慢慢站', '問醫療團隊是否適合復健或居家安全評估'] }
};

/* 3.1.0（HFPC-AUD-0001）：心衰竭專屬規則清單（不在清單＝一般規則）；放在規則物件之外，避免只為了加標記就讓其他規則的全文核對失效 */
C.rule_scope = { RULE_GLP1_ELIGIBLE: 'HF_CONFIRMED', RULE_IRON_TSAT: 'HF_CONFIRMED', RULE_EF_IMPROVED: 'HF_CONFIRMED', RULE_REHAB_AFTER_DHF: 'HF_CONFIRMED' };
/* 3.1.0（HFPC-AUD-0902）：有用途限制的來源（consumer_allowlist），每一張引用它的卡都要宣告「用在哪個用途」；建置時比對 */
C.evidence_use = {
  UDHF_2026: { IMPROVED_KEEP_PLAN: 'TRAJECTORY_CONCEPT', HF_BASICS: 'DEFINITION', SYS_LVEF_CONFLICT: 'DEFINITION', SYS_DX_UNCONFIRMED: 'DEFINITION' }
};

if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis);

/* =====================================================================
 * 用藥真相層：藥物類別教學、成分清單、重複／交互作用檢查、心衰竭要留意的藥
 * ---------------------------------------------------------------------
 * 設計原則：
 *  - 病人可以只勾「認得的藥名」；勾了成分才做重複與交互作用比對（不猜、不推論）。
 *  - 只產生「請醫師或藥師核對」的提醒，永遠不產生開始／停止／調整劑量的指示。
 *  - 沒有勾到不代表沒有在用：所有結論都附帶這個前提。
 * ===================================================================== */
(function (root) {
'use strict';
var C = root.HFPC_CONTENT || (typeof require !== 'undefined' ? require('./content.js') : null);
var D = 'DIRECT', S = 'SUPPORTIVE';
var PREG = '如果可能懷孕、正在計畫懷孕或已經懷孕，請儘快告訴開藥醫師，不要自己停藥。';

/* ---------- 藥物類別（病人語氣的用藥指導） ---------- */
C.medications = [
  { id: 'RAAS_ARNI', label: '幫心臟減輕負擔的藥（ARNI／ACEI／ARB）', short: '減輕心臟負擔的藥',
    examples: 'sacubitril/valsartan、enalapril、ramipril、valsartan、losartan、candesartan',
    why: '這類藥讓血管放鬆、心臟不用那麼費力，長期使用可以減少心衰竭惡化。',
    notice: '剛開始或加量時，有些人站起來會頭暈；ACEI 這一類有人會乾咳。',
    how: '每天固定時間吃。ARNI 和 ACEI 不能同時吃，中間要間隔，換藥由醫師安排。',
    monitor: '血壓、腎功能、血鉀（開始或調整後通常會抽血）。',
    problem: '頭暈或乾咳時記下什麼時候發生，回診告訴醫師，通常有調整或換藥的辦法。',
    urgent: '臉、嘴唇、舌頭或喉嚨突然腫起來、呼吸困難：立刻打 119。',
    do_not: '不要因為一次血壓低或一次抽血數字就自己停藥；不要自己用低鈉鹽或鉀補充品。' + PREG,
    bring: '家裡量的血壓紀錄、最近的抽血報告。',
    evidence: [['ACC_HFREF_2024', D], ['ESC_HF_2026', S], ['TSOC_CHF_2023', S]] },
  { id: 'BETA_BLOCKER', label: '讓心跳慢下來的藥（乙型阻斷劑）', short: '讓心跳慢下來的藥',
    examples: 'bisoprolol、carvedilol、metoprolol、nebivolol',
    why: '讓心跳不要那麼快、心臟休息得比較夠，長期使用可以減少心衰竭惡化。',
    notice: '剛開始或加量的頭幾週可能比較累、頭暈，通常會慢慢適應。',
    how: '每天固定時間吃，不要自己跳過。',
    monitor: '心跳、血壓；加量期間也要看體重和水腫。',
    problem: '累或頭暈的時候，量一下心跳血壓寫下來，回診給醫師看。',
    urgent: '心跳很慢又昏倒、快昏倒：打 119。',
    do_not: '不要突然自己停掉，可能讓心跳變快、胸痛或心衰竭變差。',
    bring: '家裡量的心跳與血壓紀錄。',
    evidence: [['ACC_HFREF_2024', D], ['ESC_HF_2026', S], ['TSOC_CHF_2023', S]] },
  { id: 'MRA', label: '保鉀型利尿／保護心臟的藥（MRA）', short: '保鉀型的心臟保護藥',
    examples: 'spironolactone、eplerenone、finerenone',
    why: '這類藥可以減少心臟的傷害與惡化，是長期治療的一環。不論射出分率是高是低，這一類都算心衰竭的核心用藥。',
    notice: '血鉀高通常沒有感覺，所以要靠抽血；spironolactone 有些男性會胸部脹痛。',
    how: '依醫囑每天吃。同一類裡不同的藥，研究過的對象不一樣，不能自行互換。',
    monitor: '血鉀、腎功能（開始或調整後通常會抽血）。',
    problem: '胸部脹痛或其他不舒服，告訴醫師，有機會換成另一種。',
    urgent: '肌肉很沒力、心跳亂又頭暈昏倒：今天就醫或打 119。',
    do_not: '不要自己吃低鈉鹽（含鉀）或鉀補充品，也不要自己加消炎止痛藥。' + PREG,
    bring: '最近的血鉀與腎功能報告。',
    evidence: [['ESC_HF_2026', D], ['ACC_HFREF_2024', S], ['CFS_HK_KCL_SALT', S]],
    esc: { cor: 'I', loe: 'A', population: '有症狀心衰竭，不論射出分率', drug_scope: '收縮功能差的型別主要證據為 spironolactone、eplerenone；保留型包含 finerenone', verification: 'ESC 新聞稿與二手摘要確認 Class I' } },
  { id: 'SGLT2I', label: '從尿液排糖、保護心腎的藥（SGLT2 抑制劑）', short: '保護心腎的排糖藥',
    examples: 'dapagliflozin、empagliflozin',
    why: '同時照顧心臟、腎臟，沒有糖尿病的人也會用，可以減少心衰竭惡化與住院。',
    notice: '尿量會變多、比較容易口渴；少數人私密處會癢或發炎。',
    how: '每天固定吃；注意私密處清潔。',
    monitor: '腎功能、身體的水分狀況；有糖尿病的人照常測血糖。',
    problem: '私密處癢或分泌物變多，告訴醫師或藥師。',
    urgent: '噁心想吐、肚子痛、喘、非常累（就算血糖不高），或私密處紅腫痛又發燒：立刻就醫。',
    do_not: '生病吃不下、一直吐拉肚子或要開刀時，照醫療團隊之前交代的方式處理；沒有交代過就先聯絡他們，不要自己決定。' + PREG,
    bring: '要開刀或做檢查前，先告訴醫師您在用這個藥。',
    evidence: [['ESC_HF_2026', D], ['ACC_HFREF_2024', S], ['KDIGO_DM_CKD_2022', S]],
    esc: { cor: 'I', loe: 'A', population: '有症狀心衰竭，不論射出分率', drug_scope: 'dapagliflozin、empagliflozin', verification: 'ESC 新聞稿與二手摘要確認為核心治療' } },
  { id: 'DIURETIC', label: '排水利尿劑', short: '排水的藥',
    examples: 'furosemide、bumetanide、hydrochlorothiazide、indapamide、metolazone',
    why: '把身體多餘的水排掉，讓您比較不喘、腳比較不腫。主要是改善症狀。',
    notice: '吃完尿會變多；如果頭暈、口很渴、抽筋，可能是水分或電解質不夠。',
    how: '通常安排在白天吃，晚上才不會一直起來上廁所。',
    monitor: '體重變化、腫的程度、尿量、血壓、腎功能與電解質。',
    problem: '要出門不方便時，和醫師討論時間怎麼調，不要自己整天不吃。',
    urgent: '頭暈到快昏倒、幾乎沒有尿：儘快就醫。',
    do_not: '只有醫療團隊有給您書面的個人調整方式時，才照那個調整；其他情況不要自己加倍或停掉。',
    bring: '體重紀錄。',
    evidence: [['AHA_HF_2022', D], ['ESC_HF_2026', S], ['ACC_HFREF_2024', S]] },
  { id: 'ANTICOAG', label: '抗凝血藥（俗稱血液稀釋劑）', short: '抗凝血藥',
    examples: 'apixaban、rivaroxaban、edoxaban、dabigatran、warfarin',
    why: '預防血塊、降低中風風險，常見於心房顫動；不是用來排水或治療心衰竭本身。',
    notice: '比較容易瘀青、刷牙會流血一點。',
    how: '固定時間吃。漏吃怎麼補每種藥不一樣，先問藥師，不要一次吃兩倍。吃 warfarin 要定期驗 INR，飲食盡量穩定。',
    monitor: '有沒有異常出血、腎功能；warfarin 要追蹤 INR。',
    problem: '小瘀青、刷牙少量流血，回診時告訴醫師就可以。',
    urgent: '吐血、咳血、解黑便或血便、出血止不住：現在去急診；突然嘴歪、一邊沒力、講話不清或劇烈頭痛：打 119。',
    do_not: '不要自己停藥（停了中風風險會上升）；看牙、開刀、打針前一定要說您在吃這個藥；止痛藥、中藥、保健品先問藥師。',
    bring: '看其他科時主動說您在吃抗凝血藥。',
    evidence: [['ESC_AF_2024', D], ['NHS_APIXABAN_SE', S], ['ACC_HFPEF_2026', S]] },
  { id: 'ANTIPLATELET', label: '抗血小板藥', short: '抗血小板藥',
    examples: 'aspirin、clopidogrel、ticagrelor、prasugrel',
    why: '預防冠狀動脈或支架裡形成血塊，常見於心肌梗塞、放過支架或中風之後。',
    notice: '容易瘀青、牙齦流血；吃 ticagrelor 的人有些會覺得喘。',
    how: '依醫囑吃；要吃多久由心臟科醫師決定。',
    monitor: '有沒有異常出血。',
    problem: '覺得喘的時候，還是先照第 1 步判斷是不是警訊，並告訴醫師您在吃 ticagrelor。',
    urgent: '吐血、解黑便或血便、出血止不住：現在去急診。',
    do_not: '放過支架的人不要自己停藥，可能造成支架阻塞；看牙或開刀前先告訴醫師。',
    bring: '支架放置時間與出院資料。',
    evidence: [['ESC_ACS_2023', D]] },
  { id: 'DIGOXIN', label: '毛地黃（digoxin）', short: '毛地黃',
    examples: 'digoxin',
    why: '讓心跳慢下來或改善部分心衰竭症狀。',
    notice: '平常通常沒有特別感覺。',
    how: '依醫囑固定劑量，不要自己加。',
    monitor: '腎功能、血鉀，有時候要抽血看藥物濃度。',
    problem: '新增其他藥（例如 amiodarone、某些抗生素）時，一定要說您在吃毛地黃。',
    urgent: '噁心想吐、吃不下、看東西變黃綠或模糊、心跳很慢或很亂、意識混亂：今天就醫；合併昏倒或快昏倒就打 119。',
    do_not: '不要自己加量。', bring: '最近腎功能與血鉀報告。',
    evidence: [['ACC_HFREF_2024', D], ['ESC_HF_2026', S]] },
  { id: 'OTHER_HF', heterogeneous: true, label: '其他心臟用藥（心跳、心絞痛、硝酸鹽類）', short: '其他心臟用藥',
    examples: 'ivabradine、vericiguat、isosorbide、nitroglycerin、hydralazine',
    why: '依照個人情況用來控制心跳、減輕心臟負擔或緩解胸悶。',
    notice: 'ivabradine 有人會看到短暫閃光；硝酸鹽類和 vericiguat 可能頭暈或頭痛。',
    how: '依醫囑使用。舌下含片要隨身帶，並知道怎麼用。',
    monitor: '心跳、血壓。',
    problem: '頭痛或頭暈時告訴醫師，有機會調整。',
    urgent: '胸痛時照醫師教的方式含舌下片，5 分鐘後沒改善或更嚴重：打 119，不要自己開車。',
    do_not: '在用硝酸鹽類或 vericiguat 時，不可以自己併用壯陽藥（sildenafil、tadalafil 這類）；vericiguat 也不能和 riociguat 併用。' + PREG,
    bring: '胸痛發作的紀錄（什麼時候、做什麼的時候）。',
    evidence: [['ACC_HFREF_2024', D], ['ESC_HF_2026', S], ['ESC_ACS_2023', S]] },
  { id: 'ANTIARRHYTHMIC', heterogeneous: true, label: '控制心律不整的藥', short: '心律不整的藥',
    examples: 'amiodarone、dronedarone、sotalol、flecainide、propafenone',
    why: '讓心跳維持比較規律。有些心律藥不適合心衰竭病人，由心臟科醫師選。',
    notice: 'amiodarone 會讓皮膚對太陽比較敏感。',
    how: '依醫囑吃，不要自己停。',
    monitor: 'amiodarone 要定期追蹤甲狀腺、肝功能、肺部和眼睛；也會看心電圖。',
    problem: '新出現咳嗽、喘或視力變化，告訴醫師。',
    urgent: '昏倒、心跳很快或很慢又胸悶頭暈：打 119。',
    do_not: '要加任何新藥（特別是 warfarin、毛地黃、某些降血脂藥）之前，先讓醫師或藥師確認。',
    bring: '甲狀腺與肝功能報告。',
    evidence: [['ESC_AF_2024', D], ['AHA_DRUGS_HF_2016', D]] },
  { id: 'GLP1', label: 'Semaglutide／tirzepatide（減重與血糖的針劑）', short: 'semaglutide／tirzepatide',
    examples: 'semaglutide、tirzepatide',
    why: '用來控制血糖或減重。如果心衰竭病人合併肥胖，醫師也可能用它來幫助減重、改善活動能力與生活品質。',
    notice: '噁心、想吐、拉肚子或便祕、比較沒胃口。',
    how: '依醫囑的劑量與頻率使用。同一類的其他針劑（liraglutide、dulaglutide）不在這項心衰竭建議範圍內，不能互相替代。',
    monitor: '體重、腸胃症狀、腎功能；年紀大或體力差的人要注意肌肉流失。',
    problem: '腸胃不舒服時告訴醫師，劑量調整由醫師決定。',
    urgent: '一直吐或拉到喝不下水：今天聯絡醫療團隊；上腹部劇痛延伸到背後：立刻就醫。',
    do_not: '不要自己加量，也不要買來路不明的產品。' + PREG,
    bring: '體重與飲食紀錄。',
    evidence: [['ESC_HF_2026', D], ['ACC_HFPEF_2026', S]],
    esc: { cor: 'IIa', loe: 'B1', population: '有症狀心衰竭', lvef_rule: '>=45', bmi_rule: '>=30', drug_scope: 'semaglutide、tirzepatide', verification: '保留型 EF＋肥胖 IIa 經二手摘要確認；精確門檻依使用者全文審核【未經查證】' } },
  { id: 'DIABETES_OTHER', heterogeneous: true, label: '其他降血糖藥', short: '降血糖藥',
    examples: 'insulin、gliclazide、glimepiride、metformin、pioglitazone、sitagliptin、liraglutide、dulaglutide',
    why: '控制血糖；其中有些針劑也用於體重管理。',
    notice: '胰島素或磺醯尿素類可能低血糖：發抖、冒冷汗、心悸、肚子餓、意識混亂。',
    how: '依醫囑使用；三餐不規律時，事先問好怎麼調整。',
    monitor: '血糖、腎功能。',
    problem: '有些降血糖藥（例如 pioglitazone）可能讓水腫或心衰竭變差，回診時確認是不是還適合。',
    urgent: '低血糖到意識不清：打 119。',
    do_not: '吃不下的時候怎麼減胰島素或磺醯尿素類，要事先問清楚，不要自己猜。',
    bring: '血糖紀錄。',
    evidence: [['AHA_HF_2022', D], ['AHA_DRUGS_HF_2016', D], ['KDIGO_DM_CKD_2022', S]] },
  { id: 'POTASSIUM', label: '和血鉀有關的藥', short: '血鉀相關的藥',
    examples: '氯化鉀補充劑、calcium polystyrene sulfonate、patiromer、sodium zirconium cyclosilicate',
    why: '依照抽血結果補鉀或降鉀。',
    notice: '有些降鉀藥會便祕；sodium zirconium cyclosilicate 含鈉，少數人水腫會增加。',
    how: '依醫囑服用；和其他藥的間隔時間依藥品說明。',
    monitor: '血鉀、腎功能。',
    problem: '便祕或腸胃不適，告訴醫師。',
    urgent: '肌肉很沒力、心跳亂又頭暈昏倒：立刻就醫。',
    do_not: '不要自己長期補鉀或自己停掉；要用低鈉鹽前先問醫師。',
    bring: '最近的血鉀報告。',
    evidence: [['ACC_HFREF_2024', D], ['CFS_HK_KCL_SALT', S]] },
  { id: 'OTC_SUPPLEMENT', heterogeneous: true, label: '自己買的藥、止痛藥、中藥、保健品', short: '自己買的藥與保健品',
    examples: '止痛藥、感冒藥、胃藥、中藥、保健食品',
    why: '這些不是心臟科開的，但可能影響心衰竭、腎功能、血壓、電解質或抗凝血藥。',
    notice: '—',
    how: '買之前先告訴藥師您有心衰竭，還有目前在吃哪些藥。',
    monitor: '把這些也寫進同一份用藥清單。',
    problem: '消炎止痛藥（例如 ibuprofen、naproxen、diclofenac、celecoxib）可能讓水腫、腎功能或心衰竭變差。',
    urgent: '—',
    do_not: '不要自己吃口服或全身性的消炎止痛藥；中藥和保健品先問藥師。醫師開的低劑量 aspirin 不要自己停。',
    bring: '把實際在用的品項拍照帶去。',
    evidence: [['AHA_DRUGS_HF_2016', D], ['AHA_HF_2022', D], ['HFA_POLY_2025', S]] }
];

/* ---------- 成分清單（病人只要認得名字就好） ----------
 * class：對應上面的類別｜hf_hazard：心衰竭要特別留意｜tags：規則比對用 */
C.ingredients = [
  { id: 'sacubitril_valsartan', name: 'sacubitril/valsartan', cls: 'RAAS_ARNI', tags: ['ARNI', 'RAAS'] },
  { id: 'enalapril', name: 'enalapril', cls: 'RAAS_ARNI', tags: ['ACEI', 'RAAS'] },
  { id: 'ramipril', name: 'ramipril', cls: 'RAAS_ARNI', tags: ['ACEI', 'RAAS'] },
  { id: 'lisinopril', name: 'lisinopril', cls: 'RAAS_ARNI', tags: ['ACEI', 'RAAS'] },
  { id: 'captopril', name: 'captopril', cls: 'RAAS_ARNI', tags: ['ACEI', 'RAAS'] },
  { id: 'perindopril', name: 'perindopril', cls: 'RAAS_ARNI', tags: ['ACEI', 'RAAS'] },
  { id: 'valsartan', name: 'valsartan', cls: 'RAAS_ARNI', tags: ['ARB', 'RAAS'] },
  { id: 'losartan', name: 'losartan', cls: 'RAAS_ARNI', tags: ['ARB', 'RAAS'] },
  { id: 'candesartan', name: 'candesartan', cls: 'RAAS_ARNI', tags: ['ARB', 'RAAS'] },
  { id: 'irbesartan', name: 'irbesartan', cls: 'RAAS_ARNI', tags: ['ARB', 'RAAS'] },
  { id: 'telmisartan', name: 'telmisartan', cls: 'RAAS_ARNI', tags: ['ARB', 'RAAS'] },
  { id: 'olmesartan', name: 'olmesartan', cls: 'RAAS_ARNI', tags: ['ARB', 'RAAS'] },
  { id: 'bisoprolol', name: 'bisoprolol', cls: 'BETA_BLOCKER', tags: ['BB'] },
  { id: 'carvedilol', name: 'carvedilol', cls: 'BETA_BLOCKER', tags: ['BB'] },
  { id: 'metoprolol_succinate_er', name: 'metoprolol succinate（長效）', cls: 'BETA_BLOCKER', tags: ['BB'], formulation: 'SUCCINATE_ER' },
  { id: 'metoprolol', name: 'metoprolol（不確定是長效或短效）', cls: 'BETA_BLOCKER', tags: ['BB'], formulation: 'UNKNOWN' },
  { id: 'nebivolol', name: 'nebivolol', cls: 'BETA_BLOCKER', tags: ['BB'] },
  { id: 'propranolol', name: 'propranolol', cls: 'BETA_BLOCKER', tags: ['BB'] },
  { id: 'atenolol', name: 'atenolol', cls: 'BETA_BLOCKER', tags: ['BB'] },
  { id: 'spironolactone', name: 'spironolactone', cls: 'MRA', tags: ['MRA', 'K_RAISING'] },
  { id: 'eplerenone', name: 'eplerenone', cls: 'MRA', tags: ['MRA', 'K_RAISING'] },
  { id: 'finerenone', name: 'finerenone', cls: 'MRA', tags: ['MRA', 'K_RAISING'] },
  { id: 'dapagliflozin', name: 'dapagliflozin', cls: 'SGLT2I', tags: ['SGLT2'] },
  { id: 'empagliflozin', name: 'empagliflozin', cls: 'SGLT2I', tags: ['SGLT2'] },
  { id: 'furosemide', name: 'furosemide', cls: 'DIURETIC', tags: ['LOOP'] },
  { id: 'bumetanide', name: 'bumetanide', cls: 'DIURETIC', tags: ['LOOP'] },
  { id: 'torsemide', name: 'torsemide', cls: 'DIURETIC', tags: ['LOOP'] },
  { id: 'hydrochlorothiazide', name: 'hydrochlorothiazide', cls: 'DIURETIC', tags: ['THIAZIDE'] },
  { id: 'indapamide', name: 'indapamide', cls: 'DIURETIC', tags: ['THIAZIDE'] },
  { id: 'metolazone', name: 'metolazone', cls: 'DIURETIC', tags: ['THIAZIDE'] },
  { id: 'apixaban', name: 'apixaban', cls: 'ANTICOAG', tags: ['DOAC', 'BLEED', 'BLEED_AC'] },
  { id: 'rivaroxaban', name: 'rivaroxaban', cls: 'ANTICOAG', tags: ['DOAC', 'BLEED', 'BLEED_AC'] },
  { id: 'edoxaban', name: 'edoxaban', cls: 'ANTICOAG', tags: ['DOAC', 'BLEED', 'BLEED_AC'] },
  { id: 'dabigatran', name: 'dabigatran', cls: 'ANTICOAG', tags: ['DOAC', 'BLEED', 'BLEED_AC'] },
  { id: 'warfarin', name: 'warfarin', zh: '可邁丁', cls: 'ANTICOAG', tags: ['VKA', 'BLEED', 'BLEED_AC', 'INTERACTION_SENSITIVE'] },
  { id: 'aspirin', name: 'aspirin', zh: '阿斯匹靈', cls: 'ANTIPLATELET', tags: ['ANTIPLATELET', 'BLEED'] },
  { id: 'clopidogrel', name: 'clopidogrel', cls: 'ANTIPLATELET', tags: ['ANTIPLATELET', 'BLEED'] },
  { id: 'ticagrelor', name: 'ticagrelor', cls: 'ANTIPLATELET', tags: ['ANTIPLATELET', 'BLEED'] },
  { id: 'prasugrel', name: 'prasugrel', cls: 'ANTIPLATELET', tags: ['ANTIPLATELET', 'BLEED'] },
  { id: 'digoxin', name: 'digoxin', zh: '毛地黃', cls: 'DIGOXIN', tags: ['DIGOXIN', 'INTERACTION_SENSITIVE'] },
  { id: 'ivabradine', name: 'ivabradine', cls: 'OTHER_HF', tags: ['HR_LOWERING'] },
  { id: 'vericiguat', name: 'vericiguat', cls: 'OTHER_HF', tags: ['SGC'] },
  { id: 'isosorbide', name: 'isosorbide（硝酸鹽類）', cls: 'OTHER_HF', tags: ['NITRATE'] },
  { id: 'nitroglycerin', name: 'nitroglycerin 舌下片', cls: 'OTHER_HF', tags: ['NITRATE'] },
  { id: 'hydralazine', name: 'hydralazine', cls: 'OTHER_HF', tags: ['VASODILATOR'] },
  { id: 'amiodarone', name: 'amiodarone', cls: 'ANTIARRHYTHMIC', tags: ['AMIODARONE', 'INTERACTION_SENSITIVE'] },
  { id: 'dronedarone', name: 'dronedarone', cls: 'ANTIARRHYTHMIC', tags: ['HF_HAZARD'], hf_hazard: 'DRONEDARONE' },
  { id: 'sotalol', name: 'sotalol', cls: 'ANTIARRHYTHMIC', tags: ['BB', 'HR_LOWERING', 'QT'] },
  { id: 'flecainide', name: 'flecainide', cls: 'ANTIARRHYTHMIC', tags: ['HF_HAZARD'], hf_hazard: 'CLASS1_AA' },
  { id: 'propafenone', name: 'propafenone', cls: 'ANTIARRHYTHMIC', tags: ['HF_HAZARD'], hf_hazard: 'CLASS1_AA' },
  { id: 'diltiazem', name: 'diltiazem', cls: 'OTHER_CARDIO', tags: ['NONDHP_CCB', 'HF_HAZARD', 'HR_LOWERING'], hf_hazard: 'NONDHP_CCB' },
  { id: 'verapamil', name: 'verapamil', cls: 'OTHER_CARDIO', tags: ['NONDHP_CCB', 'HF_HAZARD', 'HR_LOWERING'], hf_hazard: 'NONDHP_CCB' },
  { id: 'amlodipine', name: 'amlodipine', cls: 'OTHER_CARDIO', tags: ['DHP_CCB'] },
  { id: 'atorvastatin', name: 'atorvastatin', cls: 'OTHER_CARDIO', tags: ['STATIN'] },
  { id: 'rosuvastatin', name: 'rosuvastatin', cls: 'OTHER_CARDIO', tags: ['STATIN'] },
  { id: 'cilostazol', name: 'cilostazol', cls: 'OTHER_CARDIO', tags: ['HF_HAZARD'], hf_hazard: 'CILOSTAZOL' },
  /* 5.1 W51-RXB（CP-21）：AHA 2022 Table 13 列為可能誘發或加重心衰竭（doxazosin 中度 LOE B、nifedipine 中度 LOE C、disopyramide 重大 LOE B）；
     terazosin 為同類推論（表未列）。nifedipine 表內未區分劑型（速效或一般劑型都在此成分）。hazard 待雙審：公開版與病人端不顯示，只在院內版醫療端 */
  { id: 'doxazosin', name: 'doxazosin', cls: 'OTHER_CARDIO', tags: ['ALPHA1_BLOCKER', 'HF_HAZARD'], hf_hazard: 'ALPHA1_BLOCKER' },
  { id: 'terazosin', name: 'terazosin', cls: 'OTHER_CARDIO', tags: ['ALPHA1_BLOCKER', 'HF_HAZARD'], hf_hazard: 'ALPHA1_BLOCKER' },
  { id: 'nifedipine', name: 'nifedipine', cls: 'OTHER_CARDIO', tags: ['DHP_CCB', 'HF_HAZARD'], hf_hazard: 'NIFEDIPINE' },
  { id: 'disopyramide', name: 'disopyramide', cls: 'ANTIARRHYTHMIC', tags: ['HF_HAZARD'], hf_hazard: 'DISOPYRAMIDE' },
  { id: 'semaglutide', name: 'semaglutide', cls: 'GLP1', tags: ['GLP1_HF'] },
  { id: 'tirzepatide', name: 'tirzepatide', cls: 'GLP1', tags: ['GLP1_HF'] },
  { id: 'liraglutide', name: 'liraglutide', cls: 'DIABETES_OTHER', tags: ['GLP1_OTHER'] },
  { id: 'dulaglutide', name: 'dulaglutide', cls: 'DIABETES_OTHER', tags: ['GLP1_OTHER'] },
  { id: 'insulin', name: 'insulin', zh: '胰島素', cls: 'DIABETES_OTHER', tags: ['HYPO_RISK'] },
  { id: 'gliclazide', name: 'gliclazide', cls: 'DIABETES_OTHER', tags: ['HYPO_RISK'] },
  { id: 'glimepiride', name: 'glimepiride', cls: 'DIABETES_OTHER', tags: ['HYPO_RISK'] },
  { id: 'metformin', name: 'metformin', cls: 'DIABETES_OTHER', tags: ['DM_OTHER'] },
  { id: 'pioglitazone', name: 'pioglitazone', cls: 'DIABETES_OTHER', tags: ['HF_HAZARD'], hf_hazard: 'TZD' },
  { id: 'sitagliptin', name: 'sitagliptin', cls: 'DIABETES_OTHER', tags: ['DM_OTHER', 'DPP4'] },
  { id: 'saxagliptin', name: 'saxagliptin', cls: 'DIABETES_OTHER', tags: ['HF_HAZARD'], hf_hazard: 'DPP4_SAXA_ALO' },
  { id: 'alogliptin', name: 'alogliptin', cls: 'DIABETES_OTHER', tags: ['HF_HAZARD'], hf_hazard: 'DPP4_SAXA_ALO' },
  { id: 'potassium_chloride', name: 'potassium chloride', zh: '氯化鉀補充劑', cls: 'POTASSIUM', tags: ['K_SUPPLEMENT'] },
  { id: 'patiromer', name: 'patiromer', cls: 'POTASSIUM', tags: ['K_BINDER'] },
  { id: 'szc', name: 'sodium zirconium cyclosilicate', cls: 'POTASSIUM', tags: ['K_BINDER'] },
  { id: 'cps', name: 'calcium polystyrene sulfonate', cls: 'POTASSIUM', tags: ['K_BINDER'] },
  { id: 'ibuprofen', name: 'ibuprofen', cls: 'OTC_SUPPLEMENT', tags: ['NSAID', 'HF_HAZARD'], hf_hazard: 'NSAID' },
  { id: 'naproxen', name: 'naproxen', cls: 'OTC_SUPPLEMENT', tags: ['NSAID', 'HF_HAZARD'], hf_hazard: 'NSAID' },
  { id: 'diclofenac', name: 'diclofenac', cls: 'OTC_SUPPLEMENT', tags: ['NSAID', 'HF_HAZARD'], hf_hazard: 'NSAID' },
  { id: 'celecoxib', name: 'celecoxib', cls: 'OTC_SUPPLEMENT', tags: ['NSAID', 'HF_HAZARD'], hf_hazard: 'NSAID' },
  { id: 'mefenamic', name: 'mefenamic acid', cls: 'OTC_SUPPLEMENT', tags: ['NSAID', 'HF_HAZARD'], hf_hazard: 'NSAID' },
  { id: 'chinese_herb', name: 'Chinese herbal medicine', zh: '中藥（湯劑或科學中藥）', cls: 'OTC_SUPPLEMENT', tags: ['HERBAL'] },
  { id: 'supplement', name: 'supplements', zh: '保健食品或營養補充品', cls: 'OTC_SUPPLEMENT', tags: ['SUPPLEMENT'] }
];

/* ---------- 心衰竭要特別留意的藥（比對到成分才具體點名） ---------- */
C.hazard_registry = {
  NSAID: { label: '消炎止痛藥（NSAIDs／COX-2）', why: '可能讓水分滯留、腎功能變差、心衰竭惡化，也會增加住院風險。', action: '把正在用的止痛藥拿給醫師或藥師看，請他們換成比較適合的方式。', evidence: [['ESC_HF_2026', D], ['AHA_DRUGS_HF_2016', D]] },
  TZD: { label: 'pioglitazone（一種降血糖藥）', why: '心衰竭指引列為不建議使用，可能造成水腫、讓心衰竭變差。', action: '回診時確認是不是還適合繼續用。', evidence: [['ESC_HF_2026', D], ['AHA_HF_2022', D], ['AHA_DRUGS_HF_2016', D]] },   /* 4.9.3 WP-D（LIT-23）：ESC 2026 §10.2 p.66 TZD contraindicated in HF；AHA 2022 §7.3.7 3: Harm A */
  DPP4_SAXA_ALO: { label: 'saxagliptin、alogliptin', why: '在心衰竭病人可能增加住院風險。', action: '回診時請醫師評估要不要換成別的降血糖藥。', evidence: [['AHA_DRUGS_HF_2016', D], ['AHA_HF_2022', S]] },
  NONDHP_CCB: { label: 'diltiazem、verapamil', why: '在收縮功能差的心衰竭可能讓心臟更無力、心跳太慢。', action: '請醫師確認您的心臟功能是否適合繼續使用。', evidence: [['AHA_DRUGS_HF_2016', D], ['AHA_HF_2022', S], ['ESC_HF_2026', S]] },   /* 4.9.3 WP-D（LIT-23）：ESC 2026 p.60 not recommended、p.64 contraindicated in HFrEF */
  CILOSTAZOL: { label: 'cilostazol', why: '心衰竭病人一般不建議使用。', action: '請開這個藥的醫師和心臟科一起確認。', evidence: [['AHA_DRUGS_HF_2016', D]] },
  DRONEDARONE: { label: 'dronedarone', why: '射出分率降低型心衰竭一般應避免；最近因心衰竭惡化住院或症狀很嚴重的人，仿單規定不能使用。', action: '請心臟科確認心律用藥的選擇。', evidence: [['AHA_DRUGS_HF_2016', D], ['ESC_AF_2024', S], ['ESC_HF_2026', S]] },   /* 4.9.3 WP-D（LIT-22）：ESC 2026 §9 p.59 should be avoided in HFrEF；AHA 2022 §7.3.7 3: Harm A；Multaq 美國仿單禁忌（recent decompensation requiring hospitalization 或 NYHA IV）——仿單來源未登錄於 sources（新增來源需授權登錄，未施工） */
  CLASS1_AA: { label: 'flecainide、propafenone 這類心律藥', why: '在心臟結構有問題或心衰竭時一般不建議。', action: '請心臟科確認是否適合。', evidence: [['AHA_DRUGS_HF_2016', D], ['ESC_AF_2024', S]] },
  /* 5.1 W51-RXB（CP-21）：review: 'PENDING'＝文字待臨床雙審；engine.hazardCards 不產生病人卡（公開版沒有模擬病人閘門），院內版醫療端照常提示藥師。
     disopyramide 不併入 CLASS1_AA：該卡的標籤「flecainide、propafenone 這類心律藥」是 IC 類，disopyramide 是 IA 類，併入要改已登錄 claim 的適用範圍（列 claim 修訂申請） */
  ALPHA1_BLOCKER: { review: 'PENDING', label: 'doxazosin、terazosin（血壓或攝護腺用藥）', why: '用來降血壓時，可能讓心衰竭變差或站起來頭暈；用來改善攝護腺排尿、而且血壓不低的人，通常可以繼續用。', action: '請醫師或藥師確認您用這個藥的原因和血壓。', evidence: [['AHA_HF_2022', D], ['ESC_HF_2026', S]] },
  NIFEDIPINE: { review: 'PENDING', label: 'nifedipine（一種降血壓藥）', why: '在心衰竭可能讓心臟比較無力或水腫變多。', action: '請醫師或藥師確認這個藥是否適合您的心臟狀況。', evidence: [['AHA_HF_2022', D]] },
  DISOPYRAMIDE: { review: 'PENDING', label: 'disopyramide（一種心律藥）', why: '可能讓心臟比較無力、心衰竭變差。', action: '請心臟科醫師或藥師確認是否適合。', evidence: [['AHA_HF_2022', D]] }
};

/* ---------- 重複與交互作用檢查（只在勾了成分時才判斷） ----------
 * severity：URGENT_REVIEW 今天就請藥師或醫師看｜REVIEW 下次看診前確認
 * match：tags_all／tags_any／count_in_class／ingredients_all */

/* 找藥用的常見藥名（英文商品名與台灣常見中文商品名）：只用於搜尋與顯示，不用於任何判斷。
 * 商品名可能因廠牌不同而異；找不到時病人可以用「依藥的用途找」或選「上面找不到」。 */
var ING_ALIASES = {"sacubitril_valsartan": ["Entresto", "健安心"], "enalapril": ["Renitec"], "ramipril": ["Tritace"], "lisinopril": ["Zestril"], "captopril": ["Capoten"], "perindopril": ["Coversyl", "雅施達"], "valsartan": ["Diovan", "得安穩"], "losartan": ["Cozaar", "可悅您"], "candesartan": ["Blopress", "博脈舒"], "irbesartan": ["Aprovel", "安普諾維"], "telmisartan": ["Micardis"], "olmesartan": ["Olmetec", "雅脈"], "bisoprolol": ["Concor", "康肯"], "carvedilol": ["Dilatrend", "達利全"], "metoprolol_succinate_er": ["Betaloc ZOK", "舒壓寧控釋", "metoprolol succinate", "Toprol"], "metoprolol": ["Betaloc", "舒壓寧", "metoprolol tartrate", "Lopressor"], "nebivolol": ["Nebilet"], "propranolol": ["Inderal", "恩特來"], "atenolol": ["Tenormin", "天諾敏"], "spironolactone": ["Aldactone", "安達通"], "eplerenone": ["Inspra"], "finerenone": ["Kerendia"], "dapagliflozin": ["Forxiga", "福適佳"], "empagliflozin": ["Jardiance", "恩排糖"], "furosemide": ["Lasix", "來適泄"], "bumetanide": ["Burinex"], "hydrochlorothiazide": ["HCTZ"], "indapamide": ["Natrilix", "鈉催離"], "metolazone": ["Zaroxolyn"], "apixaban": ["Eliquis", "艾必克凝"], "rivaroxaban": ["Xarelto", "拜瑞妥"], "edoxaban": ["Lixiana", "里先安"], "dabigatran": ["Pradaxa", "普栓達"], "warfarin": ["Coumadin"], "aspirin": ["Bokey", "伯基"], "clopidogrel": ["Plavix", "保栓通"], "ticagrelor": ["Brilinta", "百無凝"], "prasugrel": ["Efient", "抑凝安"], "digoxin": ["Lanoxin"], "ivabradine": ["Coralan", "康立來"], "vericiguat": ["Verquvo"], "isosorbide": ["Imdur", "Isordil", "ISMN", "ISDN"], "nitroglycerin": ["Nitrostat", "NTG"], "hydralazine": ["Apresoline"], "amiodarone": ["Cordarone", "臟得樂"], "dronedarone": ["Multaq"], "sotalol": ["Betapace"], "flecainide": ["Tambocor"], "propafenone": ["Rytmonorm"], "diltiazem": ["Herbesser", "合必爽"], "verapamil": ["Isoptin"], "amlodipine": ["Norvasc", "脈優"], "atorvastatin": ["Lipitor", "立普妥"], "rosuvastatin": ["Crestor", "冠脂妥"], "cilostazol": ["Pletaal", "普達"], "doxazosin": ["Cardura"], "terazosin": ["Hytrin"], "nifedipine": ["Adalat"], "disopyramide": ["Rythmodan"], "semaglutide": ["Ozempic", "胰妥讚", "Wegovy"], "tirzepatide": ["Mounjaro", "猛健樂"], "liraglutide": ["Victoza", "胰妥善", "Saxenda"], "dulaglutide": ["Trulicity", "易週糖"], "gliclazide": ["Diamicron"], "glimepiride": ["Amaryl", "瑪爾胰"], "metformin": ["Glucophage", "庫魯化"], "pioglitazone": ["Actos", "愛妥糖"], "sitagliptin": ["Januvia", "佳糖維"], "saxagliptin": ["Onglyza", "昂格莎"], "alogliptin": ["Nesina", "耐釋糖"], "potassium_chloride": ["KCl", "鉀"], "patiromer": ["Veltassa"], "szc": ["Lokelma"], "cps": ["Kalimate"], "ibuprofen": ["Brufen"], "diclofenac": ["Voltaren", "非炎"], "celecoxib": ["Celebrex", "希樂葆"], "mefenamic": ["Ponstan"], "chinese_herb": ["中藥", "科學中藥"], "supplement": ["保健食品", "維他命", "魚油"]};
C.ingredients.forEach(function (i) { i.aliases = ING_ALIASES[i.id] || []; });
/* ================= 藥物證據契約（Medication Evidence Contract；ESC-P0-02～04） =================
 * 藥理類別（cls）≠ 心衰竭核心治療的證據角色（hf_roles）。治療核對表只用 hf_roles 判斷，不再用 cls。
 * hf_roles：HFrEF_RAAS／HFrEF_BB／HFrEF_MRA／HFpEF_MRA／HF_SGLT2I（SGLT2i 不分射出分率）
 * evidence_status：
 *   SUPPORTED            指引核心治療劑量表列出的成分（ESC 2026 Table 11，p.36；表號與標題已對全文，逐藥劑量逐列比對尚未做）
 *   CLASS_EXTRAPOLATED   同一藥理類別、但指引劑量表沒有列出（例如 perindopril、irbesartan）：核對表標示「請藥師確認」，不算已確認
 *   FORMULATION_UNKNOWN  metoprolol 劑型不明：心衰竭研究用的是長效 succinate；短效 tartrate 不算
 *   NOT_HF_FMT           同類但不是心衰竭核心治療的研究用藥（propranolol、atenolol）
 * finerenone：主要研究對象為射出分率 40% 以上（FINEARTS-HF）；降低型核對表不把它算成 spironolactone／eplerenone 的等價品 */
var ING_EVIDENCE = {
  sacubitril_valsartan: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'SUPPORTED', sub: 'ARNI' },
  enalapril: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'SUPPORTED', sub: 'ACEI' }, ramipril: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'SUPPORTED', sub: 'ACEI' },
  lisinopril: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'SUPPORTED', sub: 'ACEI' }, captopril: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'SUPPORTED', sub: 'ACEI' },
  perindopril: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'CLASS_EXTRAPOLATED', sub: 'ACEI' },
  valsartan: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'SUPPORTED', sub: 'ARB' }, losartan: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'SUPPORTED', sub: 'ARB' },
  candesartan: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'SUPPORTED', sub: 'ARB' },
  irbesartan: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'CLASS_EXTRAPOLATED', sub: 'ARB' }, telmisartan: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'CLASS_EXTRAPOLATED', sub: 'ARB' },
  olmesartan: { hf_roles: ['HFrEF_RAAS'], evidence_status: 'CLASS_EXTRAPOLATED', sub: 'ARB' },
  bisoprolol: { hf_roles: ['HFrEF_BB'], evidence_status: 'SUPPORTED' }, carvedilol: { hf_roles: ['HFrEF_BB'], evidence_status: 'SUPPORTED' },
  metoprolol_succinate_er: { hf_roles: ['HFrEF_BB'], evidence_status: 'SUPPORTED' }, metoprolol: { hf_roles: ['HFrEF_BB'], evidence_status: 'FORMULATION_UNKNOWN' },
  nebivolol: { hf_roles: ['HFrEF_BB'], evidence_status: 'SUPPORTED' },
  propranolol: { hf_roles: [], evidence_status: 'NOT_HF_FMT' }, atenolol: { hf_roles: [], evidence_status: 'NOT_HF_FMT' },
  spironolactone: { hf_roles: ['HFrEF_MRA', 'HFpEF_MRA'], evidence_status: 'SUPPORTED', mra_subclass: 'STEROIDAL' },
  eplerenone: { hf_roles: ['HFrEF_MRA'], evidence_status: 'SUPPORTED', mra_subclass: 'STEROIDAL' },
  finerenone: { hf_roles: ['HFpEF_MRA'], evidence_status: 'SUPPORTED', mra_subclass: 'NONSTEROIDAL', ef_scope_note: '主要研究對象為射出分率 40% 以上' },
  dapagliflozin: { hf_roles: ['HF_SGLT2I'], evidence_status: 'SUPPORTED' }, empagliflozin: { hf_roles: ['HF_SGLT2I'], evidence_status: 'SUPPORTED' }
};
C.ingredients.forEach(function (i) { var e = ING_EVIDENCE[i.id]; i.hf_roles = e ? e.hf_roles.slice() : []; i.evidence_status = e ? e.evidence_status : 'NOT_HF_FMT'; if (e && e.mra_subclass) i.mra_subclass = e.mra_subclass; if (e && e.ef_scope_note) i.ef_scope_note = e.ef_scope_note; if (e && e.sub) i.sub = e.sub; });
C.hf_role_labels = { HFrEF_RAAS: 'ARNI／ACEI／ARB', HFrEF_BB: 'Beta-blocker', HFrEF_MRA: 'MRA', HFpEF_MRA: 'MRA', HF_SGLT2I: 'SGLT2 inhibitor' };


C.combo_checks = [
  { id: 'DUP_ARNI_ACEI', severity: 'URGENT_REVIEW', match: { tags_all: ['ARNI', 'ACEI'] },
    title: '同時看到兩種作用重疊的心臟藥', body: '您勾選的藥裡，同時有 ARNI 和 ACEI 這兩類。它們一般不會一起吃，換藥時中間也需要間隔。請今天就把兩個藥袋一起拿給藥師或醫師核對，確認哪一個才是現在要吃的。',
    do_not: '在核對清楚之前，不要自己決定停哪一個。', evidence: [['ACC_HFREF_2024', D], ['HFA_POLY_2025', S]] },
  { id: 'DUP_RAAS', severity: 'URGENT_REVIEW', match: { count_tag: 'RAAS', count_min: 2 },
    title: '同一類的心臟藥可能重複了', body: '您勾選了兩種以上作用相似的藥（ACEI／ARB／ARNI 這一類）。有時候是換藥沒清乾淨的舊藥。請把所有藥袋拿給藥師核對。',
    do_not: '不要自己判斷留哪一個。', evidence: [['HFA_POLY_2025', D], ['ACC_HFREF_2024', S]] },
  { id: 'DUP_BB', severity: 'URGENT_REVIEW', match: { count_tag: 'BB', count_min: 2 },
    title: '兩種讓心跳變慢的藥可能重複', body: '您勾選了兩種乙型阻斷劑。這類藥通常只會用一種，請藥師或醫師幫您確認現在該吃哪一個。',
    do_not: '不要自己停掉其中一種。', evidence: [['HFA_POLY_2025', D]] },
  { id: 'DUP_MRA', severity: 'URGENT_REVIEW', match: { count_tag: 'MRA', count_min: 2 },
    title: '兩種保鉀型藥可能重複', body: '您勾選了兩種 MRA。一起使用會讓血鉀升高的風險增加，請今天就請藥師核對。',
    do_not: '不要自己停藥或加吃鉀。', evidence: [['ACC_HFREF_2024', D], ['HFA_POLY_2025', S]] },
  { id: 'DUP_ANTICOAG', severity: 'URGENT_REVIEW', match: { count_tag: 'BLEED_AC', count_min: 2 },
    title: '兩種抗凝血藥同時出現', body: '您勾選了兩種抗凝血藥。除非是換藥期間醫師特別交代，否則不會一起吃，出血風險會明顯增加。請今天聯絡醫師或藥師確認。',
    do_not: '不要自己停掉或兩種都繼續吃。', evidence: [['ESC_AF_2024', D], ['HFA_POLY_2025', S]] },
  { id: 'NSAID_ANTITHROMBOTIC', severity: 'URGENT_REVIEW', match: { tags_all: ['NSAID', 'BLEED'] },
    title: '止痛藥和抗凝血／抗血小板藥一起用，出血風險會增加', body: '消炎止痛藥本身可能讓心衰竭變差，和抗凝血或抗血小板藥一起用時，腸胃出血的風險也會上升。請儘快讓醫師或藥師換成比較安全的止痛方式。',
    do_not: '不要自己停掉抗凝血或抗血小板藥。', evidence: [['AHA_DRUGS_HF_2016', D], ['ESC_AF_2024', S]] },
  { id: 'MRA_K_SUPPLEMENT', severity: 'URGENT_REVIEW', match: { tags_all: ['MRA', 'K_SUPPLEMENT'] },
    title: '保鉀型藥再加鉀補充品，血鉀可能太高', body: '這兩個一起用，血鉀升高的風險會增加，而且血鉀高通常沒有感覺。請今天聯絡醫師或藥師，確認還需不需要補鉀，以及什麼時候要抽血。',
    do_not: '不要自己再加任何含鉀的補充品或低鈉鹽。', evidence: [['ACC_HFREF_2024', D], ['CFS_HK_KCL_SALT', S]] },
  { id: 'AMIO_WARFARIN', severity: 'URGENT_REVIEW', match: { ingredients_all: ['amiodarone', 'warfarin'] },
    title: 'amiodarone 會影響 warfarin 的效果', body: '兩個一起用時，warfarin 的抗凝血作用可能變強，出血風險增加，通常需要更密集驗 INR 或調整劑量。請確認您最近一次 INR 是什麼時候驗的。',
    do_not: '不要自己減 warfarin 的量。', evidence: [['ESC_AF_2024', D], ['AHA_DRUGS_HF_2016', S]] },
  { id: 'AMIO_DIGOXIN', severity: 'URGENT_REVIEW', match: { ingredients_all: ['amiodarone', 'digoxin'] },
    title: 'amiodarone 會讓毛地黃在體內升高', body: '兩個一起用時，毛地黃的濃度可能升高，容易出現噁心、看東西變色、心跳變慢。請確認醫師是否已經調整劑量或安排抽血。',
    do_not: '不要自己加毛地黃的量。', evidence: [['ACC_HFREF_2024', D], ['AHA_DRUGS_HF_2016', S]] },
  { id: 'NONDHP_BB', severity: 'REVIEW', match: { tags_all: ['NONDHP_CCB', 'BB'] },
    title: '兩種都會讓心跳變慢的藥', body: 'diltiazem 或 verapamil 和乙型阻斷劑一起用，心跳可能變太慢；在收縮功能差的心衰竭也不建議用這兩種。請回診時請醫師確認。',
    do_not: '不要自己停掉心衰竭的核心藥物。', evidence: [['AHA_DRUGS_HF_2016', D], ['ESC_AF_2024', S]] },
  { id: 'TRIPLE_ANTITHROMBOTIC', severity: 'REVIEW', match: { tags_all: ['BLEED_AC', 'ANTIPLATELET'] },
    title: '抗凝血藥加上抗血小板藥：確認還要吃多久', body: '這種組合通常只在特定期間（例如裝支架後）使用，之後醫師會重新評估。請確認兩個各自的用途和預計吃到什麼時候。',
    do_not: '不要自己停掉其中一種。', evidence: [['ESC_AF_2024', D], ['ESC_ACS_2023', S]] },
  { id: 'NITRATE_PDE5_WARN', severity: 'REVIEW', match: { tags_any: ['NITRATE', 'SGC'] },
    title: '這類藥不能和壯陽藥一起用', body: '您在用硝酸鹽類或 vericiguat。和壯陽藥（sildenafil、tadalafil 這類）一起用，血壓可能掉得很危險。如果有這方面需要，請先和醫師討論。',
    do_not: '不要自己買來併用。', evidence: [['ESC_ACS_2023', D], ['ACC_HFREF_2024', S]] }
];

if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis);

