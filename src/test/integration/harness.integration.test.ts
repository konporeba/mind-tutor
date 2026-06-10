// Phase 1 smoke test — proves the DB-backed harness itself works before the
// isolation specs (Phases 2-3) build on it: env resolves, two distinct learners are
// seeded + signed in, and an owner can create and read its own session graph through
// real Postgres + RLS. If this fails, the local stack is down or env wiring is off.

import { beforeAll, describe, expect, it } from "vitest";

import { getIdentities, type Identities } from "@/test/integration/setup";
import { createSessionGraph } from "@/test/integration/factories";

describe("integration harness", () => {
  let ids: Identities;

  beforeAll(async () => {
    ids = await getIdentities();
  });

  it("seeds two distinct authenticated identities", () => {
    expect(ids.userAId).toBeTruthy();
    expect(ids.userBId).toBeTruthy();
    expect(ids.userAId).not.toBe(ids.userBId);
  });

  it("lets an owner create and read its own session graph (RLS owner-can baseline)", async () => {
    const graph = await createSessionGraph(ids.clientA, ids.userAId);
    const { data, error } = await ids.clientA.from("sessions").select("id").eq("id", graph.sessionId).single();
    expect(error).toBeNull();
    expect(data?.id).toBe(graph.sessionId);
  });
});
