import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { loadSessionMaterials, type SessionMaterial } from "./materials";

// Unit-level query-contract test; cross-account RLS isolation is the Phase 3
// integration test. Signed-URL generation lives in the page, not here.

interface OrderResult {
  data: SessionMaterial[] | null;
  error: { message: string } | null;
}

function fakeSupabase(result: OrderResult) {
  const order = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as unknown as SupabaseClient<Database>;
  return { client, from, select, eq, order };
}

const material: SessionMaterial = {
  id: "m1",
  filename: "notes.pdf",
  mime_type: "application/pdf",
  size_bytes: 2048,
  storage_path: "user/session/notes.pdf",
};

describe("loadSessionMaterials", () => {
  it("queries materials for the session, oldest first", async () => {
    const { client, from, select, eq, order } = fakeSupabase({ data: [material], error: null });

    const result = await loadSessionMaterials(client, "session-1");

    expect(from).toHaveBeenCalledWith("materials");
    expect(select).toHaveBeenCalledWith("id, filename, mime_type, size_bytes, storage_path");
    expect(eq).toHaveBeenCalledWith("session_id", "session-1");
    expect(order).toHaveBeenCalledWith("created_at");
    expect(result).toEqual([material]);
  });

  it("returns [] (does not throw) on a read error", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "boom" } });
    expect(await loadSessionMaterials(client, "session-1")).toEqual([]);
  });
});
