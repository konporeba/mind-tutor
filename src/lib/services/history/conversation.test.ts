import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { loadConversation, type ConversationTurn } from "./conversation";

// Unit-level query-contract test; cross-account RLS isolation is the Phase 3
// integration test.

interface OrderResult {
  data: ConversationTurn[] | null;
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

const turns: ConversationTurn[] = [
  { role: "user", content: "What is X?" },
  { role: "assistant", content: "X is..." },
];

describe("loadConversation", () => {
  it("queries turns for the session ordered by position", async () => {
    const { client, from, select, eq, order } = fakeSupabase({ data: turns, error: null });

    const result = await loadConversation(client, "session-1");

    expect(from).toHaveBeenCalledWith("conversation_messages");
    expect(select).toHaveBeenCalledWith("role, content");
    expect(eq).toHaveBeenCalledWith("session_id", "session-1");
    expect(order).toHaveBeenCalledWith("position");
    expect(result).toEqual(turns);
  });

  it("returns [] (does not throw) on a read error", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "boom" } });
    expect(await loadConversation(client, "session-1")).toEqual([]);
  });
});
