import OpenAI from "openai";
import {
  CHAT_MODEL,
  EMBEDDING_CACHE_MAX_ENTRIES,
  EMBEDDING_MODEL,
  QUERY_JUDGE_MODEL,
  QUERY_REWRITE_MODEL,
  QUERY_VARIANT_COUNT,
  requireEnv
} from "./config";

let client;
const embeddingCache = new Map();
const embeddingCacheStats = {
  hits: 0,
  misses: 0
};

export function getOpenAIClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY")
    });
  }

  return client;
}

function embeddingCacheKey(text) {
  return `${EMBEDDING_MODEL}:${String(text || "").replace(/\s+/g, " ").trim()}`;
}

function readEmbeddingCache(key) {
  if (EMBEDDING_CACHE_MAX_ENTRIES <= 0) {
    embeddingCacheStats.misses += 1;
    return null;
  }

  if (!embeddingCache.has(key)) {
    embeddingCacheStats.misses += 1;
    return null;
  }

  const value = embeddingCache.get(key);
  embeddingCache.delete(key);
  embeddingCache.set(key, value);
  embeddingCacheStats.hits += 1;
  return value;
}

function writeEmbeddingCache(key, value) {
  if (EMBEDDING_CACHE_MAX_ENTRIES <= 0) {
    return;
  }

  if (embeddingCache.has(key)) {
    embeddingCache.delete(key);
  }

  embeddingCache.set(key, value);

  while (embeddingCache.size > EMBEDDING_CACHE_MAX_ENTRIES) {
    const oldestKey = embeddingCache.keys().next().value;
    embeddingCache.delete(oldestKey);
  }
}

export function getEmbeddingCacheStats() {
  return {
    ...embeddingCacheStats,
    entries: embeddingCache.size,
    maxEntries: EMBEDDING_CACHE_MAX_ENTRIES
  };
}

export async function embedTexts(texts) {
  const openai = getOpenAIClient();
  const embeddings = new Array(texts.length);
  const uncached = [];
  const batchSize = 64;

  texts.forEach((text, index) => {
    const cacheKey = embeddingCacheKey(text);
    const cachedEmbedding = readEmbeddingCache(cacheKey);

    if (cachedEmbedding) {
      embeddings[index] = cachedEmbedding;
      return;
    }

    uncached.push({
      cacheKey,
      index,
      text
    });
  });

  for (let index = 0; index < uncached.length; index += batchSize) {
    const batch = uncached.slice(index, index + batchSize);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((item) => item.text)
    });

    response.data
      .sort((left, right) => left.index - right.index)
      .forEach((item) => {
        const source = batch[item.index];
        embeddings[source.index] = item.embedding;
        writeEmbeddingCache(source.cacheKey, item.embedding);
      });
  }

  return embeddings;
}

export async function embedQuery(query) {
  const [embedding] = await embedTexts([query]);
  return embedding;
}

function parseJsonContent(content, fallback) {
  if (!content) {
    return fallback;
  }

  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const objectStart = candidate.indexOf("{");
    const objectEnd = candidate.lastIndexOf("}");

    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
      } catch {
        return fallback;
      }
    }
  }

  return fallback;
}

function uniqueStrings(values) {
  const seen = new Set();
  const unique = [];

  values.forEach((value) => {
    const cleaned = String(value || "").replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();

    if (!cleaned || seen.has(key)) {
      return;
    }

    seen.add(key);
    unique.push(cleaned);
  });

  return unique;
}

function fallbackQueryProfile(question) {
  return {
    originalQuestion: question,
    rewrittenQuestion: question,
    retrievalQueries: [question],
    intent: "Direct document question",
    typoFixes: [],
    requiresTabularReasoning: false,
    confidence: 0.5,
    usedFallback: true
  };
}

function normalizeTypoFixes(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      from: String(item?.from || "").trim(),
      to: String(item?.to || "").trim()
    }))
    .filter((item) => item.from && item.to && item.from !== item.to)
    .slice(0, 6);
}

export async function translateQuestion(question) {
  const openai = getOpenAIClient();
  const fallback = fallbackQueryProfile(question);

  try {
    const response = await openai.chat.completions.create({
      model: QUERY_REWRITE_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are the query-translation layer for a production RAG system.",
            "Rewrite the user question for retrieval without changing its meaning.",
            "Fix obvious typos, expand abbreviations only when the intent is clear, and preserve entity names.",
            "If the user asks for filtering, grouping, totals, comparisons, counts, rows, or columns, add one SQL-like natural-language retrieval query.",
            "Return strict JSON with keys: rewrittenQuestion, retrievalQueries, intent, typoFixes, requiresTabularReasoning, confidence.",
            "retrievalQueries must be diverse phrasings for vector search and must not add facts not present in the question."
          ].join(" ")
        },
        {
          role: "user",
          content: `Original question:\n${question}`
        }
      ]
    });
    const data = parseJsonContent(response.choices[0]?.message?.content, {});
    const rewrittenQuestion =
      typeof data.rewrittenQuestion === "string" && data.rewrittenQuestion.trim()
        ? data.rewrittenQuestion.trim()
        : question;
    const retrievalQueries = uniqueStrings([
      question,
      rewrittenQuestion,
      ...(Array.isArray(data.retrievalQueries) ? data.retrievalQueries : [])
    ]).slice(0, QUERY_VARIANT_COUNT);

    return {
      originalQuestion: question,
      rewrittenQuestion,
      retrievalQueries: retrievalQueries.length ? retrievalQueries : [question],
      intent:
        typeof data.intent === "string" && data.intent.trim()
          ? data.intent.trim()
          : fallback.intent,
      typoFixes: normalizeTypoFixes(data.typoFixes),
      requiresTabularReasoning: Boolean(data.requiresTabularReasoning),
      confidence:
        typeof data.confidence === "number"
          ? Math.max(0, Math.min(1, data.confidence))
          : fallback.confidence,
      usedFallback: false
    };
  } catch (error) {
    console.warn("Query translation failed; using original question.", error);
    return fallback;
  }
}

function describeContextLocation(block) {
  if (block.sectionType === "csv-rows" && block.rowStart && block.rowEnd) {
    return `rows ${block.rowStart}-${block.rowEnd}`;
  }

  if (block.sectionType === "csv-schema") {
    return "CSV schema";
  }

  if (block.pageNumber === null || block.pageNumber === undefined) {
    return block.sectionType || "text file";
  }

  return `page ${block.pageNumber}`;
}

export async function judgeRetrievedChunks({ question, queryProfile, chunks }) {
  if (chunks.length === 0) {
    return {
      selectedChunkIds: [],
      relevanceScores: [],
      sufficient: false,
      reason: "No chunks were retrieved.",
      usedFallback: false
    };
  }

  const openai = getOpenAIClient();
  const fallbackSelection = chunks.slice(0, 5).map((_, index) => index + 1);
  const fallback = {
    selectedChunkIds: fallbackSelection,
    relevanceScores: chunks.map((chunk, index) => ({
      id: index + 1,
      score: Number(chunk.score || chunk.bestScore || 0),
      reason: "Vector-search fallback ranking."
    })),
    sufficient: fallbackSelection.length > 0,
    reason: "Judge unavailable; using vector ranking fallback.",
    usedFallback: true
  };

  try {
    const chunkDigest = chunks
      .map((chunk, index) => {
        const snippet = chunk.text.replace(/\s+/g, " ").slice(0, 900);
        return [
          `[${index + 1}] ${chunk.sourceName}, ${describeContextLocation(chunk)}`,
          `Vector score: ${Number(chunk.score || chunk.bestScore || 0).toFixed(3)}`,
          snippet
        ].join("\n");
      })
      .join("\n\n");

    const response = await openai.chat.completions.create({
      model: QUERY_JUDGE_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are an LLM-as-a-judge reranker for a document-grounded RAG system.",
            "Score each candidate chunk from 0 to 1 for whether it contains evidence needed to answer the original question.",
            "Prefer precise evidence over semantic similarity alone.",
            "For SQL-like or table questions, prefer schema and row chunks that name columns and contain relevant records.",
            "Select only useful chunk ids. If no chunk contains answer evidence, return an empty selectedChunkIds array.",
            "Return strict JSON with keys: selectedChunkIds, relevanceScores, sufficient, reason.",
            "relevanceScores must be an array of objects with id, score, reason."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            `Original question: ${question}`,
            `Rewritten question: ${queryProfile.rewrittenQuestion}`,
            `Intent: ${queryProfile.intent}`,
            `Requires table reasoning: ${queryProfile.requiresTabularReasoning}`,
            "",
            "Candidate chunks:",
            chunkDigest
          ].join("\n")
        }
      ]
    });
    const data = parseJsonContent(response.choices[0]?.message?.content, {});
    const validIds = new Set(chunks.map((_, index) => index + 1));
    const selectedChunkIds = [
      ...new Set(
        (Array.isArray(data.selectedChunkIds) ? data.selectedChunkIds : [])
          .map((id) => Number(id))
          .filter((id) => validIds.has(id))
      )
    ];
    const relevanceScores = (Array.isArray(data.relevanceScores)
      ? data.relevanceScores
      : []
    )
      .map((item) => ({
        id: Number(item?.id),
        score:
          typeof item?.score === "number"
            ? Math.max(0, Math.min(1, item.score))
            : 0,
        reason:
          typeof item?.reason === "string" && item.reason.trim()
            ? item.reason.trim()
            : "No judge reason provided."
      }))
      .filter((item) => validIds.has(item.id));

    return {
      selectedChunkIds,
      relevanceScores,
      sufficient: Boolean(data.sufficient),
      reason:
        typeof data.reason === "string" && data.reason.trim()
          ? data.reason.trim()
          : "Judge completed without a reason.",
      usedFallback: false
    };
  } catch (error) {
    console.warn("Chunk judge failed; using vector ranking fallback.", error);
    return fallback;
  }
}

export async function generateGroundedAnswer({
  question,
  contextBlocks,
  queryProfile,
  judge
}) {
  const openai = getOpenAIClient();
  const context = contextBlocks
    .map((block, index) => {
      return `[${index + 1}] ${block.sourceName}, ${describeContextLocation(
        block
      )}\n${block.text}`;
    })
    .join("\n\n");

  const response = await openai.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: [
          "You are a document-grounded RAG assistant.",
          "Answer only from the supplied context blocks.",
          "Use the rewritten question only as a retrieval aid; answer the user's original question.",
          "If the context does not contain the answer, say: I could not find that in the uploaded document.",
          "Do not use outside knowledge.",
          "Cite the context block numbers you used, such as [1] or [2]."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          `Original question: ${question}`,
          queryProfile?.rewrittenQuestion
            ? `Rewritten retrieval question: ${queryProfile.rewrittenQuestion}`
            : "",
          judge?.reason ? `Judge note: ${judge.reason}` : "",
          "",
          `Context blocks:\n${context}`
        ]
          .filter(Boolean)
          .join("\n")
      }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || "";
}
