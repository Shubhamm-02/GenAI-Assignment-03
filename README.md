# Assignment 03 - Google NotebookLM RAG

A document-grounded RAG web app inspired by Google NotebookLM. Users upload a PDF, TXT, Markdown, or CSV file, the app chunks and embeds it, stores vectors in Qdrant, retrieves the most relevant chunks for each question, and asks an OpenAI chat model to answer only from retrieved context.

## Tech Stack

- Next.js web UI and API routes
- OpenAI embeddings and chat completions
- Qdrant vector database
- Custom recursive character chunking with overlap
- PDF, CSV, and plain-text ingestion
- Query rewriting, multi-query retrieval fusion, and LLM judge reranking
- Document quality gates and embedding cache

## RAG Pipeline

1. **Ingestion and quality gate**: `/api/upload` accepts PDF, TXT, Markdown, or CSV files, extracts readable text, and rejects likely corrupt uploads before indexing. The gate checks readable character count, unreadable replacement characters, symbol-heavy text, repeated-character noise, empty pages, and sparse extraction.
2. **CSV/table indexing**: CSV files are converted into a schema block plus row-range blocks. Headers are normalized into unique field labels so questions that resemble SQL filters, counts, comparisons, or column lookups can retrieve both schema and relevant records.
3. **Chunking**: `lib/chunking.js` uses a recursive character splitter. It tries paragraph breaks first, then lines, sentences, words, and finally fixed character slices. Chunks target 1200 characters with 180 characters of overlap so related context is preserved across chunk boundaries.
4. **Embedding and caching**: chunks and rewritten query variants are embedded with `text-embedding-3-small` by default. An in-memory LRU cache avoids repeated embedding calls for duplicate chunks and repeated questions.
5. **Vector storage**: vectors and metadata are stored in Qdrant. Each upload receives a unique `documentId`, and retrieval filters by that ID.
6. **Query translation**: `/api/chat` first rewrites the user question, fixes obvious typos, detects tabular intent, and creates multiple retrieval variants without changing the original meaning.
7. **Multi-query retrieval fusion**: each query variant is embedded and searched against Qdrant. Results are deduplicated and merged with reciprocal-rank fusion, reducing failures from vague wording, typos, or a single weak embedding.
8. **LLM-as-judge reranking**: a configurable judge model scores candidate chunks for evidence quality, keeps only useful context, and reports whether the retrieved evidence appears sufficient.
9. **Generation**: the chat model receives only judge-selected chunks and is instructed to answer from them. If the answer is absent, it must say it could not find the answer in the uploaded document.

## Local Setup

```bash
npm install
cp .env.example .env
docker compose up -d
npm run dev
```

Open `http://localhost:3000`.

Required `.env` values:

```bash
OPENAI_API_KEY=sk-your-openai-key
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
```

## Deployment

Deploy the app to Vercel, Render, Railway, or any Node-compatible host. For a live project link, use a managed Qdrant Cloud cluster and set these environment variables in the hosting dashboard:

```bash
OPENAI_API_KEY=sk-your-openai-key
QDRANT_URL=https://your-qdrant-cloud-url
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_COLLECTION=notebooklm_rag_chunks
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
OPENAI_CHAT_MODEL=gpt-4.1-mini
OPENAI_QUERY_REWRITE_MODEL=gpt-4.1-mini
OPENAI_QUERY_JUDGE_MODEL=gpt-4.1-mini
RETRIEVAL_K=5
RETRIEVAL_CANDIDATE_K=12
QUERY_VARIANT_COUNT=4
MIN_RETRIEVAL_SCORE=0.12
EMBEDDING_CACHE_MAX_ENTRIES=500
MAX_CHUNKS_PER_DOCUMENT=1200
DOCUMENT_QUALITY_MIN_CHARS=80
```

## Submission Checklist

- Public GitHub repository link
- Live deployed project link
- Working upload and chat flow
- Qdrant vector database configured
- OpenAI API key configured in deployment environment

## Notes

- The app does not answer from model memory. It sends retrieved context blocks to the model and asks it to cite block numbers like `[1]`.
- The UI shows retrieved source chunks under each assistant response.
- The UI also shows the query rewrite, judge status, retrieval counts, embedding cache hits, and document quality score so production bottlenecks are visible during testing.
- For larger documents, increase `MAX_FILE_BYTES` in the environment.
