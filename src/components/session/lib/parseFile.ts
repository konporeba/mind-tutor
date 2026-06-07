// Client-side file parsing (S-01).
//
// Runs in the browser island so PDF parsing never touches the Worker's 30 s CPU
// limit. PDFs are parsed with pdf.js; .txt/.md are read as raw text (markdown is
// NOT rendered or stripped — the AI sees the raw source, per PRD).

import * as pdfjsLib from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB (NFR)
export const ALLOWED_EXTENSIONS = ["pdf", "txt", "md"] as const;

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/** Validate type + size before any parsing. Returns an error message or null. */
export function validateFile(file: File): string | null {
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name) as (typeof ALLOWED_EXTENSIONS)[number])) {
    return "Unsupported file type. Upload a PDF, .txt, or .md file.";
  }
  if (file.size > MAX_SIZE_BYTES) {
    return "File exceeds the 20 MB limit.";
  }
  return null;
}

async function parsePdf(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item): item is TextItem => "str" in item)
      .map((item) => item.str)
      .join(" ");
    pages.push(text);
  }
  return pages.join("\n\n").trim();
}

/**
 * Extract text from a supported file. Throws if a PDF cannot be parsed
 * (corrupted/encrypted) so the caller can show an explanatory error.
 */
export async function parseFile(file: File): Promise<string> {
  if (extensionOf(file.name) === "pdf") {
    return parsePdf(file);
  }
  return (await file.text()).trim();
}
