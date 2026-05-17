import { DOCUMENT_QUALITY_MIN_CHARS } from "./config";

async function parsePdf(buffer) {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const pages = [];

  const data = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false
      });

      const pageText = textContent.items
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (pageText) {
        pages.push({
          pageNumber: pageData.pageNumber || pages.length + 1,
          sectionType: "pdf-page",
          text: pageText
        });
      }

      return pageText;
    }
  });

  if (pages.length > 0) {
    return pages;
  }

  return [
    {
      pageNumber: null,
      sectionType: "pdf",
      text: data.text || ""
    }
  ];
}

function parseText(buffer) {
  return [
    {
      pageNumber: null,
      sectionType: "text",
      text: buffer.toString("utf8")
    }
  ];
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  function commitCell() {
    row.push(cell.replace(/\s+/g, " ").trim());
    cell = "";
  }

  function commitRow() {
    commitCell();

    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }

    row = [];
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (inQuotes) {
      if (character === '"' && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        cell += character;
      }

      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      commitCell();
    } else if (character === "\n") {
      commitRow();
    } else if (character === "\r") {
      if (nextCharacter === "\n") {
        index += 1;
      }
      commitRow();
    } else {
      cell += character;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    commitRow();
  }

  return rows;
}

function columnLabel(index) {
  let label = "";
  let number = index + 1;

  while (number > 0) {
    const remainder = (number - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    number = Math.floor((number - 1) / 26);
  }

  return `Column ${label}`;
}

function makeUniqueHeaders(headers) {
  const seen = new Map();

  return headers.map((header, index) => {
    const fallback = columnLabel(index);
    const base = (header || fallback).replace(/\s+/g, " ").trim() || fallback;
    const key = base.toLowerCase();
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);

    return count === 1 ? base : `${base} ${count}`;
  });
}

function formatCsvRow(cells, headers, rowNumber) {
  const columnCount = Math.max(headers.length, cells.length);
  const cellsText = Array.from({ length: columnCount }, (_, columnIndex) => {
    const header = headers[columnIndex] || columnLabel(columnIndex);
    return `${header} = ${cells[columnIndex] || "(blank)"}`;
  }).join("; ");

  return `Row ${rowNumber}: ${cellsText}`;
}

function parseCsv(buffer, fileName) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const rows = parseCsvRows(text);

  if (rows.length === 0) {
    return [
      {
        pageNumber: null,
        sectionType: "csv",
        text: ""
      }
    ];
  }

  const hasHeaderRow = rows.length > 1;
  const headers = makeUniqueHeaders(
    hasHeaderRow ? rows[0] : rows[0].map((_, index) => columnLabel(index))
  );
  const dataRows = hasHeaderRow ? rows.slice(1) : rows;
  const firstDataRowNumber = hasHeaderRow ? 2 : 1;
  const hasMultipleRows = rows.length > 1;
  const rowPages = [];
  const rowsPerBlock = 25;

  for (let index = 0; index < dataRows.length; index += rowsPerBlock) {
    const rowBlock = dataRows.slice(index, index + rowsPerBlock);
    const rowStart = firstDataRowNumber + index;
    const rowEnd = rowStart + rowBlock.length - 1;

    rowPages.push({
      pageNumber: null,
      sectionType: "csv-rows",
      rowStart,
      rowEnd,
      text: [
        `CSV rows ${rowStart}-${rowEnd} from ${fileName}.`,
        `Columns: ${headers.join(", ")}`,
        ...rowBlock.map((cells, rowIndex) =>
          formatCsvRow(cells, headers, rowStart + rowIndex)
        )
      ].join("\n")
    });
  }

  return [
    {
      pageNumber: null,
      sectionType: "csv-schema",
      rowStart: null,
      rowEnd: null,
      text: [
        `CSV table: ${fileName}`,
        `Row count: ${dataRows.length}`,
        `Header row present: ${hasMultipleRows ? "yes" : "no"}`,
        `Columns (${headers.length}): ${headers
          .map((header, index) => `${header} (${columnLabel(index)})`)
          .join(", ")}`,
        "For SQL-like questions, treat each data row as one record and use the column labels above."
      ].join("\n")
    },
    ...rowPages
  ];
}

export async function loadDocument({ buffer, fileName, mimeType }) {
  const lowerName = fileName.toLowerCase();

  if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
    return parsePdf(buffer);
  }

  if (
    mimeType === "text/csv" ||
    mimeType === "application/csv" ||
    lowerName.endsWith(".csv")
  ) {
    return parseCsv(buffer, fileName);
  }

  if (
    mimeType?.startsWith("text/") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md")
  ) {
    return parseText(buffer);
  }

  throw new Error(
    "Unsupported file type. Upload a PDF, TXT, Markdown, or CSV file."
  );
}

function ratio(value, total) {
  if (!total) {
    return 0;
  }

  return Number((value / total).toFixed(3));
}

function countMatches(text, expression) {
  return text.match(expression)?.length || 0;
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function assessDocumentQuality(pages) {
  const pageTexts = pages.map((page) => page.text || "");
  const text = pageTexts.join("\n");
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const words =
    normalizedText.match(/[A-Za-z0-9][A-Za-z0-9'._-]*/g)?.filter(Boolean) ||
    [];
  const wordCount = words.length;
  const characterCount = normalizedText.length;
  const nonWhitespaceCount = countMatches(text, /\S/g);
  const alphanumericCount = countMatches(text, /[A-Za-z0-9]/g);
  const replacementCharacterCount = countMatches(text, /\uFFFD/g);
  const repeatedCharacterCount = (text.match(/(.)\1{12,}/g) || []).reduce(
    (total, run) => total + run.length,
    0
  );
  const emptyPageCount = pageTexts.filter(
    (pageText) => pageText.trim().length < 20
  ).length;
  const pageCount = Math.max(pages.length, 1);
  const averageWordLength =
    wordCount === 0
      ? 0
      : Number(
          (
            words.reduce((total, word) => total + word.length, 0) / wordCount
          ).toFixed(1)
        );
  const uniqueWordRatio =
    wordCount === 0
      ? 0
      : ratio(new Set(words.map((word) => word.toLowerCase())).size, wordCount);
  const symbolRatio = ratio(
    Math.max(nonWhitespaceCount - alphanumericCount, 0),
    nonWhitespaceCount
  );
  const repeatedCharacterRatio = ratio(
    repeatedCharacterCount,
    nonWhitespaceCount
  );
  const replacementCharacterRatio = ratio(
    replacementCharacterCount,
    nonWhitespaceCount
  );
  const emptyPageRatio = ratio(emptyPageCount, pageCount);
  const errors = [];
  const warnings = [];

  if (characterCount < DOCUMENT_QUALITY_MIN_CHARS) {
    errors.push(
      `Only ${characterCount} readable characters were extracted; upload a text-based document or use OCR first.`
    );
  }

  if (replacementCharacterRatio > 0.02) {
    errors.push("The extracted text contains too many unreadable characters.");
  } else if (replacementCharacterRatio > 0.005) {
    warnings.push("Some unreadable characters were detected in the extraction.");
  }

  if (repeatedCharacterRatio > 0.18) {
    errors.push("The extracted text appears corrupted by repeated characters.");
  } else if (repeatedCharacterRatio > 0.08) {
    warnings.push("The document has repeated-character noise that may hurt retrieval.");
  }

  if (symbolRatio > 0.55) {
    errors.push("The extracted text is mostly symbols, so indexing may be corrupt.");
  } else if (symbolRatio > 0.4) {
    warnings.push("The document has a high symbol ratio; answers may be less accurate.");
  }

  if (emptyPageRatio > 0.5 && pageCount > 1) {
    warnings.push("More than half of the extracted pages are nearly empty.");
  }

  if (wordCount < 20 && characterCount >= DOCUMENT_QUALITY_MIN_CHARS) {
    warnings.push("Very few words were extracted, so retrieval may be sparse.");
  }

  if (uniqueWordRatio < 0.08 && wordCount > 80) {
    warnings.push("The text is highly repetitive, which can reduce answer quality.");
  }

  const penalty =
    errors.length * 35 +
    warnings.length * 8 +
    symbolRatio * 18 +
    repeatedCharacterRatio * 30 +
    replacementCharacterRatio * 40 +
    emptyPageRatio * 10;

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    metrics: {
      pageCount: pages.length,
      readablePages: pageCount - emptyPageCount,
      characterCount,
      wordCount,
      emptyPageRatio,
      symbolRatio,
      repeatedCharacterRatio,
      replacementCharacterRatio,
      averageWordLength,
      uniqueWordRatio,
      qualityScore: clampScore(100 - penalty)
    }
  };
}
