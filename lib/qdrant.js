import { randomUUID } from "crypto";
import { COLLECTION_NAME, EMBEDDING_DIMENSIONS, requireEnv } from "./config";

function qdrantUrl(path) {
  return `${requireEnv("QDRANT_URL").replace(/\/$/, "")}${path}`;
}

async function qdrantRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(process.env.QDRANT_API_KEY
      ? { "api-key": process.env.QDRANT_API_KEY }
      : {})
  };

  const response = await fetch(qdrantUrl(path), {
    ...options,
    headers: {
      ...headers,
      ...options.headers
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Qdrant request failed (${response.status}): ${message}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function collectionExists() {
  const response = await fetch(qdrantUrl(`/collections/${COLLECTION_NAME}`), {
    headers: {
      ...(process.env.QDRANT_API_KEY
        ? { "api-key": process.env.QDRANT_API_KEY }
        : {})
    }
  });

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Could not inspect Qdrant collection: ${message}`);
  }

  const data = await response.json();
  const vectors = data.result?.config?.params?.vectors;
  const currentSize = vectors?.size || vectors?.default?.size;

  if (currentSize && currentSize !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Qdrant collection "${COLLECTION_NAME}" uses vector size ${currentSize}, but this app expects ${EMBEDDING_DIMENSIONS}. Use a different QDRANT_COLLECTION or matching embedding model.`
    );
  }

  return true;
}

export async function ensureCollection() {
  const exists = await collectionExists();

  if (!exists) {
    await qdrantRequest(`/collections/${COLLECTION_NAME}`, {
      method: "PUT",
      body: JSON.stringify({
        vectors: {
          size: EMBEDDING_DIMENSIONS,
          distance: "Cosine"
        }
      })
    });
  }

  await qdrantRequest(`/collections/${COLLECTION_NAME}/index`, {
    method: "PUT",
    body: JSON.stringify({
      field_name: "documentId",
      field_schema: "keyword"
    })
  }).catch(() => null);
}

export async function upsertChunks({ documentId, chunks, vectors }) {
  const points = chunks.map((chunk, index) => ({
    id: randomUUID(),
    vector: vectors[index],
    payload: {
      documentId,
      chunkIndex: chunk.metadata.chunkIndex,
      sourceName: chunk.metadata.sourceName,
      pageNumber: chunk.metadata.pageNumber,
      text: chunk.text
    }
  }));

  await qdrantRequest(`/collections/${COLLECTION_NAME}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({ points })
  });
}

export async function searchChunks({ documentId, vector, limit }) {
  const data = await qdrantRequest(
    `/collections/${COLLECTION_NAME}/points/search`,
    {
      method: "POST",
      body: JSON.stringify({
        vector,
        limit,
        with_payload: true,
        filter: {
          must: [
            {
              key: "documentId",
              match: {
                value: documentId
              }
            }
          ]
        }
      })
    }
  );

  return (data.result || []).map((point) => ({
    score: point.score,
    ...point.payload
  }));
}
