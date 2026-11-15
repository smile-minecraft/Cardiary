/**
 * 憑證樣式（`docs/design/permissions.md` 第 3.2 節）。
 *
 * 比對正規化後路徑的每個 segment，大小寫不敏感。`*.key` 會擋掉一些正常
 * 檔案（例如鍵盤配置）；設計文件選擇寧可誤擋，因為「金鑰檔」與「一般
 * 檔案」在路徑上分不出來。
 */

/** 只比對單一 segment 的樣式。 */
const SEGMENT_PATTERNS: readonly {
  readonly label: string;
  readonly test: (segment: string) => boolean;
}[] = [
  { label: ".env", test: (s) => s === ".env" },
  { label: ".env.*", test: (s) => s.startsWith(".env.") },
  { label: "*.env", test: (s) => s.endsWith(".env") },
  { label: "*.pem", test: (s) => s.endsWith(".pem") },
  { label: "*.key", test: (s) => s.endsWith(".key") },
  { label: "*.p12", test: (s) => s.endsWith(".p12") },
  { label: "*.pfx", test: (s) => s.endsWith(".pfx") },
  { label: "*.jks", test: (s) => s.endsWith(".jks") },
  { label: "*.keystore", test: (s) => s.endsWith(".keystore") },
  { label: "id_rsa*", test: (s) => s.startsWith("id_rsa") },
  { label: "id_ed25519*", test: (s) => s.startsWith("id_ed25519") },
  { label: "id_ecdsa*", test: (s) => s.startsWith("id_ecdsa") },
  { label: "id_dsa*", test: (s) => s.startsWith("id_dsa") },
  { label: ".netrc", test: (s) => s === ".netrc" },
  { label: ".npmrc", test: (s) => s === ".npmrc" },
  { label: ".pypirc", test: (s) => s === ".pypirc" },
  { label: "Cookies", test: (s) => s === "cookies" },
  { label: "Login Data*", test: (s) => s.startsWith("login data") },
  { label: "Local State", test: (s) => s === "local state" },
  { label: "keychain*", test: (s) => s.startsWith("keychain") },
  { label: "*.keychain-db", test: (s) => s.endsWith(".keychain-db") },
  { label: "credentials", test: (s) => s === "credentials" },
  { label: "secrets.json", test: (s) => s === "secrets.json" },
  { label: "secrets.yaml", test: (s) => s === "secrets.yaml" },
  { label: "secrets.yml", test: (s) => s === "secrets.yml" },
];

/** 只比對整個目錄路徑的樣式；`~/.ssh/**`、`~/.aws/**` 這類。 */
const DIRECTORY_SEGMENTS = [".ssh", ".aws", ".gnupg"] as const;

/**
 * 回傳命中的樣式名稱；沒有命中回 `null`。
 *
 * 輸入必須是正規化後的路徑或單一參數；比對用 `/` 切開的 segment。
 */
export function matchCredentialPath(input: string): string | null {
  const segments = input
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
  if (segments.length === 0) {
    return null;
  }
  for (const segment of segments) {
    if ((DIRECTORY_SEGMENTS as readonly string[]).includes(segment)) {
      return `${segment}/**`;
    }
    for (const pattern of SEGMENT_PATTERNS) {
      if (pattern.test(segment)) {
        return pattern.label;
      }
    }
  }
  // `.config/gh/hosts.yml`：三個連續的 segment。
  for (let index = 0; index + 2 < segments.length; index += 1) {
    if (
      segments[index] === ".config" &&
      segments[index + 1] === "gh" &&
      segments[index + 2] === "hosts.yml"
    ) {
      return ".config/gh/hosts.yml";
    }
  }
  return null;
}

/**
 * 指令參數的憑證比對。
 *
 * 參數可能帶選項前綴（`--file=.env`）或結尾的標點；先去掉 `=` 之前的前綴
 * 再逐段比對。回傳命中的樣式名稱。
 */
export function matchCredentialArgument(argument: string): string | null {
  if (argument.length === 0) {
    return null;
  }
  const withoutOption = argument.includes("=") ? (argument.split("=").pop() ?? argument) : argument;
  const normalized = withoutOption.replace(/^[-+]+/, "");
  if (normalized.length === 0) {
    return null;
  }
  return matchCredentialPath(normalized);
}
