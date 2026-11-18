import type { CardService } from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";
import { BoardFileStore, FreshnessStore, type SettingsStore } from "@cardiary/storage";

import { createAuditLog } from "../../permissions/audit.js";
import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import { manifest } from "./manifest.js";
import { BOARDS_AGENT_MODE_KEY, parseAgentModeSetting } from "./policy.js";
import { registerBoardsProtocol } from "./protocol.js";
import { BoardService, type BoardCardGateway, type BoardChangedEvent } from "./service.js";
import { createBoardsToolBundles } from "./tools.js";

/**
 * 白板模組的進入點。
 *
 * 白板正本是資料夾裡的 `boards/<id>.json`；服務只經過 `BoardFileStore`
 * 讀寫，卡片本體仍由卡片模組擁有。`board.*` 協定給殼與客戶端用，兩個
 * 工具組給代理用；工具組是否曝光由 `boards.agentMode` 在新的對話決定。
 */
export const hostModule: HostModule = {
  manifest,
  activate,
};

async function activate(context: ModuleActivationContext): Promise<void> {
  const cabinet = context.services.host.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  const cards = context.services.host.require<CardService>(HOST_SERVICE_NAMES.cards);
  const now = (): Date => context.services.clock.now();

  const store = new BoardFileStore({ layout: cabinet.layout, now });
  store.ensureDirectory();

  // 這個鍵屬 human-only，模組的 settings 讀取器會擋掉；主機自己在同一個
  // 資料庫讀原始值，才能把「只有人能改」與「執行期要判斷」分開。
  const agentMode = () => parseAgentModeSetting(cabinet.settings.get(BOARDS_AGENT_MODE_KEY)?.value);

  // 釘選是白板投影的屬性；卡片狀態只是鏡射，由 BoardService 在每次寫入後
  // 依「任一白板釘選」的結果同步。半衰期與卡片模組讀同一個設定。
  const freshness = new FreshnessStore({
    db: cabinet.state,
    now,
    halfLifeDays: () => settingNumber(cabinet.settings, "freshness.halfLifeDays", 30),
  });

  const service = new BoardService(
    store,
    now,
    (event: BoardChangedEvent): void => {
      context.services.protocol.emit({
        kind: "board-changed",
        boardId: event.boardId,
        payload: boardChangedPayload(event),
      });
    },
    cardGateway(cards),
    freshness,
  );
  // 啟動時掃描全部白板與 card_state 校正一次，修補上次中斷留下的差異：
  // 白板有釘選而狀態沒有的設為釘選，狀態釘選而白板沒有的取消。
  await service.reconcilePins();
  registerBoardsProtocol({ service, protocol: context.services.protocol });

  const bundles = createBoardsToolBundles({
    service,
    agentMode,
    audit: createAuditLog(cabinet.layout.root),
    now,
  });
  context.registerToolBundle(bundles.create);
  context.registerToolBundle(bundles.project);
  context.registerToolBundle(bundles.full);

  context.services.host.provide(HOST_SERVICE_NAMES.boards, service);
}

/** 卡片服務的兩個方法就夠白板用；其餘能力不往外開。 */
function cardGateway(cards: CardService): BoardCardGateway {
  return {
    get: (cardId) => cards.get(cardId),
    create: (input) =>
      cards.create({
        kind: input.kind,
        title: input.title,
        body: input.body,
        ...(input.sources === undefined ? {} : { sources: input.sources }),
      }),
  };
}

/**
 * `board.changed` 的 payload。
 *
 * 帶整份白板，讓另一個視窗不必再拉一次；`cardIds` 供釘選與新鮮度同步。
 * 白板文件是唯讀結構，序列化成事件時再轉成一般 JSON 值。
 */
function boardChangedPayload(event: BoardChangedEvent): JsonValue {
  return {
    boardId: event.boardId,
    change: event.change,
    ...(event.board === undefined ? {} : { board: event.board }),
    ...(event.cardIds === undefined ? {} : { cardIds: [...event.cardIds] }),
  } as unknown as JsonValue;
}

/** 讀設定裡的數字；沒有值或格式不對時用預設。與卡片模組的解析一致。 */
function settingNumber(settings: SettingsStore, key: string, fallback: number): number {
  const raw = settings.get(key)?.value;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
