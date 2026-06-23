// Handler-layer slice for POST /api/sessions/[id]/ask (S-05, FR-008).
//
// Proves two things against live Postgres + RLS, with only the LLM seam mocked:
//   1. Persist ordering — answering B's OWN session writes the user turn AND, once
//      the stream completes, the assistant turn (ordered by position).
//   2. Isolation — B asking on A's session 404s, persists nothing, and never calls
//      the model.
//
// Like complete.integration.test.ts, createClient is mocked to a REAL anon-key client
// authed as B (RLS stays live — only client construction is intercepted). The OpenRouter
// client is mocked to a streaming fake so no real, paid call is made.

import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database.types";
import { getIdentities } from "@/test/integration/setup";
import { createSessionGraph, type SessionGraphIds } from "@/test/integration/factories";
import { fakeOpenRouterClient, makeStreamingCompletion } from "@/test/generation/openrouter-mock";

const mockState = vi.hoisted(() => ({ client: null as SupabaseClient<Database> | null }));
vi.mock("@/lib/supabase", () => ({
  createClient: (): SupabaseClient<Database> | null => mockState.client,
}));

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/services/generation/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/generation/openrouter")>()),
  getOpenRouterClient: () => fakeOpenRouterClient(create),
}));

import { POST } from "./ask";

function contextFor(userId: string, sessionId: string, question: string): APIContext {
  return {
    locals: { user: { id: userId } },
    params: { id: sessionId },
    request: new Request("http://localhost/api/sessions/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
    cookies: {} as never,
  } as unknown as APIContext;
}

describe("POST /api/sessions/[id]/ask", () => {
  let identities: Awaited<ReturnType<typeof getIdentities>>;
  let userBId: string;
  let aGraph: SessionGraphIds;
  let bGraph: SessionGraphIds;

  beforeAll(async () => {
    identities = await getIdentities();
    mockState.client = identities.clientB; // every createClient() resolves to B's real client
    userBId = identities.userBId;
    aGraph = await createSessionGraph(identities.clientA, identities.userAId);
    bGraph = await createSessionGraph(identities.clientB, identities.userBId);
  });

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(makeStreamingCompletion(["Grounded ", "answer ", "from source."]));
  });

  it("streams an answer and persists the user turn then the assistant turn (B's own session)", async () => {
    const res = await POST(contextFor(userBId, bGraph.sessionId, "What does the fixture say?"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    // Fully consume the stream — the assistant turn is persisted before the stream closes.
    const body = await res.text();
    expect(body).toContain("Grounded ");
    expect(body).toContain("[DONE]");

    const { data: turns } = await identities.clientB
      .from("conversation_messages")
      .select("role, position, content")
      .eq("session_id", bGraph.sessionId)
      .order("position", { ascending: true });

    expect(turns).toHaveLength(2);
    expect(turns?.[0]).toMatchObject({ role: "user", position: 0, content: "What does the fixture say?" });
    expect(turns?.[1]).toMatchObject({ role: "assistant", position: 1, content: "Grounded answer from source." });
  });

  it("404s and persists nothing when B targets A's session", async () => {
    const res = await POST(contextFor(userBId, aGraph.sessionId, "leak attempt"));
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();

    const { count } = await identities.adminClient
      .from("conversation_messages")
      .select("*", { count: "exact", head: true })
      .eq("session_id", aGraph.sessionId);
    expect(count).toBe(0);
  });
});
