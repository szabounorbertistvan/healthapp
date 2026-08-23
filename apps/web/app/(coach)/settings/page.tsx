import { getProfile, isDemo } from "@/lib/data";
import { Card, PageTitle } from "@/components/ui";
import { ENTITLEMENTS, TIER_LABEL, type Tier } from "@/lib/entitlements";

const coachTiers: Tier[] = ["coach_free", "coach_pro"];

export default async function SettingsPage() {
  const profile = await getProfile();
  const tier = profile?.tier ?? "free";

  return (
    <div className="max-w-2xl">
      <PageTitle title="Settings" />

      <Card>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Subscription</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {coachTiers.map((t) => {
            const e = ENTITLEMENTS[t];
            const current = t === tier;
            return (
              <div key={t} className={`rounded-xl border p-4 ${current ? "border-2 border-accent" : "border-line"}`}>
                <div className="flex items-center justify-between">
                  <p className="font-bold">{TIER_LABEL[t]}</p>
                  {current ? (
                    <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink">Current</span>
                  ) : null}
                </div>
                <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                  <li>Up to <b className="text-ink">{e.maxClients}</b> clients</li>
                  <li>{e.advancedAnalytics ? "✓" : "—"} Advanced analytics</li>
                  <li>{e.customExerciseVideos ? "✓" : "—"} Custom exercise videos</li>
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          Billing (RevenueCat) lands in V2 — until then tiers are set manually in the subscriptions table.
        </p>
      </Card>

      <Card className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Backend</p>
        {isDemo ? (
          <div className="mt-2 space-y-2 text-sm text-ink-soft">
            <p><b className="text-ink">Demo mode.</b> To connect a real backend:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Create a Supabase project and apply the migrations in <code>supabase/</code>.</li>
              <li>Copy <code>.env.example</code> to <code>.env.local</code> and fill in the project URL and anon key.</li>
              <li>Restart the dev server — auth and live data switch on automatically.</li>
            </ol>
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">Connected to Supabase.</p>
        )}
      </Card>
    </div>
  );
}
