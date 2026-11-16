export type RetrievalMode = "dealing" | "search";

export interface RetrievalCandidate {
  readonly cardId: string;
  readonly cold: boolean;
  readonly superseded: boolean;
  readonly broken: boolean;
}

export interface RankedRetrievalCandidate extends RetrievalCandidate {
  readonly score: number;
}

export function mergeRetrievalCandidates(
  fullText: readonly RetrievalCandidate[],
  vectors: readonly RetrievalCandidate[],
  mode: RetrievalMode,
): RankedRetrievalCandidate[] {
  const scores = new Map<
    string,
    { candidate: RetrievalCandidate; score: number; bestRank: number }
  >();
  for (const source of [fullText, vectors]) {
    const seen = new Set<string>();
    const eligible = source.filter(
      (card) => !card.broken && !card.superseded && (mode === "search" || !card.cold),
    );
    for (const [index, candidate] of eligible.slice(0, 40).entries()) {
      if (seen.has(candidate.cardId)) continue;
      seen.add(candidate.cardId);
      const rank = index + 1;
      const current = scores.get(candidate.cardId);
      scores.set(candidate.cardId, {
        candidate,
        score: (current?.score ?? 0) + 1 / (60 + rank),
        bestRank: Math.min(current?.bestRank ?? rank, rank),
      });
    }
  }
  return [...scores.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.bestRank - b.bestRank ||
        a.candidate.cardId.localeCompare(b.candidate.cardId, "en"),
    )
    .slice(0, 20)
    .map(({ candidate, score }) => ({ ...candidate, score }));
}
