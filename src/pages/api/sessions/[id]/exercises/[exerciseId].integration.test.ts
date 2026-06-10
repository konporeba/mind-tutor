// Handler-layer 404-translation slice for POST /api/sessions/[id]/exercises/[exerciseId]
// (test-plan Phase 3, Risk #3). Pins the `.single()`-on-empty -> 404 path for the
// MCQ-answer endpoint, including the route-specific `session_id`-mismatch defense: B
// cannot read or record an answer on A's exercise — even by pairing its OWN session id
// with A's exercise id. The owner-200 control keeps the 404s from being spurious.
//
// Same mocking rationale as the complete.ts slice: vi.mock @/lib/supabase's createClient
// to return a REAL anon-key client authed as B. RLS stays live — only construction is
// intercepted — so this is NOT the "mock the Supabase client" anti-pattern; the DB +
// policies are exercised for real.

import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database.types";
import { getIdentities } from "@/test/integration/setup";
import { createSessionGraph, type SessionGraphIds } from "@/test/integration/factories";
import { POST } from "./[exerciseId]";

const mockState = vi.hoisted(() => ({ client: null as SupabaseClient<Database> | null }));
vi.mock("@/lib/supabase", () => ({
  createClient: (): SupabaseClient<Database> | null => mockState.client,
}));

function contextFor(userId: string, sessionId: string, exerciseId: string, answer: string): APIContext {
  return {
    locals: { user: { id: userId } },
    params: { id: sessionId, exerciseId },
    request: new Request("http://localhost/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    }),
    cookies: {} as never,
  } as unknown as APIContext;
}

describe("POST /api/sessions/[id]/exercises/[exerciseId] — isolation", () => {
  let userBId: string;
  let aGraph: SessionGraphIds;
  let bGraph: SessionGraphIds;

  beforeAll(async () => {
    const ids = await getIdentities();
    mockState.client = ids.clientB;
    userBId = ids.userBId;
    aGraph = await createSessionGraph(ids.clientA, ids.userAId);
    bGraph = await createSessionGraph(ids.clientB, ids.userBId);
  });

  it("returns 404 with no leaked answer when B targets A's session + exercise", async () => {
    const res = await POST(contextFor(userBId, aGraph.sessionId, aGraph.exerciseId, "A"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.correct_answer).toBeUndefined();
    expect(body.feedback).toBeUndefined();
    expect(body.error).toBeDefined();
  });

  it("returns 404 when B pairs its OWN session id with A's exercise id (session_id guard)", async () => {
    const res = await POST(contextFor(userBId, bGraph.sessionId, aGraph.exerciseId, "A"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.correct_answer).toBeUndefined();
  });

  it("returns 200 with feedback when B answers its OWN exercise (control)", async () => {
    const res = await POST(contextFor(userBId, bGraph.sessionId, bGraph.exerciseId, "A"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.is_correct).toBe(true);
    expect(body.correct_answer).toBe("A");
    expect(body.feedback).toBeDefined();
  });
});
