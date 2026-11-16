/**
 * 常數時間字串比較。
 *
 * HTTPS 的時間側通道不在假設模型內（遠端本來就只走加密通道），這裡要擋的是
 * 同一個行程裡的早退比較：類似 `a.startsWith(b)` 的寫法會洩漏「前幾個字元
 * 對不對」。字串長度不同時回傳 `false`，但仍掃完整個較長的一邊；時間只跟
 * 兩邊長度有關，跟第一個不一致的位置無關。
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const limit = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let index = 0; index < limit; index += 1) {
    const left = index < a.length ? a.charCodeAt(index) : 0;
    const right = index < b.length ? b.charCodeAt(index) : 0;
    diff |= left ^ right;
  }
  return diff === 0;
}
