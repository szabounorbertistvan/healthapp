"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { LengthUnit, WeightUnit } from "@healthapp/shared";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";
import { settle } from "@/lib/settle-action";
import { BUTTON, FIELD, LABEL, SMALL_BUTTON } from "@/lib/form-classes";
import { CLIENT_GOALS, type ClientGoal } from "@/lib/coach-content";
import {
  setupProgress, type Audience, type SetupFacts, type SetupStep, type StepStatus,
} from "@/lib/onboarding-model";
import { chooseSoloFromSetup, saveSetupGoal, saveSetupUnits } from "@/app/onboarding-actions";
import { AvatarPicker } from "@/components/account";
import { JoinCoach } from "@/components/join-coach";
import { InviteButton } from "@/components/invite-button";
import { Chip } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { useOnboarding } from "./provider";

export type FlowPhase = "intro" | "setup" | "finish";

export type FlowProps = {
  audience: Audience;
  phase: FlowPhase;
  /** The setup step to open on. */
  step: number;
  facts: SetupFacts;
  name: string;
  avatarUrl: string | null;
  photoUploads: boolean;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  timezone: string;
  goal: string | null;
  coached: boolean;
  coachProfileStatus: string | null;
  hasClients: boolean;
};

/** What a person picks as their own goal: the coaches' goal codes, minus "complete beginners" (who you are, not what you want). */
const GOAL_CHOICES = CLIENT_GOALS.filter((g) => g !== "beginners");

const CARD_ICONS = {
  client: [
    "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
    "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8",
    "M3 12h18a9 9 0 0 1-18 0zM8 12c0-3 2-5 5-6 2 2 3 4 1 6",
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M18 20h4a6 6 0 0 0-3-5.2",
    "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M15.5 8.5l-2 5-5 2 2-5z",
  ],
  coach: [
    "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
    "M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z",
    "M4 5h11a2 2 0 0 1 2 2v13H6a2 2 0 0 1-2-2zM17 20h3V6a2 2 0 0 0-2-2h-1M8 9h5M8 13h5",
    "M3 9l2-5h14l2 5M3 9h18M3 9v11h18V9M9 20v-6h6v6",
    "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M15.5 8.5l-2 5-5 2 2-5z",
  ],
} as const;

const CHECK = "M5 12.5l4.5 4.5L19 7.5";

/**
 * /onboarding: the welcome cards, then the setup steps, then a short summary.
 *
 * Every step is optional and every exit is open: "Skip intro", "Skip for now"
 * and "Finish later" all lead on, and the app never waits behind this flow
 * (only /today and /dashboard send a brand-new account here, once). Where the
 * person stopped is the next unanswered step (setupProgress), so a refresh,
 * a new session or another device resumes there.
 *
 * Nothing here is a second profile form: the photo is the account's own
 * AvatarPicker, units and zone go through updateAccount, the code box is
 * JoinCoach, the invite is InviteButton, and the coach's public page is the
 * existing wizard, linked.
 */
export function OnboardingFlow(props: FlowProps) {
  const [phase, setPhase] = useState<FlowPhase>(props.phase);
  const [index, setIndex] = useState(props.step);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // Moving between phases or steps puts the reader at the new heading.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: false });
  }, [phase, index]);

  // keep ?step= in the address so a reload lands on the same step
  useEffect(() => {
    if (phase !== "setup") return;
    const id = (props.audience === "client" ? CLIENT_ORDER : COACH_ORDER)[index];
    const url = new URL(window.location.href);
    url.searchParams.delete("intro");
    url.searchParams.set("step", id);
    window.history.replaceState(window.history.state, "", url);
  }, [phase, index, props.audience]);

  if (phase === "intro") {
    return <Intro audience={props.audience} headingRef={headingRef} onDone={() => setPhase("setup")} />;
  }
  if (phase === "finish") {
    return (
      <Finish
        {...props}
        headingRef={headingRef}
        onOpen={(i) => {
          setIndex(i);
          setPhase("setup");
        }}
      />
    );
  }
  return (
    <Setup
      {...props}
      index={index}
      headingRef={headingRef}
      onIndex={setIndex}
      onFinish={() => setPhase("finish")}
    />
  );
}

const CLIENT_ORDER = ["photo", "units", "goal", "training"] as const;
const COACH_ORDER = ["photo", "public_profile", "invite", "program"] as const;

// ---------- the welcome cards ----------

function Intro({
  audience, headingRef, onDone,
}: {
  audience: Audience;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const w = t.onboarding.welcome;
  const cards = w[audience];
  const { state, mark } = useOnboarding();
  const [i, setI] = useState(0);
  const card = cards[i];
  const last = i === cards.length - 1;

  function leave(how: "done" | "skipped") {
    // a replay from "Getting started" leaves the first answer as it was
    if (state?.welcome === undefined) void mark("welcome", how);
    onDone();
  }

  return (
    <section
      aria-roledescription="carousel"
      aria-label={w.region}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input, textarea, select")) return;
        if (e.key === "ArrowRight" && !last) setI(i + 1);
        if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{w.eyebrow}</p>
        <button
          type="button"
          onClick={() => leave("skipped")}
          className="text-[13px] font-semibold text-ink-faint underline-offset-2 hover:text-ink hover:underline"
        >
          {w.skip}
        </button>
      </div>

      <div
        key={i}
        role="group"
        aria-roledescription="slide"
        aria-label={fill(w.cardOf, { n: i + 1, total: cards.length })}
        className="glass mt-3 rounded-3xl p-6 sm:p-8 motion-safe:animate-[onboarding-in_220ms_ease-out]"
      >
        <span aria-hidden className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent-ink">
          <NavIcon d={CARD_ICONS[audience][i] ?? CARD_ICONS[audience][0]} className="h-7 w-7" />
        </span>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-5 font-display text-[26px] font-extrabold leading-tight tracking-tight outline-none sm:text-[30px]"
        >
          {card.title}
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">{card.body}</p>
        <ul className="mt-5 space-y-2.5">
          {card.points.map((p) => (
            <li key={p} className="flex items-start gap-2.5 text-[14px] leading-snug">
              <NavIcon d={CHECK} className="mt-px h-[18px] w-[18px] shrink-0 text-accent-ink" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <Dots count={cards.length} current={i} label={fill(w.cardOf, { n: i + 1, total: cards.length })} />
        <div className="flex gap-2">
          {i > 0 ? (
            <button type="button" onClick={() => setI(i - 1)} className={SMALL_BUTTON + " h-11 rounded-2xl px-4"}>
              {w.back}
            </button>
          ) : null}
          <button type="button" onClick={() => (last ? leave("done") : setI(i + 1))} className={BUTTON}>
            {last ? w.toSetup : w.next}
          </button>
        </div>
      </div>
    </section>
  );
}

function Dots({ count, current, label }: { count: number; current: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5" role="img" aria-label={label}>
      {Array.from({ length: count }, (_, n) => (
        <span
          key={n}
          className={`h-1.5 rounded-full transition-all ${n === current ? "w-6 bg-accent" : n < current ? "w-1.5 bg-accent/60" : "w-1.5 bg-line"}`}
        />
      ))}
    </div>
  );
}

// ---------- the setup steps ----------

function useProgress(props: Pick<FlowProps, "audience" | "facts">) {
  const { state } = useOnboarding();
  return setupProgress(props.audience, props.facts, state ?? {});
}

function Setup(props: FlowProps & {
  index: number;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onIndex: (i: number) => void;
  onFinish: () => void;
}) {
  const { t } = useI18n();
  const s = t.onboarding.setup;
  const { mark } = useOnboarding();
  const progress = useProgress(props);
  const { index, onIndex, onFinish } = props;
  const step = progress.steps[index] ?? progress.steps[0];
  const total = progress.total;
  const [notice, setNotice] = useState<string | null>(null);
  const home = props.audience === "client" ? "/today" : "/dashboard";

  function next() {
    setNotice(null);
    if (index >= total - 1) onFinish();
    else onIndex(index + 1);
  }
  /** Mark the step and move on; a mark that only stuck on this device says so, but never holds the person here. */
  async function answer(markAs: "done" | "skipped") {
    if (!(markAs === "done" && props.facts[step.id])) {
      const saved = await mark(`step:${step.id}`, markAs);
      next();
      if (!saved) setNotice(s.error);
      return;
    }
    next();
  }

  return (
    <section aria-labelledby="setup-title">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
          {fill(s.stepOf, { n: index + 1, total })}
        </p>
        <Link href={home} className="text-[13px] font-semibold text-ink-faint underline-offset-2 hover:text-ink hover:underline">
          {s.later}
        </Link>
      </div>
      <p id="setup-title" className="sr-only">{s.title}</p>

      <StepRail steps={progress.steps} current={index} onPick={onIndex} label={s.stepsNav} />

      <div className="glass mt-4 rounded-3xl p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <StatusPill status={step.status} />
          <p className="text-[12px] text-ink-faint">{s.optional}</p>
        </div>
        <h1
          ref={props.headingRef}
          tabIndex={-1}
          className="mt-3 font-display text-[24px] font-extrabold leading-tight tracking-tight outline-none sm:text-[28px]"
        >
          {stepTitle(t, step.id)}
        </h1>
        <StepBody {...props} step={step.id} status={step.status} onAnswer={answer} onNext={next} />
      </div>

      {notice ? (
        <p role="status" className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-[13px] text-warn">{notice}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          {index > 0 ? (
            <button type="button" onClick={() => onIndex(index - 1)} className={SMALL_BUTTON + " h-11 rounded-2xl px-4"}>
              {s.back}
            </button>
          ) : null}
        </div>
        {step.status !== "done" ? (
          <button
            type="button"
            onClick={() => void answer("skipped")}
            className="inline-flex h-11 items-center rounded-2xl px-4 text-[13.5px] font-semibold text-ink-soft hover:bg-surface hover:text-ink"
          >
            {s.skip}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function stepTitle(t: ReturnType<typeof useI18n>["t"], id: SetupStep): string {
  return t.onboarding.setup.steps[id].title;
}

function StepRail({
  steps, current, onPick, label,
}: {
  steps: { id: SetupStep; status: StepStatus }[];
  current: number;
  onPick: (i: number) => void;
  label: string;
}) {
  const { t } = useI18n();
  const s = t.onboarding.setup;
  const done = steps.filter((x) => x.status === "done").length;
  return (
    <nav aria-label={label} className="mt-3">
      <ol className="grid grid-cols-4 gap-1.5">
        {steps.map((step, i) => (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onPick(i)}
              aria-current={i === current ? "step" : undefined}
              aria-label={`${i + 1}. ${stepTitle(t, step.id)} — ${s.status[step.status]}`}
              className="group block w-full py-2 outline-none"
            >
              <span
                className={`block h-1.5 rounded-full ring-accent/50 group-focus-visible:ring-2 ${
                  step.status === "done" ? "bg-accent" : i === current ? "bg-accent/50" : step.status === "skipped" ? "bg-ink-faint/40" : "bg-line"
                }`}
              />
            </button>
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-ink-faint">{fill(s.doneOf, { done, total: steps.length })}</p>
    </nav>
  );
}

function StatusPill({ status }: { status: StepStatus }) {
  const { t } = useI18n();
  const label = t.onboarding.setup.status[status];
  const tone = status === "done" ? "bg-accent-soft text-accent-ink" : status === "skipped" ? "bg-bg text-ink-faint" : "bg-bg text-ink-soft";
  return (
    <span className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold ${tone}`}>
      {status === "done" ? <NavIcon d={CHECK} className="h-3.5 w-3.5" /> : null}
      {label}
    </span>
  );
}

type StepProps = Omit<FlowProps, "step"> & {
  step: SetupStep;
  status: StepStatus;
  onAnswer: (mark: "done" | "skipped") => Promise<void>;
  onNext: () => void;
};

function StepBody(props: StepProps) {
  switch (props.step) {
    case "photo": return <PhotoStep {...props} />;
    case "units": return <UnitsStep {...props} />;
    case "goal": return <GoalStep {...props} />;
    case "training": return <TrainingStep {...props} />;
    case "public_profile": return <PublicProfileStep {...props} />;
    case "invite": return <InviteStep {...props} />;
    case "program": return <ProgramStep {...props} />;
  }
}

function Why({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">{children}</p>;
}

function Primary({
  children, onClick, disabled, pending,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <div className="mt-6">
      <button type="button" onClick={onClick} disabled={disabled || pending} aria-busy={pending} className={BUTTON}>
        {children}
      </button>
    </div>
  );
}

function PhotoStep({ audience, name, avatarUrl, photoUploads, facts, onAnswer }: StepProps) {
  const { t } = useI18n();
  const p = t.onboarding.setup.steps.photo;
  return (
    <>
      <Why>{audience === "coach" ? p.whyCoach : p.why}</Why>
      <div className="mt-5 rounded-2xl bg-bg/60 p-4">
        <AvatarPicker name={name} url={avatarUrl} enabled={photoUploads} />
      </div>
      {facts.photo ? <p className="mt-3 text-[13px] text-accent-ink">{p.has}</p> : null}
      <Primary onClick={() => void onAnswer("done")} disabled={!facts.photo}>
        {t.onboarding.setup.continue}
      </Primary>
    </>
  );
}

function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone.length > 0;
  } catch {
    return false;
  }
}

function UnitsStep({ weightUnit, lengthUnit, timezone, onNext }: StepProps) {
  const { t } = useI18n();
  const s = t.onboarding.setup;
  const u = s.steps.units;
  const router = useRouter();
  const [weight, setWeight] = useState<WeightUnit>(weightUnit);
  const [length, setLength] = useState<LengthUnit>(lengthUnit);
  const [zone, setZone] = useState(timezone);
  const [detected, setDetected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const zoneId = useId();
  const zoneOk = isZone(zone.trim());

  // the browser knows the real zone; read only after hydration
  useEffect(() => {
    try {
      setDetected(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      setDetected(null);
    }
  }, []);

  function save() {
    setError(null);
    start(async () => {
      const r = await settle(
        () => saveSetupUnits({ weightUnit: weight, lengthUnit: length, timezone: zone.trim() }),
        t.common.actions.unreachable,
      );
      if (!r.ok) {
        setError(r.message === "Unknown time zone" ? u.badZone : s.error);
        return;
      }
      router.refresh();
      onNext();
    });
  }

  return (
    <>
      <Why>{u.why}</Why>
      <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
        <label className={LABEL}>
          {u.weight}
          <select className={FIELD} value={weight} onChange={(e) => setWeight(e.target.value as WeightUnit)}>
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </select>
        </label>
        <label className={LABEL}>
          {u.length}
          <select className={FIELD} value={length} onChange={(e) => setLength(e.target.value as LengthUnit)}>
            <option value="cm">cm</option>
            <option value="in">in</option>
          </select>
        </label>
      </div>
      <label htmlFor={zoneId} className={LABEL + " mt-3.5"}>{u.timezone}</label>
      <input
        id={zoneId}
        className={FIELD}
        value={zone}
        aria-invalid={!zoneOk}
        autoComplete="off"
        onChange={(e) => setZone(e.target.value)}
      />
      {!zoneOk ? <p className="mt-1 text-[12.5px] text-risk">{u.badZone}</p> : null}
      {detected && detected !== zone.trim() ? (
        <button type="button" onClick={() => setZone(detected)} className="mt-2 text-[12.5px] font-semibold text-accent-ink hover:underline">
          {fill(u.detected, { zone: detected })}
        </button>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-[13px] text-risk">{error}</p> : null}
      <Primary onClick={save} disabled={!zoneOk} pending={pending}>
        {pending ? s.saving : s.save}
      </Primary>
    </>
  );
}

function GoalStep({ goal, facts, onAnswer, onNext }: StepProps) {
  const { t } = useI18n();
  const s = t.onboarding.setup;
  const g = s.steps.goal;
  const labels = t.coachProfile.expertise.goals;
  const router = useRouter();
  const [picked, setPicked] = useState<ClientGoal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    if (!picked) {
      void onAnswer("done");
      return;
    }
    setError(null);
    start(async () => {
      const r = await settle(() => saveSetupGoal(picked), t.common.actions.unreachable);
      if (!r.ok) {
        setError(s.error);
        return;
      }
      router.refresh();
      onNext();
    });
  }

  return (
    <>
      <Why>{g.why}</Why>
      {goal ? <p className="mt-4 text-[14px] font-semibold text-accent-ink">{fill(g.current, { goal })}</p> : null}
      <p className="mt-4 text-[13px] font-semibold text-ink-soft" id="goal-pick">{g.pick}</p>
      <div role="group" aria-labelledby="goal-pick" className="mt-2 flex flex-wrap gap-2">
        {GOAL_CHOICES.map((code) => (
          <Chip key={code} on={picked === code} onToggle={() => setPicked(picked === code ? null : code)}>
            {labels[code]}
          </Chip>
        ))}
      </div>
      {error ? <p role="alert" className="mt-3 text-[13px] text-risk">{error}</p> : null}
      <Primary onClick={save} disabled={!picked && !facts.goal} pending={pending}>
        {pending ? s.saving : picked ? s.save : s.continue}
      </Primary>
    </>
  );
}

function TrainingStep({ coached, facts, onAnswer, onNext }: StepProps) {
  const { t } = useI18n();
  const s = t.onboarding.setup;
  const tr = s.steps.training;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (coached || facts.training) {
    return (
      <>
        <Why>{tr.why}</Why>
        <p className="mt-4 rounded-2xl bg-accent-soft px-4 py-3 text-[14px] text-accent-ink">{coached ? tr.coached : tr.ready}</p>
        <Primary onClick={() => void onAnswer("done")}>{s.continue}</Primary>
      </>
    );
  }

  return (
    <>
      <Why>{tr.why}</Why>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Option title={tr.codeTitle}>
          <div className="mt-auto space-y-2 pt-3">
            <JoinCoach autoFocus />
          </div>
        </Option>
        <Option title={tr.findTitle} body={tr.findBody}>
          <Link
            href="/coaches"
            className="mt-auto flex h-11 items-center justify-center rounded-2xl bg-surface px-4 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            {tr.findCta}
          </Link>
        </Option>
        <Option title={tr.soloTitle} body={tr.soloBody}>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await settle(() => chooseSoloFromSetup(), t.common.actions.unreachable);
                if (!r.ok) {
                  setError(s.error);
                  return;
                }
                router.refresh();
                onNext();
              })
            }
            className="mt-auto flex h-11 items-center justify-center rounded-2xl bg-accent px-4 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {pending ? s.saving : tr.soloCta}
          </button>
        </Option>
      </div>
      {error ? <p role="alert" className="mt-3 text-[13px] text-risk">{error}</p> : null}
    </>
  );
}

function Option({ title, body, children }: { title: string; body?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-2xl bg-bg/60 p-4">
      <p className="font-display text-[15px] font-bold tracking-tight">{title}</p>
      {body ? <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{body}</p> : null}
      <div className="flex flex-1 flex-col pt-3">{children}</div>
    </div>
  );
}

function PublicProfileStep({ coachProfileStatus, facts, onAnswer }: StepProps) {
  const { t } = useI18n();
  const s = t.onboarding.setup;
  const pp = s.steps.public_profile;
  const status = (coachProfileStatus ?? "none") as keyof typeof pp;
  const line = typeof pp[status] === "string" ? pp[status] : pp.none;
  return (
    <>
      <Why>{pp.why}</Why>
      <p className="mt-4 text-[14px] font-semibold text-ink">{line}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/settings/coach-profile" className={BUTTON}>{pp.cta}</Link>
        {facts.public_profile ? (
          <button type="button" onClick={() => void onAnswer("done")} className={SMALL_BUTTON + " h-11 rounded-2xl px-4"}>
            {s.continue}
          </button>
        ) : null}
      </div>
    </>
  );
}

function InviteStep({ hasClients, onAnswer }: StepProps) {
  const { t } = useI18n();
  const s = t.onboarding.setup;
  const inv = s.steps.invite;
  return (
    <>
      <Why>{inv.why}</Why>
      {hasClients ? <p className="mt-4 text-[13px] text-accent-ink">{inv.has}</p> : null}
      <div className="mt-5">
        <InviteButton />
      </div>
      <Primary onClick={() => void onAnswer("done")}>{s.continue}</Primary>
    </>
  );
}

function ProgramStep({ hasClients, facts, onAnswer }: StepProps) {
  const { t } = useI18n();
  const s = t.onboarding.setup;
  const pr = s.steps.program;
  return (
    <>
      <Why>{pr.why}</Why>
      {facts.program ? (
        <p className="mt-4 text-[13px] text-accent-ink">{pr.has}</p>
      ) : !hasClients ? (
        <p className="mt-4 rounded-2xl bg-bg/60 px-4 py-3 text-[13px] text-ink-soft">{pr.noClients}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        {facts.program ? (
          <button type="button" onClick={() => void onAnswer("done")} className={BUTTON}>{s.continue}</button>
        ) : (
          <Link href="/programs/new" className={BUTTON}>{pr.cta}</Link>
        )}
      </div>
    </>
  );
}

// ---------- the summary ----------

function Finish(props: FlowProps & {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onOpen: (i: number) => void;
}) {
  const { t } = useI18n();
  const s = t.onboarding.setup;
  const { mark } = useOnboarding();
  const router = useRouter();
  const progress = useProgress(props);
  const [pending, start] = useTransition();
  const client = props.audience === "client";
  const allDone = progress.done === progress.total;

  return (
    <section className="glass rounded-3xl p-6 sm:p-8">
      <span aria-hidden className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent-ink">
        <NavIcon d={CHECK} className="h-7 w-7" />
      </span>
      <h1 ref={props.headingRef} tabIndex={-1} className="mt-5 font-display text-[26px] font-extrabold tracking-tight outline-none sm:text-[30px]">
        {s.finishTitle}
      </h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
        {allDone ? s.finishBody : client ? s.finishPartial : s.finishPartialCoach}
      </p>
      <ul className="mt-5 divide-y divide-line/60 rounded-2xl bg-bg/60">
        {progress.steps.map((step, i) => (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => props.onOpen(i)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[14px] hover:text-accent-ink"
            >
              <span className="font-semibold">{stepTitle(t, step.id)}</span>
              <StatusPill status={step.status} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              // finished for good only when nothing is left; otherwise the card on Today stays the way back
              if (allDone) await mark("setup", "done");
              router.push(client ? "/today" : "/dashboard");
            })
          }
          className={BUTTON}
        >
          {client ? s.finishClient : s.finishCoach}
        </button>
      </div>
    </section>
  );
}
