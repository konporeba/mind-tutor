// Shared domain entity types, derived from the generated Supabase schema.
// Import domain row types from here rather than reaching into the generated
// `database.types` file directly. Regenerate database.types.ts after any
// migration (see docs/reference/rls-policy-template.md).

import type { Database } from "@/db/database.types";

type Tables = Database["public"]["Tables"];

export type Session = Tables["sessions"]["Row"];
export type SessionInsert = Tables["sessions"]["Insert"];
export type SessionUpdate = Tables["sessions"]["Update"];

export type Material = Tables["materials"]["Row"];
export type MaterialInsert = Tables["materials"]["Insert"];
export type MaterialUpdate = Tables["materials"]["Update"];

export type GeneratedContent = Tables["generated_content"]["Row"];
export type GeneratedContentInsert = Tables["generated_content"]["Insert"];
export type GeneratedContentUpdate = Tables["generated_content"]["Update"];

export type Exercise = Tables["exercises"]["Row"];
export type ExerciseInsert = Tables["exercises"]["Insert"];
export type ExerciseUpdate = Tables["exercises"]["Update"];
