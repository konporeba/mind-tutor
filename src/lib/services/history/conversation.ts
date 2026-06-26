// Conversation transcript read helper (S-06).
//
// Loads a session's ask-the-tutor turns in replay order. Used by the detail page
// to seed both S-05's live panel (active sessions) and S-06's read-only
// ConversationLog (completed sessions), and exercised cross-account in the RLS
// test. RLS scopes the read to the owner; the session filter is defense-in-depth.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type { ConversationMessage } from "@/types";

/** A single transcript turn: who spoke and what they said, in `position` order. */
export type ConversationTurn = Pick<ConversationMessage, "role" | "content">;

/**
 * The session's conversation turns ordered by `position` for replay. Returns []
 * when there are none (or on read error).
 */
export async function loadConversation(
  supabase: SupabaseClient<Database>,
  sessionId: string,
): Promise<ConversationTurn[]> {
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("position");

  if (error) {
    console.error("[history] loadConversation failed:", error.message);
    return [];
  }
  return data;
}
