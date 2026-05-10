import OpenAI from "openai";
import { CHAT_MODEL, EMBEDDING_MODEL, requireEnv } from "./config";

let client;

export function getOpenAIClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY")
    });
  }

  return client;
}

export async function embedTexts(texts) {
  const openai = getOpenAIClient();
  const embeddings = [];
  const batchSize = 64;

  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = texts.slice(index, index + batchSize);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch
    });

    response.data
      .sort((left, right) => left.index - right.index)
      .forEach((item) => embeddings.push(item.embedding));
  }

  return embeddings;
}

export async function embedQuery(query) {
  const [embedding] = await embedTexts([query]);
  return embedding;
}

export async function generateGroundedAnswer({ question, contextBlocks }) {
  const openai = getOpenAIClient();
  const context = contextBlocks
    .map((block, index) => {
      const page =
        block.pageNumber === null || block.pageNumber === undefined
          ? "text file"
          : `page ${block.pageNumber}`;

      return `[${index + 1}] ${block.sourceName}, ${page}\n${block.text}`;
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
          "If the context does not contain the answer, say: I could not find that in the uploaded document.",
          "Do not use outside knowledge.",
          "Cite the context block numbers you used, such as [1] or [2]."
        ].join(" ")
      },
      {
        role: "user",
        content: `Context blocks:\n${context}\n\nQuestion: ${question}`
      }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || "";
}
