// One-time Stripe bootstrap: creates the HealthApp products and prices.
// Idempotent — reruns skip prices whose lookup_key already exists.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
//
// MVP amounts (change them any time in the Stripe dashboard — the app only
// references prices by lookup_key, never by amount):
//   Premium   €10/month · €102/year (12 × 10 − 15%)
//   Coach Pro €10/month · €102/year
//
// Lookup keys must match PRICE_LOOKUP_KEYS in packages/shared/src/billing.ts.
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (sk_test_... or sk_live_...) and rerun.");
  process.exit(1);
}
const stripe = new Stripe(key);

const CURRENCY = "eur";
const PLANS = [
  {
    product: { name: "HealthApp Premium", metadata: { tier: "premium" } },
    prices: [
      { lookup_key: "premium_monthly", unit_amount: 1000, interval: "month" },
      { lookup_key: "premium_annual", unit_amount: 10200, interval: "year" },
    ],
  },
  {
    product: { name: "HealthApp Coach Pro", metadata: { tier: "coach_pro" } },
    prices: [
      { lookup_key: "coach_pro_monthly", unit_amount: 1000, interval: "month" },
      { lookup_key: "coach_pro_annual", unit_amount: 10200, interval: "year" },
    ],
  },
];

const allKeys = PLANS.flatMap((p) => p.prices.map((x) => x.lookup_key));
const existing = await stripe.prices.list({ lookup_keys: allKeys, limit: 100 });
const have = new Set(existing.data.map((p) => p.lookup_key));

for (const plan of PLANS) {
  const missing = plan.prices.filter((p) => !have.has(p.lookup_key));
  if (missing.length === 0) {
    console.log(`✓ ${plan.product.name} — all prices already exist`);
    continue;
  }
  // reuse the product if a sibling price already points at it
  const sibling = existing.data.find((p) =>
    plan.prices.some((x) => x.lookup_key === p.lookup_key),
  );
  const productId = sibling
    ? String(sibling.product)
    : (await stripe.products.create(plan.product)).id;

  for (const p of missing) {
    const price = await stripe.prices.create({
      product: productId,
      currency: CURRENCY,
      unit_amount: p.unit_amount,
      lookup_key: p.lookup_key,
      recurring: { interval: p.interval },
      metadata: { tier: plan.product.metadata.tier },
    });
    console.log(`+ ${p.lookup_key} → ${price.id} (€${p.unit_amount / 100}/${p.interval})`);
  }
}

console.log(`
Next steps:
  1. In the Stripe dashboard, enable the Customer Portal (Settings → Billing).
  2. Add a webhook endpoint: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
     Events: checkout.session.completed, customer.subscription.updated,
             customer.subscription.deleted, invoice.payment_failed
  3. supabase secrets set STRIPE_SECRET_KEY=${key.slice(0, 8)}... STRIPE_WEBHOOK_SECRET=whsec_...
  4. supabase functions deploy stripe-webhook
  5. Put STRIPE_SECRET_KEY and NEXT_PUBLIC_SITE_URL in apps/web/.env.local.
`);
