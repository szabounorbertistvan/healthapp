// HealthApp · stripe-webhook edge function
// POST /functions/v1/stripe-webhook — called by Stripe, NOT by users
// (verify_jwt = false in config.toml; authenticity comes from the Stripe
// signature instead). Writes the subscriptions table with the service role —
// the only writer besides admin_set_tier.
//
// Secrets (supabase secrets set):
//   STRIPE_SECRET_KEY       — sk_...
//   STRIPE_WEBHOOK_SECRET   — whsec_... from the endpoint's settings
//
// Which user a Stripe object belongs to travels as subscription metadata
// (metadata.user_id, set by the checkout server action) with the customer id
// as fallback. The price → tier mapping is the lookup_key convention from
// packages/shared/src/billing.ts (premium_monthly, coach_pro_annual, ...).
import Stripe from "npm:stripe@17";
import { createClient } from "jsr:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20",
});

// keep in sync with packages/shared/src/billing.ts (edge functions don't
// share the npm workspace build)
function tierForLookupKey(key: string | null | undefined): string | null {
  switch (key) {
    case "premium_monthly":
    case "premium_annual":
      return "premium";
    case "coach_pro_monthly":
    case "coach_pro_annual":
      return "coach_pro";
    default:
      return null;
  }
}

function mapStatus(stripeStatus: string): "active" | "past_due" | "canceled" {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    default: // canceled, incomplete, incomplete_expired, paused
      return "canceled";
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "missing_signature" }, 400);

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
    );
  } catch (err) {
    console.error("signature verification failed", err);
    return json({ error: "invalid_signature" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription" || !session.subscription) break;
        const sub = await stripe.subscriptions.retrieve(
          session.subscription as string,
          { expand: ["items.data.price"] },
        );
        await applySubscription(supabase, sub, session.client_reference_id);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        // the event payload's price has no lookup_key expansion guarantee —
        // refetch with the price expanded so tier mapping is reliable
        const full = await stripe.subscriptions.retrieve(sub.id, {
          expand: ["items.data.price"],
        });
        await applySubscription(supabase, full, null);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.customer) break;
        await supabase
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("stripe_customer_id", invoice.customer as string);
        break;
      }
      default:
        break; // acknowledge everything else
    }
  } catch (err) {
    console.error(`handling ${event.type} failed`, err);
    return json({ error: "handler_failed" }, 500); // Stripe retries
  }

  return json({ received: true });
});

async function applySubscription(
  supabase: ReturnType<typeof createClient>,
  sub: Stripe.Subscription,
  clientReferenceId: string | null,
) {
  const userId = sub.metadata?.user_id || clientReferenceId;
  const price = sub.items.data[0]?.price ?? null;
  const tier = tierForLookupKey(price?.lookup_key) ?? price?.metadata?.tier ?? null;
  const status = mapStatus(sub.status);

  const patch = {
    provider: "stripe",
    status,
    // a canceled sub keeps its last tier on the row; effective_tier only
    // honors it while status is active, so entitlements still drop to free
    ...(tier ? { tier } : {}),
    stripe_customer_id: sub.customer as string,
    stripe_subscription_id: sub.id,
    stripe_price_id: price?.id ?? null,
    cancel_at_period_end: sub.cancel_at_period_end,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };

  if (userId) {
    const { error } = await supabase.from("subscriptions").update(patch).eq("user_id", userId);
    if (error) throw error;
    return;
  }
  // renewal/cancel events carry no user reference — match on prior linkage
  const { error } = await supabase
    .from("subscriptions")
    .update(patch)
    .or(`stripe_subscription_id.eq.${sub.id},stripe_customer_id.eq.${sub.customer as string}`);
  if (error) throw error;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
