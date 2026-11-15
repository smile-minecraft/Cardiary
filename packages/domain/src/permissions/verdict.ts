import type { PermissionVerdict } from "./types.js";

export type Risk = "low" | "medium" | "high";

const RISK_RANK: Readonly<Record<Risk, number>> = { low: 0, medium: 1, high: 2 };

/** 取兩個風險等級中較高的一個。 */
export function maxRisk(left: Risk, right: Risk): Risk {
  return RISK_RANK[left] >= RISK_RANK[right] ? left : right;
}

export function allow(rule: string): PermissionVerdict {
  return { kind: "allow", rule };
}

export function deny(rule: string, reason: string): PermissionVerdict {
  return { kind: "deny", rule, reason };
}

export function askHuman(rule: string, risk: Risk): PermissionVerdict {
  return { kind: "ask-human", rule, risk };
}
