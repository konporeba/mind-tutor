import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import type { SessionListItem } from "@/lib/services/history/sessions";

// Dashboard session history list (S-06) with per-row hard-delete (S-07, FR-016).
//
// Rendered as a client island (not server Astro markup) so a confirmed delete can
// remove its row in place — no page reload. The list state is seeded from the SSR
// read (`listSessions`) and is the single source of truth for what's shown; on a
// successful DELETE /api/sessions/[id] the session is dropped from local state.
//
// The delete is gated behind an explicit, keyboard-accessible confirmation: a
// native <dialog> (showModal) gives focus-trapping, Escape-to-close, and
// role="dialog" for free, with no new dependency. Plain controls + fetch only.

interface Props {
  sessions: SessionListItem[];
}

const BADGE_STYLES: Record<string, string> = {
  completed: "border-green-400/40 bg-green-500/20 text-green-100",
  active: "border-blue-400/40 bg-blue-500/20 text-blue-100",
  abandoned: "border-white/20 bg-white/10 text-blue-100/70",
};

const BADGE_LABELS: Record<string, string> = {
  completed: "Completed",
  active: "In progress",
  abandoned: "Abandoned",
};

function StatusBadge({ status }: { status: string }) {
  const className = BADGE_STYLES[status] ?? BADGE_STYLES.abandoned;
  const label = BADGE_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

const dateFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export default function SessionHistoryList({ sessions: initialSessions }: Props) {
  const [sessions, setSessions] = useState<SessionListItem[]>(initialSessions);
  const [pending, setPending] = useState<SessionListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Drive the native dialog from `pending`: open it when a session is queued for
  // deletion, close it otherwise. The dialog's own `onClose` (Escape / backdrop)
  // clears `pending` so state and DOM stay in sync.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pending && !dialog.open) dialog.showModal();
    if (!pending && dialog.open) dialog.close();
  }, [pending]);

  function requestDelete(session: SessionListItem) {
    setError(null);
    setPending(session);
  }

  function cancel() {
    if (deleting) return;
    setPending(null);
  }

  async function confirmDelete() {
    if (!pending || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${pending.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't delete this session. Please try again.");
        setDeleting(false);
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== pending.id));
      setDeleting(false);
      setPending(null);
    } catch {
      setError("Couldn't delete this session. Please try again.");
      setDeleting(false);
    }
  }

  if (sessions.length === 0) {
    return (
      <div className="space-y-3 py-6 text-center">
        <p className="text-blue-100/80">You haven&apos;t started any sessions yet.</p>
        <a
          href="/sessions/new"
          className="inline-block rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
        >
          Start your first session
        </a>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/15"
          >
            <a href={`/sessions/${s.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-4">
              <span className="min-w-0">
                <span className="block truncate font-medium text-white">{s.title ?? "Untitled session"}</span>
                <span className="text-xs text-blue-100/60">{formatDate(s.created_at)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {s.status === "completed" && s.score !== null && (
                  <span className="text-sm font-semibold text-white">{s.score}%</span>
                )}
                {s.status === "active" && <span className="text-sm text-blue-200">Resume →</span>}
                <StatusBadge status={s.status} />
              </span>
            </a>
            <button
              type="button"
              onClick={() => {
                requestDelete(s);
              }}
              aria-label={`Delete session ${s.title ?? "Untitled session"}`}
              className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-2 text-blue-100/70 transition-colors hover:bg-red-500/20 hover:text-red-100"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        onClose={() => {
          setPending(null);
        }}
        aria-labelledby="delete-session-title"
        className="m-auto max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-6 text-white shadow-2xl backdrop:bg-black/60"
      >
        <h3 id="delete-session-title" className="text-lg font-semibold">
          Delete this session?
        </h3>
        <p className="mt-2 text-sm text-blue-100/80">
          “{pending?.title ?? "Untitled session"}” and all of its data — uploaded file, generated theory and exercises,
          score, and conversation — will be permanently removed. This can&apos;t be undone.
        </p>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={cancel}
            disabled={deleting}
            className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-lg bg-red-500/90 px-4 py-2 text-sm font-medium transition-colors hover:bg-red-500 disabled:opacity-50"
          >
            {deleting && <Loader2 className="size-4 animate-spin" />}
            Delete
          </button>
        </div>
      </dialog>
    </>
  );
}
