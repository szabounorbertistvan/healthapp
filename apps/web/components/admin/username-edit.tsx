"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { setUsername } from "@/app/admin-actions";

/**
 * The admin's rename: a native <dialog> like ConfirmAction, with the new
 * username as its one field. admin_set_username() re-checks the format and
 * the case-insensitive uniqueness and writes the audit row.
 */
export function UsernameEdit({ userId, current }: { userId: string; current: string | null }) {
  const { t } = useI18n();
  const m = t.admin.user.actions;
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const result = await setUsername(userId, value);
      if (!result.ok) {
        setError(result.errorCode === "USERNAME_TAKEN" ? m.renameTaken
          : result.errorCode === "USERNAME_FORMAT" ? m.renameFormat
          : result.message ?? t.admin.common.loadError);
        return;
      }
      ref.current?.close();
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => { setValue(current ?? ""); ref.current?.showModal(); }}
        className="inline-flex h-9 items-center rounded-xl bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink">
        {m.rename}
      </button>
      <dialog ref={ref} className="glass glass--strong fixed inset-0 z-50 m-auto h-fit w-[min(28rem,calc(100vw-2rem))] rounded-3xl p-0 text-ink backdrop:bg-bg/70" onClose={() => setError(null)}>
        <form method="dialog" className="p-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <h2 className="font-display text-lg font-extrabold tracking-tight">{m.renameTitle}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{m.renameBody}</p>
          <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {m.renameLabel}
            <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={24} required autoComplete="off" spellCheck={false}
              className="mt-1 h-10 w-full rounded-xl border border-line bg-bg px-3 text-[13px] font-normal normal-case tracking-normal text-ink outline-none focus:border-accent" />
          </label>
          <p className="mt-1.5 text-[12px] text-ink-faint">{m.renameHint}</p>
          {error ? <p className="mt-3 text-[12.5px] text-risk">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="inline-flex h-9 items-center rounded-xl px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50">
              {t.admin.common.cancel}
            </button>
            <button type="submit" disabled={pending || value.trim() === "" || value.trim() === current} className="inline-flex h-9 items-center rounded-xl bg-accent px-4 text-[12.5px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50">
              {pending ? t.admin.common.working : t.admin.common.confirm}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
