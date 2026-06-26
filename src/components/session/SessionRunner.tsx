import { useMemo, useState } from "react";
import { BookOpen, Check, Quote, Trophy, X } from "lucide-react";
import AskTutorPanel, { type ChatTurn } from "./AskTutorPanel";

export interface TheoryStepView {
  position: number;
  heading: string;
  body: string;
  citation: string;
}

interface ExerciseBase {
  id: string;
  position: number;
  prompt: string;
  is_correct: boolean | null;
  feedback: string | null;
}

export interface McqExerciseView extends ExerciseBase {
  kind: "mcq";
  options: string[];
  learner_answer: string | null;
  // Populated only for already-answered exercises (never leaked before answering).
  correct_answer: string | null;
}

export interface FillBlankExerciseView extends ExerciseBase {
  kind: "fill_blank";
  learner_answer: string | null;
  correct_answer: { answer: string; acceptable?: string[] } | null;
}

export interface MatchingExerciseView extends ExerciseBase {
  kind: "matching";
  left: string[];
  right: string[];
  learner_answer: Record<string, string> | null;
  correct_answer: { pairs: { left: string; right: string }[] } | null;
}

export type ExerciseView = McqExerciseView | FillBlankExerciseView | MatchingExerciseView;

interface Result {
  is_correct: boolean;
  feedback: string | null;
  /** Persisted truth, shape varies by kind; only present once answered. */
  correct_answer: unknown;
  /** The learner's submitted answer (string or left→right mapping). */
  picked: unknown;
}

interface Props {
  sessionId: string;
  title: string | null;
  initialStatus: string;
  initialScore: number | null;
  theory: TheoryStepView[];
  exercises: ExerciseView[];
  initialTurns: ChatTurn[];
}

// --- reveal helpers (interpret the per-kind correct_answer payload) ----------

function fillAnswerText(correctAnswer: unknown): string | null {
  if (correctAnswer && typeof correctAnswer === "object" && "answer" in correctAnswer) {
    const answer = (correctAnswer as { answer?: unknown }).answer;
    return typeof answer === "string" ? answer : null;
  }
  return null;
}

function matchingTruth(correctAnswer: unknown): Record<string, string> | null {
  if (!correctAnswer || typeof correctAnswer !== "object" || !("pairs" in correctAnswer)) return null;
  const pairs = (correctAnswer as { pairs?: unknown }).pairs;
  if (!Array.isArray(pairs)) return null;
  const map: Record<string, string> = {};
  for (const pair of pairs) {
    if (pair && typeof pair === "object") {
      const { left, right } = pair as { left?: unknown; right?: unknown };
      if (typeof left === "string" && typeof right === "string") map[left] = right;
    }
  }
  return map;
}

/** The learner's submitted answer as a string (mcq/fill_blank), or "" if absent. */
function pickedString(result: Result | undefined): string {
  return result && typeof result.picked === "string" ? result.picked : "";
}

/** The learner's submitted matching as a left→right map, or {} if absent. */
function pickedMap(result: Result | undefined): Record<string, string> {
  return result?.picked && typeof result.picked === "object" ? (result.picked as Record<string, string>) : {};
}

// --- per-kind question renderers ---------------------------------------------

const optionButtonBase = "w-full rounded-lg border px-4 py-2.5 text-left text-sm transition-colors ";

function McqQuestion({
  exercise,
  result,
  pending,
  onAnswer,
}: {
  exercise: McqExerciseView;
  result: Result | undefined;
  pending: boolean;
  onAnswer: (option: string) => void;
}) {
  return (
    <div className="space-y-2">
      {exercise.options.map((option) => {
        const isCorrectOption = result?.correct_answer === option;
        const wasPicked = result?.picked === option;
        return (
          <button
            key={option}
            type="button"
            disabled={!!result || pending}
            onClick={() => {
              onAnswer(option);
            }}
            className={
              optionButtonBase +
              (result
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
  );
}

function FillBlankQuestion({
  result,
  pending,
  draft,
  onDraft,
  onSubmit,
}: {
  result: Result | undefined;
  pending: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  const answered = !!result;
  const correctText = fillAnswerText(result?.correct_answer);
  const value = answered ? pickedString(result) : draft;
  return (
    <div className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-sm text-blue-100/70">Your answer</span>
        <input
          type="text"
          value={value}
          disabled={answered || pending}
          placeholder="Type your answer"
          onChange={(e) => {
            onDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim() && !answered) onSubmit();
          }}
          className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-blue-100/40 focus:border-blue-300/60 focus:outline-none disabled:opacity-70"
        />
      </label>
      {!answered && (
        <button
          type="button"
          disabled={!draft.trim() || pending}
          onClick={onSubmit}
          className="rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Submit answer
        </button>
      )}
      {result && !result.is_correct && correctText && (
        <p className="text-sm text-blue-100/90">
          Correct answer: <span className="font-semibold text-white">{correctText}</span>
        </p>
      )}
    </div>
  );
}

function MatchingQuestion({
  exercise,
  result,
  pending,
  draft,
  onDraft,
  onSubmit,
}: {
  exercise: MatchingExerciseView;
  result: Result | undefined;
  pending: boolean;
  draft: Record<string, string>;
  onDraft: (leftItem: string, right: string) => void;
  onSubmit: () => void;
}) {
  const answered = !!result;
  const selection = answered ? pickedMap(result) : draft;
  const truth = matchingTruth(result?.correct_answer);
  const allSelected = exercise.left.every((leftItem) => selection[leftItem]);
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {exercise.left.map((leftItem) => {
          const picked = selection[leftItem] ?? "";
          const isRight = answered && truth ? picked === truth[leftItem] : undefined;
          return (
            <li key={leftItem} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-white">{leftItem}</span>
              <select
                aria-label={`Match for ${leftItem}`}
                value={picked}
                disabled={answered || pending}
                onChange={(e) => {
                  onDraft(leftItem, e.target.value);
                }}
                className={
                  "flex-1 rounded-lg border bg-white/5 px-3 py-2 text-sm text-white focus:outline-none disabled:opacity-80 " +
                  (answered
                    ? isRight
                      ? "border-green-400/60 bg-green-500/20"
                      : "border-red-400/60 bg-red-500/20"
                    : "border-white/15 focus:border-blue-300/60")
                }
              >
                <option value="" disabled>
                  Choose…
                </option>
                {exercise.right.map((rightItem) => (
                  <option key={rightItem} value={rightItem} className="text-slate-900">
                    {rightItem}
                  </option>
                ))}
              </select>
              {answered &&
                (isRight ? <Check className="size-4 text-green-300" /> : <X className="size-4 text-red-300" />)}
            </li>
          );
        })}
      </ul>
      {!answered && (
        <button
          type="button"
          disabled={!allSelected || pending}
          onClick={onSubmit}
          className="rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Submit matches
        </button>
      )}
      {result && !result.is_correct && truth && (
        <p className="text-sm text-blue-100/90">
          Correct matches:{" "}
          <span className="font-semibold text-white">
            {exercise.left.map((leftItem) => `${leftItem} → ${truth[leftItem]}`).join("; ")}
          </span>
        </p>
      )}
    </div>
  );
}

export default function SessionRunner({
  sessionId,
  title,
  initialStatus,
  initialScore,
  theory,
  exercises,
  initialTurns,
}: Props) {
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
  // In-progress answers for the typed (fill_blank) / selected (matching) inputs.
  const [drafts, setDrafts] = useState<Map<string, string | Record<string, string>>>(new Map());
  const firstUnanswered = exercises.findIndex((ex) => !seededResults.has(ex.id));
  const [current, setCurrent] = useState(firstUnanswered === -1 ? exercises.length - 1 : firstUnanswered);
  const [score, setScore] = useState<number | null>(initialScore);
  const [completed, setCompleted] = useState(initialStatus === "completed");
  const [pending, setPending] = useState(false);

  const allAnswered = results.size === exercises.length;

  async function submit(exercise: ExerciseView, payload: string | Record<string, string>) {
    if (pending || results.has(exercise.id)) return;
    setPending(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/exercises/${exercise.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: payload }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { is_correct: boolean; feedback: string | null; correct_answer: unknown };
      setResults((prev) => new Map(prev).set(exercise.id, { ...data, picked: payload }));
    } finally {
      setPending(false);
    }
  }

  function setFillDraft(id: string, value: string) {
    setDrafts((prev) => new Map(prev).set(id, value));
  }

  function setMatchDraft(id: string, leftItem: string, right: string) {
    setDrafts((prev) => {
      const next = new Map(prev);
      const cur = (next.get(id) as Record<string, string> | undefined) ?? {};
      next.set(id, { ...cur, [leftItem]: right });
      return next;
    });
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

            {exercise.kind === "mcq" && (
              <McqQuestion
                exercise={exercise}
                result={currentResult}
                pending={pending}
                onAnswer={(option) => submit(exercise, option)}
              />
            )}
            {exercise.kind === "fill_blank" && (
              <FillBlankQuestion
                result={currentResult}
                pending={pending}
                draft={(drafts.get(exercise.id) as string | undefined) ?? ""}
                onDraft={(value) => {
                  setFillDraft(exercise.id, value);
                }}
                onSubmit={() => submit(exercise, (drafts.get(exercise.id) as string | undefined) ?? "")}
              />
            )}
            {exercise.kind === "matching" && (
              <MatchingQuestion
                exercise={exercise}
                result={currentResult}
                pending={pending}
                draft={(drafts.get(exercise.id) as Record<string, string> | undefined) ?? {}}
                onDraft={(leftItem, right) => {
                  setMatchDraft(exercise.id, leftItem, right);
                }}
                onSubmit={() => submit(exercise, (drafts.get(exercise.id) as Record<string, string> | undefined) ?? {})}
              />
            )}

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

      {/* Ask-the-tutor (S-05): live during an in-progress session (theory + exercises).
          A session loaded as completed is read-only history — S-06 renders the transcript
          via ConversationLog instead, so the interactive panel is suppressed here. */}
      {initialStatus !== "completed" && <AskTutorPanel sessionId={sessionId} initialTurns={initialTurns} />}
    </div>
  );
}
