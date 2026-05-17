import {
  MIN_RETRIEVAL_SCORE,
  QUERY_JUDGE_MODEL,
  QUERY_REWRITE_MODEL,
  RETRIEVAL_CANDIDATE_K,
  RETRIEVAL_K
} from "./config";
import {
  embedTexts,
  generateGroundedAnswer,
  getEmbeddingCacheStats,
  judgeRetrievedChunks,
  translateQuestion
} from "./openai";
import { searchChunks } from "./qdrant";

const NOT_FOUND = "I could not find that in the uploaded document.";

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function chunkKey(chunk) {
  return chunk.id || `${chunk.sourceName}:${chunk.chunkIndex}`;
}

function fuseSearchResults(resultsByQuery, queries, minScore) {
  const fused = new Map();
  const rrfK = 60;

  resultsByQuery.forEach((chunks, queryIndex) => {
    chunks.forEach((chunk, rank) => {
      const score = Number(chunk.score || 0);

      if (score < minScore) {
        return;
      }

      const key = chunkKey(chunk);
      const existing =
        fused.get(key) ||
        {
          ...chunk,
          score,
          bestScore: score,
          fusedScore: 0,
          matchedQueries: []
        };

      existing.bestScore = Math.max(existing.bestScore, score);
      existing.score = existing.bestScore;
      existing.fusedScore += 1 / (rrfK + rank + 1);
      existing.matchedQueries.push({
        query: queries[queryIndex],
        rank: rank + 1,
        score
      });

      fused.set(key, existing);
    });
  });

  return [...fused.values()].sort((left, right) => {
    if (right.fusedScore !== left.fusedScore) {
      return right.fusedScore - left.fusedScore;
    }

    return right.bestScore - left.bestScore;
  });
}

function buildPipeline({ queryProfile, retrievalQueries, candidates, selected, judge }) {
  return {
    strategy: "query-translation + multi-query fusion + LLM judge",
    queryTranslation: {
      rewrittenQuestion: queryProfile.rewrittenQuestion,
      intent: queryProfile.intent,
      typoFixes: queryProfile.typoFixes,
      requiresTabularReasoning: queryProfile.requiresTabularReasoning,
      confidence: round(queryProfile.confidence, 2),
      usedFallback: queryProfile.usedFallback
    },
    retrieval: {
      rewriteModel: QUERY_REWRITE_MODEL,
      judgeModel: QUERY_JUDGE_MODEL,
      retrievalQueries,
      minScore: MIN_RETRIEVAL_SCORE,
      topK: RETRIEVAL_K,
      candidateK: RETRIEVAL_CANDIDATE_K,
      candidateCount: candidates.length,
      selectedCount: selected.length,
      embeddingCache: getEmbeddingCacheStats()
    },
    judge: {
      sufficient: judge.sufficient,
      reason: judge.reason,
      usedFallback: judge.usedFallback
    }
  };
}

function sourceFromChunk(chunk, index) {
  return {
    id: index + 1,
    score: round(chunk.score),
    fusedScore: round(chunk.fusedScore),
    judgeScore:
      typeof chunk.judgeScore === "number" ? round(chunk.judgeScore, 2) : null,
    judgeReason: chunk.judgeReason || "",
    pageNumber: chunk.pageNumber,
    sectionType: chunk.sectionType,
    rowStart: chunk.rowStart,
    rowEnd: chunk.rowEnd,
    sourceName: chunk.sourceName,
    text: chunk.text
  };
}

export async function answerQuestion({ documentId, question }) {
  const queryProfile = await translateQuestion(question);
  const retrievalQueries = queryProfile.retrievalQueries;
  const queryEmbeddings = await embedTexts(retrievalQueries);
  const resultsByQuery = await Promise.all(
    queryEmbeddings.map((vector) =>
      searchChunks({
        documentId,
        vector,
        limit: RETRIEVAL_CANDIDATE_K
      })
    )
  );
  let candidates = fuseSearchResults(
    resultsByQuery,
    retrievalQueries,
    MIN_RETRIEVAL_SCORE
  );

  if (candidates.length === 0) {
    candidates = fuseSearchResults(resultsByQuery, retrievalQueries, 0);
  }

  candidates = candidates.slice(0, RETRIEVAL_CANDIDATE_K);

  if (candidates.length === 0) {
    const judge = {
      sufficient: false,
      reason: "No candidate chunks were retrieved.",
      usedFallback: false
    };

    return {
      answer: NOT_FOUND,
      sources: [],
      pipeline: buildPipeline({
        queryProfile,
        retrievalQueries,
        candidates,
        selected: [],
        judge
      })
    };
  }

  const judge = await judgeRetrievedChunks({
    question,
    queryProfile,
    chunks: candidates
  });
  const judgeScoreById = new Map(
    judge.relevanceScores.map((item) => [item.id, item])
  );
  const selectedIds = judge.selectedChunkIds.length
    ? judge.selectedChunkIds
    : judge.relevanceScores
        .filter((item) => item.score >= 0.55)
        .sort((left, right) => right.score - left.score)
        .map((item) => item.id);
  const selectedChunks = selectedIds
    .map((id) => {
      const chunk = candidates[id - 1];
      const judgeScore = judgeScoreById.get(id);

      if (!chunk) {
        return null;
      }

      return {
        ...chunk,
        judgeScore: judgeScore?.score ?? null,
        judgeReason: judgeScore?.reason || ""
      };
    })
    .filter(Boolean)
    .slice(0, RETRIEVAL_K);

  if (selectedChunks.length === 0) {
    return {
      answer: NOT_FOUND,
      sources: [],
      pipeline: buildPipeline({
        queryProfile,
        retrievalQueries,
        candidates,
        selected: [],
        judge
      })
    };
  }

  const answer = await generateGroundedAnswer({
    question,
    contextBlocks: selectedChunks,
    queryProfile,
    judge
  });

  return {
    answer: answer || NOT_FOUND,
    sources: selectedChunks.map(sourceFromChunk),
    pipeline: buildPipeline({
      queryProfile,
      retrievalQueries,
      candidates,
      selected: selectedChunks,
      judge
    })
  };
}
