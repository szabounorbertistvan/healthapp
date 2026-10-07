import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/data";
import { Logo } from "@/components/logo";
import { LanguageSelector } from "@/components/language-selector";
import { CompleteProfileForm } from "@/components/complete-profile-form";
import { getI18n } from "@/lib/i18n/server";
import { safeNext } from "@/lib/safe-next";

// Where an account without a username lands (both layouts redirect here). A
// Google sign-up cannot carry the sign-up form's fields, and accounts created
// before the fields existed have none either.
export default async function CompleteProfilePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { t } = await getI18n();
  const profile = await getProfile();
  // where they were going — a coach page, usually (20261107100000); only a path on this site
  const raw = (await searchParams).next;
  const next = raw ? safeNext(raw, "") || null : null;
  if (!profile) redirect("/");
  if (profile.username) redirect(next ?? (profile.role === "client" ? "/today" : "/dashboard"));

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="fixed right-4 top-4 z-20">
        <LanguageSelector />
      </div>
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <Logo size="md" />
        </Link>
        <h1 className="mb-3 text-center font-display text-2xl font-extrabold tracking-tight">
          {t.clientApp.completeProfile.title}
        </h1>
        <CompleteProfileForm initialName={profile.full_name} initialRole={profile.role} next={next} />
      </div>
    </main>
  );
}
