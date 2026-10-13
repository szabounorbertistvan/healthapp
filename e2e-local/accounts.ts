import path from "node:path";

/**
 * The local suite's accounts — supabase/seed/e2e.sql makes them, on a
 * throwaway database. None of them exists on the live project.
 */
export const PASSWORD = "Voinic-E2E-local-1";

export const ACCOUNTS = {
  coachA: "e2e-coach-a@voinic.test",
  coachB: "e2e-coach-b@voinic.test",
  clientA: "e2e-client-a@voinic.test",
  clientB: "e2e-client-b@voinic.test",
  clientC: "e2e-client-c@voinic.test",
  clientD: "e2e-client-d@voinic.test",
} as const;
export const RESET_ACCOUNT = "e2e-reset@voinic.test";

export const USERNAMES = {
  coachA: "e2e_coach_a", coachB: "e2e_coach_b", clientA: "e2e_client_a",
  clientB: "e2e_client_b", clientC: "e2e_client_c", clientD: "e2e_client_d",
  clientF: "e2e_client_f",
} as const;

export const PUBLISHED_COACH = "e2e-coach-alpha";
export const DRAFT_COACH = "e2e-coach-beta";

export type Who = keyof typeof ACCOUNTS;
export const authFile = (who: Who) => path.join(__dirname, ".auth", `${who}.json`);

/** A tag unique to this run, for the names of anything a spec creates (and must remove). */
export const RUN = `e2e-${Date.now().toString(36)}`;
