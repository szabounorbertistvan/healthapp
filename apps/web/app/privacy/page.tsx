import { CookieSettingsButton } from "@/components/cookie-banner";
import Link from "next/link";
import type { Metadata } from "next";
import { APP_NAME, CONTACT_EMAIL } from "@/lib/brand";
import { Logo } from "@/components/logo";
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
// Have it reviewed by a lawyer before public launch. There is no company yet:
// name it under "Who we are" (and in /terms) once one runs the service.

function EnglishContent() {
  return (
    <>
      <h1 className="text-3xl font-extrabold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-ink-faint">Last updated: 22 October 2026</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-soft">
        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Who we are</h2>
          <p>
            {APP_NAME} is an independent project run by its developers, not yet by a
            registered company; when a company takes over running it, it will be named here.
            For any privacy question or request, contact{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-accent-ink hover:underline">{CONTACT_EMAIL}</a>.
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
          <p className="mt-2">
            Pictures are stored with Cloudinary. Progress photos and coaches&apos; qualification
            documents are stored privately and can only be opened through short-lived signed
            links the app creates for the people allowed to see them. Profile photos and coach
            cover images are public, because they are shown on your profile.
          </p>
          <p className="mt-2">
            The app itself is served by Vercel; the parts that run on its servers run in Vercel&apos;s
            Frankfurt (EU) region. If you sign in with Google, Google tells us the email address,
            name and picture of your Google account. If you turn on rest-timer notifications, your
            browser gives us an address at its push service (run by the browser&apos;s maker, such
            as Google, Apple or Mozilla); we keep it to send you the &quot;rest finished&quot;
            notification, whose content is encrypted for your browser.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Asking an AI for feedback</h2>
          <p>
            When you finish a workout you can choose to open an AI assistant (ChatGPT, Claude,
            Gemini, Grok or Perplexity) with a summary of that workout. Nothing is sent until
            you tap one. The summary — the workout&apos;s name and date, the exercises, sets,
            weights and effort, your notes on the sets, and your sex and age if you have set
            them, but never your name, username or email — then goes from your device to that
            service, in the link it opens or when you paste it, and that service handles it
            under its own terms. {APP_NAME} does not receive the answer. The exact text is
            shown under &quot;See what gets sent&quot; before you tap.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Cookies</h2>
          <p>
            We use strictly-necessary cookies: the session cookies that keep you signed in.
            Because they are essential, they need no consent.
          </p>
          <p className="mt-2">
            Only if you choose &quot;Accept analytics&quot; do we also use Google Analytics
            (Google Ireland Ltd.), which sets the <code>_ga</code> cookies, to count visits to
            our public pages — the home page, the coach directory and coach pages, sign-in,
            and these legal pages. It never runs inside your account, so no training,
            nutrition, body or message data ever reaches it. Advertising features are off.
            Google may process the data in the United States under the EU–US Data Privacy
            Framework. Nothing is loaded until you accept, and you can change your choice at
            any time; withdrawing deletes the <code>_ga</code> cookies from this browser.
          </p>
          <CookieSettingsButton />
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Coach directory measurement</h2>
          <p>
            On the public coach directory and coach pages we count, without cookies and
            without storing anything on your device, how often pages are viewed and which
            buttons (contact, book, save, create an account) are used, and where a visit
            came from (for example a search engine, Instagram or a utm_ link). A visitor is
            counted as a code computed from that day&apos;s random key, your IP address and
            browser type; the IP address and browser type are never stored, and the key is
            deleted the next day, so no visitor can be recognised or followed across days.
            Raw counts are deleted after 180 days. When you create an account from a coach
            page, we keep which coach page and source it came from, until your account is
            deleted or for two years. Coaches see only totals about their own page. Nothing
            is shared with any third party.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Coach applications and qualification documents</h2>
          <p>
            A coach profile appears in the directory only after a Voinic administrator has
            reviewed it. To show their qualifications, coaches upload certificates, diplomas
            or licences (and optionally other supporting documents, such as a CV). We do not
            ask for, accept or keep identity documents, and we do not verify identity.
            Qualification documents are stored privately: only the coach and Voinic&apos;s
            administrators can open them, they never appear on the public page, and they are
            not shared with anyone else. A coach can remove a document while their
            application is not under review; documents an approved profile relies on stay
            while the profile is live. A document that was not accepted, and the documents of
            an application that was rejected or withdrawn, are deleted after 12 months. All of
            them are deleted when the account is deleted. The decisions on an application
            (what was decided, when, and the note to the coach) are kept as a record while
            the account exists.
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
      <p className="mt-2 text-sm text-ink-faint">Ultima actualizare: 22 octombrie 2026</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-soft">
        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Cine suntem</h2>
          <p>
            {APP_NAME} este un proiect independent, administrat de dezvoltatorii săi, nu încă de
            o firmă înregistrată; când o firmă va prelua administrarea, va fi menționată aici.
            Pentru orice întrebare sau solicitare privind confidențialitatea, contactați{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-accent-ink hover:underline">{CONTACT_EMAIL}</a>.
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
          <p className="mt-2">
            Imaginile sunt stocate cu Cloudinary. Fotografiile de progres și documentele de
            calificare ale antrenorilor sunt stocate privat și pot fi deschise doar prin linkuri
            semnate, valabile scurt timp, pe care aplicația le creează pentru persoanele care au
            dreptul să le vadă. Fotografiile de profil și imaginile de copertă ale antrenorilor
            sunt publice, pentru că apar pe profilul dumneavoastră.
          </p>
          <p className="mt-2">
            Aplicația este servită de Vercel; părțile care rulează pe serverele sale rulează în
            regiunea Frankfurt (UE) a Vercel. Dacă vă autentificați cu Google, Google ne comunică
            adresa de email, numele și fotografia contului dumneavoastră Google. Dacă porniți
            notificările cronometrului de pauză, browserul ne dă o adresă la serviciul său de
            notificări (operat de producătorul browserului, de exemplu Google, Apple sau Mozilla);
            o păstrăm pentru a vă trimite notificarea „pauza s-a terminat”, al cărei conținut este
            criptat pentru browserul dumneavoastră.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Părerea unui AI despre antrenament</h2>
          <p>
            Când terminați un antrenament puteți alege să deschideți un asistent AI (ChatGPT,
            Claude, Gemini, Grok sau Perplexity) cu un rezumat al acelui antrenament. Nimic nu
            este trimis până nu apăsați pe unul. Rezumatul — numele și data antrenamentului,
            exercițiile, seriile, greutățile și efortul, notițele dumneavoastră la serii, precum
            și sexul și vârsta, dacă le-ați completat, dar niciodată numele, numele de utilizator
            sau adresa de email — pleacă atunci de pe dispozitivul dumneavoastră către acel
            serviciu, în linkul pe care îl deschide sau când îl lipiți, iar serviciul îl
            prelucrează potrivit propriilor sale condiții. {APP_NAME} nu primește răspunsul.
            Textul exact este afișat la „Vezi ce se trimite” înainte să apăsați.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Cookie-uri</h2>
          <p>
            Folosim cookie-uri strict necesare: cookie-urile de sesiune care vă mențin
            autentificat. Fiind esențiale, nu necesită consimțământ.
          </p>
          <p className="mt-2">
            Doar dacă alegeți „Accept analiza” folosim și Google Analytics (Google Ireland
            Ltd.), care setează cookie-urile <code>_ga</code>, pentru a număra vizitele pe
            paginile noastre publice — prima pagină, directorul și paginile antrenorilor,
            autentificarea și aceste pagini legale. Nu rulează niciodată în contul
            dumneavoastră, deci nicio dată despre antrenamente, nutriție, corp sau mesaje nu
            ajunge la Google. Funcțiile de publicitate sunt oprite. Google poate prelucra
            datele în Statele Unite, în baza Cadrului UE–SUA privind protecția datelor. Nimic
            nu se încarcă înainte de acordul dumneavoastră, iar alegerea poate fi schimbată
            oricând; retragerea șterge cookie-urile <code>_ga</code> din acest browser.
          </p>
          <CookieSettingsButton />
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Măsurarea directorului de antrenori</h2>
          <p>
            În directorul public de antrenori și pe paginile antrenorilor numărăm, fără
            cookie-uri și fără a stoca ceva pe dispozitivul dumneavoastră, cât de des sunt
            vizitate paginile, ce butoane sunt folosite (contact, programare, salvare, creare
            cont) și de unde a venit vizita (de exemplu un motor de căutare, Instagram sau un
            link utm_). Un vizitator este numărat ca un cod calculat din cheia aleatorie a
            zilei, adresa IP și tipul browserului; adresa IP și tipul browserului nu sunt
            stocate niciodată, iar cheia este ștearsă a doua zi, așa că niciun vizitator nu
            poate fi recunoscut sau urmărit de la o zi la alta. Numărătorile brute se șterg
            după 180 de zile. Când creați un cont de pe pagina unui antrenor, păstrăm de pe ce
            pagină și din ce sursă a venit, până la ștergerea contului sau timp de doi ani.
            Antrenorii văd doar totaluri despre propria pagină. Nimic nu este partajat cu terți.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Aplicațiile antrenorilor și documentele de calificare</h2>
          <p>
            Un profil de antrenor apare în director doar după ce un administrator Voinic l-a
            verificat. Pentru a-și dovedi calificările, antrenorii încarcă certificate, diplome
            sau licențe (și, opțional, alte documente doveditoare, de exemplu un CV). Nu cerem,
            nu acceptăm și nu păstrăm acte de identitate și nu verificăm identitatea.
            Documentele de calificare sunt stocate privat: doar antrenorul și administratorii
            Voinic le pot deschide, nu apar niciodată pe pagina publică și nu sunt partajate cu
            nimeni altcineva. Un antrenor își poate șterge un document cât timp aplicația nu
            este în verificare; documentele pe care se bazează un profil aprobat rămân cât
            timp profilul este public. Un document neacceptat, precum și documentele unei
            aplicații respinse sau retrase, se șterg după 12 luni. Toate se șterg odată cu
            contul. Deciziile luate asupra unei aplicații (ce s-a decis, când și nota pentru
            antrenor) sunt păstrate ca evidență cât timp există contul.
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
