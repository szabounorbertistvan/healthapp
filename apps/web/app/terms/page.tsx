import Link from "next/link";
import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";
import { Logo } from "@/components/logo";
import { getLocale } from "@/lib/i18n/server";
import { LanguageSelector } from "@/components/language-selector";

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

// NOTE: working draft — have it reviewed by a lawyer before public launch, and
// fill in the operator identity and governing law below.

function EnglishContent() {
  return (
    <>
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
    </>
  );
}

function RomanianContent() {
  return (
    <>
      <h1 className="text-3xl font-extrabold tracking-tight">Termeni și condiții</h1>
      <p className="mt-2 text-sm text-ink-faint">Ultima actualizare: 26 august 2026</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-soft">
        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">1. Serviciul</h2>
          <p>
            {APP_NAME} este o platformă de antrenament, nutriție și coaching operată de{" "}
            <b className="text-ink">[numele și adresa operatorului — de completat înainte de lansare]</b>.
            Prin crearea unui cont, sunteți de acord cu acești termeni.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">2. Nu constituie sfat medical</h2>
          <p>
            {APP_NAME} și antrenorii de pe platformă oferă îndrumare în materie de fitness și
            nutriție, nu îngrijire medicală. Programele, planurile de mese și orice feedback
            din partea antrenorului nu înlocuiesc sfatul unui medic. Consultați un medic
            înainte de a începe un program de antrenament sau de nutriție, mai ales dacă aveți
            o afecțiune medicală, sunteți însărcinată sau aveți sub 18 ani. Vă antrenați pe
            propriul risc și în limitele proprii.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">3. Antrenori și clienți</h2>
          <p>
            Antrenorii de pe {APP_NAME} sunt profesioniști independenți, nu angajații noștri.
            Relația de coaching — calitatea, prețul și rezultatele acesteia — este între
            dumneavoastră și antrenorul dumneavoastră. Noi punem la dispoziție instrumentele:
            programe, planuri, check-in-uri, mesagerie și indicatori de aderență. Oricare
            dintre părți poate încheia relația de coaching în orice moment, din aplicație;
            antrenorul pierde apoi accesul la datele noi ale clientului.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">4. Contul dumneavoastră</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Trebuie să aveți cel puțin 16 ani pentru a crea un cont.</li>
            <li>Păstrați-vă datele de autentificare numai pentru dumneavoastră; sunteți responsabil de activitatea din contul dumneavoastră.</li>
            <li>Introduceți datele cu onestitate — antrenorii iau decizii pe baza lor.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">5. Utilizare acceptabilă</h2>
          <p>
            Nu utilizați serviciul în mod abuziv: fără hărțuire sau mesaje abuzive, fără
            încărcarea de conținut pe care nu aveți dreptul să îl distribuiți, fără încercări
            de a accesa datele altor utilizatori, fără extragere automată de date (scraping)
            și fără utilizarea platformei în scopuri ilegale. Putem suspenda conturile care
            încalcă aceste reguli.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">6. Abonamente</h2>
          <p>
            Nivelul gratuit rămâne gratuit. Nivelurile plătite (Premium pentru clienți;
            Starter și Pro pentru antrenori) deblochează funcții suplimentare, așa cum sunt
            descrise pe pagina de prețuri. Prețurile, condițiile de facturare și de anulare
            vor fi afișate la momentul achiziției, când abonamentele plătite vor fi lansate.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">7. Conținutul și datele dumneavoastră</h2>
          <p>
            Datele dumneavoastră rămân ale dumneavoastră. Le folosim numai pentru a opera
            serviciul, așa cum este descris în{" "}
            <Link href="/privacy" className="font-semibold text-accent-ink hover:underline">Politica de confidențialitate</Link>.
            Le puteți exporta sau vă puteți șterge contul în orice moment, din aplicație.
            Datele despre alimente provin de la Open Food Facts, sub licența Open Database License.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">8. Răspundere</h2>
          <p>
            Serviciul este furnizat „ca atare”. În măsura permisă de lege, nu suntem
            răspunzători pentru accidentări survenite la antrenament, rezultate ale dietei,
            deciziile antrenorilor sau pierderi de date aflate în afara controlului nostru.
            Nimic din acești termeni nu limitează răspunderea care nu poate fi limitată
            prin lege.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">9. Modificări și încetare</h2>
          <p>
            Putem actualiza acești termeni; modificările importante vor fi anunțate în
            aplicație înainte de a intra în vigoare. Vă puteți închide contul în orice moment.
            Putem închide conturile care încalcă acești termeni, cu notificare prealabilă
            acolo unde este rezonabil.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">10. Legea aplicabilă</h2>
          <p>
            Acești termeni sunt guvernați de legile din <b className="text-ink">[jurisdicția —
            de completat înainte de lansare]</b>, fără a afecta protecțiile obligatorii ale
            consumatorilor din țara dumneavoastră de reședință.
          </p>
        </section>
      </div>
    </>
  );
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

      {locale === "ro" ? <RomanianContent /> : <EnglishContent />}

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
