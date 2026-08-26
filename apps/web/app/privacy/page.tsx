import Link from "next/link";
import type { Metadata } from "next";
import { APP_NAME, APP_INITIAL } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Privacy Policy · ${APP_NAME}`,
  description: `What data ${APP_NAME} stores, why, and the rights you have over it.`,
};

// NOTE: this is a working draft written from what the app actually does.
// Have it reviewed by a lawyer before public launch, and fill in the
// operator identity below.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 pb-24">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-black text-white">{APP_INITIAL}</span>
          <span className="text-lg font-extrabold tracking-tight">{APP_NAME}</span>
        </Link>
        <Link href="/" className="text-sm font-semibold text-accent-ink hover:underline">← Back</Link>
      </header>

      <h1 className="text-3xl font-extrabold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-ink-faint">Last updated: 26 August 2026</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-soft">
        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Who we are</h2>
          <p>
            {APP_NAME} is operated by <b className="text-ink">[operator name and address — fill in before launch]</b>.
            For any privacy question or request, contact{" "}
            <b className="text-ink">[contact email]</b>.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">What we store</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-ink">Account</b> — email address, display name, avatar, language and unit preferences.</li>
            <li><b className="text-ink">Training data</b> — programs, logged workouts, sets, weights, personal records.</li>
            <li><b className="text-ink">Nutrition data</b> — meal plans, food logs and their calorie/macro snapshots.</li>
            <li><b className="text-ink">Progress data</b> — body weight, measurements, weekly check-ins (sleep, energy, stress, hunger, recovery, notes), and progress photos if you upload them.</li>
            <li><b className="text-ink">Coaching data</b> — your coach relationship, messages, and coach feedback.</li>
            <li><b className="text-ink">Engagement data</b> — habits, streaks, badges, and in-app notifications.</li>
          </ul>
          <p className="mt-2">
            Training, nutrition and progress data can reveal information about your health.
            We store it solely to provide the service to you and your coach — never for
            advertising, and we do not sell it.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Who can see your data</h2>
          <p>
            Your data is visible to you and — only while you have an <i>active</i> coaching
            relationship — to your coach. Access is enforced in the database itself
            (row-level security), not just in the app. When a coaching relationship ends,
            the coach loses access to your new data automatically.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Where it lives</h2>
          <p>
            Data is stored with Supabase on AWS in the EU (region eu-west-1, Ireland).
            When you search foods or scan a barcode, the search term or barcode is sent to{" "}
            <a href="https://openfoodfacts.org" className="font-semibold text-accent-ink hover:underline">Open Food Facts</a>{" "}
            to look up nutrition data; no account information is sent with it.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Cookies</h2>
          <p>
            We use only strictly-necessary cookies: the session cookies that keep you
            signed in. There are no analytics, advertising or tracking cookies. Because
            these cookies are essential, no consent is required — we just tell you.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Your rights (GDPR)</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-ink">Export</b> — download everything we hold about you, from Settings, at any time.</li>
            <li><b className="text-ink">Deletion</b> — request account deletion in the app. Your profile is anonymised immediately and all data is permanently purged within 30 days.</li>
            <li><b className="text-ink">Access, rectification, restriction, objection</b> — contact us at the address above.</li>
            <li>You may lodge a complaint with your local data-protection authority.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Retention</h2>
          <p>
            Data is kept while your account exists. After a deletion request, remaining
            data is purged within 30 days. Messages you sent to a coach remain visible to
            them (with your name removed) so their side of the conversation stays intact.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Changes</h2>
          <p>
            If this policy changes in a way that affects you, we will tell you in the app
            before the change takes effect.
          </p>
        </section>
      </div>

      <footer className="mt-16 border-t border-line pt-6 text-center text-xs text-ink-faint">
        <Link href="/privacy" className="hover:underline">Privacy</Link>
        {" · "}
        <Link href="/terms" className="hover:underline">Terms</Link>
        {" · "}
        {APP_NAME} · Food data from Open Food Facts
      </footer>
    </main>
  );
}
