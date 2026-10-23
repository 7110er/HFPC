/* =====================================================================
 * HFPC 網頁設定（公開值，不是秘密；任何人打開網頁都看得到）
 * 管理者上傳到 GitHub 後，直接在 GitHub 網頁上編輯這個檔案（步驟見 docs/V5_WEB_ENTRY.md）。
 *   API_URL                 Apps Script 統一部署的網址（結尾 /exec）；網頁直接連線時用
 *   GAS_URL                 Google 工作區網址（同一個 /exec；讀不到直接連線時，醫療人員與病人改到這裡）
 *   GOOGLE_OAUTH_CLIENT_ID  Google 登入用戶端 ID（結尾 .apps.googleusercontent.com）；空白時改用系統設定的值
 *   FORCE_MODE              'AUTO'（自動判斷，預設）或 'WORKSPACE'（固定使用 Google 工作區）
 * 不要在這裡放試算表 ID、金鑰或任何密碼。
 * ===================================================================== */
window.HFPC_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwEpv92I2cUeQ4fUF5uzsqNPUtNQuGkCx16-IFh7iaN1z30vQKM-TrDfyxT37alTwkY/exec',
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwEpv92I2cUeQ4fUF5uzsqNPUtNQuGkCx16-IFh7iaN1z30vQKM-TrDfyxT37alTwkY/exec',
  GOOGLE_OAUTH_CLIENT_ID: '',
  FORCE_MODE: 'AUTO'
};
