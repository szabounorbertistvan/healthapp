import Link from "next/link";
import type { Metadata } from "next";
import { APP_NAME, CONTACT_EMAIL } from "@/lib/brand";
import { Logo } from "@/components/logo";
import { getLocale } from "@/lib/i18n/server";
import { LanguageSelector } from "@/components/language-selector";

// Google Play asks every app with accounts for a web page, reachable without
// the app and without signing in, that says how to delete the account and what
// happens to the data. The deletion itself stays in the app (the Account /
// Settings card, request_account_deletion()); this page only explains it, and
// must keep saying what that function and the purge job actually do.

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  if (locale === "ro") {
    return {
      title: `Ștergerea contului · ${APP_NAME}`,
      description: `Cum vă ștergeți contul ${APP_NAME} și ce se întâmplă cu datele dumneavoastră.`,
    };
  }
  return {
    title: `Delete your account · ${APP_NAME}`,
    description: `How to delete your ${APP_NAME} account and what happens to your data.`,
  };
}

const mail = (
  <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-accent-ink hover:underline">{CONTACT_EMAIL}</a>
);

function EnglishContent() {
  return (
    <>
      <h1 className="text-3xl font-extrabold tracking-tight">Delete your {APP_NAME} account</h1>
      <p className="mt-2 text-sm text-ink-faint">Applies to the website and the Android app — it is the same account.</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-soft">
        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">In the app</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li><Link href="/login" className="font-semibold text-accent-ink hover:underline">Sign in</Link> on the website or in the Android app.</li>
            <li>Open <b className="text-ink">Account</b> (coaches: <b className="text-ink">Settings</b>).</li>
            <li>Under <b className="text-ink">Your data</b>, find <b className="text-ink">Delete this account</b>, type DELETE and tap <b className="text-ink">Request deletion</b>.</li>
          </ol>
          <p className="mt-2">
            Want a copy first? <b className="text-ink">Download my data</b>, in the same place, gives you
            everything the account holds as one file.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Without signing in</h2>
          <p>
            Write to {mail} from the email address of the account and ask for it to be deleted.
            We reply within 30 days, and may ask you to confirm the request from that address.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">What happens</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-ink">Immediately</b> — your profile is anonymised and every coaching relationship ends, so no coach can see your data any more. Progress photos and the files you attached to messages are removed.</li>
            <li><b className="text-ink">Within 30 days</b> — everything else is erased for good: workouts, food logs, measurements, check-ins, habits, posts, and the sign-in record with your email address.</li>
            <li><b className="text-ink">What stays</b> — messages you sent to a coach stay in that coach&apos;s conversation, with your name removed, so their side of it remains readable.</li>
          </ul>
          <p className="mt-2">
            Signing in again does not cancel a request. If you change your mind, write to {mail}{" "}
            before the 30 days are up.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">More</h2>
          <p>
            What we store and why is in the <Link href="/privacy" className="font-semibold text-accent-ink hover:underline">Privacy Policy</Link>.
          </p>
        </section>
      </div>
    </>
  );
}

function RomanianContent() {
  return (
    <>
      <h1 className="text-3xl font-extrabold tracking-tight">Ștergerea contului {APP_NAME}</h1>
      <p className="mt-2 text-sm text-ink-faint">Pentru site și pentru aplicația de Android — este același cont.</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-soft">
        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Din aplicație</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li><Link href="/login" className="font-semibold text-accent-ink hover:underline">Autentificați-vă</Link> pe site sau în aplicația de Android.</li>
            <li>Deschideți <b className="text-ink">Cont</b> (antrenorii: <b className="text-ink">Setări</b>).</li>
            <li>La <b className="text-ink">Datele tale</b>, găsiți <b className="text-ink">Șterge acest cont</b>, scrieți DELETE și apăsați <b className="text-ink">Cere ștergerea</b>.</li>
          </ol>
          <p className="mt-2">
            Vreți întâi o copie? <b className="text-ink">Descarcă-mi datele</b>, în același loc, vă dă
            într-un singur fișier tot ce conține contul.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Fără autentificare</h2>
          <p>
            Scrieți-ne la {mail} de pe adresa de email a contului și cereți ștergerea lui.
            Răspundem în cel mult 30 de zile și vă putem cere să confirmați solicitarea de pe acea adresă.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Ce se întâmplă</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-ink">Imediat</b> — profilul dumneavoastră este anonimizat și se încheie orice colaborare cu un antrenor, deci niciun antrenor nu vă mai vede datele. Fotografiile de progres și fișierele atașate mesajelor sunt șterse.</li>
            <li><b className="text-ink">În cel mult 30 de zile</b> — tot restul este șters definitiv: antrenamente, jurnalul alimentar, măsurători, check-in-uri, obiceiuri, postări și datele de autentificare, inclusiv adresa de email.</li>
            <li><b className="text-ink">Ce rămâne</b> — mesajele trimise unui antrenor rămân în conversația acestuia, fără numele dumneavoastră, ca partea sa de conversație să rămână lizibilă.</li>
          </ul>
          <p className="mt-2">
            O nouă autentificare nu anulează solicitarea. Dacă v-ați răzgândit, scrieți-ne la {mail}{" "}
            înainte să treacă cele 30 de zile.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Mai multe</h2>
          <p>
            Ce date stocăm și de ce găsiți în <Link href="/privacy" className="font-semibold text-accent-ink hover:underline">Politica de confidențialitate</Link>.
          </p>
        </section>
      </div>
    </>
  );
}

export default async function DeleteAccountPage() {
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
        {APP_NAME}
      </footer>
    </main>
  );
}
