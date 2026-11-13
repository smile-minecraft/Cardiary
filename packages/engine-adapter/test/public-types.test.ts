import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 規格書第 3 章：領域核心與其他套件不依賴 Pi Durable。
 * 公開型別若引用 `@earendil-works/*` 的型別，換引擎時就不能只重寫轉接層。
 *
 * 這個測試從兩個套件的進入點沿著相對匯入走完整個型別圖，檢查每個檔案。
 * 之後轉接層的實作檔案若沒有從 `index.ts` 匯出，就不在檢查範圍內。
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageDirectories = ["packages/engine-adapter", "packages/module-api"] as const;

function entryPoint(packageDirectory: string): string {
  const declaration = join(repoRoot, packageDirectory, "dist/index.d.ts");
  if (existsSync(declaration)) {
    return declaration;
  }
  return join(repoRoot, packageDirectory, "src/index.ts");
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const base = resolve(dirname(fromFile), specifier);
  const candidates = specifier.endsWith(".js")
    ? [base.replace(/\.js$/, ".d.ts"), base.replace(/\.js$/, ".ts"), base]
    : [base, `${base}.d.ts`, `${base}.ts`, join(base, "index.d.ts"), join(base, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function collectTypeGraph(entry: string): string[] {
  const visited = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) {
      continue;
    }
    visited.add(file);
    const source = readFileSync(file, "utf8");
    const references = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
    for (const match of source.matchAll(references)) {
      const specifier = match[1];
      if (specifier === undefined) {
        continue;
      }
      const target = resolveRelative(file, specifier);
      if (target !== null) {
        pending.push(target);
      }
    }
  }
  return [...visited];
}

describe("公開型別不依賴引擎套件", () => {
  it.each(packageDirectories)("%s 的型別圖沒有 @earendil-works", (packageDirectory) => {
    const entry = entryPoint(packageDirectory);
    const files = collectTypeGraph(entry);

    // 型別圖至少要有進入點與幾個模組，避免因為解析失敗而空轉通過。
    expect(files.length).toBeGreaterThan(3);

    const offenders = files
      .filter((file) => readFileSync(file, "utf8").includes("@earendil-works"))
      .map((file) => relative(repoRoot, file));
    expect(offenders).toEqual([]);
  });
});
