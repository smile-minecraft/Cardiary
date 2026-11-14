/** 協定限制的預設值；M0 照設計文件先用這組數字。 */
export interface GatewayLimits {
  readonly maxFrameBytes: number;
  readonly replayWindow: number;
  readonly heartbeatSeconds: number;
  readonly historyLimit: number;
  readonly snapshotHistoryLimit: number;
  readonly streamingBufferBytes: number;
  readonly maxBufferedBytes: number;
  readonly approvalTimeoutMs: number;
  /** 單一 frame 等待寫入完成的期限；慢客戶端超過就關閉連線。 */
  readonly sendTimeoutMs: number;
}

export const DEFAULT_LIMITS: GatewayLimits = {
  maxFrameBytes: 1024 * 1024,
  replayWindow: 512,
  heartbeatSeconds: 20,
  historyLimit: 50,
  snapshotHistoryLimit: 100,
  streamingBufferBytes: 256 * 1024,
  maxBufferedBytes: 1024 * 1024,
  approvalTimeoutMs: 300_000,
  sendTimeoutMs: 5000,
};
