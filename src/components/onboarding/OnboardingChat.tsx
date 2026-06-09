import { useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";

// A bounded, scripted guided chat: the tutor asks a fixed set of short questions
// one at a time. Once every question is answered, the collected answers are sent
// to /api/onboarding (which distills them into the profile bio). Plain controls +
// fetch only — no browser-only library (lesson-compliant).
const QUESTIONS = [
  "To start — what's your current role, or what are you studying right now?",
  "How much experience do you have with this kind of material so far?",
  "Which topics or domains do you already know well?",
] as const;

const ANSWER_MAX = 1000;

export default function OnboardingChat() {
  const [answers, setAnswers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const index = answers.length; // index of the question currently being asked
  const done = index >= QUESTIONS.length;
  const canSend = draft.trim().length > 0 && !submitting;

  async function finish(allAnswers: string[]) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: allAnswers }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setError("Couldn't save your profile. Please try again.");
      setSubmitting(false);
    }
  }

  function send() {
    const value = draft.trim();
    if (!value) {
      return;
    }
    const next = [...answers, value];
    setAnswers(next);
    setDraft("");
    if (next.length === QUESTIONS.length) {
      void finish(next);
    }
  }

  return (
    <div className="space-y-4">
      {/* Transcript of answered question/answer pairs. */}
      <div className="space-y-3">
        {answers.map((answer, i) => (
          <div key={i} className="space-y-2">
            <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white/10 px-4 py-2 text-sm text-blue-100/90">
              {QUESTIONS[i]}
            </p>
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-gradient-to-r from-blue-500/80 to-purple-500/80 px-4 py-2 text-sm text-white">
              {answer}
            </p>
          </div>
        ))}

        {/* Active (unanswered) question. */}
        {!done && (
          <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white/10 px-4 py-2 text-sm text-blue-100/90">
            {QUESTIONS[index]}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      {/* Input for the active question, or the finishing/retry state. */}
      {!done ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={draft}
            maxLength={ANSWER_MAX}
            rows={2}
            autoFocus
            placeholder="Type your answer…"
            disabled={submitting}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            className="w-full resize-none rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-blue-100/40 focus:border-white/40 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send answer"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Send className="size-4" />
          </button>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-3">
          {submitting ? (
            <p className="flex items-center gap-2 text-sm text-blue-100/80">
              <Loader2 className="size-4 animate-spin" />
              Setting up your tutor…
            </p>
          ) : (
            // Reachable only when the submit failed: let the learner retry without
            // re-answering the questions.
            <button
              type="button"
              onClick={() => void finish(answers)}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90"
            >
              <Sparkles className="size-4" />
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
