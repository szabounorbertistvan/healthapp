import type { Locale } from "./config";

// The Terms of Service and the Privacy Policy — one text each, read by the web's
// /terms and /privacy pages and by the app's own legal screen, so what people agree
// to can never differ between the site and the phone.
//
// NOTE: working drafts written from what the app actually does — have them reviewed
// by a lawyer before public launch. There is no company yet: name it in Terms §1 and
// under Privacy "Who we are" once one runs the service.
//
// Text markup, kept tiny on purpose (parseInline below): **bold**, *italic*, `code`,
// [label](href). {app} and {email} are the product name and the contact address,
// filled in by each renderer from its own brand constants.

export type LegalPage = "terms" | "privacy";

export type LegalBlock =
  | { p: string }
  | { ul: string[] }
  /** The web's cookie-choice button; the app has no cookies and skips it. */
  | { cookieSettings: true };

export type LegalDoc = {
  title: string;
  /** "Last updated: …", already in the document's language. */
  updated: string;
  sections: { h: string; blocks: LegalBlock[] }[];
};

const terms: Record<Locale, LegalDoc> = {
  en: {
    title: "Terms of Service",
    updated: "Last updated: 22 October 2026",
    sections: [
      {
        h: "1. The service",
        blocks: [
          { p: "{app} is a training, nutrition and coaching platform. It is an independent project run by its developers, not yet by a registered company; when a company takes over running it, it will be named here and announced in the app. By creating an account you agree to these terms." },
        ],
      },
      {
        h: "2. Not medical advice",
        blocks: [
          { p: "{app} and the coaches on it provide fitness and nutrition guidance, not medical care. Programs, meal plans and any coach feedback are not a substitute for advice from a doctor. Consult one before starting a training or nutrition program, especially if you have a medical condition, are pregnant, or are under 18. You train at your own risk and within your own limits." },
        ],
      },
      {
        h: "3. Coaches and clients",
        blocks: [
          { p: "Coaches on {app} are independent professionals, not our employees. The coaching relationship — its quality, pricing and outcomes — is between you and your coach. We provide the tools: programs, plans, check-ins, messaging and adherence signals. Either side can end a coaching relationship at any time in the app; the coach then loses access to the client's new data." },
        ],
      },
      {
        h: "4. Your account",
        blocks: [
          {
            ul: [
              "You must be at least 16 to create an account.",
              "Keep your credentials to yourself; you are responsible for activity on your account.",
              "Enter data honestly — coaches make decisions based on it.",
            ],
          },
        ],
      },
      {
        h: "5. Acceptable use",
        blocks: [
          { p: "Do not misuse the service: no harassment or abusive messages, no uploading content you have no right to share, no attempts to access other users' data, no scraping, and no use of the platform for anything unlawful. We may suspend accounts that break these rules." },
        ],
      },
      {
        h: "6. Subscriptions",
        blocks: [
          { p: "The free tier stays free. Paid tiers (Premium for clients; Starter and Pro for coaches) unlock additional features as described on the pricing page. Prices, billing and cancellation terms will be shown at the point of purchase when paid subscriptions launch." },
        ],
      },
      {
        h: "7. Your content and data",
        blocks: [
          { p: "Your data stays yours. We use it only to run the service, as described in the [Privacy Policy](/privacy). You can export it or delete your account at any time from the app. Food data comes from Open Food Facts under the Open Database License." },
        ],
      },
      {
        h: "8. Liability",
        blocks: [
          { p: "The service is provided \"as is\". To the extent permitted by law, we are not liable for training injuries, dietary outcomes, coach decisions, or data loss beyond our control. Nothing in these terms limits liability that cannot be limited by law." },
        ],
      },
      {
        h: "9. Changes and termination",
        blocks: [
          { p: "We may update these terms; material changes will be announced in the app before they take effect. You may close your account at any time. We may terminate accounts that violate these terms, with notice where reasonable." },
        ],
      },
      {
        h: "10. Governing law",
        blocks: [
          { p: "These terms are governed by Romanian law, without affecting mandatory consumer protections of your country of residence." },
        ],
      },
      {
        h: "11. Contact",
        blocks: [{ p: "Questions about these terms or your account: [{email}](mailto:{email})." }],
      },
    ],
  },
  ro: {
    title: "Termeni și condiții",
    updated: "Ultima actualizare: 22 octombrie 2026",
    sections: [
      {
        h: "1. Serviciul",
        blocks: [
          { p: "{app} este o platformă de antrenament, nutriție și coaching. Este un proiect independent, administrat de dezvoltatorii săi, nu încă de o firmă înregistrată; când o firmă va prelua administrarea, va fi menționată aici și anunțată în aplicație. Prin crearea unui cont, sunteți de acord cu acești termeni." },
        ],
      },
      {
        h: "2. Nu constituie sfat medical",
        blocks: [
          { p: "{app} și antrenorii de pe platformă oferă îndrumare în materie de fitness și nutriție, nu îngrijire medicală. Programele, planurile de mese și orice feedback din partea antrenorului nu înlocuiesc sfatul unui medic. Consultați un medic înainte de a începe un program de antrenament sau de nutriție, mai ales dacă aveți o afecțiune medicală, sunteți însărcinată sau aveți sub 18 ani. Vă antrenați pe propriul risc și în limitele proprii." },
        ],
      },
      {
        h: "3. Antrenori și clienți",
        blocks: [
          { p: "Antrenorii de pe {app} sunt profesioniști independenți, nu angajații noștri. Relația de coaching — calitatea, prețul și rezultatele acesteia — este între dumneavoastră și antrenorul dumneavoastră. Noi punem la dispoziție instrumentele: programe, planuri, check-in-uri, mesagerie și indicatori de aderență. Oricare dintre părți poate încheia relația de coaching în orice moment, din aplicație; antrenorul pierde apoi accesul la datele noi ale clientului." },
        ],
      },
      {
        h: "4. Contul dumneavoastră",
        blocks: [
          {
            ul: [
              "Trebuie să aveți cel puțin 16 ani pentru a crea un cont.",
              "Păstrați-vă datele de autentificare numai pentru dumneavoastră; sunteți responsabil de activitatea din contul dumneavoastră.",
              "Introduceți datele cu onestitate — antrenorii iau decizii pe baza lor.",
            ],
          },
        ],
      },
      {
        h: "5. Utilizare acceptabilă",
        blocks: [
          { p: "Nu utilizați serviciul în mod abuziv: fără hărțuire sau mesaje abuzive, fără încărcarea de conținut pe care nu aveți dreptul să îl distribuiți, fără încercări de a accesa datele altor utilizatori, fără extragere automată de date (scraping) și fără utilizarea platformei în scopuri ilegale. Putem suspenda conturile care încalcă aceste reguli." },
        ],
      },
      {
        h: "6. Abonamente",
        blocks: [
          { p: "Nivelul gratuit rămâne gratuit. Nivelurile plătite (Premium pentru clienți; Starter și Pro pentru antrenori) deblochează funcții suplimentare, așa cum sunt descrise pe pagina de prețuri. Prețurile, condițiile de facturare și de anulare vor fi afișate la momentul achiziției, când abonamentele plătite vor fi lansate." },
        ],
      },
      {
        h: "7. Conținutul și datele dumneavoastră",
        blocks: [
          { p: "Datele dumneavoastră rămân ale dumneavoastră. Le folosim numai pentru a opera serviciul, așa cum este descris în [Politica de confidențialitate](/privacy). Le puteți exporta sau vă puteți șterge contul în orice moment, din aplicație. Datele despre alimente provin de la Open Food Facts, sub licența Open Database License." },
        ],
      },
      {
        h: "8. Răspundere",
        blocks: [
          { p: "Serviciul este furnizat „ca atare”. În măsura permisă de lege, nu suntem răspunzători pentru accidentări survenite la antrenament, rezultate ale dietei, deciziile antrenorilor sau pierderi de date aflate în afara controlului nostru. Nimic din acești termeni nu limitează răspunderea care nu poate fi limitată prin lege." },
        ],
      },
      {
        h: "9. Modificări și încetare",
        blocks: [
          { p: "Putem actualiza acești termeni; modificările importante vor fi anunțate în aplicație înainte de a intra în vigoare. Vă puteți închide contul în orice moment. Putem închide conturile care încalcă acești termeni, cu notificare prealabilă acolo unde este rezonabil." },
        ],
      },
      {
        h: "10. Legea aplicabilă",
        blocks: [
          { p: "Acești termeni sunt guvernați de legea română, fără a afecta protecțiile obligatorii ale consumatorilor din țara dumneavoastră de reședință." },
        ],
      },
      {
        h: "11. Contact",
        blocks: [{ p: "Întrebări despre acești termeni sau despre contul dumneavoastră: [{email}](mailto:{email})." }],
      },
    ],
  },
};

const privacy: Record<Locale, LegalDoc> = {
  en: {
    title: "Privacy Policy",
    updated: "Last updated: 22 October 2026",
    sections: [
      {
        h: "Who we are",
        blocks: [
          { p: "{app} is an independent project run by its developers, not yet by a registered company; when a company takes over running it, it will be named here. For any privacy question or request, contact [{email}](mailto:{email})." },
        ],
      },
      {
        h: "What we store",
        blocks: [
          {
            ul: [
              "**Account** — email address, display name, avatar, language and unit preferences.",
              "**Training data** — programs, logged workouts, sets, weights, personal records.",
              "**Nutrition data** — meal plans, food logs and their calorie/macro snapshots.",
              "**Progress data** — body weight, measurements, weekly check-ins (sleep, energy, stress, hunger, recovery, notes), and progress photos if you upload them.",
              "**Coaching data** — your coach relationship, messages, and coach feedback.",
              "**Engagement data** — habits, streaks, badges, and in-app notifications.",
            ],
          },
          { p: "Training, nutrition and progress data can reveal information about your health. We store it solely to provide the service to you and your coach — never for advertising, and we do not sell it." },
        ],
      },
      {
        h: "Who can see your data",
        blocks: [
          { p: "Your data is visible to you and — only while you have an *active* coaching relationship — to your coach. Access is enforced in the database itself (row-level security), not just in the app. When a coaching relationship ends, the coach loses access to your new data automatically." },
        ],
      },
      {
        h: "Where it lives",
        blocks: [
          { p: "Data is stored with Supabase on AWS in the EU (region eu-west-1, Ireland). When you search foods or scan a barcode, the search term or barcode is sent to [Open Food Facts](https://openfoodfacts.org) to look up nutrition data; no account information is sent with it." },
          { p: "Pictures are stored with Cloudinary. Progress photos and coaches' qualification documents are stored privately and can only be opened through short-lived signed links the app creates for the people allowed to see them. Profile photos and coach cover images are public, because they are shown on your profile." },
          { p: "The app itself is served by Vercel; the parts that run on its servers run in Vercel's Frankfurt (EU) region. If you sign in with Google, Google tells us the email address, name and picture of your Google account. If you turn on rest-timer notifications, your browser gives us an address at its push service (run by the browser's maker, such as Google, Apple or Mozilla); we keep it to send you the \"rest finished\" notification, whose content is encrypted for your browser." },
        ],
      },
      {
        h: "Asking an AI for feedback",
        blocks: [
          { p: "When you finish a workout you can choose to open an AI assistant (ChatGPT, Claude, Gemini, Grok or Perplexity) with a summary of that workout. Nothing is sent until you tap one. The summary — the workout's name and date, the exercises, sets, weights and effort, your notes on the sets, and your sex and age if you have set them, but never your name, username or email — then goes from your device to that service, in the link it opens or when you paste it, and that service handles it under its own terms. {app} does not receive the answer. The exact text is shown under \"See what gets sent\" before you tap." },
        ],
      },
      {
        h: "Cookies",
        blocks: [
          { p: "We use strictly-necessary cookies: the session cookies that keep you signed in. Because they are essential, they need no consent." },
          { p: "Only if you choose \"Accept analytics\" do we also use Google Analytics (Google Ireland Ltd.), which sets the `_ga` cookies, to count visits to our public pages — the home page, the coach directory and coach pages, sign-in, and these legal pages. It never runs inside your account, so no training, nutrition, body or message data ever reaches it. Advertising features are off. Google may process the data in the United States under the EU–US Data Privacy Framework. Nothing is loaded until you accept, and you can change your choice at any time; withdrawing deletes the `_ga` cookies from this browser." },
          { cookieSettings: true },
        ],
      },
      {
        h: "Coach directory measurement",
        blocks: [
          { p: "On the public coach directory and coach pages we count, without cookies and without storing anything on your device, how often pages are viewed and which buttons (contact, book, save, create an account) are used, and where a visit came from (for example a search engine, Instagram or a utm_ link). A visitor is counted as a code computed from that day's random key, your IP address and browser type; the IP address and browser type are never stored, and the key is deleted the next day, so no visitor can be recognised or followed across days. Raw counts are deleted after 180 days. When you create an account from a coach page, we keep which coach page and source it came from, until your account is deleted or for two years. Coaches see only totals about their own page. Nothing is shared with any third party." },
        ],
      },
      {
        h: "Coach applications and qualification documents",
        blocks: [
          { p: "A coach profile appears in the directory only after a Voinic administrator has reviewed it. To show their qualifications, coaches upload certificates, diplomas or licences (and optionally other supporting documents, such as a CV). We do not ask for, accept or keep identity documents, and we do not verify identity. Qualification documents are stored privately: only the coach and Voinic's administrators can open them, they never appear on the public page, and they are not shared with anyone else. A coach can remove a document while their application is not under review; documents an approved profile relies on stay while the profile is live. A document that was not accepted, and the documents of an application that was rejected or withdrawn, are deleted after 12 months. All of them are deleted when the account is deleted. The decisions on an application (what was decided, when, and the note to the coach) are kept as a record while the account exists." },
        ],
      },
      {
        h: "Your rights (GDPR)",
        blocks: [
          {
            ul: [
              "**Export** — download everything we hold about you, from Settings, at any time.",
              "**Deletion** — request account deletion in the app. Your profile is anonymised immediately and all data is permanently purged within 30 days.",
              "**Access, rectification, restriction, objection** — contact us at the address above.",
              "You may lodge a complaint with your local data-protection authority.",
            ],
          },
        ],
      },
      {
        h: "Retention",
        blocks: [
          { p: "Data is kept while your account exists. After a deletion request, remaining data is purged within 30 days. Messages you sent to a coach remain visible to them (with your name removed) so their side of the conversation stays intact." },
        ],
      },
      {
        h: "Changes",
        blocks: [
          { p: "If this policy changes in a way that affects you, we will tell you in the app before the change takes effect." },
        ],
      },
    ],
  },
  ro: {
    title: "Politica de confidențialitate",
    updated: "Ultima actualizare: 22 octombrie 2026",
    sections: [
      {
        h: "Cine suntem",
        blocks: [
          { p: "{app} este un proiect independent, administrat de dezvoltatorii săi, nu încă de o firmă înregistrată; când o firmă va prelua administrarea, va fi menționată aici. Pentru orice întrebare sau solicitare privind confidențialitatea, contactați [{email}](mailto:{email})." },
        ],
      },
      {
        h: "Ce date stocăm",
        blocks: [
          {
            ul: [
              "**Cont** — adresa de e-mail, numele afișat, avatarul, preferințele de limbă și de unități de măsură.",
              "**Date de antrenament** — programe, antrenamente înregistrate, seturi, greutăți, recorduri personale.",
              "**Date de nutriție** — planuri de mese, jurnale alimentare și valorile lor de calorii/macronutrienți la momentul înregistrării.",
              "**Date de progres** — greutatea corporală, măsurătorile, check-in-urile săptămânale (somn, energie, stres, foame, recuperare, notițe) și fotografiile de progres, dacă le încărcați.",
              "**Date de coaching** — relația cu antrenorul dumneavoastră, mesajele și feedbackul antrenorului.",
              "**Date de implicare** — obiceiuri, serii de zile consecutive, insigne și notificări în aplicație.",
            ],
          },
          { p: "Datele de antrenament, nutriție și progres pot dezvălui informații despre sănătatea dumneavoastră. Le stocăm exclusiv pentru a furniza serviciul dumneavoastră și antrenorului dumneavoastră — niciodată în scopuri publicitare — și nu le vindem." },
        ],
      },
      {
        h: "Cine vă poate vedea datele",
        blocks: [
          { p: "Datele dumneavoastră sunt vizibile pentru dumneavoastră și — numai cât timp aveți o relație de coaching *activă* — pentru antrenorul dumneavoastră. Accesul este impus chiar la nivelul bazei de date (securitate la nivel de rând), nu doar în aplicație. Când o relație de coaching se încheie, antrenorul pierde automat accesul la datele dumneavoastră noi." },
        ],
      },
      {
        h: "Unde sunt stocate",
        blocks: [
          { p: "Datele sunt stocate cu Supabase, pe AWS, în UE (regiunea eu-west-1, Irlanda). Când căutați alimente sau scanați un cod de bare, termenul de căutare sau codul de bare este trimis către [Open Food Facts](https://openfoodfacts.org) pentru a consulta datele nutriționale; nicio informație despre cont nu este trimisă împreună cu acesta." },
          { p: "Imaginile sunt stocate cu Cloudinary. Fotografiile de progres și documentele de calificare ale antrenorilor sunt stocate privat și pot fi deschise doar prin linkuri semnate, valabile scurt timp, pe care aplicația le creează pentru persoanele care au dreptul să le vadă. Fotografiile de profil și imaginile de copertă ale antrenorilor sunt publice, pentru că apar pe profilul dumneavoastră." },
          { p: "Aplicația este servită de Vercel; părțile care rulează pe serverele sale rulează în regiunea Frankfurt (UE) a Vercel. Dacă vă autentificați cu Google, Google ne comunică adresa de email, numele și fotografia contului dumneavoastră Google. Dacă porniți notificările cronometrului de pauză, browserul ne dă o adresă la serviciul său de notificări (operat de producătorul browserului, de exemplu Google, Apple sau Mozilla); o păstrăm pentru a vă trimite notificarea „pauza s-a terminat”, al cărei conținut este criptat pentru browserul dumneavoastră." },
        ],
      },
      {
        h: "Părerea unui AI despre antrenament",
        blocks: [
          { p: "Când terminați un antrenament puteți alege să deschideți un asistent AI (ChatGPT, Claude, Gemini, Grok sau Perplexity) cu un rezumat al acelui antrenament. Nimic nu este trimis până nu apăsați pe unul. Rezumatul — numele și data antrenamentului, exercițiile, seriile, greutățile și efortul, notițele dumneavoastră la serii, precum și sexul și vârsta, dacă le-ați completat, dar niciodată numele, numele de utilizator sau adresa de email — pleacă atunci de pe dispozitivul dumneavoastră către acel serviciu, în linkul pe care îl deschide sau când îl lipiți, iar serviciul îl prelucrează potrivit propriilor sale condiții. {app} nu primește răspunsul. Textul exact este afișat la „Vezi ce se trimite” înainte să apăsați." },
        ],
      },
      {
        h: "Cookie-uri",
        blocks: [
          { p: "Folosim cookie-uri strict necesare: cookie-urile de sesiune care vă mențin autentificat. Fiind esențiale, nu necesită consimțământ." },
          { p: "Doar dacă alegeți „Accept analiza” folosim și Google Analytics (Google Ireland Ltd.), care setează cookie-urile `_ga`, pentru a număra vizitele pe paginile noastre publice — prima pagină, directorul și paginile antrenorilor, autentificarea și aceste pagini legale. Nu rulează niciodată în contul dumneavoastră, deci nicio dată despre antrenamente, nutriție, corp sau mesaje nu ajunge la Google. Funcțiile de publicitate sunt oprite. Google poate prelucra datele în Statele Unite, în baza Cadrului UE–SUA privind protecția datelor. Nimic nu se încarcă înainte de acordul dumneavoastră, iar alegerea poate fi schimbată oricând; retragerea șterge cookie-urile `_ga` din acest browser." },
          { cookieSettings: true },
        ],
      },
      {
        h: "Măsurarea directorului de antrenori",
        blocks: [
          { p: "În directorul public de antrenori și pe paginile antrenorilor numărăm, fără cookie-uri și fără a stoca ceva pe dispozitivul dumneavoastră, cât de des sunt vizitate paginile, ce butoane sunt folosite (contact, programare, salvare, creare cont) și de unde a venit vizita (de exemplu un motor de căutare, Instagram sau un link utm_). Un vizitator este numărat ca un cod calculat din cheia aleatorie a zilei, adresa IP și tipul browserului; adresa IP și tipul browserului nu sunt stocate niciodată, iar cheia este ștearsă a doua zi, așa că niciun vizitator nu poate fi recunoscut sau urmărit de la o zi la alta. Numărătorile brute se șterg după 180 de zile. Când creați un cont de pe pagina unui antrenor, păstrăm de pe ce pagină și din ce sursă a venit, până la ștergerea contului sau timp de doi ani. Antrenorii văd doar totaluri despre propria pagină. Nimic nu este partajat cu terți." },
        ],
      },
      {
        h: "Aplicațiile antrenorilor și documentele de calificare",
        blocks: [
          { p: "Un profil de antrenor apare în director doar după ce un administrator Voinic l-a verificat. Pentru a-și dovedi calificările, antrenorii încarcă certificate, diplome sau licențe (și, opțional, alte documente doveditoare, de exemplu un CV). Nu cerem, nu acceptăm și nu păstrăm acte de identitate și nu verificăm identitatea. Documentele de calificare sunt stocate privat: doar antrenorul și administratorii Voinic le pot deschide, nu apar niciodată pe pagina publică și nu sunt partajate cu nimeni altcineva. Un antrenor își poate șterge un document cât timp aplicația nu este în verificare; documentele pe care se bazează un profil aprobat rămân cât timp profilul este public. Un document neacceptat, precum și documentele unei aplicații respinse sau retrase, se șterg după 12 luni. Toate se șterg odată cu contul. Deciziile luate asupra unei aplicații (ce s-a decis, când și nota pentru antrenor) sunt păstrate ca evidență cât timp există contul." },
        ],
      },
      {
        h: "Drepturile dumneavoastră (GDPR)",
        blocks: [
          {
            ul: [
              "**Export** — descărcați, din Setări, tot ce deținem despre dumneavoastră, în orice moment.",
              "**Ștergere** — solicitați ștergerea contului din aplicație. Profilul dumneavoastră este anonimizat imediat, iar toate datele sunt eliminate definitiv în termen de 30 de zile.",
              "**Acces, rectificare, restricționare, opoziție** — contactați-ne la adresa de mai sus.",
              "Puteți depune o plângere la autoritatea de protecție a datelor din țara dumneavoastră.",
            ],
          },
        ],
      },
      {
        h: "Păstrarea datelor",
        blocks: [
          { p: "Datele sunt păstrate cât timp există contul dumneavoastră. După o solicitare de ștergere, datele rămase sunt eliminate în termen de 30 de zile. Mesajele pe care le-ați trimis unui antrenor rămân vizibile pentru acesta (cu numele dumneavoastră eliminat), astfel încât partea sa de conversație să rămână intactă." },
        ],
      },
      {
        h: "Modificări",
        blocks: [
          { p: "Dacă această politică se modifică într-un mod care vă afectează, vă vom anunța în aplicație înainte ca modificarea să intre în vigoare." },
        ],
      },
    ],
  },
};

export const LEGAL: Record<LegalPage, Record<Locale, LegalDoc>> = { terms, privacy };

export type LegalSpan = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

/** One paragraph or list item → styled runs. {app} / {email} are filled first. */
export function parseInline(source: string, vars: { app: string; email: string }): LegalSpan[] {
  const text = source.replaceAll("{app}", vars.app).replaceAll("{email}", vars.email);
  const spans: LegalSpan[] = [];
  const token = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let at = 0;
  for (let m = token.exec(text); m; m = token.exec(text)) {
    if (m.index > at) spans.push({ text: text.slice(at, m.index) });
    if (m[1] !== undefined) spans.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) spans.push({ text: m[2], italic: true });
    else if (m[3] !== undefined) spans.push({ text: m[3], code: true });
    else spans.push({ text: m[4]!, href: m[5]! });
    at = token.lastIndex;
  }
  if (at < text.length) spans.push({ text: text.slice(at) });
  return spans;
}
