"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { APP_NAME } from "@/lib/brand";
import { BUTTON, FIELD_INSET, HINT, LABEL, SMALL_BUTTON_INSET } from "@/lib/form-classes";
import { SHARE_FORMAT_SIZE, type ShareFormat } from "@/lib/share-card";
import { downloadBlob } from "@/lib/share-card-render";
import {
  COACH_SHARE_FORMATS, COACH_SHARE_MAX_SPECS, COACH_SHARE_TEMPLATES, coachShareFileName, normalizeCoachShareOptions,
  primarySpecialization, selectableSpecializations,
  type CoachShareCard, type CoachShareLabels, type CoachShareOptions, type CoachSharePhoto,
} from "@/lib/coach-share-card";
import { canShareAnything, copyProfileLink, shareCoachCard } from "@/lib/coach-share-deliver";
import { Chip, Switch } from "./ui";

type Result = { status: "rendering" | "ready" | "error"; blob: Blob | null; url: string | null; photoFailed: boolean };

/**
 * /marketplace/share — the coach makes a promotional image of their own
 * public profile. The server hands over a CoachShareCard built from the
 * public payload only (coachShareCardFromPublic); this component chooses a
 * template, a size, a photo among the coach's own and which of their own
 * specializations to show, and renders the real PNG — the preview is the
 * file. The renderer (and the QR encoder) load on this page only.
 */
export function CoachShareGenerator({ card }: { card: CoachShareCard }) {
  const { t, locale } = useI18n();
  const s = t.coachProfile.shareCard;
  const ids = useId();
  const [options, setOptions] = useState<CoachShareOptions>(() => normalizeCoachShareOptions(card, {}));
  const [result, setResult] = useState<Result>({ status: "rendering", blob: null, url: null, photoFailed: false });
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [canShare, setCanShare] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  useEffect(() => setCanShare(canShareAnything()), []);

  const labels: CoachShareLabels = useMemo(() => ({
    cta: s.cardCta, verified: t.coachProfile.verification.badge,
    online: t.coachProfile.discovery.online, inPerson: t.coachProfile.discovery.inPerson, brand: APP_NAME,
  }), [s.cardCta, t]);

  const set = useCallback((patch: Partial<CoachShareOptions>) => {
    setOptions((o) => normalizeCoachShareOptions(card, { ...o, ...patch }));
  }, [card]);

  // re-render on every change, a beat later so a run of clicks paints once
  useEffect(() => {
    let alive = true;
    setResult((r) => ({ ...r, status: "rendering" }));
    const timer = setTimeout(async () => {
      try {
        const { renderCoachShareCard } = await import("@/lib/coach-share-render");
        const out = await renderCoachShareCard({ card, options, locale, labels });
        if (!alive) return;
        const url = URL.createObjectURL(out.blob);
        setResult((prev) => {
          if (prev.url) URL.revokeObjectURL(prev.url);
          return { status: "ready", blob: out.blob, url, photoFailed: options.photo !== "none" && !out.photoLoaded };
        });
      } catch {
        if (alive) setResult((r) => ({ ...r, status: "error" }));
      }
    }, 150);
    return () => { alive = false; clearTimeout(timer); };
  }, [card, options, locale, labels, attempt]);
  useEffect(() => () => { if (result.url) URL.revokeObjectURL(result.url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fileName = coachShareFileName(card.slug, options.template, options.format);
  const size = SHARE_FORMAT_SIZE[options.format];
  const primary = primarySpecialization(card);
  const selectable = selectableSpecializations(card);
  const specName = (x: { name_en: string; name_ro: string }) => (locale === "ro" ? x.name_ro : x.name_en);
  const photos: CoachSharePhoto[] = [...(card.avatarUrl ? ["avatar" as const] : []), ...(card.coverUrl ? ["cover" as const] : []), "none"];
  const ready = result.status === "ready" && result.blob;

  async function onShare() {
    if (!result.blob) return;
    const outcome = await shareCoachCard(result.blob, fileName, { title: card.name, url: card.url });
    setStatus(outcome === "shared" ? s.shared : outcome === "shared-link" ? s.sharedLink : outcome === "unsupported" ? s.shareUnsupported : "");
  }
  async function onCopy() {
    if (await copyProfileLink(card.url)) setStatus(s.copied);
    else { linkRef.current?.select(); setStatus(s.copyFailed); }
  }
  function onDownload() {
    if (!result.blob) return;
    downloadBlob(result.blob, fileName);
    setStatus(s.downloaded);
  }

  const radioCard = "flex h-full cursor-pointer flex-col rounded-2xl border border-line bg-bg p-3.5 transition peer-checked:border-accent peer-checked:bg-accent-soft peer-focus-visible:ring-2 peer-focus-visible:ring-accent hover:border-ink-faint";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-8" data-testid="share-generator">
      {/* ---------- preview + actions (first on a phone) ---------- */}
      <section aria-labelledby={`${ids}-preview`} className="lg:sticky lg:top-6 lg:order-2 lg:self-start">
        <h2 id={`${ids}-preview`} className="sr-only">{s.preview}</h2>
        <div
          className={`relative mx-auto w-full overflow-hidden rounded-2xl bg-surface ${options.format === "story" ? "aspect-[9/16] max-w-[min(100%,calc(62vh*9/16))]" : "aspect-square max-w-[min(100%,62vh)]"}`}
          data-testid="share-preview-box" data-format={options.format}
        >
          {result.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.url} width={size.width} height={size.height} data-testid="share-preview"
              alt={fill(s.previewAlt, { format: `${s.formats[options.format].name} ${s.formats[options.format].size}` })}
              className={`h-full w-full object-contain transition-opacity motion-reduce:transition-none ${result.status === "rendering" ? "opacity-60" : "opacity-100"}`}
            />
          ) : (
            <span className="block h-full w-full animate-pulse bg-surface motion-reduce:animate-none" aria-hidden />
          )}
          {result.status === "rendering" ? (
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-bg/90 px-3 py-1 text-[12px] font-semibold text-ink-soft">{s.rendering}</span>
          ) : null}
        </div>
        {result.status === "error" ? (
          <p role="alert" className="mt-3 text-center text-[13px] text-risk">
            {s.failed}{" "}
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-semibold underline">{s.retry}</button>
          </p>
        ) : null}
        {result.photoFailed ? <p className={`${HINT} text-center`} data-testid="share-photo-failed">{s.photoFailed}</p> : null}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={onDownload} disabled={!ready} className={`${BUTTON} w-full`} data-testid="share-download">
            {s.download}
          </button>
          {canShare ? (
            <button type="button" onClick={onShare} disabled={!ready} data-testid="share-share"
              className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-surface px-5 font-display text-sm font-bold text-ink outline-none ring-accent/60 hover:bg-accent-soft focus-visible:ring-2 disabled:opacity-50">
              {s.share}
            </button>
          ) : (
            <p className="self-center text-[12.5px] text-ink-faint sm:text-left" data-testid="share-unsupported">{s.shareUnsupported}</p>
          )}
        </div>
        <div className="mt-3">
          <label htmlFor={`${ids}-link`} className={LABEL}>{s.linkLabel}</label>
          <div className="mt-1.5 flex gap-2">
            <input id={`${ids}-link`} ref={linkRef} readOnly value={card.url} className={`${FIELD_INSET} min-w-0 flex-1`} data-testid="share-link"
              onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={onCopy} className={`${SMALL_BUTTON_INSET} shrink-0`} data-testid="share-copy">{s.copy}</button>
          </div>
          <a href={card.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[13px] font-semibold text-accent-ink hover:underline">
            {s.viewProfile} ↗
          </a>
        </div>
        <p role="status" aria-live="polite" className="mt-2 min-h-[1.25rem] text-[13px] font-semibold text-accent-ink" data-testid="share-status">{status}</p>
        <p className={HINT}>{s.publishNote}</p>
      </section>

      {/* ---------- choices ---------- */}
      {/* content-start: beside a tall Story preview the choices stay together instead of stretching apart */}
      <div className="grid content-start gap-6 lg:order-1">
        <fieldset>
          <legend className="font-display text-[16px] font-bold">{s.stepTemplate}</legend>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
            {COACH_SHARE_TEMPLATES.map((k) => (
              <label key={k} className="block">
                <input type="radio" name={`${ids}-template`} value={k} checked={options.template === k} onChange={() => set({ template: k })}
                  className="peer sr-only" data-testid={`share-template-${k}`} />
                <span className={radioCard}>
                  <span className="font-display text-[15px] font-bold">{s.templates[k].name}</span>
                  <span className="mt-1 text-[12.5px] leading-snug text-ink-soft">{s.templates[k].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-display text-[16px] font-bold">{s.stepFormat}</legend>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {COACH_SHARE_FORMATS.map((k: ShareFormat) => (
              <label key={k} className="block">
                <input type="radio" name={`${ids}-format`} value={k} checked={options.format === k} onChange={() => set({ format: k })}
                  className="peer sr-only" data-testid={`share-format-${k}`} />
                <span className={radioCard}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-display text-[15px] font-bold">{s.formats[k].name}</span>
                    <span className="text-[11.5px] font-semibold tabular-nums text-ink-faint">{s.formats[k].size}</span>
                  </span>
                  <span className="mt-1 text-[12.5px] leading-snug text-ink-soft">{s.formats[k].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-display text-[16px] font-bold">{s.stepPhoto}</legend>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {photos.map((k) => (
              <Chip key={k} on={options.photo === k} onToggle={() => set({ photo: k })}>
                <span data-testid={`share-photo-${k}`}>{s.photos[k]}</span>
              </Chip>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-display text-[16px] font-bold">{s.stepContent}</legend>
          {primary ? <p className={HINT}>{fill(s.primaryNote, { name: specName(primary) })}</p> : null}
          <p className={`${LABEL} mt-3`}>{s.specsLabel}</p>
          {selectable.length > 0 ? (
            <>
              <p className={HINT}>{fill(s.specsHint, { max: COACH_SHARE_MAX_SPECS })}</p>
              <div className="mt-2 flex flex-wrap gap-1.5" data-testid="share-specs">
                {selectable.map((x) => {
                  const on = options.specs.includes(x.slug);
                  return (
                    <Chip key={x.slug} on={on} disabled={!on && options.specs.length >= COACH_SHARE_MAX_SPECS}
                      onToggle={() => set({ specs: on ? options.specs.filter((v) => v !== x.slug) : [...options.specs, x.slug] })}>
                      {specName(x)}
                    </Chip>
                  );
                })}
              </div>
            </>
          ) : (
            <p className={HINT}>{s.noSpecs}</p>
          )}
          <div className="mt-4 grid gap-2">
            {card.headline ? (
              <Switch label={s.showHeadline} checked={options.showHeadline} onChange={(v) => set({ showHeadline: v })}
                onLabel={t.coachProfile.wizard.on} offLabel={t.coachProfile.wizard.off} inset />
            ) : null}
            <Switch label={s.showQr} checked={options.showQr} onChange={(v) => set({ showQr: v })}
              onLabel={t.coachProfile.wizard.on} offLabel={t.coachProfile.wizard.off} inset />
          </div>
        </fieldset>
      </div>
    </div>
  );
}
