import { isDemo } from "@/lib/data";
import { Card, PageTitle } from "@/components/ui";

export default function SettingsPage() {
  return (
    <div className="max-w-xl">
      <PageTitle title="Settings" />
      <Card>
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
      <Card className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Coming later</p>
        <p className="mt-2 text-sm text-ink-soft">
          Profile, notification preferences, and language (RO/EN) land with Sprint 2 auth polish.
        </p>
      </Card>
    </div>
  );
}
