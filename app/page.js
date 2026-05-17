"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  GitBranch,
  Loader2,
  MessageSquareText,
  Search,
  Send,
  ShieldCheck,
  UploadCloud
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

const starterMessages = [
  {
    role: "assistant",
    content: "Upload a document, then ask a question grounded in its content.",
    sources: []
  }
];

function formatScore(score) {
  if (typeof score !== "number") {
    return "n/a";
  }

  return `${Math.round(score * 100)}%`;
}

function sourceLocation(source) {
  if (source.sectionType === "csv-schema") {
    return "CSV schema";
  }

  if (source.sectionType === "csv-rows" && source.rowStart && source.rowEnd) {
    return `Rows ${source.rowStart}-${source.rowEnd}`;
  }

  if (source.pageNumber) {
    return `Page ${source.pageNumber}`;
  }

  return "Text";
}

export default function Home() {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [documentInfo, setDocumentInfo] = useState(null);
  const [messages, setMessages] = useState(starterMessages);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isAsking, setIsAsking] = useState(false);

  const canAsk = useMemo(
    () => Boolean(documentInfo?.documentId && question.trim() && !isAsking),
    [documentInfo, isAsking, question]
  );

  function onFileSelect(selectedFile) {
    setFile(selectedFile);
    setDocumentInfo(null);
    setMessages(starterMessages);
    setStatus("");
    setError("");
  }

  async function uploadDocument(event) {
    event.preventDefault();

    if (!file) {
      setError("Choose a document first.");
      return;
    }

    setIsUploading(true);
    setError("");
    setStatus("Indexing document");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed.");
      }

      setDocumentInfo(data);
      setStatus(data.quality?.warnings?.length ? "Ready with warnings" : "Ready");
      setMessages([
        {
          role: "assistant",
          content: `${data.fileName} is indexed into ${data.chunkCount} chunks with a quality score of ${data.quality?.metrics?.qualityScore ?? "n/a"}.`,
          sources: [],
          pipeline: null
        }
      ]);
    } catch (uploadError) {
      setStatus("");
      setError(uploadError.message);
    } finally {
      setIsUploading(false);
    }
  }

  async function askQuestion(event) {
    event.preventDefault();

    if (!canAsk) {
      return;
    }

    const nextQuestion = question.trim();
    setQuestion("");
    setIsAsking(true);
    setError("");
    setMessages((current) => [
      ...current,
      { role: "user", content: nextQuestion, sources: [] }
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          documentId: documentInfo.documentId,
          question: nextQuestion
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Question failed.");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.answer,
          sources: data.sources || [],
          pipeline: data.pipeline || null
        }
      ]);
    } catch (questionError) {
      setError(questionError.message);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: "I could not answer that from the indexed document.",
          sources: []
        }
      ]);
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="sidebar" aria-label="Document controls">
        <div className="brand-row">
          <div className="brand-mark">
            <MessageSquareText aria-hidden="true" size={22} />
          </div>
          <div>
            <h1>Notebook RAG</h1>
            <p>Document-grounded assistant</p>
          </div>
        </div>

        <form className="upload-panel" onSubmit={uploadDocument}>
          <button
            className="drop-zone"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const droppedFile = event.dataTransfer.files?.[0];
              if (droppedFile) {
                onFileSelect(droppedFile);
              }
            }}
          >
            <UploadCloud aria-hidden="true" size={30} />
            <span>{file ? file.name : "PDF, TXT, Markdown, or CSV"}</span>
          </button>

          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".pdf,.txt,.md,.csv,application/pdf,text/plain,text/markdown,text/csv"
            onChange={(event) => {
              const selectedFile = event.target.files?.[0];
              if (selectedFile) {
                onFileSelect(selectedFile);
              }
            }}
          />

          <button className="primary-button" type="submit" disabled={isUploading}>
            {isUploading ? (
              <Loader2 className="spin" aria-hidden="true" size={18} />
            ) : (
              <Database aria-hidden="true" size={18} />
            )}
            Index document
          </button>
        </form>

        {status && (
          <div className="status-line">
            <CheckCircle2 aria-hidden="true" size={17} />
            <span>{status}</span>
          </div>
        )}

        {error && (
          <div className="error-line">
            <AlertTriangle aria-hidden="true" size={17} />
            <span>{error}</span>
          </div>
        )}

        <div className="document-panel">
          <div className="panel-title">
            <FileText aria-hidden="true" size={18} />
            <span>Document</span>
          </div>
          {documentInfo ? (
            <dl className="metrics">
              <div>
                <dt>File</dt>
                <dd>{documentInfo.fileName}</dd>
              </div>
              <div>
                <dt>Pages</dt>
                <dd>{documentInfo.pageCount}</dd>
              </div>
              <div>
                <dt>Chunks</dt>
                <dd>{documentInfo.chunkCount}</dd>
              </div>
              <div>
                <dt>Quality</dt>
                <dd>{documentInfo.quality?.metrics?.qualityScore ?? "n/a"}</dd>
              </div>
              <div>
                <dt>Strategy</dt>
                <dd>{documentInfo.chunking?.name}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted-text">No document indexed</p>
          )}
        </div>

        {documentInfo?.quality && (
          <div className="quality-panel">
            <div className="panel-title">
              <Gauge aria-hidden="true" size={18} />
              <span>Quality gate</span>
            </div>
            <dl className="metrics compact">
              <div>
                <dt>Words</dt>
                <dd>{documentInfo.quality.metrics.wordCount}</dd>
              </div>
              <div>
                <dt>Readable pages</dt>
                <dd>{documentInfo.quality.metrics.readablePages}</dd>
              </div>
            </dl>
            {documentInfo.quality.warnings.length > 0 ? (
              <ul className="warning-list">
                {documentInfo.quality.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="muted-text">Passed without warnings</p>
            )}
          </div>
        )}
      </section>

      <section className="chat-panel" aria-label="Document chat">
        <div className="chat-header">
          <div>
            <p className="eyebrow">Ask the document</p>
            <h2>{documentInfo?.fileName || "Waiting for a document"}</h2>
          </div>
          <div className="retrieval-chip">
            <GitBranch aria-hidden="true" size={15} />
            Advanced RAG
          </div>
        </div>

        <div className="message-list" aria-live="polite">
          {messages.map((message, index) => (
            <article
              className={`message ${message.role}`}
              key={`${message.role}-${index}`}
            >
              <p>{message.content}</p>
              {message.pipeline && (
                <div className="pipeline-trace">
                  <div className="trace-row">
                    <Search aria-hidden="true" size={15} />
                    <span>Rewrite</span>
                    <strong>
                      {message.pipeline.queryTranslation.rewrittenQuestion}
                    </strong>
                  </div>
                  <div className="trace-row">
                    <ShieldCheck aria-hidden="true" size={15} />
                    <span>Judge</span>
                    <strong>
                      {message.pipeline.judge.sufficient
                        ? "Sufficient"
                        : "Needs caution"}
                    </strong>
                  </div>
                  <div className="trace-meta">
                    <span>
                      {message.pipeline.retrieval.candidateCount} candidates
                    </span>
                    <span>
                      {message.pipeline.retrieval.selectedCount} selected
                    </span>
                    <span>
                      {message.pipeline.retrieval.embeddingCache.hits} cache hits
                    </span>
                  </div>
                  {message.pipeline.queryTranslation.typoFixes.length > 0 && (
                    <div className="fix-list">
                      {message.pipeline.queryTranslation.typoFixes.map((fix) => (
                        <span key={`${fix.from}-${fix.to}`}>
                          {fix.from} -&gt; {fix.to}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {message.sources.length > 0 && (
                <div className="sources">
                  {message.sources.map((source) => (
                    <details key={`${source.id}-${source.score}`}>
                      <summary>
                        [{source.id}] {sourceLocation(source)} ·{" "}
                        {formatScore(source.judgeScore ?? source.score)}
                      </summary>
                      {source.judgeReason && (
                        <p className="judge-note">{source.judgeReason}</p>
                      )}
                      <p>{source.text}</p>
                    </details>
                  ))}
                </div>
              )}
            </article>
          ))}
          {isAsking && (
            <article className="message assistant">
              <p className="thinking">
                <Loader2 className="spin" aria-hidden="true" size={16} />
                Retrieving context
              </p>
            </article>
          )}
        </div>

        <form className="composer" onSubmit={askQuestion}>
          <input
            type="text"
            value={question}
            disabled={!documentInfo || isAsking}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={
              documentInfo
                ? "Ask a question about the uploaded document"
                : "Index a document first"
            }
          />
          <button className="send-button" type="submit" disabled={!canAsk}>
            {isAsking ? (
              <Loader2 className="spin" aria-hidden="true" size={18} />
            ) : (
              <Send aria-hidden="true" size={18} />
            )}
            Send
          </button>
        </form>
      </section>
    </main>
  );
}
