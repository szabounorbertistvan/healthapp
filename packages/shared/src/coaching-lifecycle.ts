// The coaching relationship lifecycle (migrations 20261109100000 / 20261109110000),
// mirrored from SQL so the screens offer exactly the moves the database
// accepts. The authority stays in the database: trainer_clients_lifecycle_guard()
// for every writer, coaching_transition() for the two participants.
//
//   invited → active → (paused ⇄ active) → ended        ended is final

export const RELATIONSHIP_STATUSES = ["invited", "active", "paused", "ended"] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

/** General reasons only — never free text: nobody explains a medical break. */
export const PAUSE_REASONS = ["vacation", "break", "schedule", "health", "other"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];
export const END_REASONS = ["goals_reached", "schedule", "not_a_fit", "break", "other"] as const;
export type EndReason = (typeof END_REASONS)[number];

/** Every status change any writer may make (the trigger's graph). */
export function canTransition(from: RelationshipStatus, to: RelationshipStatus): boolean {
  if (from === to) return true;
  switch (from) {
    case "invited": return to === "active" || to === "ended";
    case "active": return to === "paused" || to === "ended";
    case "paused": return to === "active" || to === "ended";
    case "ended": return false;
  }
}

export type CoachingMove = "pause" | "resume" | "end";

/** What either participant may do now (coaching_transition()); an invite is not theirs to move. */
export function coachingMoves(status: RelationshipStatus): CoachingMove[] {
  if (status === "active") return ["pause", "end"];
  if (status === "paused") return ["resume", "end"];
  return [];
}

/** The status a move leads to. */
export function moveTarget(move: CoachingMove): "paused" | "active" | "ended" {
  return move === "pause" ? "paused" : move === "resume" ? "active" : "ended";
}

/** A client has one current coach: active or paused (one_current_coach_per_client). */
export function isCurrent(status: RelationshipStatus): boolean {
  return status === "active" || status === "paused";
}
