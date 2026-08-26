import type { Metadata } from "next";
import "./globals.css";
import { CookieBanner } from "@/components/cookie-banner";
import { APP_NAME } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";

export const metadata: Metadata = {
  title: `${APP_NAME} Coach`,
  description: "Coach dashboard — programs, nutrition, check-ins, adherence.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getI18n();
  return (
    <html lang={locale}>
      <body className="font-sans antialiased">
        <I18nProvider locale={locale} dict={t}>
          {children}
          <CookieBanner />
        </I18nProvider>
      </body>
    </html>
  );
}
