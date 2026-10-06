"use client";
import { useContext, useEffect, useId, useState, useTransition } from "react";
import { sharedContext } from "@/lib/shared-context";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { COACH_LIMITS, type CoachPublicProfile, type CoachViewerState } from "@/lib/coach-profile";
import { formatPrice } from "@/lib/coach-onboarding";
import type { StartCoachingState } from "@/lib/coach-public";
import { BUTTON, FIELD, HINT, LABEL, SMALL_BUTTON } from "@/lib/form-classes";
import { cancelCoachingRequest, requestCoaching } from "@/app/coach-profile-actions";

/**
 * "Contact coach": every button on the page (hero, each service, the phone's
 * bottom bar) opens one dialog — an optional service, a short message, an
 * optional goal and format, send. A request to talk, never a booking or a
 * payment (20261103100000). The request goes through request_coaching(),
 * which is the authority on every rule; the states below only decide what to
 * draw: Contact / Request sent (cancel) / Request accepted / Contact again.
 * Without the provider (the onboarding preview) the buttons are inert.
 */
type Ctx = {
  state: StartCoachingState;
  open: (serviceId?: string | null) => void;
  slug: string;
  pendingId: string | null;
};
const StartCoachingContext = sharedContext<Ctx | null>("start-coaching", null);

export function StartCoachingProvider({
  profile, viewer, state, children,
}: {
  profile: CoachPublicProfile;
  viewer: CoachViewerState | null;
  state: StartCoachingState;
  children: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const p = t.coachProfile.publicPage;
  const s = t.coachProfile.services;
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [service, setService] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [goal, setGoal] = useState("");
  const [format, setFormat] = useState<"online" | "in_person" | "hybrid" | null>(null);
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = profile.display_name;

  function show(serviceId?: string | null) {
    setError(null);
    setSent(false);
    setService(serviceId ?? (profile.services.length === 1 ? profile.services[0]!.id : null));
    setOpen(true);
  }

  const messageMissing = !message.trim();
  // formats the coach offers; hybrid only when they do both
  const formats = ([profile.online ? "online" : null, profile.in_person ? "in_person" : null,
    profile.online && profile.in_person ? "hybrid" : null] as const).filter((f): f is "online" | "in_person" | "hybrid" => Boolean(f));

  function send() {
    setTouched(true);
    if (messageMissing || pending) return;
    setError(null);
    start(async () => {
      const result = await requestCoaching({
        profileId: profile.id, serviceId: service, message, goal: goal.trim() || null, format, slug: profile.slug,
      });
      if (result.ok) {
        setSent(true);
        setMessage("");
        setGoal("");
        setFormat(null);
        setTouched(false);
        router.refresh();
        return;
      }
      setError(
        result.errorCode === "GOAL_TOO_LONG" ? p.errGoal
          : result.errorCode === "REQUEST_PENDING" ? p.errPending
          : result.errorCode === "NOT_ACCEPTING_CLIENTS" ? p.errNotAccepting
          : result.errorCode === "ALREADY_COACHED" ? p.errAlreadyClient
          : result.errorCode === "ALREADY_HAS_COACH" ? p.errHasCoach
          : result.errorCode === "REQUEST_RATE" ? p.errRate
          : result.errorCode === "COACH_NOT_FOUND" ? p.errGone
          : p.errGeneric,
      );
    });
  }

  const priceOf = (sv: CoachPublicProfile["services"][number]) => {
    const price = sv.price_public ? formatPrice(sv.price_cents, sv.currency, locale) : null;
    return price ? `${price} ${s.unitShort[sv.price_unit]}`.trim() : sv.price_public ? s.onRequest : s.priceHidden;
  };

  return (
    <StartCoachingContext.Provider value={{ state, open: show, slug: profile.slug, pendingId: viewer?.pending_request?.id ?? null }}>
      {children}
      <StickyCta />
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
            <Dialog.Popup className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 outline-none sm:max-h-[92vh] sm:rounded-2xl">
              {sent ? (
                <div role="status" data-testid="coaching-request-sent">
                  <Dialog.Title className="font-display text-lg font-bold">{p.sent}</Dialog.Title>
                  <Dialog.Description className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                    {fill(p.sentBody, { name })}
                  </Dialog.Description>
                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <Link href="/coaches/requests" className={`${SMALL_BUTTON} h-11 px-5`}>{p.myRequests}</Link>
                    <Dialog.Close className={BUTTON}>{p.close}</Dialog.Close>
                  </div>
                </div>
              ) : (
                <>
                  <Dialog.Title className="font-display text-lg font-bold">{fill(p.dialogTitle, { name })}</Dialog.Title>
                  <Dialog.Description className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
                    {fill(p.dialogBody, { name })}
                  </Dialog.Description>

                  {profile.services.length > 0 ? (
                    <fieldset className="mt-4">
                      <legend className={LABEL}>{p.chooseService}</legend>
                      <div className="mt-2 grid gap-2">
                        {profile.services.map((sv) => (
                          <label
                            key={sv.id}
                            className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 ring-accent/60 has-[:focus-visible]:ring-2 ${
                              service === sv.id ? "bg-accent-soft" : "bg-bg"
                            }`}
                          >
                            <span className="flex items-center gap-3">
                              <input
                                type="radio" name={`${ids}-service`} className="accent-[var(--color-accent)]"
                                checked={service === sv.id} onChange={() => setService(sv.id)}
                              />
                              <span className="font-semibold">{sv.name}</span>
                            </span>
                            <span className="text-[13px] font-semibold text-accent-ink">{priceOf(sv)}</span>
                          </label>
                        ))}
                        {profile.services.length > 1 ? (
                          <label className={`flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 ${service === null ? "bg-accent-soft" : "bg-bg"}`}>
                            <input
                              type="radio" name={`${ids}-service`} className="accent-[var(--color-accent)]"
                              checked={service === null} onChange={() => setService(null)}
                            />
                            <span className="text-[14px] text-ink-soft">{p.anyService}</span>
                          </label>
                        ) : null}
                      </div>
                    </fieldset>
                  ) : null}

                  <label className={`${LABEL} mt-4`} htmlFor={`${ids}-message`}>{p.message}</label>
                  <textarea
                    id={`${ids}-message`} rows={4} maxLength={COACH_LIMITS.requestMessage} value={message} required
                    placeholder={p.messagePlaceholder} aria-invalid={touched && messageMissing}
                    className={`${FIELD} h-auto min-h-24 resize-y py-2.5 leading-relaxed`}
                    aria-describedby={`${ids}-message-hint`}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <p id={`${ids}-message-hint`} className={HINT}>
                    {touched && messageMissing ? <span className="text-risk">{p.messageRequired}</span> : p.messageHint}
                    <span className="float-right tabular-nums text-ink-faint">{message.length}/{COACH_LIMITS.requestMessage}</span>
                  </p>

                  <label className={`${LABEL} mt-4`} htmlFor={`${ids}-goal`}>{p.goal}</label>
                  <input
                    id={`${ids}-goal`} className={FIELD} maxLength={300} value={goal} placeholder={p.goalPlaceholder}
                    onChange={(e) => setGoal(e.target.value)}
                  />

                  {formats.length > 1 ? (
                    <fieldset className="mt-4">
                      <legend className={LABEL}>{p.formatLabel}</legend>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {[null, ...formats].map((f) => (
                          <button
                            key={f ?? "any"} type="button" aria-pressed={format === f} onClick={() => setFormat(f)}
                            className={`h-10 rounded-full px-4 text-[13px] font-semibold transition ${
                              format === f ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"}`}
                          >
                            {f ? s.deliveries[f] : p.anyFormat}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}

                  {viewer?.has_other_coach ? (
                    <p className="mt-3 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-warn">
                      {fill(p.otherCoach, { name })}
                    </p>
                  ) : null}
                  {error ? <p role="alert" className="mt-3 text-[13px] text-risk">{error}</p> : null}

                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <Dialog.Close className={`${SMALL_BUTTON} h-11 px-5`}>{p.cancel}</Dialog.Close>
                    <button type="button" className={BUTTON} disabled={pending || (touched && messageMissing)} onClick={send}
                      data-testid="coaching-request-send">
                      {pending ? p.sending : p.send}
                    </button>
                  </div>
                </>
              )}
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </StartCoachingContext.Provider>
  );
}

const PRIMARY = "inline-flex h-12 items-center justify-center rounded-2xl bg-accent px-6 font-display text-[15px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-60";
const SOFT = "inline-flex h-12 items-center justify-center rounded-2xl bg-accent-soft px-6 font-display text-[15px] font-bold text-accent-ink hover:bg-accent hover:text-accent-fg disabled:opacity-60";
const QUIET = "inline-flex h-12 items-center justify-center rounded-2xl bg-bg px-5 text-[14px] font-semibold text-ink-soft";

/** The Start coaching control in whatever state this reader is in. */
export function StartCoachingButton({
  serviceId = null, compact = false, soft = false, className = "",
}: {
  serviceId?: string | null;
  compact?: boolean;
  /** A quieter fill for the per-service buttons, so the hero's stays the main action. */
  soft?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const p = t.coachProfile.publicPage;
  const ctx = useContext(StartCoachingContext);
  const size = compact ? "h-10 px-4 text-[13.5px]" : "";
  const primary = soft ? SOFT : PRIMARY;
  const state = ctx?.state ?? "preview";

  switch (state) {
    case "available":
    case "contact_again":
      return (
        <button type="button" className={`${primary} ${size} ${className}`} onClick={() => ctx?.open(serviceId)}
          data-testid="contact-coach" data-state={state}>
          {state === "contact_again" ? p.contactAgain : p.startCoaching}
        </button>
      );
    case "accepted":
      return (
        <Link href="/coaches/requests" className={`${QUIET} ${size} ${className}`} data-testid="coaching-request-accepted">
          ✓ {p.requestAccepted}
        </Link>
      );
    case "sign_in":
      return (
        <Link href={`/login?${new URLSearchParams({ next: `/coaches/${ctx!.slug}` })}`} className={`${primary} ${size} ${className}`}>
          {p.startCoaching}
        </Link>
      );
    case "pending":
      return <PendingRequest ctx={ctx!} className={`${QUIET} ${size} ${className}`} />;
    case "client":
      return <Link href="/coach" className={`${QUIET} ${size} ${className}`}>{p.youAreClient}</Link>;
    case "self":
      return <Link href="/settings/coach-profile" className={`${QUIET} ${size} ${className}`}>{p.editProfile}</Link>;
    case "not_accepting":
      return <span className={`${QUIET} ${size} ${className}`}>{p.notAccepting}</span>;
    case "preview":
      return (
        <button type="button" disabled className={`${primary} ${size} ${className}`} title={p.previewNote}>
          {p.startCoaching}
        </button>
      );
  }
}

/**
 * On a phone the hero's button scrolls away; this bar keeps the action in
 * reach. Portalled to <body> (CLAUDE.md: never a `fixed` element in place),
 * phones only, and only when there is something to do.
 */
function StickyCta() {
  const ctx = useContext(StartCoachingContext);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !ctx || (ctx.state !== "available" && ctx.state !== "sign_in" && ctx.state !== "contact_again")) return null;
  return createPortal(
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:hidden">
      <StartCoachingButtonInContext ctx={ctx} />
    </div>,
    document.body,
  );
}

// A portal leaves the provider's DOM subtree but not its React tree, so the
// context still reaches here; the indirection keeps the bar full-width.
function StartCoachingButtonInContext({ ctx }: { ctx: Ctx }) {
  return (
    <StartCoachingContext.Provider value={ctx}>
      <StartCoachingButton className="w-full" />
    </StartCoachingContext.Provider>
  );
}

/** "Request sent", with the one thing a client can still do about it: take it back. */
function PendingRequest({ ctx, className }: { ctx: Ctx; className: string }) {
  const { t } = useI18n();
  const p = t.coachProfile.publicPage;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={className} data-testid="coaching-request-pending">✓ {p.requestSent}</span>
      {ctx.pendingId ? (
        <button
          type="button" disabled={pending}
          className="text-[13px] font-semibold text-ink-faint hover:text-ink hover:underline disabled:opacity-50"
          onClick={() => start(async () => {
            setError(false);
            const result = await cancelCoachingRequest({ requestId: ctx.pendingId!, slug: ctx.slug });
            if (!result.ok) setError(true);
            else router.refresh();
          })}
        >
          {p.cancelRequest}
        </button>
      ) : null}
      {error ? <span role="alert" className="text-[12.5px] text-risk">{p.errGeneric}</span> : null}
    </span>
  );
}
