import { redirect } from "next/navigation";
import { getProfile } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * Where a suspended account lands. Both app layouts redirect here while
 * users.suspended_at is set (admin_set_suspended); an account that is not
 * suspended never sees this page.
 */
export default async function SuspendedPage() {
  const profile = await getProfile();
  if (!profile) redirect("/");
  if (!profile.suspended_at) redirect(profile.role === "client" ? "/today" : "/dashboard");
  const { t } = await getI18n();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-md rounded-3xl p-8 text-center">
        <div className="flex justify-center"><Logo size="sm" /></div>
        <h1 className="mt-6 font-display text-2xl font-extrabold tracking-tight">{t.admin.suspended.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{t.admin.suspended.body}</p>
        <div className="mt-6 flex justify-center"><SignOutButton /></div>
      </div>
    </main>
  );
}
