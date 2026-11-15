import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  Card,
  CardPage,
  CardQuery,
  CardSearchHit,
  CardService,
  CardSummary,
} from "@cardiary/domain";
import { createInMemoryApprovalLedger } from "@cardiary/engine-adapter";
import type { ModelInvocationRequest, ModelInvoker } from "@cardiary/module-api";
import { FakeEngine } from "@cardiary/engine-fake";
import { openStateDatabase, type Database } from "@cardiary/storage";

/** 測試用的卡片服務：卡片放在記憶體，載入紀錄留得下來。 */
export class MemoryCards implements CardService {
  readonly #cards = new Map<string, Card>();
  readonly loads: { conversationId: string; cardId: string }[] = [];
  #counter = 0;

  get count(): number {
    return this.#cards.size;
  }

  add(input: {
    readonly kind: Card["frontmatter"]["kind"];
    readonly title: string;
    readonly body: string;
    readonly sources?: readonly string[];
  }): Card {
    this.#counter += 1;
    const cardId = `card_${this.#counter.toString().padStart(4, "0")}`;
    const card: Card = {
      cardId,
      frontmatter: {
        id: cardId,
        kind: input.kind,
        title: input.title,
        created: "2026-01-01T00:00:00.000Z",
        sources: input.sources ?? [],
        tags: [],
        persona: "default",
        extra: {},
      },
      body: input.body,
      revision: `revision_${this.#counter}`,
    };
    this.#cards.set(cardId, card);
    return card;
  }

  async get(cardId: string): Promise<Card | null> {
    return this.#cards.get(cardId) ?? null;
  }

  /** 模擬使用者編輯卡片內文；用來驗血緣標記被改掉的情況。 */
  rewrite(cardId: string, body: string): void {
    const card = this.#cards.get(cardId);
    if (card === undefined) throw new Error(`找不到卡片 ${cardId}`);
    this.#cards.set(cardId, { ...card, body, revision: `${card.revision}-edited` });
  }

  async list(query: CardQuery): Promise<CardPage<CardSummary>> {
    const items = [...this.#cards.values()]
      .filter((card) => query.kinds === undefined || query.kinds.includes(card.frontmatter.kind))
      .map((card) => this.summaryOf(card));
    return { items };
  }

  async search(query: CardQuery): Promise<CardPage<CardSearchHit>> {
    const page = await this.list(query);
    return {
      items: page.items.map((card) => ({ card, score: 1, snippet: card.title })),
    };
  }

  async create(input: {
    readonly kind: Card["frontmatter"]["kind"];
    readonly title: string;
    readonly body: string;
    readonly sources?: readonly string[];
  }): Promise<Card> {
    return this.add(input);
  }

  async patch(): Promise<Card> {
    throw new Error("測試不支援補丁");
  }

  async delete(): Promise<{ readonly deletedAssets: number }> {
    return { deletedAssets: 0 };
  }

  async noteConversationLoad(input: {
    readonly conversationId: string;
    readonly cardId: string;
  }): Promise<void> {
    this.loads.push(input);
  }

  summaryOf(card: Card): CardSummary {
    return {
      cardId: card.cardId,
      kind: card.frontmatter.kind,
      title: card.frontmatter.title,
      tags: [],
      persona: card.frontmatter.persona,
      createdAt: card.frontmatter.created,
      lifecycle: "live",
    };
  }
}

/** 測試用的模型：記下請求，回固定的摘要。 */
export class StubModels implements ModelInvoker {
  readonly requests: ModelInvocationRequest[] = [];
  fail = false;
  text = "摘要：前面在處理卡片與測試。";

  async invoke(request: ModelInvocationRequest): Promise<{ readonly text: string }> {
    this.requests.push(request);
    if (this.fail) throw new Error("模型暫時不可用");
    return { text: this.text };
  }
}

export interface ContextFixture {
  readonly root: string;
  readonly db: Database;
  readonly engine: FakeEngine;
  readonly cards: MemoryCards;
  close(): void;
}

/** 開一個真的狀態庫與假引擎；不啟主機、不載模組。 */
export async function createContextFixture(): Promise<ContextFixture> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-context-"));
  await mkdir(join(root, "state"), { recursive: true });
  await mkdir(join(root, "tmp"), { recursive: true });
  const handle = openStateDatabase({
    filePath: join(root, "state", "cardiary.sqlite"),
    appVersion: "0.1.0",
    backupDirectory: join(root, "tmp"),
  });
  const engine = new FakeEngine({
    environment: {
      stateDir: join(root, "state"),
      tempDir: join(root, "tmp"),
      defaultWorkingDir: root,
    },
    approvals: createInMemoryApprovalLedger(),
    permissionGate: {
      async evaluate() {
        return { kind: "allow" };
      },
    },
    credentials: {
      async resolve() {
        return { provider: "fake", kind: "none", secret: "" };
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  await engine.open();
  return {
    root,
    db: handle.db,
    engine,
    cards: new MemoryCards(),
    close(): void {
      handle.db.close();
    },
  };
}

/** 建一場對話。 */
export async function createConversation(
  engine: FakeEngine,
  systemContext = "固定前綴",
): Promise<string> {
  const conversation = await engine.createConversation({
    model: { provider: "fake", model: "fake-1" },
    systemContext,
    toolBundles: [],
  });
  return conversation.id;
}

/** 送一則訊息並等回合結束。 */
export async function send(
  engine: FakeEngine,
  conversationId: string,
  text: string,
): Promise<void> {
  await engine.sendMessage({
    conversationId,
    content: [{ type: "text", text }],
    delivery: "queue",
    sender: { kind: "human", clientId: "test" },
  });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const conversation = await engine.getConversation(conversationId);
    if (conversation?.state === "idle") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("等待回合結束逾時");
}
