import Link from "next/link";
import type { Metadata } from "next";
import { parseEmailUnsubscribe } from "@healthapp/shared";
import { Logo } from "@/components/logo";
import { LanguageSelector } from "@/components/language-selector";
import { UnsubscribeButton } from "@/components/unsubscribe-button";
import { getI18n } from "@/lib/i18n/server";
import { APP_NAME } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.common.unsubscribe.title} · ${APP_NAME}`, robots: { index: false, follow: false } };
}

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Where "Stop emails like this" at the foot of a marketplace email leads. No
 * session needed and nothing changes on load (mail scanners open links): the
 * person confirms with the button. The token is checked by the database.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Search }) {
  const [{ t }, params] = await Promise.all([getI18n(), searchParams]);
  const m = t.common.unsubscribe;
  const link = parseEmailUnsubscribe(params);
  const categories = t.clientWidgets.emailPrefs.categories;
  const label = link ? categories[link.category as keyof typeof categories]?.label ?? link.category : null;

  return (
    <main className="mx-auto max-w-lg px-6 pb-24">
      <div className="fixed right-4 top-4 z-20"><LanguageSelector /></div>
      <header className="py-6">
        <Link href="/" className="inline-flex items-center gap-2"><Logo size="sm" /></Link>
      </header>

      <div className="glass rounded-3xl p-6">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">{m.title}</h1>
        {link && label ? (
          <UnsubscribeButton link={{ u: link.userId, c: link.category, t: link.token }} category={label} />
        ) : (
          <p role="alert" className="mt-3 text-[14px] leading-relaxed text-ink-soft">{m.invalid}</p>
        )}
        <div className="mt-6 flex flex-wrap gap-4 text-[13px] font-semibold">
          <Link href="/account" className="text-accent-ink hover:underline">{m.settings}</Link>
          <Link href="/" className="text-ink-faint hover:underline">{m.home}</Link>
        </div>
      </div>
    </main>
  );
}
