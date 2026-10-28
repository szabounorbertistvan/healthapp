import Link from "next/link";
import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";
import { Logo } from "@/components/logo";
import { getLocale } from "@/lib/i18n/server";
import { LanguageSelector } from "@/components/language-selector";
import { LegalDocument } from "@/components/legal-document";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  if (locale === "ro") {
    return {
      title: `Termeni și condiții · ${APP_NAME}`,
      description: `Termenii care se aplică atunci când folosiți ${APP_NAME}.`,
    };
  }
  return {
    title: `Terms of Service · ${APP_NAME}`,
    description: `The terms that apply when you use ${APP_NAME}.`,
  };
}

export default async function TermsPage() {
  const locale = await getLocale();
  return (
    <main className="mx-auto max-w-2xl px-6 pb-24">
      <div className="fixed right-4 top-4 z-20"><LanguageSelector /></div>
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-2">
          <Logo size="sm" />
        </Link>
        <Link href="/" className="text-sm font-semibold text-accent-ink hover:underline">
          {locale === "ro" ? "← Înapoi" : "← Back"}
        </Link>
      </header>

      <LegalDocument page="terms" locale={locale} />

      <footer className="mt-16 border-t border-line pt-6 text-center text-xs text-ink-faint">
        <Link href="/privacy" className="hover:underline">{locale === "ro" ? "Confidențialitate" : "Privacy"}</Link>
        {" · "}
        <Link href="/terms" className="hover:underline">{locale === "ro" ? "Termeni" : "Terms"}</Link>
        {" · "}
        {APP_NAME} · {locale === "ro" ? "Date despre alimente de la Open Food Facts" : "Food data from Open Food Facts"}
      </footer>
    </main>
  );
}
