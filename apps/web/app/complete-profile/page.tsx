import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile, isDemo } from "@/lib/data";
import { Logo } from "@/components/logo";
import { LanguageSelector } from "@/components/language-selector";
import { CompleteProfileForm } from "@/components/complete-profile-form";
import { getI18n } from "@/lib/i18n/server";

// Where an account without a username lands (both layouts redirect here). A
// Google sign-up cannot carry the sign-up form's fields, and accounts created
// before the fields existed have none either. Demo mode never needs this page.
export default async function CompleteProfilePage() {
  const { t } = await getI18n();
  const profile = await getProfile();
  if (!profile) redirect("/");
  const home = profile.role === "client" ? "/today" : "/dashboard";
  if (isDemo || profile.username) redirect(home);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="fixed right-4 top-4 z-20">
        <LanguageSelector />
      </div>
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <Logo size="md" />
        </Link>
        <h1 className="mb-3 text-center text-xl font-bold tracking-tight">
          {t.clientApp.completeProfile.title}
        </h1>
        <CompleteProfileForm initialName={profile.full_name} next={home} />
      </div>
    </main>
  );
}
