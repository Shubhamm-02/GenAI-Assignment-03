import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/rag";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { documentId, question } = await request.json();

    if (!documentId || !question?.trim()) {
      return NextResponse.json(
        { error: "A document and question are required." },
        { status: 400 }
      );
    }

    const result = await answerQuestion({
      documentId,
      question: question.trim()
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          error.message ||
          "The question could not be answered from the uploaded document."
      },
      { status: 500 }
    );
  }
}
