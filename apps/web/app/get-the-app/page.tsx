import Link from "next/link";

// Clients land here if they sign into the web app — their surface is mobile.
export default function GetTheAppPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="max-w-md">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-lg font-black text-white">B</span>
        <h1 className="text-2xl font-extrabold tracking-tight">BuddyGym lives on your phone</h1>
        <p className="mt-3 text-ink-soft">
          Workouts, nutrition, check-ins and streaks are in the mobile app for iOS and Android.
          The web dashboard is your coach&apos;s workspace.
        </p>
        <p className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm text-ink-soft">
          The mobile app ships with the private beta — your coach will send you an invite link.
        </p>
        <Link href="/" className="mt-6 inline-block text-sm font-semibold text-accent-ink hover:underline">
          ← Back to buddygym.app
        </Link>
      </div>
    </main>
  );
}
