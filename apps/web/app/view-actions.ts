"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isDemo } from "@/lib/supabase/server";
import { store } from "@/lib/demo-store";
import { VIEW_COOKIE } from "@/lib/view-mode";

/**
 * Switch between the coach workspace and one client's app.
 *
 * Refuses outside demo mode. Doing this against a real database would mean an
 * admin silently reading another person's health data, which needs an audited
 * impersonation flow rather than a cookie — deliberately not built here.
 */
export async function setView(target: string): Promise<void> {
  if (!isDemo) return;

  let value: string;
  let destination: string;

  if (target === "coach") {
    value = "coach";
    destination = "/dashboard";
  } else if (target.startsWith("client:")) {
    const clientId = target.slice("client:".length);
    if (!store().clients.some((c) => c.client_id === clientId)) return;
    value = target;
    destination = "/today";
  } else {
    return;
  }

  const jar = await cookies();
  jar.set(VIEW_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(destination);
}

/** Roster for the switcher: everyone the demo coach could look at. */
export async function viewableClients(): Promise<{ id: string; name: string }[]> {
  if (!isDemo) return [];
  return store().clients.map((c) => ({ id: c.client_id, name: c.full_name }));
}
