import { useRef, useState } from "react";
import { Loader2, MessageCircleQuestion, Send } from "lucide-react";

// In-session "ask the tutor" chat (S-05, FR-008). The learner asks free-form
// questions about their uploaded material; answers stream in token-by-token and stay
// grounded in the source. Each turn is persisted server-side (see api/sessions/[id]/ask),
// so `initialTurns` rehydrates the transcript on reload — including an unanswered
// question (a user turn with no following assistant turn) from an interrupted stream.
//
// Plain controls + fetch + the browser-native stream reader only — no browser-only
// library enters the SSR module graph (lesson-compliant).

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  sessionId: string;
  initialTurns: ChatTurn[];
}

const QUESTION_MAX = 1000;

export default function AskTutorPanel({ sessionId, initialTurns }: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>(initialTurns);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const canSend = draft.trim().length > 0 && !streaming;

  async function send() {
    const question = draft.trim();
    if (!question || streaming) return;

    setDraft("");
    setError(null);
    setTurns((prev) => [...prev, { role: "user", content: question }]);
    setStreaming(true);

    let assistant = "";
    let hasAssistantTurn = false;
    // Append the assistant turn on the first delta, then replace it in place as more
    // arrive. Reading the flag inside the updater keeps its boolean type (a linear read
    // would narrow to the closure-only-mutated `false`).
    const renderAssistant = () => {
      setTurns((prev) => {
        const next = [...prev];
        if (hasAssistantTurn) next[next.length - 1] = { role: "assistant", content: assistant };
        else next.push({ role: "assistant", content: assistant });
        return next;
      });
      hasAssistantTurn = true;
    };

    try {
      const res = await fetch(`/api/sessions/${sessionId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Couldn't get an answer. Please try again.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; keep the trailing partial.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          let payload: unknown;
          try {
            payload = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (payload === "[DONE]") continue;
          if (typeof payload === "string") {
            assistant += payload;
            renderAssistant();
          } else if (payload && typeof payload === "object" && "warning" in payload) {
            // Answer streamed but failed to persist — show it, but flag that it won't survive reload.
            setError((payload as { warning?: string }).warning ?? "This answer may not have been saved.");
          } else if (payload && typeof payload === "object" && "error" in payload) {
            setError((payload as { error?: string }).error ?? "The tutor couldn't answer that.");
          }
        }
      }
    } catch {
      setError("Connection lost. Please try again.");
    } finally {
      setStreaming(false);
      transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-blue-100/60 uppercase">
        <MessageCircleQuestion className="size-4" />
        Ask the tutor
      </h2>

      <div ref={transcriptRef} role="log" aria-live="polite" className="max-h-80 space-y-3 overflow-y-auto">
        {turns.length === 0 && (
          <p className="text-sm text-blue-100/60">
            Ask anything about your uploaded material — answers stay grounded in your source.
          </p>
        )}
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <p
              key={i}
              className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-gradient-to-r from-blue-500/80 to-purple-500/80 px-4 py-2 text-sm whitespace-pre-wrap text-white"
            >
              {turn.content}
            </p>
          ) : (
            <p
              key={i}
              className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white/10 px-4 py-2 text-sm whitespace-pre-wrap text-blue-100/90"
            >
              {turn.content}
            </p>
          ),
        )}
        {streaming && turns[turns.length - 1]?.role !== "assistant" && (
          <p className="flex items-center gap-2 text-sm text-blue-100/70">
            <Loader2 className="size-4 animate-spin" />
            Reading your material…
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={draft}
          maxLength={QUESTION_MAX}
          rows={2}
          placeholder="Ask a question about your material…"
          disabled={streaming}
          aria-label="Ask the tutor a question"
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="w-full resize-none rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-blue-100/40 focus:border-white/40 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send question"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </form>
    </section>
  );
}
