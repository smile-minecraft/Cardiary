// 從已提交的 JSON Schema 產生 TypeScript 與 Swift 型別。
/* global URL, console */
//
// 執行：pnpm --filter @cardiary/protocol generate
//
// TypeScript 由 json-schema-to-typescript 產生；Swift 由這個檔案裡的迷你產生器
// 產生。Swift 產生器只支援 schema 實際用到的 JSON Schema 子集，遇到不認識的
// 結構會直接失敗，避免默默產生錯誤的型別。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const schemaPath = fileURLToPath(new URL("../schema/protocol.schema.json", import.meta.url));
const tsOutputPath = fileURLToPath(new URL("../src/generated/protocol.ts", import.meta.url));
const swiftOutputPath = fileURLToPath(
  new URL(
    "../../../apple/CardiaryKit/Sources/CardiaryKit/Generated/ProtocolTypes.swift",
    import.meta.url,
  ),
);

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const defs = schema.$defs;

if (!defs || typeof defs !== "object") {
  throw new Error("schema 缺少 $defs");
}

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

const tsBanner = `/* eslint-disable */
/**
 * 這個檔案由 packages/protocol/schema/protocol.schema.json 產生，不要手改。
 * 重新產生：pnpm --filter @cardiary/protocol generate
 */`;

const tsSource = await compileFromFile(schemaPath, {
  bannerComment: tsBanner,
  declareExternallyReferenced: true,
  enableConstEnums: false,
  format: true,
  style: {
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: false,
    trailingComma: "all",
    bracketSpacing: true,
  },
  unknownAny: true,
});

mkdirSync(dirname(tsOutputPath), { recursive: true });
writeFileSync(tsOutputPath, `${tsSource.trimEnd()}\n`, "utf8");

// ---------------------------------------------------------------------------
// Swift
// ---------------------------------------------------------------------------

const SWIFT_KEYWORDS = new Set([
  "associatedtype",
  "class",
  "deinit",
  "enum",
  "extension",
  "fileprivate",
  "func",
  "import",
  "init",
  "inout",
  "internal",
  "let",
  "open",
  "operator",
  "private",
  "protocol",
  "public",
  "rethrows",
  "static",
  "struct",
  "subscript",
  "typealias",
  "var",
  "break",
  "case",
  "continue",
  "default",
  "defer",
  "do",
  "else",
  "fallthrough",
  "for",
  "guard",
  "if",
  "in",
  "repeat",
  "return",
  "switch",
  "where",
  "while",
  "as",
  "Any",
  "catch",
  "false",
  "is",
  "nil",
  "super",
  "self",
  "Self",
  "throw",
  "throws",
  "true",
  "try",
]);

// 這兩個型別由手寫的 JSONValue.swift 提供，產生器只負責引用。
const HAND_WRITTEN_TYPES = new Set(["JSONValue", "JSONObject"]);

// 根聯集只用於 JSON Schema 驗證；Swift 端直接使用 ClientFrame 與 ServerFrame。
const SWIFT_SKIP = new Set(["CardiaryProtocol"]);

function escapeSwiftIdentifier(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`不是合法的 Swift 識別字：${name}`);
  }
  return SWIFT_KEYWORDS.has(name) ? `\`${name}\`` : name;
}

function assertSwiftTypeName(name) {
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`不是合法的 Swift 型別名稱：${name}`);
  }
}

function refName(ref) {
  const prefix = "#/$defs/";
  if (!ref.startsWith(prefix)) {
    throw new Error(`只支援 $defs 內的 $ref：${ref}`);
  }
  return ref.slice(prefix.length);
}

function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function snakeToCamel(value) {
  return value
    .split(/[_-]/)
    .filter((part) => part.length > 0)
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

function swiftType(node, context) {
  if (!node || typeof node !== "object") {
    throw new Error(`無法解析 ${context} 的 schema`);
  }

  if (node.$ref) {
    const name = refName(node.$ref);
    if (name === "JSONValue") {
      return "JSONValue";
    }
    if (name === "JSONObject") {
      return "JSONObject";
    }
    return name;
  }

  if (node.const !== undefined) {
    if (typeof node.const === "string") {
      return "String";
    }
    if (typeof node.const === "number") {
      return "Int";
    }
    if (typeof node.const === "boolean") {
      return "Bool";
    }
    throw new Error(`${context} 的 const 型別不支援：${typeof node.const}`);
  }

  if (node.enum) {
    throw new Error(`${context} 使用了 inline enum；請改成 $ref`);
  }

  switch (node.type) {
    case "string":
      return "String";
    case "integer":
      return "Int";
    case "number":
      return "Double";
    case "boolean":
      return "Bool";
    case "array":
      return `[${swiftType(node.items, `${context}[]`)}]`;
    case "object":
      if (node.additionalProperties && typeof node.additionalProperties === "object") {
        return "JSONObject";
      }
      throw new Error(`${context} 使用了 inline object；請改成 $ref`);
    default:
      throw new Error(`${context} 的 schema 結構不支援：${JSON.stringify(node)}`);
  }
}

function swiftDefault(node) {
  if (node.const === undefined) {
    return null;
  }
  if (typeof node.const === "string") {
    return JSON.stringify(node.const);
  }
  if (typeof node.const === "number" || typeof node.const === "boolean") {
    return String(node.const);
  }
  throw new Error(`不支援的 const 預設值：${String(node.const)}`);
}

function isOptional(schemaNode, propertyName) {
  return !(schemaNode.required ?? []).includes(propertyName);
}

function emitStruct(name, node) {
  assertSwiftTypeName(name);
  const properties = Object.entries(node.properties ?? {});
  const lines = [];

  lines.push(`public struct ${name}: Codable, Equatable, Sendable {`);
  for (const [propertyName, propertySchema] of properties) {
    const type = swiftType(propertySchema, `${name}.${propertyName}`);
    const optional = isOptional(node, propertyName);
    lines.push(
      `    public let ${escapeSwiftIdentifier(propertyName)}: ${type}${optional ? "?" : ""}`,
    );
  }

  lines.push("");

  if (properties.length === 0) {
    lines.push("    public init() {}");
    lines.push("}");
    return lines.join("\n");
  }

  lines.push("    public init(");
  lines.push(
    properties
      .map(([propertyName, propertySchema]) => {
        const type = swiftType(propertySchema, `${name}.${propertyName}`);
        const optional = isOptional(node, propertyName);
        const constantDefault = swiftDefault(propertySchema);
        const defaultValue = optional
          ? " = nil"
          : constantDefault === null
            ? ""
            : ` = ${constantDefault}`;
        return `        ${escapeSwiftIdentifier(propertyName)}: ${type}${
          optional ? "?" : ""
        }${defaultValue}`;
      })
      .join(",\n"),
  );
  lines.push("    ) {");
  for (const [propertyName] of properties) {
    const identifier = escapeSwiftIdentifier(propertyName);
    lines.push(`        self.${identifier} = ${identifier}`);
  }
  lines.push("    }");

  lines.push("");
  lines.push("    private enum CodingKeys: String, CodingKey {");
  for (const [propertyName] of properties) {
    lines.push(
      `        case ${escapeSwiftIdentifier(propertyName)} = ${JSON.stringify(propertyName)}`,
    );
  }
  lines.push("    }");

  lines.push("");
  lines.push("    public init(from decoder: Decoder) throws {");
  lines.push("        let container = try decoder.container(keyedBy: CodingKeys.self)");
  for (const [propertyName, propertySchema] of properties) {
    const identifier = escapeSwiftIdentifier(propertyName);
    const type = swiftType(propertySchema, `${name}.${propertyName}`);
    const optional = isOptional(node, propertyName);
    if (optional) {
      lines.push(
        `        let ${identifier} = try container.decodeIfPresent(${type}.self, forKey: .${identifier})`,
      );
    } else {
      lines.push(
        `        let ${identifier} = try container.decode(${type}.self, forKey: .${identifier})`,
      );
    }
    if (propertySchema.const !== undefined) {
      const expected = JSON.stringify(propertySchema.const);
      lines.push(`        guard ${identifier} == ${expected} else {`);
      lines.push(
        `            throw DecodingError.dataCorruptedError(forKey: .${identifier}, in: container, debugDescription: ${JSON.stringify(
          `${name}.${propertyName} 必須是 ${String(propertySchema.const)}`,
        )})`,
      );
      lines.push("        }");
    }
  }
  lines.push("        self.init(");
  lines.push(
    properties
      .map(([propertyName]) => {
        const identifier = escapeSwiftIdentifier(propertyName);
        return `            ${propertyName}: ${identifier}`;
      })
      .join(",\n"),
  );
  lines.push("        )");
  lines.push("    }");

  lines.push("");
  lines.push("    public func encode(to encoder: Encoder) throws {");
  lines.push("        var container = encoder.container(keyedBy: CodingKeys.self)");
  for (const [propertyName] of properties) {
    const identifier = escapeSwiftIdentifier(propertyName);
    const optional = isOptional(node, propertyName);
    lines.push(
      `        try container.${optional ? "encodeIfPresent" : "encode"}(${identifier}, forKey: .${identifier})`,
    );
  }
  lines.push("    }");

  lines.push("}");
  return lines.join("\n");
}

function emitStringEnum(name, node) {
  assertSwiftTypeName(name);
  const values = node.enum;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${name} 的 enum 是空的`);
  }

  const seen = new Set();
  const lines = [];
  lines.push(`public enum ${name}: String, Codable, Equatable, Sendable, CaseIterable {`);
  for (const value of values) {
    if (typeof value !== "string") {
      throw new Error(`${name} 的 enum 只支援字串：${String(value)}`);
    }
    let caseName = snakeToCamel(value);
    if (!/^[a-z][A-Za-z0-9_]*$/.test(caseName)) {
      throw new Error(`${name} 的 enum 值無法轉成 Swift 識別字：${value}`);
    }
    if (seen.has(caseName)) {
      let suffix = 2;
      while (seen.has(`${caseName}${suffix}`)) {
        suffix += 1;
      }
      caseName = `${caseName}${suffix}`;
    }
    seen.add(caseName);
    lines.push(`    case ${escapeSwiftIdentifier(caseName)} = ${JSON.stringify(value)}`);
  }
  lines.push("}");
  return lines.join("\n");
}

function patternPrefix(pattern) {
  if (typeof pattern !== "string") {
    return null;
  }
  const match = pattern.match(/^\^([A-Za-z0-9._-]+?)\\\./);
  return match ? `${match[1]}.` : null;
}

function buildUnion(name, node) {
  const branches = node.oneOf.map((branchRef) => {
    if (!branchRef.$ref) {
      throw new Error(`${name} 的 oneOf 只支援 $ref`);
    }
    const branchName = refName(branchRef.$ref);
    const branch = defs[branchName];
    if (!branch || branch.type !== "object") {
      throw new Error(`${name} 的聯集分支必須是物件：${branchName}`);
    }
    return {
      branchName,
      branch,
      catchAll: branch["x-catch-all"] === true,
    };
  });

  const constValues = new Map();
  for (const { branch } of branches) {
    for (const [propertyName, propertySchema] of Object.entries(branch.properties ?? {})) {
      if (propertySchema.const !== undefined) {
        if (!constValues.has(propertyName)) {
          constValues.set(propertyName, new Set());
        }
        constValues.get(propertyName).add(String(propertySchema.const));
      }
    }
  }

  const discriminator = [];
  for (const [propertyName, values] of constValues) {
    const presentInEveryBranch = branches.every(
      ({ branch }) => branch.properties?.[propertyName]?.const !== undefined,
    );
    if (!presentInEveryBranch || values.size > 1) {
      discriminator.push(propertyName);
    }
  }
  discriminator.sort();

  if (discriminator.length === 0) {
    throw new Error(`${name} 找不到可以用來區分的 const 欄位`);
  }

  const exact = [];
  const catchAll = [];
  const exactKeys = new Set();

  for (const branchInfo of branches) {
    const key = discriminator.map(
      (propertyName) => branchInfo.branch.properties?.[propertyName]?.const,
    );
    if (branchInfo.catchAll) {
      // 只有 const 的欄位用來比對；非 const 的 type 會用 prefix 另外檢查。
      const constKey = discriminator.map(
        (propertyName) => branchInfo.branch.properties?.[propertyName]?.const,
      );
      catchAll.push({ ...branchInfo, key, constKey });
    } else {
      const keyString = JSON.stringify(key);
      if (exactKeys.has(keyString)) {
        throw new Error(`${name} 有重複的聯集鍵：${keyString}`);
      }
      exactKeys.add(keyString);
      exact.push({ ...branchInfo, key });
    }
  }

  return { branches, discriminator, exact, catchAll };
}

function swiftStringPattern(value) {
  return value === undefined ? ".none" : `.some(${JSON.stringify(value)})`;
}

function emitUnion(name, node) {
  assertSwiftTypeName(name);
  const info = buildUnion(name, node);
  const lines = [];

  lines.push(`public enum ${name}: Codable, Equatable, Sendable {`);
  for (const branch of info.branches) {
    lines.push(`    case ${lowerFirst(branch.branchName)}(${branch.branchName})`);
  }

  lines.push("");
  lines.push("    private enum DiscriminatorKeys: String, CodingKey {");
  for (const propertyName of info.discriminator) {
    lines.push(`        case ${escapeSwiftIdentifier(propertyName)}`);
  }
  lines.push("    }");

  lines.push("");
  lines.push("    public init(from decoder: Decoder) throws {");
  lines.push("        let container = try decoder.container(keyedBy: DiscriminatorKeys.self)");
  for (const propertyName of info.discriminator) {
    const identifier = escapeSwiftIdentifier(propertyName);
    lines.push(
      `        let ${identifier} = try container.decodeIfPresent(String.self, forKey: .${identifier})`,
    );
  }

  const switchSubject =
    info.discriminator.length === 1
      ? escapeSwiftIdentifier(info.discriminator[0])
      : `(${info.discriminator
          .map((propertyName) => escapeSwiftIdentifier(propertyName))
          .join(", ")})`;

  lines.push(`        switch ${switchSubject} {`);

  for (const branch of info.exact) {
    const pattern =
      info.discriminator.length === 1
        ? swiftStringPattern(branch.key[0])
        : `(${branch.key.map(swiftStringPattern).join(", ")})`;
    lines.push(`        case ${pattern}:`);
    lines.push(
      `            self = .${lowerFirst(branch.branchName)}(try ${branch.branchName}(from: decoder))`,
    );
  }

  for (const branch of info.catchAll) {
    const patternParts = [];
    const conditions = [];
    for (let index = 0; index < info.discriminator.length; index += 1) {
      const propertyName = info.discriminator[index];
      const value = branch.key[index];
      if (value !== undefined) {
        patternParts.push(`.some(${JSON.stringify(value)})`);
        continue;
      }
      const binding = `value${index}`;
      patternParts.push(`.some(let ${binding})`);
      const prefix = patternPrefix(branch.branch.properties?.[propertyName]?.pattern);
      if (prefix) {
        conditions.push(`${binding}.hasPrefix(${JSON.stringify(prefix)})`);
      }
    }
    const pattern =
      info.discriminator.length === 1 ? patternParts[0] : `(${patternParts.join(", ")})`;
    lines.push(
      `        case ${pattern}${conditions.length > 0 ? ` where ${conditions.join(" && ")}` : ""}:`,
    );
    lines.push(
      `            self = .${lowerFirst(branch.branchName)}(try ${branch.branchName}(from: decoder))`,
    );
  }

  lines.push("        default:");
  const debugParts = info.discriminator.map(
    (propertyName) => `${propertyName}=\\(${escapeSwiftIdentifier(propertyName)} ?? "nil")`,
  );
  lines.push(
    `            throw DecodingError.dataCorruptedError(forKey: .${escapeSwiftIdentifier(
      info.discriminator[0],
    )}, in: container, debugDescription: "不支援的 ${name} 判別組合：${debugParts.join(", ")}")`,
  );
  lines.push("        }");
  lines.push("    }");

  lines.push("");
  lines.push("    public func encode(to encoder: Encoder) throws {");
  lines.push("        switch self {");
  for (const branch of info.branches) {
    const caseName = lowerFirst(branch.branchName);
    lines.push(`        case .${caseName}(let value):`);
    lines.push("            try value.encode(to: encoder)");
  }
  lines.push("        }");
  lines.push("    }");

  lines.push("}");
  return lines.join("\n");
}

function emitDefinition(name, node) {
  if (HAND_WRITTEN_TYPES.has(name) || SWIFT_SKIP.has(name)) {
    return null;
  }
  if (node.oneOf) {
    return emitUnion(name, node);
  }
  if (node.enum) {
    return emitStringEnum(name, node);
  }
  if (node.type === "object") {
    return emitStruct(name, node);
  }
  throw new Error(`不支援的 schema 定義 ${name}：${JSON.stringify(node)}`);
}

if (!defs.JSONValue || !defs.JSONObject) {
  throw new Error("schema 必須定義 JSONValue 與 JSONObject");
}

const emitted = [];
for (const name of Object.keys(defs).sort()) {
  const source = emitDefinition(name, defs[name]);
  if (source) {
    emitted.push(`// MARK: - ${name}\n\n${source}`);
  }
}

const swiftHeader = `// 這個檔案由 packages/protocol/schema/protocol.schema.json 產生，不要手改。
// 重新產生：pnpm --filter @cardiary/protocol generate
//
// JSONValue 與 JSONObject 由同一個 target 的 JSONValue.swift 提供。

import Foundation
`;

const swiftSource = `${swiftHeader}
${emitted.join("\n\n")}
`;

mkdirSync(dirname(swiftOutputPath), { recursive: true });
writeFileSync(swiftOutputPath, swiftSource, "utf8");

console.log(`已產生 ${tsOutputPath}`);
console.log(`已產生 ${swiftOutputPath}`);
