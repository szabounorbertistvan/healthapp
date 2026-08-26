"use server";
// Stripe billing actions. Price amounts live in Stripe; the app addresses
// prices only by lookup_key (see packages/shared/src/billing.ts and
// scripts/stripe-setup.mjs). The webhook edge function — not these actions —
// is what writes the subscriptions table.
import { revalidatePath } from "next/cache";
import Stripe from "stripe";
import {
  PRICE_LOOKUP_KEYS,
  type PaidTier,
  type PlanInterval,
} from "@buddygym/shared";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** Creates a Stripe Checkout session and returns its URL for redirect. */
export async function startCheckout(
  plan: PaidTier,
  interval: PlanInterval,
  returnPath: string,
): Promise<ActionResult & { url?: string }> {
  if (isDemo) return { ok: true, demo: true };
  const stripe = stripeClient();
  if (!stripe) return { ok: false, message: "Billing is not configured (STRIPE_SECRET_KEY missing)." };

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };

  const lookupKey = PRICE_LOOKUP_KEYS[plan]?.[interval];
  if (!lookupKey) return { ok: false, message: "Unknown plan" };
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = prices.data[0];
  if (!price) {
    return { ok: false, message: `Stripe price '${lookupKey}' not found — run scripts/stripe-setup.mjs.` };
  }

  // reuse the Stripe customer if one exists so upgrades don't fork identities
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const base = siteUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: auth.user.id,
    ...(sub?.stripe_customer_id
      ? { customer: sub.stripe_customer_id }
      : { customer_email: auth.user.email ?? undefined }),
    subscription_data: { metadata: { user_id: auth.user.id } },
    allow_promotion_codes: true,
    success_url: `${base}${returnPath}?billing=success`,
    cancel_url: `${base}${returnPath}?billing=canceled`,
  });
  if (!session.url) return { ok: false, message: "Stripe did not return a checkout URL" };
  return { ok: true, url: session.url };
}

/** Opens the Stripe customer portal (plan changes, cancellation, invoices). */
export async function openBillingPortal(returnPath: string): Promise<ActionResult & { url?: string }> {
  if (isDemo) return { ok: true, demo: true };
  const stripe = stripeClient();
  if (!stripe) return { ok: false, message: "Billing is not configured (STRIPE_SECRET_KEY missing)." };

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!sub?.stripe_customer_id) return { ok: false, message: "No billing account yet" };

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${siteUrl()}${returnPath}`,
  });
  return { ok: true, url: session.url };
}

/** Admin comp: grant or revoke any tier for free (SQL enforces is_admin). */
export async function adminSetTier(userId: string, tier: string): Promise<ActionResult> {
  if (isDemo) return { ok: true, demo: true };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_set_tier", {
    target_user: userId,
    new_tier: tier,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin");
  return { ok: true };
}
