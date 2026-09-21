/* ============================================================
 * 相册配置：以后只改这里，不用动 our.js / index.html。
 *
 *   workerUrl      : Cloudflare Worker 地址（部署后拿到，形如
 *                    https://xxx.你的子域.workers.dev）
 *   uploadPassword : 和 Worker 里的 UPLOAD_PASSWORD 保持一致；
 *                    留空 "" 表示 Worker 未设口令、不校验。
 * ============================================================ */
window.ALBUM_CONFIG = {
  workerUrl: "https://proud-flower-5f26.hleisure161.workers.dev",
  uploadPassword: ""
};
