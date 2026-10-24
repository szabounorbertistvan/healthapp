import type { MeV1 } from "@healthapp/api/v1";
import { api } from "./api";
import { useOfflineQuery } from "./offline-query";

/** A coach (or a coach who also trains) gets the coach tabs; everyone trains on the client ones. */
export function isCoachRole(role: MeV1["role"] | undefined): boolean {
  return role === "coach" || role === "both";
}

/** Who is signed in, kept on the phone so the right tabs show with no signal. */
export function useMe() {
  return useOfflineQuery("me", ["me"], api.me);
}
