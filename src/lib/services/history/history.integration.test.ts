// Cross-account isolation for the S-06 session-history READ HELPERS (plan Phase 3).
//
// The table-level RLS proof lives in rls-isolation.integration.test.ts; this spec
// proves the same guarantee through the actual functions the dashboard and detail
// page call — listSessions / loadSessionMaterials / loadConversation — so a future
// change to a helper's query (a dropped filter, a wrong column) that re-opens a
// cross-account leak is caught at the app read path, not just the policy.
//
// Two REAL authenticated learners drive live Postgres + RLS (a mocked client would
// bypass the only thing under test). Every denial is paired with an owner-can-read
// control so it can never pass vacuously.

import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { getIdentities, type Identities } from "@/test/integration/setup";
import { createSessionGraph } from "@/test/integration/factories";
import { listSessions } from "./sessions";
import { loadSessionMaterials } from "./materials";
import { loadConversation } from "./conversation";

/** Seed one conversation turn for a session (the factory creates none). */
async function seedTurn(client: SupabaseClient<Database>, userId: string, sessionId: string): Promise<void> {
  const { error } = await client.from("conversation_messages").insert({
    user_id: userId,
    session_id: sessionId,
    role: "user",
    position: 0,
    content: "fixture question",
  });
  if (error) throw new Error(`[integration] failed to seed conversation turn: ${error.message}`);
}

describe("session-history read helpers — cross-account isolation", () => {
  let ids: Identities;
  let aSessionId: string;
  let bSessionId: string;

  beforeAll(async () => {
    ids = await getIdentities();
    const aGraph = await createSessionGraph(ids.clientA, ids.userAId, { title: "A history fixture" });
    const bGraph = await createSessionGraph(ids.clientB, ids.userBId, { title: "B history fixture" });
    aSessionId = aGraph.sessionId;
    bSessionId = bGraph.sessionId;
    await seedTurn(ids.clientA, ids.userAId, aSessionId);
    await seedTurn(ids.clientB, ids.userBId, bSessionId);
  });

  it("listSessions returns the caller's own sessions and never another learner's", async () => {
    const bIds = (await listSessions(ids.clientB)).map((s) => s.id);
    expect(bIds).toContain(bSessionId); // control: own session is listed
    expect(bIds).not.toContain(aSessionId); // denial: A's session never leaks
  });

  it("loadSessionMaterials denies another learner's session; owner sees its own (control)", async () => {
    expect(await loadSessionMaterials(ids.clientB, aSessionId)).toHaveLength(0);
    expect((await loadSessionMaterials(ids.clientB, bSessionId)).length).toBeGreaterThan(0);
  });

  it("loadConversation denies another learner's session; owner sees its own (control)", async () => {
    expect(await loadConversation(ids.clientB, aSessionId)).toHaveLength(0);
    expect((await loadConversation(ids.clientB, bSessionId)).length).toBeGreaterThan(0);
  });
});
