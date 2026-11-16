import {
  applyEmotionTurn,
  decayEmotion,
  type EmotionDelta,
  type EmotionState,
} from "@cardiary/domain";
import { EmotionStore } from "@cardiary/storage";

export interface EmotionTurn {
  readonly userText: string;
  readonly previousAssistantText: string;
}

export type EmotionRule = (turn: EmotionTurn) => EmotionDelta;

export const defaultEmotionRule: EmotionRule = ({ userText, previousAssistantText }) => {
  const positive = /謝謝|感謝|喜歡|太好了|thanks|thank you|great/iu.test(userText);
  const negative = /生氣|失望|糟糕|討厭|angry|frustrat|terrible/iu.test(userText);
  const previousFailed = /無法|失敗|抱歉|could not|failed|sorry/iu.test(previousAssistantText);
  return {
    valence: positive === negative ? 0 : positive ? 0.05 : -0.05,
    arousal: negative ? 0.05 : 0,
    confidence: previousFailed ? -0.05 : 0.02,
    focus: 0.02,
  };
};

export class EmotionService {
  constructor(
    private readonly store: EmotionStore,
    private readonly now: () => Date,
    private readonly rule: EmotionRule = defaultEmotionRule,
  ) {}

  get(): EmotionState {
    const now = this.now();
    return decayEmotion(this.store.read(now), now);
  }

  applyTurn(turn: EmotionTurn): EmotionState {
    const now = this.now();
    const state = applyEmotionTurn(this.store.read(now), this.rule(turn), now);
    this.store.write(state);
    return state;
  }
}
