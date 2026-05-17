export const COLLECTION_NAME =
  process.env.QDRANT_COLLECTION || "notebooklm_rag_chunks";

export const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

export const EMBEDDING_DIMENSIONS = Number(
  process.env.OPENAI_EMBEDDING_DIMENSIONS || 1536
);

export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";

export const QUERY_REWRITE_MODEL =
  process.env.OPENAI_QUERY_REWRITE_MODEL || CHAT_MODEL;

export const QUERY_JUDGE_MODEL = process.env.OPENAI_QUERY_JUDGE_MODEL || CHAT_MODEL;

export const MAX_FILE_BYTES = Number(
  process.env.MAX_FILE_BYTES || 10 * 1024 * 1024
);

export const RETRIEVAL_K = Number(process.env.RETRIEVAL_K || 5);

export const RETRIEVAL_CANDIDATE_K = Number(
  process.env.RETRIEVAL_CANDIDATE_K || Math.max(RETRIEVAL_K * 3, 12)
);

export const QUERY_VARIANT_COUNT = Number(process.env.QUERY_VARIANT_COUNT || 4);

export const MIN_RETRIEVAL_SCORE = Number(
  process.env.MIN_RETRIEVAL_SCORE || 0.12
);

export const MAX_CHUNKS_PER_DOCUMENT = Number(
  process.env.MAX_CHUNKS_PER_DOCUMENT || 1200
);

export const DOCUMENT_QUALITY_MIN_CHARS = Number(
  process.env.DOCUMENT_QUALITY_MIN_CHARS || 80
);

export const EMBEDDING_CACHE_MAX_ENTRIES = Number(
  process.env.EMBEDDING_CACHE_MAX_ENTRIES || 500
);

export function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
