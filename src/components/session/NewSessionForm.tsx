import { useRef, useState } from "react";
import { FileUp, Loader2, Sparkles } from "lucide-react";
import { parseFile, validateFile, ALLOWED_EXTENSIONS } from "@/components/session/lib/parseFile";

type Status = "idle" | "reading" | "generating" | "error";

const STEP_LABEL: Record<Exclude<Status, "idle" | "error">, string> = {
  reading: "Reading your file…",
  generating: "Generating your session…",
};

export default function NewSessionForm() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = status === "reading" || status === "generating";

  function pickFile(next: File | null) {
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    const validationError = validateFile(next);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function submit() {
    if (!file) {
      setError("Choose a file to begin.");
      return;
    }

    try {
      setStatus("reading");
      const extractedText = await parseFile(file);
      if (!extractedText.trim()) {
        setStatus("error");
        setError("Couldn't read any text from this file. Try another file.");
        return;
      }

      setStatus("generating");
      const body = new FormData();
      body.append("file", file);
      body.append("extractedText", extractedText);

      const res = await fetch("/api/sessions", { method: "POST", body });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus("error");
        setError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }

      const data = (await res.json()) as { id: string };
      window.location.href = `/sessions/${data.id}`;
    } catch {
      setStatus("error");
      setError("Couldn't read this file. It may be corrupted or password-protected.");
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-6"
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-white/20 bg-white/5 p-8 text-blue-100/80 transition-colors hover:bg-white/10 disabled:opacity-50"
      >
        <FileUp className="size-8" />
        <span className="font-medium text-white">{file ? file.name : "Choose a file"}</span>
        <span className="text-xs text-blue-100/50">PDF, .txt, or .md · up to 20 MB</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")}
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          pickFile(e.target.files?.[0] ?? null);
        }}
      />

      {error && (
        <p role="alert" className="rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      {busy && (
        <p className="flex items-center justify-center gap-2 text-sm text-blue-100/80">
          <Loader2 className="size-4 animate-spin" />
          {STEP_LABEL[status]}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !file}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Sparkles className="size-4" />
        {busy ? "Working…" : "Start session"}
      </button>
    </form>
  );
}
