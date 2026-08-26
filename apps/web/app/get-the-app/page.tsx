import Link from "next/link";
import { APP_NAME, APP_INITIAL } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { LanguageSelector } from "@/components/language-selector";

// Clients land here if they sign into the web app — their surface is mobile.
export default async function GetTheAppPage() {
  const { t } = await getI18n();
  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="fixed right-4 top-4 z-20">
        <LanguageSelector />
      </div>
      <div className="max-w-md">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-lg font-black text-white">{APP_INITIAL}</span>
        <h1 className="text-2xl font-extrabold tracking-tight">{fill(t.getApp.title, { app: APP_NAME })}</h1>
        <p className="mt-3 text-ink-soft">{t.getApp.body}</p>
        <p className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm text-ink-soft">
          {t.getApp.beta}
        </p>
        <Link href="/" className="mt-6 inline-block text-sm font-semibold text-accent-ink hover:underline">
          {t.getApp.back}
        </Link>
      </div>
    </main>
  );
}
