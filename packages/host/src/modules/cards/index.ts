import type { AssetStore, CardIndex, CardService } from "@cardiary/domain";
import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";
import type { JsonValue } from "@cardiary/engine-adapter";
import {
  CardFileStore,
  CardIndexStore,
  LocalAssetStore,
  type Database,
  type SettingsStore,
} from "@cardiary/storage";

import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import type { BoardService } from "../boards/service.js";
import { CardLibrary } from "./library.js";
import { manifest } from "./manifest.js";
import { registerCardsProtocol } from "./protocol.js";
import { CardStateStore } from "./state.js";
import { createCardToolBundle } from "./tools.js";
import type { RetrievalService } from "../retrieval/service.js";
import { CardWatcher, parseCardRescanIntervalMs } from "./watcher.js";

/**
 * 卡片模組的進入點。
 *
 * 主機已經把儲存接好（`cardStorage`）；這裡只建立檔案、索引、原檔與狀態
 * 四個部件，啟動掃描之後才接受請求。停用時只停監看，資料全部保留。
 */
export const hostModule: HostModule = {
  manifest,
  activate,
  deactivate,
};

async function activate(context: ModuleActivationContext): Promise<void> {
  const cabinet = context.services.host.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  const now = (): Date => context.services.clock.now();
  const warn = (message: string, fields?: { readonly [key: string]: JsonValue }): void => {
    context.services.logger.warn(message, fields);
  };

  const files = new CardFileStore({ layout: cabinet.layout, now });
  let cachedDatabase: Database | null = null;
  let cachedIndex: CardIndexStore | null = null;
  const index = (): CardIndexStore => {
    const database = cabinet.cache();
    if (cachedIndex === null || cachedDatabase !== database) {
      cachedDatabase = database;
      cachedIndex = new CardIndexStore({ db: database, now });
    }
    return cachedIndex;
  };
  let cachedAssetDatabase: Database | null = null;
  let cachedAssets: LocalAssetStore | null = null;
  const assets = (): LocalAssetStore => {
    const database = cabinet.cache();
    if (cachedAssets === null || cachedAssetDatabase !== database) {
      cachedAssetDatabase = database;
      cachedAssets = new LocalAssetStore({ layout: cabinet.layout, index: index(), now });
    }
    return cachedAssets;
  };

  const library = new CardLibrary({
    files,
    index,
    assets,
    state: new CardStateStore({
      db: () => cabinet.state,
      now,
      halfLifeDays: () => settingNumber(cabinet.settings, "freshness.halfLifeDays", 30),
    }),
    now,
    emit: (intent) => context.services.protocol.emit(intent),
    warn,
    // 刪卡時連帶移除白板投影：投影在別的模組，所以刪除流程主動呼叫過去。
    // 白板模組沒啟用或還沒接上時安靜跳過；投影清不掉就不要刪卡，留給呼叫端重試。
    beforeDelete: async (cardId) => {
      const boards = context.services.host.get<BoardService>(HOST_SERVICE_NAMES.boards);
      await boards?.removeCardProjections(cardId);
    },
  });

  await library.initialize();

  // 內部測試接縫：CARDIARY_CARD_RESCAN_MS 可以縮短補掃間隔（毫秒），
  // 讓測試組裝在 FSEvents 漏事件時仍能快速接上；產品預設維持 10 分鐘。
  const rescanEnv = process.env.CARDIARY_CARD_RESCAN_MS;
  const rescanIntervalMs = parseCardRescanIntervalMs(rescanEnv);
  if (rescanEnv !== undefined && rescanIntervalMs === undefined) {
    warn("CARDIARY_CARD_RESCAN_MS 不是正整數毫秒，沿用預設補掃間隔", { value: rescanEnv });
  }

  const watcher = new CardWatcher({
    directory: files.directory,
    library,
    warn,
    ...(rescanIntervalMs === undefined ? {} : { rescanIntervalMs }),
  });
  watcher.start();

  const search: CardLibrary["search"] = (query) => {
    const retrieval = context.services.host.get<RetrievalService>("retrieval");
    return retrieval === undefined
      ? library.search({ ...query, includeSuperseded: false })
      : retrieval.search(query, "search");
  };
  registerCardsProtocol({ library, protocol: context.services.protocol, search });
  context.registerToolBundle(createCardToolBundle({ library, search }));

  const cardService: CardService = library;
  const cardIndex: CardIndex = {
    rebuild: () => library.rebuild(),
    rescan: () => library.rescan(),
  };
  const assetStore: AssetStore = {
    put: (input) => assets().put(input),
    read: async (blobId) => assets().read(blobId) ?? null,
    release: async (blobId) => assets().release(blobId) === "deleted",
  };
  context.services.host.provide(HOST_SERVICE_NAMES.cards, cardService);
  context.services.host.provide(HOST_SERVICE_NAMES.cardIndex, cardIndex);
  context.services.host.provide(HOST_SERVICE_NAMES.assets, assetStore);

  runningWatchers.add(watcher);
}

const runningWatchers = new Set<CardWatcher>();

/** 讀設定裡的數字；沒有值或格式不對時用預設。與生命週期服務的解析一致。 */
function settingNumber(settings: SettingsStore, key: string, fallback: number): number {
  const raw = settings.get(key)?.value;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 停用：停止監看；協定、工具與服務的註冊由主機撤銷。 */
export function deactivate(): void {
  for (const watcher of runningWatchers) {
    watcher.stop();
  }
  runningWatchers.clear();
}
