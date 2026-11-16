/**
 * 可委派網域清單的規則解析與比對。
 *
 * 這份清單只有人可以改；工具與模型都不能新增條目。規則格式：
 *
 * - `example.com`：精確比對這個 host（含 `www.` 不行，要寫完整）。
 * - `*.example.com`：`example.com` 的所有子網域，不含本身。
 * - `example.com/docs`：host 之外，再限制路徑前綴（邊界在 `/`）。
 *
 * 刻意不支援：IP 位址（含純數字與十六進位寫法）、埠號、IPv6 字面值、
 * 萬用字元放在中間、兩層以下的萬用網域（`*.com` 會被拒絕）、私有網段與
 * 本機名稱。對外委派只給公開的網域，範圍寧可窄不可寬。
 *
 * 重新導向要逐腳比對：任何一腳不在這份清單內，呼叫端就不得再跟隨。
 */

/** 清單裡的一條規則。 */
export interface DomainRule {
  /** 小寫的 host，或是 `*.example.com` 這種只放在最前面的萬用字元。 */
  readonly host: string;
  /** 路徑前綴；`example.com/docs` 限制在 `/docs` 及其下。 */
  readonly pathPrefix?: string;
}

/** 規則寫錯時丟出；人設定清單的入口要顯示訊息，不要靜靜忽略。 */
export class DomainRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainRuleError";
  }
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** 是不是 IP 位址的字面寫法，包括 `2130706433`（十進位 IPv4）這種容易偽裝的形狀。 */
export function isIpLiteralHost(host: string): boolean {
  const bare = stripBrackets(host).toLowerCase();
  if (bare.includes(":")) {
    // 直接是 IPv6，或是 `host:port` 被當成 IPv6 處理。
    return true;
  }
  if (/^\d+$/.test(bare) || /^0x[0-9a-f]+$/.test(bare)) {
    // 純十進位或十六進位數字：瀏覽器會當成 IPv4。
    return true;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare)) {
    // 四段十進位；不另外檢查 0–255，寫錯也當 IP 拒絕。
    return true;
  }
  return false;
}

/** 是不是私有或本機網段；這些永遠不能加入委派清單。 */
export function isPrivateHost(host: string): boolean {
  const bare = stripBrackets(host).toLowerCase().replace(/\.$/, "");
  if (
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    bare.endsWith(".local") ||
    bare.endsWith(".internal") ||
    bare.endsWith(".home") ||
    bare.endsWith(".home.arpa") ||
    bare.endsWith(".corp") ||
    bare.endsWith(".lan") ||
    bare.endsWith(".intranet")
  ) {
    return true;
  }
  if (bare === "0.0.0.0" || bare === "::" || bare === "::1") {
    return true;
  }
  // ULA（fc00::/7）與連結本機（fe80::/10）。
  if (/^f[cd][0-9a-f]{0,2}(?::|$)/.test(bare) || /^fe[89ab][0-9a-f]?(?::|$)/.test(bare)) {
    return true;
  }
  const v4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4 === null) {
    return false;
  }
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    // 電信業者 NAT 的共用空間，不是公開網路。
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  return false;
}

/**
 * 解析一條規則；寫錯一律丟 `DomainRuleError`。
 *
 * 呼叫端（人設定清單的入口）要把訊息原樣顯示給設定的人，不要靜靜忽略。
 */
export function parseDomainRule(input: string): DomainRule {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new DomainRuleError("網域規則不能是空的");
  }
  if (/\s/.test(trimmed)) {
    throw new DomainRuleError("網域規則不能包含空白");
  }
  if (
    trimmed.includes("://") ||
    trimmed.includes("@") ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    throw new DomainRuleError("只要寫 host 和路徑，不要加協定、帳號、查詢字串或片段");
  }
  const slash = trimmed.indexOf("/");
  const rawHost = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const rawPath = slash === -1 ? undefined : trimmed.slice(slash);
  const host = rawHost.toLowerCase();
  if (host.length === 0) {
    throw new DomainRuleError("網域規則缺少 host");
  }
  if (host.includes(":")) {
    throw new DomainRuleError("不支援埠號或 IPv6 位址");
  }
  if (isIpLiteralHost(host)) {
    throw new DomainRuleError("不支援 IP 位址，請寫網域名稱");
  }
  if (isPrivateHost(host)) {
    throw new DomainRuleError("私有網段與本機名稱不能加入委派清單");
  }
  const wildcard = host.startsWith("*.");
  const base = wildcard ? host.slice(2) : host;
  if (base.includes("*")) {
    throw new DomainRuleError("萬用字元只能放在最前面（例如 *.example.com）");
  }
  if (!validHostname(base)) {
    throw new DomainRuleError("網域名稱格式不正確");
  }
  if (wildcard && !base.includes(".")) {
    throw new DomainRuleError("萬用網域至少要涵蓋兩層（例如 *.example.com）");
  }
  if (rawPath === undefined) {
    return { host };
  }
  return { host, pathPrefix: normalizePrefix(rawPath) };
}

/** 把規則寫回字串；儲存與顯示都用這個形狀。 */
export function formatDomainRule(rule: DomainRule): string {
  return rule.pathPrefix === undefined ? rule.host : `${rule.host}${rule.pathPrefix}`;
}

/** 把儲存的字串解析成規則；遇到壞掉的規則丟出去，呼叫端視同設定損毀。 */
export function parseDomainRules(inputs: readonly string[]): DomainRule[] {
  return inputs.map((input) => parseDomainRule(input));
}

/** 這個 URL 能不能委派；逐腳比對由呼叫端負責，每一腳都要呼叫一次。 */
export function domainRuleMatches(rule: DomainRule, url: URL): boolean {
  if (url.username !== "" || url.password !== "") {
    // 帶帳號的 URL 可能是 `user@host` 偽裝；不比對。
    return false;
  }
  if (url.port !== "") {
    // 沒有預設埠以外的埠就無法判定是否預期之內；保守拒絕。
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0 || isIpLiteralHost(host)) {
    return false;
  }
  const matched = rule.host.startsWith("*.")
    ? host.endsWith(rule.host.slice(1)) && host !== rule.host.slice(2)
    : host === rule.host;
  if (!matched) {
    return false;
  }
  const prefix = rule.pathPrefix;
  if (prefix === undefined) {
    return true;
  }
  const path = url.pathname === "" ? "/" : url.pathname;
  if (prefix === "/") {
    return true;
  }
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** 清單中是否有一條規則涵蓋這個 URL。 */
export function matchesAllowedDomain(rules: readonly DomainRule[], url: URL): boolean {
  return rules.some((rule) => domainRuleMatches(rule, url));
}

/**
 * 重新導向鏈是否每一腳都在清單內。
 *
 * HTTP 客戶端在跟隨每一次重新導向之前都要呼叫它；任何一腳不命中就要
 * 停止，不可以只檢查第一腳。
 */
export function redirectChainStaysAllowed(
  rules: readonly DomainRule[],
  hops: readonly URL[],
): boolean {
  return hops.length > 0 && hops.every((hop) => matchesAllowedDomain(rules, hop));
}

function stripBrackets(host: string): string {
  const trimmed = host.trim();
  return trimmed.length >= 2 && trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
}

function validHostname(host: string): boolean {
  if (host.length > 253) {
    return false;
  }
  return host.split(".").every((label) => LABEL.test(label));
}

function normalizePrefix(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new DomainRuleError("路徑前綴的編碼不正確");
  }
  if (!decoded.startsWith("/")) {
    throw new DomainRuleError("路徑前綴要以 / 開頭");
  }
  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("//")) {
    throw new DomainRuleError("路徑前綴不能包含 ..、反斜線或連續的 /");
  }
  // 去掉尾端的 /；"/" 本身保留。
  const trimmed = decoded.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}
