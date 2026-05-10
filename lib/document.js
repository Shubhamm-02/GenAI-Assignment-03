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
      text: data.text || ""
    }
  ];
}

function parseText(buffer) {
  return [
    {
      pageNumber: null,
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

function parseCsv(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const rows = parseCsvRows(text);

  if (rows.length === 0) {
    return [
      {
        pageNumber: null,
        text: ""
      }
    ];
  }

  const headers = rows[0].map((header, index) => header || columnLabel(index));
  const hasMultipleRows = rows.length > 1;
  const dataRows = hasMultipleRows ? rows.slice(1) : rows;
  const formattedRows = dataRows.map((cells, rowIndex) => {
    const cellsText = cells
      .map((value, columnIndex) => {
        const header = hasMultipleRows
          ? headers[columnIndex] || columnLabel(columnIndex)
          : columnLabel(columnIndex);

        return `${header} = ${value || "(blank)"}`;
      })
      .join("; ");

    return `Row ${hasMultipleRows ? rowIndex + 2 : rowIndex + 1}: ${cellsText}`;
  });

  return [
    {
      pageNumber: null,
      text: [
        "CSV table converted to row-wise document text.",
        hasMultipleRows ? `Headers: ${headers.join(", ")}` : "",
        ...formattedRows
      ]
        .filter(Boolean)
        .join("\n")
    }
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
    return parseCsv(buffer);
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
