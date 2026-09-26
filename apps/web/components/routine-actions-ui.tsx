"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { canShareProgram, copyName, TRAINING_STYLES, type RoutineCard } from "@healthapp/shared";
import { copyRoutine, setRoutineFlags, shareRoutine, updateRoutineDetails } from "@/app/routine-actions";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";
import { NavIcon } from "./client-nav";

/**
 * The action row under a routine's header: start it, copy it, duplicate it,
 * assign it, share it.
 *
 * Which buttons exist is decided from the row itself, using the same
 * predicates the database enforces (canCopyProgram, canShareProgram). A button
 * that the server would refuse is not drawn disabled — it is not drawn.
 */
export function RoutineActions({
  card,
  canCopy,
  clients,
}: {
  card: RoutineCard;
  /** False for a coached client: their coach authors their programs. */
  canCopy: boolean;
  /** A coach's active clients, for Assign. Empty for everyone else. */
  clients: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const r = t.clientApp.routines;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [name, setName] = useState("");

  function runCopy(forClientId?: string) {
    startTransition(async () => {
      setError(null);
      const result = await copyRoutine({ sourceId: card.id, name, forClientId: forClientId ?? null });
      if (!result.ok) {
        setError(result.message ?? r.couldNotCopy);
        return;
      }
      setCopying(false);
      setAssigning(false);
      setNote(result.message ?? null);
      // A copy for myself is somewhere I want to be; an assignment is not.
      if (!forClientId && result.id) router.push(`/routines/${result.id}`);
      else router.refresh();
    });
  }

  function openCopy(forAssignment: boolean) {
    setName(forAssignment ? card.name : copyName(card.name));
    setError(null);
    if (forAssignment) setAssigning(true);
    else setCopying(true);
  }

  const shareable = canShareProgram(card);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {card.is_mine && card.days > 0 ? (
          <a
            href="/workout"
            className="inline-flex h-11 items-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
          >
            {r.start}
          </a>
        ) : null}

        {canCopy ? (
          <button
            type="button"
            onClick={() => openCopy(false)}
            className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-surface px-4 text-[13px] font-semibold text-ink-soft hover:text-ink"
          >
            <NavIcon d="M8 8h11v11H8zM5 16V5h11" className="h-4 w-4" />
            {card.is_mine ? r.duplicate : r.copy}
          </button>
        ) : null}

        {clients.length > 0 ? (
          <button
            type="button"
            onClick={() => openCopy(true)}
            className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-surface px-4 text-[13px] font-semibold text-ink-soft hover:text-ink"
          >
            <NavIcon d="M16 3.1a4 4 0 0 1 0 7.8M20 21v-2a4 4 0 0 0-3-3.9M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" className="h-4 w-4" />
            {r.assign}
          </button>
        ) : null}

        {shareable ? <ShareButton programId={card.id} /> : null}
      </div>

      {!canCopy && !card.is_mine ? (
        <p className="mt-2 text-[12.5px] text-ink-faint">{r.cannotCopyCoached}</p>
      ) : null}

      {note ? <p className="mt-2 text-[12.5px] font-semibold text-accent-ink">{note}</p> : null}
      {error ? <p className="mt-2 text-[12.5px] font-semibold text-risk">{error}</p> : null}

      {copying || assigning ? (
        <Card plain className="mt-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{r.nameLabel}</span>
            <input
              autoFocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder={r.namePlaceholder}
              className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
            />
          </label>

          {assigning ? (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{r.assignPick}</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {clients.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={pending || name.trim().length < 2}
                    onClick={() => runCopy(c.id)}
                    className="inline-flex h-10 items-center rounded-full bg-accent-soft px-4 text-[12.5px] font-bold text-accent-ink disabled:opacity-40"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex gap-2">
            {!assigning ? (
              <button
                type="button"
                disabled={pending || name.trim().length < 2}
                onClick={() => runCopy()}
                className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-[12.5px] font-bold text-accent-fg disabled:opacity-40"
              >
                {r.confirmCopy}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => { setCopying(false); setAssigning(false); }}
              className="inline-flex h-10 items-center rounded-full px-3.5 text-[12.5px] font-semibold text-ink-faint hover:text-ink"
            >
              {r.cancel}
            </button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** Post the routine to the feed — the plan only, never anything logged. */
function ShareButton({ programId }: { programId: string }) {
  const { t } = useI18n();
  const r = t.clientApp.routines;
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending || done}
        title={r.shareHint}
        onClick={() =>
          startTransition(async () => {
            const result = await shareRoutine(programId);
            if (!result.ok) { setError(result.message ?? r.couldNotShare); return; }
            setDone(true);
          })
        }
        className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-surface px-4 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
      >
        <NavIcon d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M8 7l4-4 4 4" className="h-4 w-4" />
        {done ? r.shared : r.share}
      </button>
      {error ? <p className="w-full text-[12.5px] font-semibold text-risk">{error}</p> : null}
    </>
  );
}

/**
 * Name, description, level, goal and visibility — the fields Discover filters
 * on. Only shown to whoever may edit the routine; the visibility control is
 * hidden for a coach program, which the check constraint refuses to publish.
 */
export function RoutineDetailsForm({
  card,
  canPublish,
}: {
  card: RoutineCard;
  canPublish: boolean;
}) {
  const { t } = useI18n();
  const r = t.clientApp.routines;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: card.name,
    description: card.description ?? "",
    level: card.level ?? "",
    goal: card.goal ?? "",
    style: card.training_style ?? "",
    visibility: card.visibility,
  });

  function save() {
    startTransition(async () => {
      setError(null);
      const result = await updateRoutineDetails({
        programId: card.id,
        name: form.name,
        description: form.description,
        level: form.level || null,
        goal: form.goal || null,
        trainingStyle: form.style || null,
        visibility: canPublish ? form.visibility : undefined,
      });
      if (!result.ok) { setError(result.message ?? r.couldNotSave); return; }
      setSaved(true);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d="M4 20h4l10-10-4-4L4 16zM13 7l4 4" className="h-4 w-4" />
        {r.editDetails}
      </button>
    );
  }

  return (
    <Card plain className="mt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{r.nameLabel}</span>
          <input
            value={form.name}
            maxLength={120}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{r.descriptionLabel}</span>
          <textarea
            value={form.description}
            maxLength={2000}
            rows={3}
            placeholder={r.descriptionPlaceholder}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
        </label>
        <Field label={r.allLevels} value={form.level} onChange={(v) => setForm({ ...form, level: v })}
          options={(["beginner", "intermediate", "advanced"] as const).map((l) => ({ value: l, label: r.level[l] }))} />
        <Field label={r.allGoals} value={form.goal} onChange={(v) => setForm({ ...form, goal: v })}
          options={(["strength", "hypertrophy", "fat_loss", "endurance", "general"] as const).map((g) => ({ value: g, label: r.goal[g] }))} />
        <Field label={r.styleLabel} value={form.style} onChange={(v) => setForm({ ...form, style: v })}
          options={TRAINING_STYLES.map((st) => ({ value: st, label: r.style[st] }))} />
        {canPublish ? (
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {r.visibility[form.visibility]}
            </span>
            <select
              value={form.visibility}
              onChange={(e) => setForm({ ...form, visibility: e.target.value as typeof form.visibility })}
              className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
            >
              {(["private", "followers", "public"] as const).map((v) => (
                <option key={v} value={v}>{r.visibility[v]}</option>
              ))}
            </select>
            <span className="text-[11.5px] text-ink-faint">{r.visibilityHint[form.visibility]}</span>
          </label>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-[12.5px] font-semibold text-risk">{error}</p> : null}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-[12.5px] font-bold text-accent-fg disabled:opacity-40"
        >
          {r.saveDetails}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-10 items-center rounded-full px-3.5 text-[12.5px] font-semibold text-ink-faint hover:text-ink"
        >
          {r.cancel}
        </button>
        {saved ? <span className="text-[12.5px] font-semibold text-accent-ink">{r.detailsSaved}</span> : null}
      </div>
    </Card>
  );
}

function Field({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * Feature / mark-as-Voinic, for admins only — the page renders this only for
 * an admin viewing a public routine, and admin_set_program_flags() refuses
 * anyone else whatever the UI does.
 */
export function RoutineAdminFlags({ programId, featured, official }: { programId: string; featured: boolean; official: boolean }) {
  const { t } = useI18n();
  const r = t.clientApp.routines;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function set(nextFeatured: boolean, nextOfficial: boolean) {
    startTransition(async () => {
      setError(null);
      const result = await setRoutineFlags(programId, nextFeatured, nextOfficial);
      if (!result.ok) { setError(result.message ?? r.couldNotFlag); return; }
      router.refresh();
    });
  }

  const button = "inline-flex h-9 items-center rounded-full bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-40";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{r.adminFlags}</span>
      <button type="button" disabled={pending} onClick={() => set(!featured, official)} className={button}>
        {featured ? r.unfeature : r.feature}
      </button>
      <button type="button" disabled={pending} onClick={() => set(featured, !official)} className={button}>
        {official ? r.unmarkOfficial : r.markOfficial}
      </button>
      {error ? <span className="text-[12px] font-semibold text-risk">{error}</span> : null}
    </div>
  );
}
