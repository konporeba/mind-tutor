// Handler-layer slice for DELETE /api/sessions/[id] (S-07, FR-016).
//
// Pins the two risks of an irreversible hard-delete:
//   1. Cascade completeness — deleting the session row must clear EVERY child row
//      (materials, generated_content, exercises) so nothing is retrievable after.
//   2. Owner isolation — a non-owner hitting another learner's session id gets 404
//      and the victim's whole graph stays intact.
//
// Same construction as complete.integration.test.ts: vi.mock @/lib/supabase so
// createClient() yields a REAL anon-key client for the acting identity. RLS stays
// live — only client construction is intercepted — so the cascade + policies are
// exercised for real. Absence is asserted via the service-role admin client so a
// "gone" row can't be confused with an RLS-hidden one.

import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database.types";
import { getIdentities } from "@/test/integration/setup";
import { createSessionGraph } from "@/test/integration/factories";
import { DELETE } from "./[id]";

const mockState = vi.hoisted(() => ({ client: null as SupabaseClient<Database> | null }));
vi.mock("@/lib/supabase", () => ({
  createClient: (): SupabaseClient<Database> | null => mockState.client,
}));

function contextFor(userId: string, sessionId: string): APIContext {
  return {
    locals: { user: { id: userId } },
    params: { id: sessionId },
    request: new Request(`http://localhost/api/sessions/${sessionId}`, { method: "DELETE" }),
    cookies: {} as never,
  } as unknown as APIContext;
}

describe("DELETE /api/sessions/[id]", () => {
  let identities: Awaited<ReturnType<typeof getIdentities>>;

  beforeAll(async () => {
    identities = await getIdentities();
  });

  it("owner delete returns 200 and cascades every child row", async () => {
    const { clientA, userAId, adminClient } = identities;
    const graph = await createSessionGraph(clientA, userAId);
    mockState.client = clientA;

    const res = await DELETE(contextFor(userAId, graph.sessionId));
    expect(res.status).toBe(200);

    // Session row gone, and every child row gone via the on-delete cascade.
    const session = await adminClient.from("sessions").select("id").eq("id", graph.sessionId);
    expect(session.data).toEqual([]);
    for (const table of ["materials", "generated_content", "exercises"] as const) {
      const child = await adminClient.from(table).select("id").eq("session_id", graph.sessionId);
      expect(child.data, `${table} should be empty after cascade`).toEqual([]);
    }
  });

  it("returns 404 and leaves the graph intact when B targets A's session", async () => {
    const { clientA, clientB, userAId, userBId, adminClient } = identities;
    const graph = await createSessionGraph(clientA, userAId);
    mockState.client = clientB;

    const res = await DELETE(contextFor(userBId, graph.sessionId));
    expect(res.status).toBe(404);

    // A's session and its children are untouched.
    const session = await adminClient.from("sessions").select("id").eq("id", graph.sessionId);
    expect(session.data).toHaveLength(1);
    const exercises = await adminClient.from("exercises").select("id").eq("session_id", graph.sessionId);
    expect(exercises.data).toHaveLength(1);
  });

  it("returns 404 for a missing/already-deleted id", async () => {
    const { clientA, userAId } = identities;
    mockState.client = clientA;

    const res = await DELETE(contextFor(userAId, "00000000-0000-0000-0000-000000000000"));
    expect(res.status).toBe(404);
  });
});
