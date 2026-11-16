export interface EmotionState {
  readonly valence: number;
  readonly arousal: number;
  readonly confidence: number;
  readonly focus: number;
  readonly updatedAt: string;
}

export type EmotionDelta = Partial<Omit<EmotionState, "updatedAt">>;

export function baselineEmotion(now: Date): EmotionState {
  return { valence: 0, arousal: 0.5, confidence: 0.5, focus: 0.5, updatedAt: now.toISOString() };
}

/** 半衰期：6 小時指數衰減到基準。 */
export const EMOTION_HALF_LIFE_MS = 6 * 60 * 60 * 1000;
/** 單回合單維度的最大變動幅度。 */
export const EMOTION_MAX_TURN_DELTA = 0.15;
/** 注入層的 token 預算，以 `estimateTokens` 的 1 token ≈ 2.5 字元估算。 */
export const EMOTION_TRAILING_TOKEN_LIMIT = 120;

const HALF_LIFE_MS = EMOTION_HALF_LIFE_MS;

export function decayEmotion(state: EmotionState, now: Date): EmotionState {
  const remaining =
    0.5 ** (Math.max(0, now.getTime() - Date.parse(state.updatedAt)) / HALF_LIFE_MS);
  return {
    valence: state.valence * remaining,
    arousal: 0.5 + (state.arousal - 0.5) * remaining,
    confidence: 0.5 + (state.confidence - 0.5) * remaining,
    focus: 0.5 + (state.focus - 0.5) * remaining,
    updatedAt: now.toISOString(),
  };
}

/**
 * 注入層用的一行自然語言加數值。
 *
 * 這一行只會進最尾端一層，不參與檢索、不影響發牌。為了穩定注入行為，
 * 內容採固定格式，數值固定兩位小數。
 */
export function formatEmotionLine(state: EmotionState): string {
  return [
    "情緒狀態：",
    `平穩程度 ${state.valence.toFixed(2)}（-1 到 1）`,
    `激發程度 ${state.arousal.toFixed(2)}（0 到 1）`,
    `信心 ${state.confidence.toFixed(2)}（0 到 1）`,
    `專注 ${state.focus.toFixed(2)}（0 到 1）`,
  ].join("、");
}

export function applyEmotionTurn(
  state: EmotionState,
  delta: EmotionDelta,
  now: Date,
): EmotionState {
  const decayed = decayEmotion(state, now);
  const change = (value: number, amount: number | undefined, min: number): number =>
    Math.min(
      1,
      Math.max(
        min,
        value + Math.max(-EMOTION_MAX_TURN_DELTA, Math.min(EMOTION_MAX_TURN_DELTA, amount ?? 0)),
      ),
    );
  return {
    valence: change(decayed.valence, delta.valence, -1),
    arousal: change(decayed.arousal, delta.arousal, 0),
    confidence: change(decayed.confidence, delta.confidence, 0),
    focus: change(decayed.focus, delta.focus, 0),
    updatedAt: now.toISOString(),
  };
}
