export const CHUNKING_STRATEGY = {
  name: "recursive-character-with-overlap",
  chunkSize: 1200,
  overlap: 180,
  separators: ["\n\n", "\n", ". ", " ", ""]
};

function normalizeText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mergeParts(parts, separator, maxChars, separators, nextIndex) {
  const chunks = [];
  let current = "";

  for (const rawPart of parts) {
    const part = rawPart.trim();

    if (!part) {
      continue;
    }

    if (part.length > maxChars) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }

      chunks.push(...splitRecursive(part, maxChars, separators, nextIndex));
      continue;
    }

    const candidate = current ? `${current}${separator}${part}` : part;

    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) {
        chunks.push(current.trim());
      }
      current = part;
    }
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks;
}

function splitRecursive(text, maxChars, separators, index = 0) {
  const cleaned = normalizeText(text);

  if (!cleaned || cleaned.length <= maxChars) {
    return cleaned ? [cleaned] : [];
  }

  const separator = separators[index];

  if (separator === undefined) {
    return cleaned.match(new RegExp(`.{1,${maxChars}}`, "gs")) || [];
  }

  if (separator === "") {
    return cleaned.match(new RegExp(`.{1,${maxChars}}`, "gs")) || [];
  }

  if (!cleaned.includes(separator)) {
    return splitRecursive(cleaned, maxChars, separators, index + 1);
  }

  return mergeParts(
    cleaned.split(separator),
    separator,
    maxChars,
    separators,
    index + 1
  );
}

function withOverlap(chunks, overlap) {
  return chunks.map((chunk, index) => {
    if (index === 0 || overlap <= 0) {
      return chunk;
    }

    const previousTail = chunks[index - 1].slice(-overlap).trim();
    return `${previousTail}\n${chunk}`.trim();
  });
}

export function chunkPages(pages, sourceName, options = CHUNKING_STRATEGY) {
  const chunks = [];

  pages.forEach((page) => {
    const pageChunks = withOverlap(
      splitRecursive(page.text, options.chunkSize, options.separators),
      options.overlap
    );

    pageChunks.forEach((text) => {
      if (text.length < 20) {
        return;
      }

      chunks.push({
        text,
        metadata: {
          sourceName,
          pageNumber: page.pageNumber,
          chunkIndex: chunks.length
        }
      });
    });
  });

  return chunks;
}
