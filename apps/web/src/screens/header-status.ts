/**
 * 頁首的連線狀態。
 *
 * 「還沒配對」和「已配對但斷線」是不同狀態：前者不該顯示重新連線，
 * 因為在使用者完成配對之前，重連不會有結果。
 */

import { translate, type Language } from "../i18n";
import type { ConnectionStatus } from "../state/remote-app";

export type HeaderConnectionState = "unpaired" | "connecting" | "connected" | "reconnecting";

export interface HeaderStatus {
  readonly state: HeaderConnectionState;
  readonly label: string;
  readonly dotClass: string;
}

export interface HeaderStatusInput {
  readonly needsPairing: boolean;
  readonly connectionStatus: ConnectionStatus;
}

export function headerStatus(input: HeaderStatusInput, language: Language): HeaderStatus {
  if (input.needsPairing) {
    // 尚未配對不是錯誤，用中性灰點；紅色留給已配對卻斷線的情況。
    return {
      state: "unpaired",
      label: translate(language, "connection.notPaired"),
      dotClass: "status-dot",
    };
  }
  switch (input.connectionStatus) {
    case "connected":
      return {
        state: "connected",
        label: translate(language, "connection.connected"),
        dotClass: "status-dot is-connected",
      };
    case "connecting":
      return {
        state: "connecting",
        label: translate(language, "connection.connecting"),
        dotClass: "status-dot is-connecting",
      };
    case "disconnected":
      return {
        state: "reconnecting",
        label: translate(language, "connection.disconnected"),
        dotClass: "status-dot is-disconnected",
      };
  }
}
