/** Codes coaching_transition() raises (20261109110000). Here, not in the "use server" file: those may export only async functions. */
export const COACHING_ERRORS = ["RELATIONSHIP_NOT_FOUND", "INVALID_TRANSITION", "INVALID_REASON", "NOT_SIGNED_IN"] as const;
export type CoachingErrorCode = (typeof COACHING_ERRORS)[number];
