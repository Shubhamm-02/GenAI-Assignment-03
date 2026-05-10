export const COLLECTION_NAME =
  process.env.QDRANT_COLLECTION || "notebooklm_rag_chunks";

export const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

export const EMBEDDING_DIMENSIONS = Number(
  process.env.OPENAI_EMBEDDING_DIMENSIONS || 1536
);

export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";

export const MAX_FILE_BYTES = Number(
  process.env.MAX_FILE_BYTES || 10 * 1024 * 1024
);

export const RETRIEVAL_K = Number(process.env.RETRIEVAL_K || 5);

export function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
