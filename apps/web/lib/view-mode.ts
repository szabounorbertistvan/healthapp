import "server-only";
import { cookies } from "next/headers";
import { isDemo } from "./supabase/server";
import { DEMO_CLIENT_ID } from "./demo-client-store";
import { store } from "./demo-store";

// Which surface an admin is currently looking at.
//
// Coaches and clients each have exactly one home, so this exists only so an
// admin can walk both without two accounts. It lives in a cookie because every
// data function is a server component read — it has to be resolvable without a
// round trip to the client.
//
// DEMO ONLY, on purpose. In a live install this would be impersonation: an
// admin reading one client's workouts, weight and check-ins. That is a real
// access-control decision (and health data), so it is not something to switch
// on with a cookie. See setView().

const COOKIE = "bg_view";

export type ViewMode = { surface: "coach" } | { surface: "client"; clientId: string };

export async function currentView(): Promise<ViewMode> {
  if (!isDemo) return { surface: "coach" };
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value ?? "";
  if (raw.startsWith("client:")) {
    const clientId = raw.slice("client:".length);
    // Only ids on the roster — a stale cookie must not address a missing client.
    if (store().clients.some((c) => c.client_id === clientId)) {
      return { surface: "client", clientId };
    }
  }
  return raw === "coach" ? { surface: "coach" } : { surface: "coach" };
}

/** The client the client-app screens should read, in demo mode. */
export async function viewingClientId(): Promise<string> {
  const view = await currentView();
  return view.surface === "client" ? view.clientId : DEMO_CLIENT_ID;
}

export const VIEW_COOKIE = COOKIE;
