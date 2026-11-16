/**
 * 亂數來源的共用約定。
 *
 * 領域層不依賴 Node 型別，只假設有 Web Crypto 的最小形狀；呼叫端也可以注入
 * 自己的 `RandomBytes`（測試注入固定來源重現結果）。和卡片 ULID 不同，這裡
 * 產生的是憑證材料，來源壞掉就必須失敗，不能退回 `Math.random`。
 */

/** 注入的亂數來源：回傳指定位元組數的亂數。 */
export type RandomBytes = (length: number) => Uint8Array;

/** Web Crypto；沒有的時候直接拋錯，不退成弱亂數。 */
export const webCryptoRandomBytes: RandomBytes = (length) => {
  const cryptoSource = globalThis.crypto;
  if (typeof cryptoSource?.getRandomValues !== "function") {
    throw new Error("此環境沒有 Web Crypto；呼叫端必須注入 randomBytes");
  }
  return cryptoSource.getRandomValues(new Uint8Array(length));
};
