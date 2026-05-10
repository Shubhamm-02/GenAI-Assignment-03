import { RETRIEVAL_K } from "./config";
import { embedQuery } from "./openai";
import { generateGroundedAnswer } from "./openai";
import { searchChunks } from "./qdrant";

export async function answerQuestion({ documentId, question }) {
  const queryEmbedding = await embedQuery(question);
  const retrievedChunks = await searchChunks({
    documentId,
    vector: queryEmbedding,
    limit: RETRIEVAL_K
  });

  if (retrievedChunks.length === 0) {
    return {
      answer: "I could not find that in the uploaded document.",
      sources: []
    };
  }

  const answer = await generateGroundedAnswer({
    question,
    contextBlocks: retrievedChunks
  });

  return {
    answer,
    sources: retrievedChunks.map((chunk, index) => ({
      id: index + 1,
      score: chunk.score,
      pageNumber: chunk.pageNumber,
      sourceName: chunk.sourceName,
      text: chunk.text
    }))
  };
}
