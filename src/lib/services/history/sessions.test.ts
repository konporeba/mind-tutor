import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { listSessions, type SessionListItem } from "./sessions";

// Unit-level shape test: the cross-account RLS proof (learner B can't see A's
// sessions) is the Phase 3 integration test against live Postgres. Here we pin
// the query contract — selected columns, newest-first order, and the graceful
// empty/error fallbacks — with a fake query builder, no DB.

interface OrderResult {
  data: SessionListItem[] | null;
  error: { message: string } | null;
}

function fakeSupabase(result: OrderResult) {
  const order = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ order });
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as unknown as SupabaseClient<Database>;
  return { client, from, select, order };
}

const row = (id: string, created_at: string): SessionListItem => ({
  id,
  title: `Session ${id}`,
  status: "completed",
  score: 80,
  created_at,
});

describe("listSessions", () => {
  it("selects the list columns ordered by created_at descending", async () => {
    const rows = [row("b", "2026-06-02T00:00:00Z"), row("a", "2026-06-01T00:00:00Z")];
    const { client, from, select, order } = fakeSupabase({ data: rows, error: null });

    const result = await listSessions(client);

    expect(from).toHaveBeenCalledWith("sessions");
    expect(select).toHaveBeenCalledWith("id, title, status, score, created_at");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toEqual(rows);
  });

  it("returns [] when there are no rows", async () => {
    const { client } = fakeSupabase({ data: [], error: null });
    expect(await listSessions(client)).toEqual([]);
  });

  it("returns [] (does not throw) on a read error", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "boom" } });
    expect(await listSessions(client)).toEqual([]);
  });
});
