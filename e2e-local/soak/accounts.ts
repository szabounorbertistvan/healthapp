import path from "node:path";

/**
 * The soak suite's three people (supabase/seed/e2e.sql, "the soak trio"). They
 * exist only on the throwaway local stack and nothing in e2e-local/*.spec.ts
 * touches them, so the soak rounds can write freely and pile up history the
 * way a real account does.
 */
export const SOAK = {
  coach: "e2e-soak-coach@voinic.test",
  client: "e2e-soak-client@voinic.test",
  solo: "e2e-soak-solo@voinic.test",
} as const;

export const SOAK_USERNAMES = { coach: "e2e_soak_coach", client: "e2e_soak_client", solo: "e2e_soak_solo" } as const;
export const SOAK_COACH_SLUG = "e2e-soak-coach";

export type SoakWho = keyof typeof SOAK;
export const soakAuth = (who: SoakWho) => path.join(__dirname, "..", ".auth", `soak-${who}.json`);

/** A tag unique to this round, for the names of what the round creates. */
export const ROUND = `soak-${Date.now().toString(36)}`;
