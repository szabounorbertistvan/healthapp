import Link from "next/link";
import type { Metadata } from "next";
import { APP_NAME, APP_INITIAL } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Terms of Service · ${APP_NAME}`,
  description: `The terms that apply when you use ${APP_NAME}.`,
};

// NOTE: working draft — have it reviewed by a lawyer before public launch, and
// fill in the operator identity and governing law below.
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 pb-24">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-black text-white">{APP_INITIAL}</span>
          <span className="text-lg font-extrabold tracking-tight">{APP_NAME}</span>
        </Link>
        <Link href="/" className="text-sm font-semibold text-accent-ink hover:underline">← Back</Link>
      </header>

      <h1 className="text-3xl font-extrabold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-ink-faint">Last updated: 26 August 2026</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-soft">
        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">1. The service</h2>
          <p>
            {APP_NAME} is a training, nutrition and coaching platform operated by{" "}
            <b className="text-ink">[operator name and address — fill in before launch]</b>.
            By creating an account you agree to these terms.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">2. Not medical advice</h2>
          <p>
            {APP_NAME} and the coaches on it provide fitness and nutrition guidance, not
            medical care. Programs, meal plans and any coach feedback are not a substitute
            for advice from a doctor. Consult one before starting a training or nutrition
            program, especially if you have a medical condition, are pregnant, or are under 18.
            You train at your own risk and within your own limits.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">3. Coaches and clients</h2>
          <p>
            Coaches on {APP_NAME} are independent professionals, not our employees. The
            coaching relationship — its quality, pricing and outcomes — is between you and
            your coach. We provide the tools: programs, plans, check-ins, messaging and
            adherence signals. Either side can end a coaching relationship at any time in
            the app; the coach then loses access to the client&apos;s new data.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">4. Your account</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>You must be at least 16 to create an account.</li>
            <li>Keep your credentials to yourself; you are responsible for activity on your account.</li>
            <li>Enter data honestly — coaches make decisions based on it.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">5. Acceptable use</h2>
          <p>
            Do not misuse the service: no harassment or abusive messages, no uploading
            content you have no right to share, no attempts to access other users&apos; data,
            no scraping, and no use of the platform for anything unlawful. We may suspend
            accounts that break these rules.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">6. Subscriptions</h2>
          <p>
            The free tier stays free. Paid tiers (Premium for clients; Starter and Pro for
            coaches) unlock additional features as described on the pricing page. Prices,
            billing and cancellation terms will be shown at the point of purchase when
            paid subscriptions launch.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">7. Your content and data</h2>
          <p>
            Your data stays yours. We use it only to run the service, as described in the{" "}
            <Link href="/privacy" className="font-semibold text-accent-ink hover:underline">Privacy Policy</Link>.
            You can export it or delete your account at any time from the app.
            Food data comes from Open Food Facts under the Open Database License.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">8. Liability</h2>
          <p>
            The service is provided &quot;as is&quot;. To the extent permitted by law, we are not
            liable for training injuries, dietary outcomes, coach decisions, or data loss
            beyond our control. Nothing in these terms limits liability that cannot be
            limited by law.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">9. Changes and termination</h2>
          <p>
            We may update these terms; material changes will be announced in the app
            before they take effect. You may close your account at any time. We may
            terminate accounts that violate these terms, with notice where reasonable.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">10. Governing law</h2>
          <p>
            These terms are governed by the laws of <b className="text-ink">[jurisdiction —
            fill in before launch]</b>, without affecting mandatory consumer protections of
            your country of residence.
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
