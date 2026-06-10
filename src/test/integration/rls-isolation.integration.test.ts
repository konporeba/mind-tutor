// Cross-learner isolation at the RLS layer (test-plan Phase 2, Risk #3 / IDOR).
//
// THE load-bearing isolation guarantee. Ownership is enforced ONLY by Supabase RLS
// (`user_id = (select auth.uid())`) — no handler re-checks user_id — so this drives two
// REAL authenticated learners against live Postgres + RLS. A mocked client would bypass
// the only thing under test (research: "a mocked Supabase client tests nothing").
//
// For every domain table we prove a non-owner (B) reading A's row returns 0 rows, and a
// non-owner mutating A's row affects 0 rows — the OWNER-CAN read is only a control that
// keeps the denial from being vacuous (the row genuinely exists and is reachable by A).
// We also prove B cannot forge A's ownership on insert (the `with check` guard the
// `sessions` POST relies on).
//
// Regression caught: a dropped/loosened *_select/_update/_delete/_insert policy, or a
// future table missing `enable row level security`.
//
// Note the asymmetry (research): an RLS-blocked UPDATE/DELETE returns NO error and 0
// rows, so we assert affected-count; an RLS-blocked INSERT (with check) RAISES, so we
// assert the error.

import { beforeAll, describe, expect, it } from "vitest";

import { getIdentities, type Identities } from "@/test/integration/setup";
import { createSessionGraph } from "@/test/integration/factories";

/** Structural view of a postgrest list/affected-rows response — keeps types out of `any`. */
interface ListResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

/** Run a query and return the number of rows it read or affected (throws on a real error). */
async function count(query: PromiseLike<ListResult>): Promise<number> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

describe("cross-learner isolation (RLS layer)", () => {
  let ids: Identities;
  const rows = { session: "", material: "", content: "", exercise: "" };

  beforeAll(async () => {
    ids = await getIdentities();
    const graph = await createSessionGraph(ids.clientA, ids.userAId);
    rows.session = graph.sessionId;
    rows.material = graph.materialId;
    rows.content = graph.contentId;
    rows.exercise = graph.exerciseId;
    // Ensure learner A owns a profile row so the profiles isolation checks have a target.
    const { error } = await ids.clientA.from("profiles").upsert({ user_id: ids.userAId, bio: "owner bio" });
    if (error) throw new Error(`[integration] failed to seed profile for A: ${error.message}`);
  });

  describe("sessions", () => {
    it("denies a non-owner read (0 rows); owner can read (control)", async () => {
      expect(await count(ids.clientB.from("sessions").select("id").eq("id", rows.session))).toBe(0);
      expect(await count(ids.clientA.from("sessions").select("id").eq("id", rows.session))).toBe(1);
    });
    it("denies a non-owner update (0 rows affected)", async () => {
      const q = ids.clientB.from("sessions").update({ title: "hacked" }).eq("id", rows.session).select("id");
      expect(await count(q)).toBe(0);
    });
    it("denies a non-owner delete (row survives)", async () => {
      expect(await count(ids.clientB.from("sessions").delete().eq("id", rows.session).select("id"))).toBe(0);
      expect(await count(ids.clientA.from("sessions").select("id").eq("id", rows.session))).toBe(1);
    });
  });

  describe("materials", () => {
    it("denies a non-owner read (0 rows); owner can read (control)", async () => {
      expect(await count(ids.clientB.from("materials").select("id").eq("id", rows.material))).toBe(0);
      expect(await count(ids.clientA.from("materials").select("id").eq("id", rows.material))).toBe(1);
    });
    it("denies a non-owner update (0 rows affected)", async () => {
      const q = ids.clientB.from("materials").update({ filename: "hacked.txt" }).eq("id", rows.material).select("id");
      expect(await count(q)).toBe(0);
    });
    it("denies a non-owner delete (row survives)", async () => {
      expect(await count(ids.clientB.from("materials").delete().eq("id", rows.material).select("id"))).toBe(0);
      expect(await count(ids.clientA.from("materials").select("id").eq("id", rows.material))).toBe(1);
    });
  });

  describe("generated_content", () => {
    it("denies a non-owner read (0 rows); owner can read (control)", async () => {
      expect(await count(ids.clientB.from("generated_content").select("id").eq("id", rows.content))).toBe(0);
      expect(await count(ids.clientA.from("generated_content").select("id").eq("id", rows.content))).toBe(1);
    });
    it("denies a non-owner update (0 rows affected)", async () => {
      const q = ids.clientB.from("generated_content").update({ position: 999 }).eq("id", rows.content).select("id");
      expect(await count(q)).toBe(0);
    });
    it("denies a non-owner delete (row survives)", async () => {
      expect(await count(ids.clientB.from("generated_content").delete().eq("id", rows.content).select("id"))).toBe(0);
      expect(await count(ids.clientA.from("generated_content").select("id").eq("id", rows.content))).toBe(1);
    });
  });

  describe("exercises", () => {
    it("denies a non-owner read (0 rows); owner can read (control)", async () => {
      expect(await count(ids.clientB.from("exercises").select("id").eq("id", rows.exercise))).toBe(0);
      expect(await count(ids.clientA.from("exercises").select("id").eq("id", rows.exercise))).toBe(1);
    });
    it("denies a non-owner update (0 rows affected)", async () => {
      const q = ids.clientB.from("exercises").update({ feedback: "hacked" }).eq("id", rows.exercise).select("id");
      expect(await count(q)).toBe(0);
    });
    it("denies a non-owner delete (row survives)", async () => {
      expect(await count(ids.clientB.from("exercises").delete().eq("id", rows.exercise).select("id"))).toBe(0);
      expect(await count(ids.clientA.from("exercises").select("id").eq("id", rows.exercise))).toBe(1);
    });
  });

  describe("profiles", () => {
    it("denies a non-owner read (0 rows); owner can read (control)", async () => {
      expect(await count(ids.clientB.from("profiles").select("user_id").eq("user_id", ids.userAId))).toBe(0);
      expect(await count(ids.clientA.from("profiles").select("user_id").eq("user_id", ids.userAId))).toBe(1);
    });
    it("denies a non-owner update (0 rows affected)", async () => {
      const q = ids.clientB.from("profiles").update({ bio: "hacked" }).eq("user_id", ids.userAId).select("user_id");
      expect(await count(q)).toBe(0);
    });
    it("denies a non-owner delete (row survives)", async () => {
      expect(await count(ids.clientB.from("profiles").delete().eq("user_id", ids.userAId).select("user_id"))).toBe(0);
      expect(await count(ids.clientA.from("profiles").select("user_id").eq("user_id", ids.userAId))).toBe(1);
    });
  });

  it("blocks a non-owner from forging another learner's ownership on insert (with check)", async () => {
    // B authenticated, but RLS `insert with check (user_id = auth.uid())` must reject a row
    // stamped with A's id. Unlike update/delete, this RAISES rather than affecting 0 rows.
    const { error } = await ids.clientB.from("sessions").insert({ user_id: ids.userAId });
    expect(error).not.toBeNull();
  });
});
