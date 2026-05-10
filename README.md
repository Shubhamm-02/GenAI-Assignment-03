# Assignment 03 - Google NotebookLM RAG

A document-grounded RAG web app inspired by Google NotebookLM. Users upload a PDF, TXT, Markdown, or CSV file, the app chunks and embeds it, stores vectors in Qdrant, retrieves the most relevant chunks for each question, and asks an OpenAI chat model to answer only from retrieved context.

## Tech Stack

- Next.js web UI and API routes
- OpenAI embeddings and chat completions
- Qdrant vector database
- Custom recursive character chunking with overlap
- PDF, CSV, and plain-text ingestion

## RAG Pipeline

1. **Ingestion**: `/api/upload` accepts PDF, TXT, Markdown, or CSV files. PDF text is extracted page by page. CSV files are converted into row-wise text using the header row as field labels, so questions can target specific rows and columns.
2. **Chunking**: `lib/chunking.js` uses a recursive character splitter. It tries paragraph breaks first, then lines, sentences, words, and finally fixed character slices. Chunks target 1200 characters with 180 characters of overlap so related context is preserved across chunk boundaries.
3. **Embedding**: chunks are embedded with `text-embedding-3-small` by default.
4. **Vector storage**: vectors and metadata are stored in Qdrant. Each upload receives a unique `documentId`, and retrieval filters by that ID.
5. **Retrieval**: `/api/chat` embeds the user question and retrieves the top matching chunks from Qdrant.
6. **Generation**: the chat model receives only the retrieved chunks and is instructed to answer from them. If the answer is absent, it must say it could not find the answer in the uploaded document.

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
- For larger documents, increase `MAX_FILE_BYTES` in the environment.
