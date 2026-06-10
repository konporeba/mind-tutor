// Handler-layer 404-translation slice for POST /api/sessions/[id]/complete
// (test-plan Phase 3, Risk #3). Pins the `.single()`-on-empty -> 404 path that the
// RLS-layer test (rls-isolation.integration.test.ts) cannot see: a non-owner (B) hitting
// A's session id gets 404 with NO leaked score, while B hitting its OWN session gets 200
// — the control that keeps the 404 from being spurious.
//
// We vi.mock @/lib/supabase's createClient to return a REAL anon-key client authed as
// user B. RLS stays live — only client *construction* is intercepted — so this is NOT the
// forbidden "mock the Supabase client" anti-pattern: the DB + its policies are exercised
// for real; the mock just supplies B's identity where the handler would otherwise read it
// from the request cookies.

import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database.types";
import { getIdentities } from "@/test/integration/setup";
import { createSessionGraph, type SessionGraphIds } from "@/test/integration/factories";
import { POST } from "./complete";

const mockState = vi.hoisted(() => ({ client: null as SupabaseClient<Database> | null }));
vi.mock("@/lib/supabase", () => ({
  createClient: (): SupabaseClient<Database> | null => mockState.client,
}));

function contextFor(userId: string, sessionId: string): APIContext {
  return {
    locals: { user: { id: userId } },
    params: { id: sessionId },
    request: new Request("http://localhost/api/sessions/complete", { method: "POST" }),
    cookies: {} as never,
  } as unknown as APIContext;
}

describe("POST /api/sessions/[id]/complete — isolation", () => {
  let userBId: string;
  let aGraph: SessionGraphIds;
  let bGraph: SessionGraphIds;

  beforeAll(async () => {
    const ids = await getIdentities();
    mockState.client = ids.clientB; // every createClient() call resolves to B's real client
    userBId = ids.userBId;
    aGraph = await createSessionGraph(ids.clientA, ids.userAId);
    bGraph = await createSessionGraph(ids.clientB, ids.userBId);
  });

  it("returns 404 with no leaked score when B targets A's session", async () => {
    const res = await POST(contextFor(userBId, aGraph.sessionId));
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.score).toBeUndefined();
    expect(body.error).toBeDefined();
  });

  it("returns 200 with a score when B completes its OWN session (control)", async () => {
    const res = await POST(contextFor(userBId, bGraph.sessionId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.score).toBe("number");
  });
});
