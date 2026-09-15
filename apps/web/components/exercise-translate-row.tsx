"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setExerciseRomanian } from "@/app/exercise-admin-actions";
import { useI18n } from "@/lib/i18n/client";

/**
 * One exercise on the admin translation desk: the English name and steps on
 * the left, the Romanian ones to type on the right. Name and instructions save
 * together — they are one piece of work, and two buttons per row would double
 * the clicks for 873 rows.
 */
/** The import stores one step per line. */
const SPLIT_RE = new RegExp(String.fromCharCode(13) + "?" + String.fromCharCode(10));

export function ExerciseTranslateRow({
  id,
  nameEn,
  nameRo,
  instructionsEn,
  instructionsRo,
  muscles,
  image,
}: {
  id: string;
  nameEn: string;
  nameRo: string | null;
  instructionsEn: string;
  instructionsRo: string | null;
  muscles: string[];
  image: string | null;
}) {
  const { t } = useI18n();
  const m = t.coachApp.admin.exercises;
  const router = useRouter();
  const [name, setName] = useState(nameRo ?? "");
  const [steps, setSteps] = useState(instructionsRo ?? "");
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = name.trim() !== (nameRo ?? "") || steps.trim() !== (instructionsRo ?? "");

  function save() {
    if (!dirty || pending) return;
    startTransition(async () => {
      const result = await setExerciseRomanian(id, name, steps);
      if (!result.ok) {
        setState("error");
        setMessage(result.message ?? null);
        return;
      }
      setState("saved");
      setMessage(null);
      router.refresh();
    });
  }

  return (
    <li className={`grid gap-4 px-5 py-5 lg:grid-cols-2 lg:gap-6 ${pending ? "opacity-60" : ""}`}>
      {/* what the import gave us */}
      <div className="flex min-w-0 gap-3.5">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            width={64}
            height={64}
            className="h-16 w-16 shrink-0 rounded-2xl bg-bg object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{nameEn}</p>
          {muscles.length > 0 ? (
            <p className="mt-0.5 text-[12.5px] text-ink-faint">{muscles.join(", ")}</p>
          ) : null}
          {/* The import stores one step per line; showing them numbered makes the
              contract for the Romanian box on the right obvious. */}
          <ol className="mt-2 space-y-1.5">
            {instructionsEn
              .split(SPLIT_RE)
              .map((line) => line.trim())
              .filter(Boolean)
              .map((step, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-soft">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-bg text-[11px] font-bold tabular-nums text-ink-faint">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
          </ol>
        </div>
      </div>

      {/* what an admin types */}
      <div className="flex min-w-0 flex-col gap-2.5">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setState("idle");
          }}
          placeholder={m.namePlaceholder}
          aria-label={m.namePlaceholder}
          className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-accent"
        />
        <textarea
          value={steps}
          onChange={(e) => {
            setSteps(e.target.value);
            setState("idle");
          }}
          rows={6}
          placeholder={m.instructionsPlaceholder}
          aria-label={m.instructionsPlaceholder}
          className="w-full rounded-2xl border border-line bg-bg px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-accent"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={save}
            className="inline-flex h-10 items-center rounded-2xl bg-accent px-4 font-display text-[13px] font-bold text-accent-fg disabled:opacity-40"
          >
            {t.common.actions.save}
          </button>
          {state === "saved" && !dirty ? (
            <span className="text-[12.5px] font-semibold text-accent-ink">{m.saved}</span>
          ) : null}
          {state === "error" ? (
            <span className="text-[12.5px] font-semibold text-risk">{message ?? m.couldNotSave}</span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
