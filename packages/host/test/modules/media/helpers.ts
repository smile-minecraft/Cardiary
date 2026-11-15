import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CardService } from "@cardiary/domain";
import type { ModelInvoker } from "@cardiary/module-api";
import type { HostEngine } from "../../../src/engine/types.js";
import { SilentLogger } from "../../../src/logging.js";
import type { CardEnvironment } from "../../../src/modules/contract.js";
import { MediaService } from "../../../src/modules/media/pipeline.js";
import {
  RecognitionClient,
  type BrokerRequester,
  type RecognitionResult,
} from "../../../src/modules/media/recognition.js";
import { MediaStore } from "../../../src/modules/media/store.js";
import { CardLibrary } from "../../../src/modules/cards/library.js";
import { CardStateStore } from "../../../src/modules/cards/state.js";
import {
  CardFileStore,
  CardIndexStore,
  LocalAssetStore,
  Storage,
  type Database,
} from "@cardiary/storage";

export interface MediaFixture {
  readonly folder: string;
  readonly storage: Storage;
  readonly library: CardLibrary;
  readonly store: MediaStore;
  readonly media: MediaService;
  close(): void;
}

export interface MakeMediaFixtureOptions {
  readonly recognition?: BrokerRequester | null;
  readonly models?: ModelInvoker | null;
  readonly modelState?: {
    readonly providers: readonly {
      readonly providerId: string;
      readonly models: readonly {
        readonly modelId: string;
        readonly input: readonly ("text" | "image" | "audio")[];
      }[];
    }[];
    readonly resolved: readonly {
      readonly role: string;
      readonly ref?: { readonly providerId: string; readonly modelId: string };
    }[];
  };
  readonly conversationModel?: { readonly provider: string; readonly model: string };
}

export async function makeMediaFixture(
  options: MakeMediaFixtureOptions = {},
): Promise<MediaFixture> {
  const folder = await mkdtemp(join(tmpdir(), "cardiary-media-"));
  const storage = Storage.open({ path: folder, initialize: true });
  const now = (): Date => new Date();
  const files = new CardFileStore({ layout: storage.layout, now });
  const indexFor = (database: Database): CardIndexStore =>
    new CardIndexStore({ db: database, now });
  let cachedDatabase: Database | null = null;
  let cachedIndex: CardIndexStore | null = null;
  const index = (): CardIndexStore => {
    const database = storage.cache;
    if (cachedIndex === null || cachedDatabase !== database) {
      cachedDatabase = database;
      cachedIndex = indexFor(database);
    }
    return cachedIndex;
  };
  let cachedAssetDatabase: Database | null = null;
  let cachedAssets: LocalAssetStore | null = null;
  const assets = (): LocalAssetStore => {
    const database = storage.cache;
    if (cachedAssets === null || cachedAssetDatabase !== database) {
      cachedAssetDatabase = database;
      cachedAssets = new LocalAssetStore({ layout: storage.layout, index: index(), now });
    }
    return cachedAssets;
  };
  const library = new CardLibrary({
    files,
    index,
    assets,
    state: new CardStateStore({ db: () => storage.state, now }),
    now,
  });
  await library.initialize();

  const store = new MediaStore({
    layout: storage.layout,
    state: storage.state,
    cache: () => storage.cache,
    now,
  });
  const recognition = new RecognitionClient(() => options.recognition ?? undefined);
  const models = options.models === null ? undefined : (options.models ?? undefined);
  const engine =
    options.conversationModel === undefined
      ? undefined
      : ({
          async getConversation() {
            return {
              id: "conv",
              model: {
                provider: options.conversationModel?.provider,
                model: options.conversationModel?.model,
              },
            };
          },
        } as unknown as HostEngine);
  const modelService =
    models === undefined ? undefined : Object.assign(models, { state: options.modelState });
  const cardEnvironment: CardEnvironment = {
    layout: storage.layout,
    state: storage.state,
    cache: () => storage.cache,
    settings: storage.settings,
    ownsConnections: false,
    close: () => {},
  };
  const media = new MediaService({
    store,
    recognition,
    cardStorage: cardEnvironment,
    cards: () => library as CardService,
    models: () => modelService as ModelInvoker | undefined,
    engine: () => engine,
    now,
    logger: new SilentLogger(),
  });
  return {
    folder,
    storage,
    library,
    store,
    media,
    close: () => storage.close(),
  };
}

/** 假的模型：圖片用途回描述，音訊用途回摘要。 */
export function fakeModels(description = "白板上寫著預算與排程。"): ModelInvoker {
  return {
    async invoke(request) {
      return {
        text: request.purpose.includes("圖片") ? description : "討論搬家與租約。",
      };
    },
  };
}

/** 假的殼路由：依 route 回固定結果。 */
export function fakeBroker(results: {
  readonly ocr?: RecognitionResult;
  readonly transcribe?: RecognitionResult;
}): BrokerRequester {
  return {
    async requestBroker(route) {
      const result = route === "broker.recognition.ocr" ? results.ocr : results.transcribe;
      if (result === undefined) return { available: false, reason: "no_shell" };
      if (!result.available) return { available: false, reason: result.reason };
      return {
        available: true,
        text: result.text,
        ...(result.locale === undefined ? {} : { locale: result.locale }),
        ...(result.truncated === true ? { truncated: true } : {}),
      };
    },
  };
}
