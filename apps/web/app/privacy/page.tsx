import Link from "next/link";
import type { Metadata } from "next";
import { APP_NAME, APP_INITIAL } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/server";
import { LanguageSelector } from "@/components/language-selector";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  if (locale === "ro") {
    return {
      title: `Politica de confidențialitate · ${APP_NAME}`,
      description: `Ce date stochează ${APP_NAME}, de ce, și drepturile pe care le aveți asupra lor.`,
    };
  }
  return {
    title: `Privacy Policy · ${APP_NAME}`,
    description: `What data ${APP_NAME} stores, why, and the rights you have over it.`,
  };
}

// NOTE: this is a working draft written from what the app actually does.
// Have it reviewed by a lawyer before public launch, and fill in the
// operator identity below.

function EnglishContent() {
  return (
    <>
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
    </>
  );
}

function RomanianContent() {
  return (
    <>
      <h1 className="text-3xl font-extrabold tracking-tight">Politica de confidențialitate</h1>
      <p className="mt-2 text-sm text-ink-faint">Ultima actualizare: 26 august 2026</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-soft">
        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Cine suntem</h2>
          <p>
            {APP_NAME} este operat de <b className="text-ink">[numele și adresa operatorului — de completat înainte de lansare]</b>.
            Pentru orice întrebare sau solicitare privind confidențialitatea, contactați{" "}
            <b className="text-ink">[contact email]</b>.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Ce date stocăm</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-ink">Cont</b> — adresa de e-mail, numele afișat, avatarul, preferințele de limbă și de unități de măsură.</li>
            <li><b className="text-ink">Date de antrenament</b> — programe, antrenamente înregistrate, seturi, greutăți, recorduri personale.</li>
            <li><b className="text-ink">Date de nutriție</b> — planuri de mese, jurnale alimentare și valorile lor de calorii/macronutrienți la momentul înregistrării.</li>
            <li><b className="text-ink">Date de progres</b> — greutatea corporală, măsurătorile, check-in-urile săptămânale (somn, energie, stres, foame, recuperare, notițe) și fotografiile de progres, dacă le încărcați.</li>
            <li><b className="text-ink">Date de coaching</b> — relația cu antrenorul dumneavoastră, mesajele și feedbackul antrenorului.</li>
            <li><b className="text-ink">Date de implicare</b> — obiceiuri, serii de zile consecutive, insigne și notificări în aplicație.</li>
          </ul>
          <p className="mt-2">
            Datele de antrenament, nutriție și progres pot dezvălui informații despre sănătatea
            dumneavoastră. Le stocăm exclusiv pentru a furniza serviciul dumneavoastră și
            antrenorului dumneavoastră — niciodată în scopuri publicitare — și nu le vindem.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Cine vă poate vedea datele</h2>
          <p>
            Datele dumneavoastră sunt vizibile pentru dumneavoastră și — numai cât timp aveți o
            relație de coaching <i>activă</i> — pentru antrenorul dumneavoastră. Accesul este
            impus chiar la nivelul bazei de date (securitate la nivel de rând), nu doar în
            aplicație. Când o relație de coaching se încheie, antrenorul pierde automat accesul
            la datele dumneavoastră noi.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Unde sunt stocate</h2>
          <p>
            Datele sunt stocate cu Supabase, pe AWS, în UE (regiunea eu-west-1, Irlanda).
            Când căutați alimente sau scanați un cod de bare, termenul de căutare sau codul de
            bare este trimis către{" "}
            <a href="https://openfoodfacts.org" className="font-semibold text-accent-ink hover:underline">Open Food Facts</a>{" "}
            pentru a consulta datele nutriționale; nicio informație despre cont nu este trimisă
            împreună cu acesta.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Cookie-uri</h2>
          <p>
            Folosim numai cookie-uri strict necesare: cookie-urile de sesiune care vă mențin
            autentificat. Nu există cookie-uri de analiză, de publicitate sau de urmărire.
            Deoarece aceste cookie-uri sunt esențiale, consimțământul nu este necesar — doar
            vă informăm.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Drepturile dumneavoastră (GDPR)</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-ink">Export</b> — descărcați, din Setări, tot ce deținem despre dumneavoastră, în orice moment.</li>
            <li><b className="text-ink">Ștergere</b> — solicitați ștergerea contului din aplicație. Profilul dumneavoastră este anonimizat imediat, iar toate datele sunt eliminate definitiv în termen de 30 de zile.</li>
            <li><b className="text-ink">Acces, rectificare, restricționare, opoziție</b> — contactați-ne la adresa de mai sus.</li>
            <li>Puteți depune o plângere la autoritatea de protecție a datelor din țara dumneavoastră.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Păstrarea datelor</h2>
          <p>
            Datele sunt păstrate cât timp există contul dumneavoastră. După o solicitare de
            ștergere, datele rămase sunt eliminate în termen de 30 de zile. Mesajele pe care
            le-ați trimis unui antrenor rămân vizibile pentru acesta (cu numele dumneavoastră
            eliminat), astfel încât partea sa de conversație să rămână intactă.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Modificări</h2>
          <p>
            Dacă această politică se modifică într-un mod care vă afectează, vă vom anunța în
            aplicație înainte ca modificarea să intre în vigoare.
          </p>
        </section>
      </div>
    </>
  );
}

export default async function PrivacyPage() {
  const locale = await getLocale();
  return (
    <main className="mx-auto max-w-2xl px-6 pb-24">
      <div className="fixed right-4 top-4"><LanguageSelector /></div>
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-black text-white">{APP_INITIAL}</span>
          <span className="text-lg font-extrabold tracking-tight">{APP_NAME}</span>
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
