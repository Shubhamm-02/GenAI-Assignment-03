import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { CHUNKING_STRATEGY, chunkPages } from "@/lib/chunking";
import { MAX_FILE_BYTES } from "@/lib/config";
import { loadDocument } from "@/lib/document";
import { embedTexts } from "@/lib/openai";
import { ensureCollection, upsertChunks } from "@/lib/qdrant";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "Upload a PDF, TXT, Markdown, or CSV file." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "File is too large for this demo." },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const pages = await loadDocument({
      buffer,
      fileName: file.name,
      mimeType: file.type
    });

    const chunks = chunkPages(pages, file.name);

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: "No readable text was found in the uploaded document." },
        { status: 422 }
      );
    }

    await ensureCollection();

    const documentId = randomUUID();
    const vectors = await embedTexts(chunks.map((chunk) => chunk.text));

    await upsertChunks({
      documentId,
      chunks,
      vectors
    });

    return NextResponse.json({
      documentId,
      fileName: file.name,
      pageCount: pages.length,
      chunkCount: chunks.length,
      chunking: CHUNKING_STRATEGY
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          error.message ||
          "The document could not be processed. Check your environment keys."
      },
      { status: 500 }
    );
  }
}
