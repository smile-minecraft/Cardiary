/**
 * MCP 工具的硬規則。
 *
 * 不管伺服器怎麼命名工具、工具描述怎麼寫，下列動作一律拒絕：刪除資料、
 * 對外送訊息、變更權限或白名單、讀寫金鑰圈與憑證。其餘工具一律詢問，
 * 沒有「自動允許」這條路徑——MCP 工具永遠不會回 `allow`。
 *
 * 判斷只看 Cardiary 收到的工具名稱，不看工具描述或輸入；提示詞注入因此
 * 不能改變判定。輸入的內容另外由審批畫面呈現給人看。
 */

/** 政策結果；`ask` 代表需要人工審批，沒有 `allow`。 */
export type McpToolPolicyDecision =
  | { readonly outcome: "deny"; readonly reason: string; readonly token: string }
  | { readonly outcome: "ask" };

/** 刪除類動詞；命中任何一個 token 就拒絕。 */
const DELETE_TOKENS: readonly string[] = [
  "delete",
  "remove",
  "destroy",
  "purge",
  "drop",
  "unlink",
  "truncate",
  "erase",
  "wipe",
];

/** 對外送訊息或發布的動詞。 */
const OUTBOUND_TOKENS: readonly string[] = [
  "send",
  "publish",
  "email",
  "notify",
  "webhook",
  "tweet",
  "dm",
];

/** 送訊息類的片語；`list_messages` 這類讀取工具不該被擋。 */
const OUTBOUND_PHRASES: readonly string[] = [
  "post_message",
  "create_message",
  "reply_message",
  "direct_message",
  "sendmessage",
];

/** 權限、白名單與提權。 */
const PERMISSION_TOKENS: readonly string[] = [
  "grant",
  "permission",
  "permissions",
  "authorize",
  "approve",
  "escalate",
  "sudo",
  "chmod",
  "chown",
  "admin",
];

/** 金鑰圈、憑證與密鑰。 */
const SECRET_TOKENS: readonly string[] = [
  "keychain",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "token",
  "tokens",
  "password",
  "passwd",
  "apikey",
  "api_key",
  "private_key",
];

/**
 * 計算工具名稱的政策。
 *
 * 名稱先轉小寫，再依 `.`、`_`、`-` 切成 token；中文或駝峰風格的工具名
 * 若拆不出禁止字，仍然只會得到 `ask`，由人決定。
 */
export function evaluateMcpToolPolicy(toolName: string): McpToolPolicyDecision {
  const tokens = tokenize(toolName);
  const joined = tokens.join("_");
  for (const [group, list] of [
    ["刪除資料", DELETE_TOKENS],
    ["對外送訊息", [...OUTBOUND_TOKENS, ...OUTBOUND_PHRASES]],
    ["變更權限", PERMISSION_TOKENS],
    ["存取密鑰", SECRET_TOKENS],
  ] as const) {
    const hit = list.find((token) => tokens.includes(token) || joined.includes(token));
    if (hit !== undefined) {
      return {
        outcome: "deny",
        token: hit,
        reason: `MCP 工具 ${toolName} 屬於永遠禁止的類別（${group}）；即使人工核准也不能執行。`,
      };
    }
  }
  return { outcome: "ask" };
}

function tokenize(toolName: string): string[] {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[.\s_\-/]+/)
    .filter((token) => token.length > 0);
}
