import { Logo } from "@/components/logo";
import { getI18n } from "@/lib/i18n/server";
import { RetryButton } from "./retry-button";

// What the service worker (app/sw.ts) shows when a page cannot load for want
// of a connection. Precached at install, so it must carry nobody's data: no
// session reads, nothing beyond the locale the root layout already picked.
export default async function OfflinePage() {
  const { t } = await getI18n();
  const o = t.common.offline;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-6 text-center">
        <div className="mb-5 flex justify-center">
          <Logo size="md" />
        </div>
        <h1 className="font-display text-lg font-bold tracking-tight">{o.title}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{o.body}</p>
        <RetryButton label={o.retry} />
      </div>
    </main>
  );
}
