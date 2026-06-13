import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Risk #5 (server layer) — the load-bearing trust boundary. POST /api/sessions
// re-validates the upload in four guard clauses that all return 400 BEFORE the first
// DB read and before generateSession. The strongest assertion is: bad input -> 400 +
// the right message AND generateSession is never called (the "before generation runs"
// ordering invariant). This needs no real Supabase and no real OpenRouter:
//   - createClient is mocked to a dummy non-null (clears the `if (!supabase)` 500 guard);
//   - generateSession is a spy we assert was never reached.
// The .docx / oversize inputs mirror parseFile.test.ts so the duplicated MAX_SIZE_BYTES /
// ALLOWED_EXTENSIONS constants in the two modules cannot drift apart silently.

const { generateSessionSpy } = vi.hoisted(() => ({ generateSessionSpy: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  // Dummy non-null client; the four bad-input guards return before it is ever used.
  createClient: () => ({}) as unknown,
}));
vi.mock("@/lib/services/generation/generate", () => ({
  generateSession: generateSessionSpy,
}));

import { POST } from "./index";

const MAX_SIZE_BYTES = 20 * 1024 * 1024;

/** A File whose reported size is overridden, so we never allocate 20+ MB. */
function fileWithSize(name: string, size: number): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/**
 * Fake an APIContext whose request.formData() yields the given FormData directly
 * (no multipart round-trip — so an overridden File.size survives). createClient is
 * mocked, so request.headers / cookies are passed but never read.
 */
function contextFor(form: FormData): APIContext {
  return {
    locals: { user: { id: "test-user" } },
    cookies: {} as never,
    request: {
      headers: new Headers(),
      formData: () => Promise.resolve(form),
    },
  } as unknown as APIContext;
}

/** Otherwise-valid intake so each case fails only on the upload guard under test. */
function withIntake(form: FormData): FormData {
  form.set("knowledgeLevel", "intermediate");
  form.set("learningGoal", "learn the basics");
  form.set("timeBudgetMinutes", "30");
  return form;
}

describe("POST /api/sessions — bad-input guards (Risk #5)", () => {
  beforeEach(() => {
    generateSessionSpy.mockReset();
  });

  it("returns 400 when no file is provided", async () => {
    const form = withIntake(new FormData());
    form.set("extractedText", "some extracted text");
    // No `file` entry at all.

    const res = await POST(contextFor(form));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("No file provided");
    expect(generateSessionSpy).not.toHaveBeenCalled();
  });

  it("returns 400 when extracted text is empty (the must-challenge case)", async () => {
    const form = withIntake(new FormData());
    form.set("file", fileWithSize("notes.txt", 1000));
    form.set("extractedText", "   "); // whitespace-only -> .trim() is empty

    const res = await POST(contextFor(form));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Could not read any text from the file");
    expect(generateSessionSpy).not.toHaveBeenCalled();
  });

  it("returns 400 for an unsupported file type", async () => {
    const form = withIntake(new FormData());
    form.set("file", fileWithSize("notes.docx", 1000));
    form.set("extractedText", "some extracted text");

    const res = await POST(contextFor(form));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Unsupported file type. Upload a PDF, .txt, or .md file.",
    );
    expect(generateSessionSpy).not.toHaveBeenCalled();
  });

  it("returns 400 for an oversize file (just over the 20 MB cap)", async () => {
    const form = withIntake(new FormData());
    form.set("file", fileWithSize("big.pdf", MAX_SIZE_BYTES + 1));
    form.set("extractedText", "some extracted text");

    const res = await POST(contextFor(form));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("File exceeds the 20 MB limit.");
    expect(generateSessionSpy).not.toHaveBeenCalled();
  });
});
