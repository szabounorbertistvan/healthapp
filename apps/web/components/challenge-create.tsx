"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CHALLENGE_TYPES } from "@healthapp/shared";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";
import { NavIcon } from "./client-nav";
import { createChallenge } from "@/app/challenge-actions";

const FIELD =
  "mt-1.5 h-11 w-full rounded-2xl bg-bg px-3.5 text-[14px] text-ink outline-none ring-accent/50 focus:ring-2";

/** yyyy-mm-dd for today and for the last day of this month — the usual window. */
function defaultWindow() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return { start: iso(now), end: iso(end) };
}

/**
 * Start your own challenge. Collapsed by default: the page is a list of
 * challenges to join, and a permanently open form would push them below it.
 */
export function ChallengeCreate() {
  const { t } = useI18n();
  const ch = t.common.challenges;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const window0 = defaultWindow();
  const [form, setForm] = useState({
    name: "",
    description: "",
    type: "workouts" as string,
    targetValue: "12",
    startDate: window0.start,
    endDate: window0.end,
    visibility: "public" as "public" | "private",
  });

  function submit() {
    setError(null);
    start(async () => {
      const result = await createChallenge({
        ...form,
        targetValue: Number(form.targetValue),
      });
      if (!result.ok) {
        setError(result.message ?? ch.unknownType);
        return;
      }
      setOpen(false);
      router.refresh();
      if (result.id) router.push(`/challenges/${result.id}`);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 inline-flex h-11 items-center gap-2 rounded-2xl bg-surface px-5 font-display text-sm font-bold text-ink-soft transition hover:bg-accent-soft/40 hover:text-ink sm:mt-6"
      >
        <NavIcon d="M12 5v14M5 12h14" className="h-4 w-4 [stroke-width:2.4]" />
        {ch.createTitle}
      </button>
    );
  }

  return (
    <Card plain className="mt-5 sm:mt-6">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{ch.createTitle}</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">{ch.createHint}</p>

      <label className="mt-3.5 block text-[13px] font-semibold text-ink-soft">
        {ch.nameLabel}
        <input
          className={FIELD}
          value={form.name}
          placeholder={ch.namePlaceholder}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>

      <label className="mt-3.5 block text-[13px] font-semibold text-ink-soft">
        {ch.descriptionLabel}
        <input
          className={FIELD}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>

      <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
        <label className="block text-[13px] font-semibold text-ink-soft">
          {ch.typeLabel}
          <select
            className={FIELD}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {CHALLENGE_TYPES.map((type) => (
              <option key={type} value={type}>
                {ch.type[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] font-semibold text-ink-soft">
          {ch.targetLabel} <span className="text-ink-faint">({ch.unit[form.type as keyof typeof ch.unit]})</span>
          <input
            className={FIELD}
            inputMode="decimal"
            value={form.targetValue}
            onChange={(e) => setForm({ ...form, targetValue: e.target.value })}
          />
        </label>
        <label className="block text-[13px] font-semibold text-ink-soft">
          {ch.startLabel}
          <input
            type="date"
            className={FIELD}
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
        </label>
        <label className="block text-[13px] font-semibold text-ink-soft">
          {ch.endLabel}
          <input
            type="date"
            className={FIELD}
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
        </label>
      </div>

      <label className="mt-3.5 block text-[13px] font-semibold text-ink-soft">
        {ch.visibilityLabel}
        <select
          className={FIELD}
          value={form.visibility}
          onChange={(e) => setForm({ ...form, visibility: e.target.value as "public" | "private" })}
        >
          <option value="public">{ch.visibilityPublic}</option>
          <option value="private">{ch.visibilityPrivate}</option>
        </select>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={submit}
          disabled={pending || form.name.trim().length < 3}
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {pending ? ch.creating : ch.create}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12.5px] font-semibold text-ink-faint hover:text-ink"
        >
          {t.common.actions.cancel}
        </button>
        {error ? <span className="text-[13px] text-risk">{error}</span> : null}
      </div>
    </Card>
  );
}
