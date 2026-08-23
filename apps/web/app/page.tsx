import Link from "next/link";
import { isDemo } from "@/lib/supabase/server";

const clientBenefits = [
  { title: "Log a set in 3 taps", body: "Pre-filled targets, automatic rest timer, personal records detected for you — even with no signal at the gym." },
  { title: "Nutrition without spreadsheets", body: "Scan a barcode or tap \"ate as planned\". Your macros update instantly against the plan your coach built." },
  { title: "See real progress", body: "Weight trends, strength PRs, weekly check-ins — everything in one timeline, not five apps." },
  { title: "Stay on a streak", body: "Habits, streaks and badges keep the boring weeks moving. Discreet — no leaderboards, no spam." },
];

const coachBenefits = [
  { title: "Know who needs you today", body: "Every client carries an On Track / Needs Attention / At Risk signal — with the reason spelled out." },
  { title: "Build once, coach everywhere", body: "Program and meal builders on the web; your clients get them on their phone the moment you hit publish." },
  { title: "Feedback in context", body: "Comment on the exact set, session or check-in — not in a WhatsApp thread three days later." },
];

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 pb-20">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-black text-white">B</span>
          <span className="text-lg font-extrabold tracking-tight">BuddyGym</span>
        </div>
        <nav className="flex items-center gap-3">
          <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft hover:text-ink">
            Sign in
          </Link>
          <Link href="/login" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            Get started
          </Link>
        </nav>
      </header>

      <section className="py-14 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent-ink">
          Training · Nutrition · Progress · Coaching
        </p>
        <h1 className="mx-auto max-w-2xl text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">
          Your coaching, finally in one app.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-ink-soft">
          BuddyGym replaces WhatsApp threads, spreadsheets and three different trackers
          with a single flow between you and your coach — or on your own.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login" className="rounded-xl bg-accent px-6 py-3 font-semibold text-white hover:opacity-90">
            Start free
          </Link>
          {isDemo ? (
            <Link href="/dashboard" className="rounded-xl border border-line bg-surface px-6 py-3 font-semibold text-ink-soft hover:border-accent">
              Browse the coach demo
            </Link>
          ) : null}
        </div>
      </section>

      <section className="py-10">
        <h2 className="mb-5 text-lg font-bold">For you</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {clientBenefits.map((b) => (
            <div key={b.title} className="rounded-xl border border-line bg-surface p-5">
              <p className="font-bold">{b.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-10">
        <h2 className="mb-5 text-lg font-bold">For coaches</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {coachBenefits.map((b) => (
            <div key={b.title} className="rounded-xl border border-line bg-surface p-5">
              <p className="font-bold">{b.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-8 text-center">
        <h2 className="text-xl font-bold">Simple pricing</h2>
        <div className="mx-auto mt-6 grid max-w-2xl gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-line p-4">
            <p className="font-bold">Free</p>
            <p className="mt-1 text-sm text-ink-soft">Workouts, nutrition, habits &amp; streaks</p>
          </div>
          <div className="rounded-xl border-2 border-accent p-4">
            <p className="font-bold text-accent-ink">Premium</p>
            <p className="mt-1 text-sm text-ink-soft">+ progress photos &amp; advanced charts</p>
          </div>
          <div className="rounded-xl border border-line p-4">
            <p className="font-bold">Coach</p>
            <p className="mt-1 text-sm text-ink-soft">Starter: 3 clients · Pro: 30 clients + analytics</p>
          </div>
        </div>
        <p className="mt-6 text-xs text-ink-faint">Română + English · offline logging · your data stays yours (GDPR export &amp; delete built in)</p>
      </section>

      <footer className="pt-10 text-center text-xs text-ink-faint">
        BuddyGym · Food data from Open Food Facts
      </footer>
    </main>
  );
}
