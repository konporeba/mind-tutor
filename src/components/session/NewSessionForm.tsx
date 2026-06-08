import { useRef, useState } from "react";
import { FileUp, Loader2, Sparkles } from "lucide-react";
import { parseFile, validateFile, ALLOWED_EXTENSIONS } from "@/components/session/lib/parseFile";
import { cn } from "@/lib/utils";
import { KNOWLEDGE_LEVELS, LEARNING_GOAL_MAX, TIME_BUDGETS, type KnowledgeLevel, type TimeBudget } from "@/types";

type Status = "idle" | "reading" | "generating" | "error";

const STEP_LABEL: Record<Exclude<Status, "idle" | "error">, string> = {
  reading: "Reading your file…",
  generating: "Generating your session…",
};

export default function NewSessionForm() {
  const [file, setFile] = useState<File | null>(null);
  const [knowledgeLevel, setKnowledgeLevel] = useState<KnowledgeLevel | "">("");
  const [learningGoal, setLearningGoal] = useState("");
  const [timeBudget, setTimeBudget] = useState<TimeBudget | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = status === "reading" || status === "generating";
  const canSubmit = Boolean(file) && Boolean(knowledgeLevel) && learningGoal.trim().length > 0 && timeBudget !== null;

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
    if (!knowledgeLevel || !learningGoal.trim() || timeBudget === null) {
      setError("Tell us your level, goal, and available time to begin.");
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
      body.append("knowledgeLevel", knowledgeLevel);
      body.append("learningGoal", learningGoal.trim());
      body.append("timeBudgetMinutes", String(timeBudget));

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

      <fieldset disabled={busy} className="space-y-2">
        <legend className="text-sm font-medium text-white">How well do you know this material?</legend>
        <div className="flex flex-wrap gap-2">
          {KNOWLEDGE_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={knowledgeLevel === level}
              onClick={() => {
                setKnowledgeLevel(level);
              }}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors",
                knowledgeLevel === level
                  ? "border-transparent bg-gradient-to-r from-blue-500 to-purple-500 text-white"
                  : "border-white/20 bg-white/5 text-blue-100/80 hover:bg-white/10",
              )}
            >
              {level}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <label htmlFor="learning-goal" className="text-sm font-medium text-white">
          What do you want to get out of this session?
        </label>
        <textarea
          id="learning-goal"
          value={learningGoal}
          maxLength={LEARNING_GOAL_MAX}
          disabled={busy}
          rows={2}
          placeholder="e.g. Understand the core idea well enough to explain it to someone else"
          onChange={(e) => {
            setLearningGoal(e.target.value);
          }}
          className="w-full resize-none rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-blue-100/40 focus:border-white/40 focus:outline-none disabled:opacity-50"
        />
        <p className="text-right text-xs text-blue-100/50">
          {learningGoal.length}/{LEARNING_GOAL_MAX}
        </p>
      </div>

      <fieldset disabled={busy} className="space-y-2">
        <legend className="text-sm font-medium text-white">How much time do you have?</legend>
        <div className="flex gap-2">
          {TIME_BUDGETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={timeBudget === minutes}
              onClick={() => {
                setTimeBudget(minutes);
              }}
              className={cn(
                "flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                timeBudget === minutes
                  ? "border-transparent bg-gradient-to-r from-blue-500 to-purple-500 text-white"
                  : "border-white/20 bg-white/5 text-blue-100/80 hover:bg-white/10",
              )}
            >
              ~{minutes} min
            </button>
          ))}
        </div>
      </fieldset>

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
        disabled={busy || !canSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Sparkles className="size-4" />
        {busy ? "Working…" : "Start session"}
      </button>
    </form>
  );
}
