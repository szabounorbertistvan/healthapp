import type { Metadata } from "next";
import { Exo_2, Inter } from "next/font/google";
import "./globals.css";
import { CookieBanner } from "@/components/cookie-banner";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { getTheme } from "@/lib/theme-server";

// Brand type: Exo 2 matches the squared, rounded-corner capitals of the logo
// wordmark (display + headings); Inter carries body copy.
// next/font self-hosts both at build time — no runtime request to Google.
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });
const exo2 = Exo_2({ subsets: ["latin", "latin-ext"], weight: ["600", "700", "800"], variable: "--font-exo2", display: "swap" });

export const metadata: Metadata = {
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description: "Antrenament, nutriție, check-in-uri și coaching într-o singură aplicație. Training, nutrition, check-ins and coaching in one app.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ locale, t }, theme] = await Promise.all([getI18n(), getTheme()]);
  return (
    <html lang={locale} data-theme={theme === "system" ? undefined : theme} className={`${inter.variable} ${exo2.variable}`}>
      <body className="font-sans antialiased">
        <I18nProvider locale={locale} dict={t}>
          {children}
          <CookieBanner />
        </I18nProvider>
      </body>
    </html>
  );
}
