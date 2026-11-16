import type { PermissionAction } from "@cardiary/domain";

/** 本機檔案與終端機模組的工具名稱；權限判斷與工具定義共用同一組常數。 */
export const LOCAL_TOOL_NAMES = {
  readFile: "read_file",
  writeFile: "write_file",
  listDirectory: "list_directory",
  runCommand: "run_command",
} as const;

export type LocalToolName = (typeof LOCAL_TOOL_NAMES)[keyof typeof LOCAL_TOOL_NAMES];

/**
 * 把工具呼叫轉成一個 `PermissionAction`。
 *
 * 一個工具只做一件事：讀檔、寫檔、列目錄、執行指令各自一個動作，
 * 判定才能逐項測試。輸入不合法時回 `null`，由呼叫端一律詢問。
 */
export function localToolAction(toolName: string, input: unknown): PermissionAction | null {
  const fields = asObject(input);
  switch (toolName) {
    case LOCAL_TOOL_NAMES.readFile: {
      const path = stringField(fields, "path");
      return path === null ? null : { kind: "fs.read", path };
    }
    case LOCAL_TOOL_NAMES.writeFile: {
      const path = stringField(fields, "path");
      const content = stringField(fields, "content");
      if (path === null || content === null) {
        return null;
      }
      const mode = fields?.mode;
      const writeMode = mode === "create" || mode === "append" ? mode : "replace";
      return { kind: "fs.write", path, mode: writeMode };
    }
    case LOCAL_TOOL_NAMES.listDirectory: {
      const path = stringField(fields, "path") ?? ".";
      return { kind: "fs.list", path };
    }
    case LOCAL_TOOL_NAMES.runCommand: {
      const command = stringField(fields, "command");
      if (command === null) {
        return null;
      }
      const cwd = stringField(fields, "cwd") ?? ".";
      return { kind: "shell.exec", command, cwd };
    }
    case "create_card_on_board":
      return { kind: "cards.create", cardKind: "note" };
    case "project_card_to_board":
      // 沿用未知工具的審批路徑，不提供「一律允許」。
      return null;
    default:
      return null;
  }
}

/** 白名單的 `action_kind`：`shell.exec` 不細分成唯讀版本控制查詢。 */
export function actionKindFor(action: PermissionAction): string {
  if (action.kind === "network.outbound") {
    return "network";
  }
  return action.kind;
}

function asObject(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function stringField(fields: Record<string, unknown> | null, key: string): string | null {
  const value = fields?.[key];
  return typeof value === "string" ? value : null;
}
