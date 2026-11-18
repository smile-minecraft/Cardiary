/**
 * 檢索契約測試的接縫；正式產品不會用到。
 *
 * 只有 `CARDIARY_TEST_FAULTS=1` 且 `CARDIARY_TEST_EMBEDDER=fake` 時生效，和主機
 * 其餘故障注入旗標同一道閘（正式入口在 `CARDIARY_TEST_FAULTS` 不是 1 時拒絕故障旗標）。
 * 目的是讓黑箱契約測試在真的主機行程上建出向量索引，不必下載約 600 MB 的嵌入模型。
 *
 * 假嵌入器是決定性的：相同文字永遠得到相同向量，維度固定 16。它只產生向量，
 * 不寫任何檔案；向量照常存在 `cache/index.sqlite` 的 `vec_cards`，由快取區的
 * 正常規則管理（刪掉整個 `cache/` 後重建）。
 */

import type { CardEmbedder } from "./vectors.js";

const DIMENSION = 16;

/** 測試環境要求假嵌入器時回傳它；其餘情況回 `undefined`，模組改用本機嵌入模型。 */
export function testEmbedder(): CardEmbedder | undefined {
  if (process.env.CARDIARY_TEST_FAULTS !== "1") return undefined;
  if (process.env.CARDIARY_TEST_EMBEDDER !== "fake") return undefined;
  return {
    embed: (text) => Promise.resolve(fakeVector(text)),
    stop: () => {},
  };
}

/** FNV-1a 雜湊當種子，線性同餘產生 [-1, 1) 的分量。 */
export function fakeVector(text: string): Float32Array {
  const vector = new Float32Array(DIMENSION);
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let state = hash >>> 0;
  for (let index = 0; index < DIMENSION; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    vector[index] = (state / 4294967296) * 2 - 1;
  }
  return vector;
}
