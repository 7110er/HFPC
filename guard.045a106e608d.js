/* =====================================================================
 * HFPC 網頁（5.0 W5-W，K06-01／K06-04）：防嵌入檢查——每一頁最先執行（head 第一支外部腳本）
 * - 外殼（index.html）：不允許被任何頁面嵌入（window.top 必須是自己）。
 * - 子頁（staff／patient／public）：只允許被同一來源的外殼嵌入；被其他網站嵌入 → 停止載入並清空畫面。
 * 限制（5.1 K06-04）：meta CSP 不能設定 frame-ancestors，GitHub Pages 也不能加 HTTP 標頭；
 * 這段 JavaScript 只能擋一般的嵌入，不等於完整的點擊劫持防護（殘餘風險，見 docs/V5_WEB_ENTRY.md）。
 * ===================================================================== */
(function () {
  'use strict';
  var shell = document.documentElement.getAttribute('data-page') === 'shell', ok = true;
  try {
    if (window.top !== window.self) {
      if (shell) ok = false;
      else ok = window.top.location.origin === window.location.origin;   /* 跨來源時讀取 origin 會丟出例外 */
    }
  } catch (e) { ok = false; }
  window.HFPC_FRAME_OK = ok;
  if (ok) return;
  try { window.stop(); } catch (e) { /* 舊瀏覽器沒有 stop：下面仍會清空畫面 */ }
  document.documentElement.innerHTML = '<head><meta charset="utf-8"><title>無法顯示</title></head><body><p>這個頁面不能放在其他網站裡面開啟。請直接在瀏覽器網址列開啟醫療團隊提供的網址。</p></body>';
})();
