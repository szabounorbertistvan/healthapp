"use client";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";
import { REPORT_DETAILS_MAX, reportReasonsFor, type ReportTarget } from "@healthapp/shared";
import { reportContent, setBlocked, setMuted } from "@/app/moderation-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { commentMenuActions, postMenuActions, profileMenuActions, sheetReducer, type MenuAction } from "@/lib/moderation-ui";
import { SOCIAL } from "@/lib/social-ui";
import { NavIcon } from "./client-nav";

const CLOSE = "M6 6l12 12M18 6L6 18";
const MUTE = "M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6";
const UNMUTE = "M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13";
const BLOCK = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M5.6 5.6l12.8 12.8";
const FLAG = "M5 21V4M5 4h11l-2 4 2 4H5";
const CHECK = "m5 12 5 5 9-10";

type Target = { userId: string; name: string };
type Changed = "muted" | "unmuted" | "blocked" | "unblocked";

/**
 * The ••• for someone else's post, comment or profile: Mute / Unmute,
 * Block / Unblock, Report — never both halves of a pair (postMenuActions /
 * commentMenuActions / profileMenuActions). Opens one sheet: a bottom sheet
 * on a phone, a dialog from `sm`. `onChanged` lets the caller update at once
 * (a blocked author's post leaves the screen) before the refresh lands.
 */
export function ModerationMenuButton({ target, postId, commentId, reviewId, coachProfileId, muted, blocked, place, onChanged, size = "default" }: {
  target: Target;
  /** Set for a post's menu: Report then reports the post, not the person. */
  postId?: string;
  /** Set for a comment's menu: Report then reports the comment. */
  commentId?: string;
  /** Set for a coach review's menu (20261106100000): Report is the only action. */
  reviewId?: string;
  /** Set for a coach profile's menu (20261110110000): Report is the only action, with the marketplace reasons. */
  coachProfileId?: string;
  muted: boolean;
  blocked: boolean;
  place: "post" | "profile" | "comment" | "review" | "coach";
  onChanged?: (what: Changed) => void;
  size?: "default" | "small";
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, toggle] = useReducer((v: boolean) => !v, false);
  const actions = place === "post"
    ? postMenuActions({ mine: false, muted, blocked })
    : place === "comment" || place === "review" || place === "coach"
      ? commentMenuActions({ mine: false })
      : profileMenuActions({ me: false, muted, blocked });
  if (actions.length === 0) return null;

  return (
    <>
      <button
        type="button"
        aria-label={fill(t.common.moderation.more, { name: target.name })}
        aria-haspopup="dialog"
        onClick={toggle}
        className={`${size === "small" ? "inline-flex h-8 w-8 items-center justify-center rounded-full" : SOCIAL.iconButton} shrink-0 text-ink-faint hover:bg-bg hover:text-ink focus-visible:outline-2 focus-visible:outline-accent`}
      >
        <svg viewBox="0 0 24 24" className={size === "small" ? "h-4 w-4" : "h-5 w-5"} fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open ? (
        <ModerationSheet
          dialogRef={ref}
          target={target}
          postId={postId}
          commentId={commentId}
          reviewId={reviewId}
          coachProfileId={coachProfileId}
          actions={actions}
          onChanged={onChanged}
          onClose={toggle}
        />
      ) : null}
    </>
  );
}

/**
 * The sheet itself, walking sheetReducer's steps (lib/moderation-ui.ts):
 *   menu → Mute / Unmute / Unblock: sent at once, then a one-line confirmation;
 *        → Block: "Block @x?" first, sent only on the confirmation;
 *        → Report: a fixed list of reasons (details only for "Something else").
 * One request at a time. A failure says so and goes back — nothing is
 * assumed to have happened. After a change the page refreshes on close, and
 * the server decides what is left to see.
 */
function ModerationSheet({ dialogRef, target, postId, commentId, reviewId, coachProfileId, actions, onChanged, onClose }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  target: Target;
  postId?: string;
  commentId?: string;
  reviewId?: string;
  coachProfileId?: string;
  actions: MenuAction[];
  onChanged?: (what: Changed) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const m = t.common.moderation;
  const router = useRouter();
  const [state, dispatch] = useReducer(sheetReducer, { step: "menu" });
  const changed = useRef(false);

  useEffect(() => {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  }, [dialogRef]);

  const close = () => dialogRef.current?.close();
  const name = { name: target.name };

  async function run(action: "mute" | "unmute" | "block" | "unblock") {
    const r = action === "mute" || action === "unmute"
      ? await setMuted(target.userId, action === "mute")
      : await setBlocked(target.userId, action === "block");
    const what = ({ mute: "muted", unmute: "unmuted", block: "blocked", unblock: "unblocked" } as const)[action];
    if (r.ok) {
      changed.current = true;
      onChanged?.(what);
    }
    dispatch({ type: "result", ok: r.ok, what });
  }

  const kind: ReportTarget = coachProfileId ? "coach" : reviewId ? "review" : commentId ? "comment" : postId ? "post" : "user";
  async function sendReport() {
    if (state.step !== "report" || !state.reason) return;
    const { reason, details } = state;
    dispatch({ type: "submit" });
    const r = await reportContent(kind, coachProfileId ?? reviewId ?? commentId ?? postId ?? target.userId, reason, reason === "other" ? details : "");
    dispatch({ type: "result", ok: r.ok, what: "reported" });
  }

  const row = "flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
  const pending = state.step === "pending";

  return (
    <dialog
      ref={dialogRef}
      aria-label={fill(m.more, name)}
      onClose={() => {
        onClose();
        if (changed.current) router.refresh();
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      className="app-dialog sheet-enter mb-0 mt-auto w-full max-w-none rounded-t-3xl bg-surface p-0 text-ink sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-sm sm:rounded-3xl"
    >
      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" aria-busy={pending}>
        <div className="mb-2 flex items-center justify-end">
          <button type="button" onClick={close} aria-label={m.close} className="grid h-11 w-11 place-items-center rounded-full text-ink-soft hover:bg-bg hover:text-ink">
            <NavIcon d={CLOSE} className="h-5 w-5" />
          </button>
        </div>

        {state.step === "menu" || (pending && state.from === "menu") ? (
          <div className="flex flex-col gap-1">
            {actions.map((a) => {
              if (a === "edit" || a === "delete") return null;
              const label =
                a === "mute" ? fill(m.mute, name)
                : a === "unmute" ? fill(m.unmute, name)
                : a === "block" ? fill(m.block, name)
                : a === "unblock" ? fill(m.unblock, name)
                : coachProfileId ? m.reportCoach : commentId ? m.reportComment : postId ? m.reportPost : fill(m.reportUser, name);
              const icon = a === "mute" ? MUTE : a === "unmute" ? UNMUTE : a === "report" ? FLAG : BLOCK;
              const risky = a === "block" || a === "report";
              return (
                <button
                  key={a}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    dispatch({ type: "choose", action: a });
                    // Undoing is one tap; Mute and Block ask first (sheetReducer).
                    if (a === "unmute" || a === "unblock") void run(a);
                  }}
                  className={`${row} ${risky ? "text-risk" : ""}`}
                >
                  <NavIcon d={icon} className="h-5 w-5" />
                  <span className="min-w-0 truncate">{label}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {state.step === "confirm-block" || (pending && state.from === "confirm-block") ? (
          <div>
            <p className="font-display text-lg font-bold tracking-tight">{fill(m.blockTitle, name)}</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{m.blockBody}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={pending} onClick={() => dispatch({ type: "back" })} className="h-11 rounded-2xl px-4 text-[13px] font-semibold text-ink-soft hover:bg-bg hover:text-ink">
                {m.cancel}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => { dispatch({ type: "confirm" }); void run("block"); }}
                className="h-11 rounded-2xl bg-risk px-5 font-display text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
              >
                {m.blockConfirm}
              </button>
            </div>
          </div>
        ) : null}

        {state.step === "confirm-mute" || (pending && state.from === "confirm-mute") ? (
          <div>
            <p className="font-display text-lg font-bold tracking-tight">{fill(m.muteTitle, name)}</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{m.muteBody}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={pending} onClick={() => dispatch({ type: "back" })} className="h-11 rounded-2xl px-4 text-[13px] font-semibold text-ink-soft hover:bg-bg hover:text-ink">
                {m.cancel}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => { dispatch({ type: "confirm" }); void run("mute"); }}
                className="h-11 rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
              >
                {m.muteConfirm}
              </button>
            </div>
          </div>
        ) : null}

        {state.step === "report" || (pending && state.from === "report") ? (
          <form onSubmit={(e) => { e.preventDefault(); void sendReport(); }}>
            <p className="font-display text-lg font-bold tracking-tight">{m.reportTitle}</p>
            <p className="mt-1 text-[12.5px] text-ink-faint">{m.reportHint}</p>
            <div role="radiogroup" aria-label={m.reportTitle} className="mt-3 flex flex-col gap-1">
              {reportReasonsFor(kind).map((r) => {
                const on = state.step === "report" && state.reason === r;
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={pending}
                    onClick={() => dispatch({ type: "reason", reason: r })}
                    className={`${row} justify-between ${on ? "bg-accent-soft text-accent-ink" : ""}`}
                  >
                    {m.reasons[r]}
                    {on ? <NavIcon d={CHECK} className="h-4 w-4 [stroke-width:2.4]" /> : null}
                  </button>
                );
              })}
            </div>
            {state.step === "report" && state.reason === "other" ? (
              <label className="mt-2 block">
                <span className="text-[12.5px] font-semibold text-ink-soft">{m.detailsLabel}</span>
                <textarea
                  value={state.details}
                  onChange={(e) => dispatch({ type: "details", details: e.target.value.slice(0, REPORT_DETAILS_MAX) })}
                  maxLength={REPORT_DETAILS_MAX}
                  rows={3}
                  className="mt-1 w-full resize-none rounded-2xl border border-line bg-bg px-3.5 py-3 text-[14px] outline-none focus:border-accent"
                />
                <span className="block text-right text-[11px] tabular-nums text-ink-faint">
                  {state.details.length}/{REPORT_DETAILS_MAX}
                </span>
              </label>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" disabled={pending} onClick={() => dispatch({ type: "back" })} className="h-11 rounded-2xl px-4 text-[13px] font-semibold text-ink-soft hover:bg-bg hover:text-ink">
                {m.back}
              </button>
              <button
                type="submit"
                disabled={pending || state.step !== "report" || !state.reason}
                className="h-11 rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
              >
                {m.submitReport}
              </button>
            </div>
          </form>
        ) : null}

        {state.step === "done" ? (
          <div className="py-2 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent-ink">
              <NavIcon d={CHECK} className="h-5 w-5 [stroke-width:2.4]" />
            </span>
            <p role="status" className="mt-3 text-[14px] font-semibold">{fill(m.done[state.what], name)}</p>
            <button type="button" autoFocus onClick={close} className="mt-4 h-11 rounded-2xl bg-bg px-5 text-[13px] font-semibold hover:bg-accent-soft">
              {m.close}
            </button>
          </div>
        ) : null}

        {state.step === "error" ? (
          <div className="py-2 text-center">
            <p role="alert" className="text-[14px] font-semibold text-risk">{m.failed}</p>
            <button type="button" onClick={() => dispatch({ type: "back" })} className="mt-4 h-11 rounded-2xl bg-bg px-5 text-[13px] font-semibold hover:bg-accent-soft">
              {m.back}
            </button>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
