import {
  mergeRetrievalCandidates,
  type CardPage,
  type CardQuery,
  type CardSearchHit,
  type RetrievalCandidate,
  type RetrievalMode,
} from "@cardiary/domain";

export interface RetrievalSource {
  search(query: CardQuery): Promise<CardPage<CardSearchHit>>;
}

export interface VectorSource {
  search(query: CardQuery): Promise<readonly CardSearchHit[]>;
}

export class RetrievalService {
  constructor(
    private readonly fullText: RetrievalSource,
    private readonly vectors?: VectorSource,
  ) {}

  async search(query: CardQuery, mode: RetrievalMode): Promise<CardPage<CardSearchHit>> {
    const fullText = (await this.fullText.search({ ...query, limit: 40, includeSuperseded: false }))
      .items;
    let vectors: readonly CardSearchHit[] = [];
    if (this.vectors !== undefined) {
      try {
        vectors = await this.vectors.search({ ...query, limit: 40, includeSuperseded: false });
      } catch {
        // 語意檢索失敗時，全文檢索仍可用。
      }
    }
    const candidate = (hit: CardSearchHit): RetrievalCandidate => ({
      cardId: hit.card.cardId,
      cold: hit.card.lifecycle === "cold",
      superseded: hit.card.supersededBy !== undefined,
      broken: hit.card.broken === true,
    });
    const hits = new Map([...vectors, ...fullText].map((hit) => [hit.card.cardId, hit]));
    const merged = mergeRetrievalCandidates(fullText.map(candidate), vectors.map(candidate), mode);
    const limit =
      query.limit === undefined || query.limit <= 0 ? 20 : Math.min(20, Math.floor(query.limit));
    return {
      items: merged.slice(0, limit).map(({ cardId, score }) => ({ ...hits.get(cardId)!, score })),
    };
  }
}
