import type { Metadata } from "next";
import "./globals.css";
import { CookieBanner } from "@/components/cookie-banner";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${APP_NAME} Coach`,
  description: "Coach dashboard — programs, nutrition, check-ins, adherence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
