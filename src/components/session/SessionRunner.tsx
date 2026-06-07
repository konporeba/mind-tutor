import { useMemo, useState } from "react";
import { BookOpen, Check, Quote, Trophy, X } from "lucide-react";

export interface TheoryStepView {
  position: number;
  heading: string;
  body: string;
  citation: string;
}

export interface ExerciseView {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  learner_answer: string | null;
  is_correct: boolean | null;
  feedback: string | null;
  // Populated only for already-answered exercises (never leaked before answering).
  correct_answer: string | null;
}

interface Result {
  is_correct: boolean;
  feedback: string | null;
  correct_answer: string | null;
  picked: string | null;
}

interface Props {
  sessionId: string;
  title: string | null;
  initialStatus: string;
  initialScore: number | null;
  theory: TheoryStepView[];
  exercises: ExerciseView[];
}

export default function SessionRunner({ sessionId, title, initialStatus, initialScore, theory, exercises }: Props) {
  // Seed results from persisted (already-answered) exercises so a reload restores state.
  const seededResults = useMemo<Map<string, Result>>(() => {
    const seed = new Map<string, Result>();
    for (const ex of exercises) {
      if (ex.is_correct !== null) {
        seed.set(ex.id, {
          is_correct: ex.is_correct,
          feedback: ex.feedback,
          correct_answer: ex.correct_answer,
          picked: ex.learner_answer,
        });
      }
    }
    return seed;
  }, [exercises]);

  const [results, setResults] = useState<Map<string, Result>>(seededResults);
  const firstUnanswered = exercises.findIndex((ex) => !seededResults.has(ex.id));
  const [current, setCurrent] = useState(firstUnanswered === -1 ? exercises.length - 1 : firstUnanswered);
  const [score, setScore] = useState<number | null>(initialScore);
  const [completed, setCompleted] = useState(initialStatus === "completed");
  const [pending, setPending] = useState(false);

  const allAnswered = results.size === exercises.length;

  async function answer(exercise: ExerciseView, option: string) {
    if (pending || results.has(exercise.id)) return;
    setPending(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/exercises/${exercise.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: option }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        is_correct: boolean;
        feedback: string | null;
        correct_answer: string | null;
      };
      setResults((prev) => new Map(prev).set(exercise.id, { ...data, picked: option }));
    } finally {
      setPending(false);
    }
  }

  async function finish() {
    setPending(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/complete`, { method: "POST" });
      if (!res.ok) return;
      const data = (await res.json()) as { score: number };
      setScore(data.score);
      setCompleted(true);
    } finally {
      setPending(false);
    }
  }

  const exercise = exercises[current];
  const currentResult = results.get(exercise.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 text-white">
      <header className="space-y-3">
        <a href="/dashboard" className="text-sm text-blue-100/60 transition-colors hover:text-white">
          ← Dashboard
        </a>
        <h1 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
          {title ?? "Study session"}
        </h1>
        {/* Milestone bar (FR-013): theory steps then exercises, current highlighted. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {theory.map((t) => (
            <span
              key={`t-${t.position}`}
              title={t.heading}
              className="flex size-7 items-center justify-center rounded-full bg-blue-400/40 text-xs"
            >
              <BookOpen className="size-3.5" />
            </span>
          ))}
          {exercises.map((ex, idx) => {
            const result = results.get(ex.id);
            const isCurrent = !completed && idx === current;
            return (
              <span
                key={`e-${ex.id}`}
                title={`Exercise ${idx + 1}`}
                className={
                  "flex size-7 items-center justify-center rounded-full text-xs font-semibold " +
                  (result
                    ? result.is_correct
                      ? "bg-green-500/60"
                      : "bg-red-500/60"
                    : isCurrent
                      ? "bg-white/80 text-slate-900 ring-2 ring-white"
                      : "bg-white/15")
                }
              >
                {idx + 1}
              </span>
            );
          })}
        </div>
      </header>

      {completed && (
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl">
          <Trophy className="size-8 text-yellow-300" />
          <div>
            <p className="text-lg font-semibold">Session complete</p>
            <p className="text-blue-100/80">
              Your score: <span className="font-bold text-white">{score}%</span>
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Theory panel */}
        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
          <h2 className="text-sm font-semibold tracking-wide text-blue-100/60 uppercase">Theory</h2>
          {theory.map((step) => (
            <article key={step.position} className="space-y-2">
              <h3 className="font-semibold text-white">{step.heading}</h3>
              <p className="text-sm leading-relaxed text-blue-100/90">{step.body}</p>
              <blockquote className="flex gap-2 rounded-lg border-l-2 border-blue-300/50 bg-white/5 px-3 py-2 text-xs text-blue-100/70 italic">
                <Quote className="size-3.5 shrink-0" />
                <span>{step.citation}</span>
              </blockquote>
            </article>
          ))}
        </section>

        {/* Exercise panel */}
        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
          <h2 className="text-sm font-semibold tracking-wide text-blue-100/60 uppercase">
            Exercise {current + 1} of {exercises.length}
          </h2>
          <div className="space-y-4">
            <p className="font-medium text-white">{exercise.prompt}</p>
            <div className="space-y-2">
              {exercise.options.map((option) => {
                const isCorrectOption = currentResult?.correct_answer === option;
                const wasPicked = currentResult?.picked === option;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={!!currentResult || pending}
                    onClick={() => answer(exercise, option)}
                    className={
                      "w-full rounded-lg border px-4 py-2.5 text-left text-sm transition-colors " +
                      (currentResult
                        ? isCorrectOption
                          ? "border-green-400/60 bg-green-500/20"
                          : wasPicked
                            ? "border-red-400/60 bg-red-500/20"
                            : "border-white/10 bg-white/5 opacity-60"
                        : "border-white/15 bg-white/5 hover:bg-white/15")
                    }
                  >
                    {option}
                  </button>
                );
              })}
            </div>

            {currentResult && (
              <div
                className={
                  "space-y-1 rounded-lg p-3 text-sm " + (currentResult.is_correct ? "bg-green-500/20" : "bg-red-500/20")
                }
              >
                <p className="flex items-center gap-1.5 font-semibold">
                  {currentResult.is_correct ? (
                    <>
                      <Check className="size-4" /> Correct
                    </>
                  ) : (
                    <>
                      <X className="size-4" /> Not quite
                    </>
                  )}
                </p>
                {currentResult.feedback && <p className="text-blue-100/90">{currentResult.feedback}</p>}
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <button
                type="button"
                disabled={current === 0}
                onClick={() => {
                  setCurrent((c) => Math.max(0, c - 1));
                }}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm transition-colors hover:bg-white/10 disabled:opacity-40"
              >
                Previous
              </button>
              {current < exercises.length - 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setCurrent((c) => Math.min(exercises.length - 1, c + 1));
                  }}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm transition-colors hover:bg-white/10"
                >
                  Next
                </button>
              ) : (
                !completed && (
                  <button
                    type="button"
                    disabled={!allAnswered || pending}
                    onClick={finish}
                    className="rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Finish session
                  </button>
                )
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
