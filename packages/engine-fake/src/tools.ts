import type {
  ToolBundle,
  ToolBundleId,
  ToolBundleState,
  ToolDefinition,
  ToolGeneration,
  ToolName,
  ToolRegistry,
} from "@cardiary/engine-adapter";

interface BundleEntry {
  readonly bundle: ToolBundle;
  retired: boolean;
}

/**
 * 行程內的工具註冊表：同一個 `bundleId` 可以同時存在多個 generation；
 * 對話釘選版本，停用只標記不可用，重新註冊同版本就恢復。
 */
export class FakeToolRegistry implements ToolRegistry {
  readonly #bundles = new Map<ToolBundleId, Map<ToolGeneration, BundleEntry>>();
  readonly #pinnedCount: (bundleId: ToolBundleId, generation: ToolGeneration) => number;

  constructor(pinnedCount: (bundleId: ToolBundleId, generation: ToolGeneration) => number) {
    this.#pinnedCount = pinnedCount;
  }

  async register(bundle: ToolBundle): Promise<void> {
    const generations =
      this.#bundles.get(bundle.bundleId) ?? new Map<ToolGeneration, BundleEntry>();
    const existing = generations.get(bundle.generation);
    if (existing) {
      existing.retired = false;
    } else {
      generations.set(bundle.generation, { bundle, retired: false });
    }
    this.#bundles.set(bundle.bundleId, generations);
  }

  async retire(bundleId: ToolBundleId, generation: ToolGeneration): Promise<void> {
    const entry = this.#bundles.get(bundleId)?.get(generation);
    if (entry) entry.retired = true;
  }

  async list(): Promise<readonly ToolBundleState[]> {
    const states: ToolBundleState[] = [];
    for (const [bundleId, generations] of this.#bundles) {
      for (const generation of generations.keys()) {
        states.push({
          bundleId,
          generation,
          pinnedByConversations: this.#pinnedCount(bundleId, generation),
        });
      }
    }
    return states;
  }

  /** 解析釘選版本中的工具；停用或找不到回 `null`。 */
  resolve(
    pins: readonly { readonly bundleId: ToolBundleId; readonly generation: ToolGeneration }[],
    toolName: ToolName,
  ): ToolDefinition | null {
    for (const pin of pins) {
      const entry = this.#bundles.get(pin.bundleId)?.get(pin.generation);
      if (!entry || entry.retired) continue;
      const tool = entry.bundle.tools.find((candidate) => candidate.name === toolName);
      if (tool) return tool;
    }
    return null;
  }

  /** 目前最新一代的 generation；建立新對話時釘選用。 */
  latestGeneration(bundleId: ToolBundleId): ToolGeneration | null {
    const generations = this.#bundles.get(bundleId);
    if (!generations) return null;
    let latest: ToolGeneration | null = null;
    for (const generation of generations.keys()) {
      if (latest === null || generation > latest) latest = generation;
    }
    return latest;
  }
}
