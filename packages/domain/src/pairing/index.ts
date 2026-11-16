/**
 * 遠端裝置配對的領域層：短碼、裝置 Token 與配對請求的狀態機。
 *
 * 純函式加注入的時間與亂數；不讀資料庫、不碰網路、不碰檔案。儲存、控制
 * 通道與公開協定的連線都由呼叫端（主機服務）負責，規則在這裡收斂。
 */

export * from "./constant-time.js";
export * from "./device-token.js";
export * from "./ids.js";
export * from "./random.js";
export * from "./session.js";
export * from "./short-code.js";
