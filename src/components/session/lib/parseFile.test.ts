import { describe, expect, it } from "vitest";

import { ALLOWED_EXTENSIONS, MAX_SIZE_BYTES, extensionOf, validateFile } from "./parseFile";

// Risk #5 (client layer 1) — the type/size gate at file-pick time. These functions
// are pure and import-safe (pdf.js is lazily imported only inside parsePdf, per
// lessons.md), so this test runs in `node` env with no mocks and no jsdom.

/** A File whose reported size is overridden, so we never allocate 20+ MB. */
function fileWithSize(name: string, size: number): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("extensionOf", () => {
  it("lowercases the substring after the last dot", () => {
    expect(extensionOf("a.PDF")).toBe("pdf");
    expect(extensionOf("notes.txt")).toBe("txt");
  });

  it("returns empty string when there is no dot", () => {
    expect(extensionOf("README")).toBe("");
  });

  it("treats a leading-dot dotfile as all-extension", () => {
    // ".gitignore" has its only dot at index 0 -> everything after is the "extension".
    expect(extensionOf(".gitignore")).toBe("gitignore");
  });

  it("uses only the final segment for multi-dot names", () => {
    expect(extensionOf("notes.pdf.exe")).toBe("exe");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
  });
});

describe("validateFile", () => {
  it("rejects an unsupported file type with an explanatory message", () => {
    expect(validateFile(fileWithSize("notes.docx", 1000))).toBe(
      "Unsupported file type. Upload a PDF, .txt, or .md file.",
    );
  });

  it("rejects an oversize file (just over the 20 MB cap)", () => {
    expect(validateFile(fileWithSize("big.pdf", MAX_SIZE_BYTES + 1))).toBe("File exceeds the 20 MB limit.");
  });

  it("accepts each allowed extension within the size cap", () => {
    for (const ext of ALLOWED_EXTENSIONS) {
      expect(validateFile(fileWithSize(`material.${ext}`, 1000))).toBeNull();
    }
  });

  it("accepts a file exactly at the size cap (boundary is inclusive)", () => {
    // The guard is `size > MAX`, so size === MAX must pass.
    expect(validateFile(fileWithSize("edge.pdf", MAX_SIZE_BYTES))).toBeNull();
  });
});
