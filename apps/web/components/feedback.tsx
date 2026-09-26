"use client";
import { usePathname } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { sendFeedback, type FeedbackKind } from "@/app/feedback-actions";
import { NavIcon } from "./client-nav";

const ICON = "M4 5h16v11H9l-5 4zM12 8v3M12 13.5h.01";
const KINDS: FeedbackKind[] = ["bug", "idea", "other"];

/**
 * "Send feedback" — a row in the sidebar footer and in the phone "More" sheet
 * of both shells, opening a native modal <dialog> (top layer, so the glass
 * sheet it sits in cannot clip it). The screen the person was on travels with
 * the message; the rows land on /admin/feedback and nowhere else.
 */
export function FeedbackButton({ sheet = false }: { sheet?: boolean }) {
  const { t } = useI18n();
  const f = t.common.feedback;
  const pathname = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  function open() {
    setSent(false);
    setError(null);
    ref.current?.showModal();
  }

  function submit() {
    setError(null);
    if (!text.trim()) { setError(f.empty); return; }
    start(async () => {
      const res = await sendFeedback(kind, text, pathname);
      if (res.ok) { setSent(true); setText(""); return; }
      setError(res.reason === "rate" ? f.rate : res.reason === "empty" ? f.empty : f.failed);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={
          sheet
            ? "flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium text-ink-soft"
            : "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-ink-soft hover:bg-surface hover:text-ink"
        }
      >
        <NavIcon d={ICON} />
        <span className="flex-1">{f.button}</span>
      </button>
      <dialog
        ref={ref}
        aria-labelledby="feedback-title"
        className="glass glass--strong fixed inset-0 z-50 m-auto h-fit w-[min(32rem,calc(100vw-2rem))] rounded-3xl p-0 text-ink backdrop:bg-bg/70"
        onClose={() => setError(null)}
      >
        {sent ? (
          <div className="p-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
              <NavIcon d="M5 12.5l4.5 4.5L19 7.5" className="h-6 w-6" />
            </span>
            <h2 id="feedback-title" className="mt-4 font-display text-xl font-extrabold tracking-tight">{f.thanksTitle}</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{f.thanksBody}</p>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="mt-5 inline-flex h-10 items-center rounded-xl bg-accent px-5 text-[13px] font-bold text-accent-fg hover:opacity-90"
            >
              {f.close}
            </button>
          </div>
        ) : (
          <form className="p-5 sm:p-6" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <h2 id="feedback-title" className="font-display text-xl font-extrabold tracking-tight">{f.title}</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{f.intro}</p>

            <div role="radiogroup" aria-label={f.title} className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-bg p-1">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={`h-9 rounded-xl text-[13px] font-semibold ${
                    kind === k ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {f.kinds[k]}
                </button>
              ))}
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={4000}
              rows={5}
              autoFocus
              placeholder={f.placeholder[kind]}
              aria-label={f.title}
              className="mt-3 w-full resize-y rounded-2xl border border-line bg-bg px-3.5 py-3 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
            {error ? <p className="mt-2 text-[12.5px] text-risk">{error}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => ref.current?.close()}
                disabled={pending}
                className="inline-flex h-10 items-center rounded-xl px-4 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
              >
                {f.cancel}
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-10 items-center rounded-xl bg-accent px-5 text-[13px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
              >
                {pending ? f.sending : f.send}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
