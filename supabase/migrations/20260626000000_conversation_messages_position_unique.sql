-- conversation_messages: enforce per-session turn ordering integrity (S-05 impl-review F1).
--
-- The ask endpoint derives `position` from the current turn count, so two concurrent
-- asks (double-submit / two tabs) could write duplicate positions, making the replay
-- order (order by position) nondeterministic. A unique constraint makes the second
-- colliding insert fail cleanly at the DB instead of silently corrupting the transcript.

alter table public.conversation_messages
  add constraint conversation_messages_session_position_unique unique (session_id, position);
