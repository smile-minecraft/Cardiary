import type { ToolBundleId } from "../ids.js";
import type { ToolGeneration } from "../tools.js";
import type { ToolBundleState } from "../tools.js";

/** 已註冊的工具組版本（轉接層內部使用的完整形狀）。 */
export interface RegisteredBundle {
  readonly bundleId: ToolBundleId;
  readonly generation: ToolGeneration;
  readonly label: string;
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
    readonly replay: "safe" | "unsafe";
    readonly execute: unknown;
  }[];
  /** 是否已退役；退役後呼叫回 `tool-unavailable`。 */
  retired: boolean;
}

/**
 * 工具組版本的行程內索引。
 *
 * 對話釘選 `{ bundleId, generation }`；同一個 `bundleId` 可以同時存在多個
 * generation，舊版保留給已釘選的進行中對話。停用模組呼叫 `retire`，
 * 重新啟用同一個版本恢復 `retired = false`。
 */
export class BundleIndex {
  readonly #bundles = new Map<string, RegisteredBundle>();
  readonly #pinnedByConversations = new Map<string, number>();

  static key(bundleId: ToolBundleId, generation: ToolGeneration): string {
    return `${bundleId}@${generation}`;
  }

  register(bundle: RegisteredBundle): void {
    const key = BundleIndex.key(bundle.bundleId, bundle.generation);
    const existing = this.#bundles.get(key);
    if (existing === undefined) {
      this.#bundles.set(key, { ...bundle, retired: false });
      return;
    }
    // 同一個版本重新註冊：恢復可用狀態並換成新定義。
    existing.retired = false;
    this.#bundles.set(key, { ...bundle, retired: false });
  }

  retire(bundleId: ToolBundleId, generation: ToolGeneration): void {
    const bundle = this.#bundles.get(BundleIndex.key(bundleId, generation));
    if (bundle !== undefined) {
      bundle.retired = true;
    }
  }

  /** 取消退役；重新啟用同一個版本時使用。 */
  revive(bundleId: ToolBundleId, generation: ToolGeneration): void {
    const bundle = this.#bundles.get(BundleIndex.key(bundleId, generation));
    if (bundle !== undefined) {
      bundle.retired = false;
    }
  }

  get(bundleId: ToolBundleId, generation: ToolGeneration): RegisteredBundle | undefined {
    return this.#bundles.get(BundleIndex.key(bundleId, generation));
  }

  /** 最新（generation 最大）且未退役的版本。 */
  latest(bundleId: ToolBundleId): RegisteredBundle | undefined {
    let found: RegisteredBundle | undefined;
    for (const bundle of this.#bundles.values()) {
      if (bundle.bundleId !== bundleId) {
        continue;
      }
      if (found === undefined || bundle.generation > found.generation) {
        found = bundle;
      }
    }
    return found;
  }

  pin(bundleId: ToolBundleId, generation: ToolGeneration): void {
    const key = BundleIndex.key(bundleId, generation);
    this.#pinnedByConversations.set(key, (this.#pinnedByConversations.get(key) ?? 0) + 1);
  }

  unpin(bundleId: ToolBundleId, generation: ToolGeneration): void {
    const key = BundleIndex.key(bundleId, generation);
    const current = this.#pinnedByConversations.get(key) ?? 0;
    if (current <= 1) {
      this.#pinnedByConversations.delete(key);
      return;
    }
    this.#pinnedByConversations.set(key, current - 1);
  }

  pinnedCount(bundleId: ToolBundleId, generation: ToolGeneration): number {
    return this.#pinnedByConversations.get(BundleIndex.key(bundleId, generation)) ?? 0;
  }

  /** 所有版本，依 `bundleId` 與 generation 排序。 */
  list(): readonly ToolBundleState[] {
    return [...this.#bundles.values()]
      .sort((left, right) =>
        left.bundleId === right.bundleId
          ? left.generation - right.generation
          : left.bundleId.localeCompare(right.bundleId),
      )
      .map((bundle) => ({
        bundleId: bundle.bundleId,
        generation: bundle.generation,
        pinnedByConversations: this.pinnedCount(bundle.bundleId, bundle.generation),
      }));
  }

  /**
   * 解析對話可使用的一個工具：先找釘選的版本，找不到才用最新版本。
   * 回傳 `null` 表示工具不存在或已退役，呼叫端要回 `tool-unavailable`。
   */
  resolve(name: string, pins: readonly { readonly bundleId: ToolBundleId; readonly generation: ToolGeneration }[]): RegisteredBundle | null {
    for (const pin of pins) {
      const bundle = this.get(pin.bundleId, pin.generation);
      if (bundle === undefined || bundle.retired) {
        continue;
      }
      if (bundle.tools.some((tool) => tool.name === name)) {
        return bundle;
      }
    }
    return null;
  }
}
