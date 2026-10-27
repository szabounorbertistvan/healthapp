import type { CoachShareCardV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { APP_NAME, SITE_URL } from "@/lib/brand";
import {
  COACH_SHARE_FORMATS, COACH_SHARE_MAX_SPECS, COACH_SHARE_TEMPLATES, coachShareCardFromPublic, coachShareFileName,
  coachSharePhotoUrl, layoutCoachShareCard, normalizeCoachShareOptions, selectableSpecializations,
  type CoachSharePhoto, type CoachShareTemplate, type MeasureText,
} from "@/lib/coach-share-card";
import { getMyCoachProfile, getPublicCoachProfile } from "@/lib/coach-profile-data";
import { getI18n } from "@/lib/i18n/server";
import { qrModules } from "@/lib/qr";
import { SHARE_CARD_COLORS, type ShareFormat } from "@/lib/share-card";

// The coach's share card for the app — the web's /marketplace/share: always
// about the signed-in coach (their own profile row, never a slug from the
// URL), from coach_public_profile() only, so a profile that is not public has
// no card. Laid out here by the web's own layoutCoachShareCard(); the app
// paints the items. ?template&format&photo&specs=a,b&headline=0&qr=0.
//
// The browser measures text on a canvas; here a fixed-width estimate stands in
// (the shape the layout's tests use), a little wide so text wraps early rather
// than overflowing — wrapText shrinks or trims whatever still does not fit.
export const dynamic = "force-dynamic";

const measure: MeasureText = (text, size, weight, font, tracking) =>
  text.length * size * (font === "display" ? (weight >= 700 ? 0.6 : 0.57) : 0.54) + tracking * size * Math.max(0, text.length - 1);

export const GET = v1Route(async (request) => {
  const q = new URL(request.url).searchParams;
  const [{ t, locale }, mine] = await Promise.all([getI18n(), getMyCoachProfile()]);
  if (!mine) return apiJson<CoachShareCardV1>({ status: "none" });
  const pub = mine.profile.status === "published" ? await getPublicCoachProfile(mine.profile.slug) : null;
  if (!pub) return apiJson<CoachShareCardV1>({ status: "not_public" });

  const card = coachShareCardFromPublic(pub, SITE_URL);
  const options = normalizeCoachShareOptions(card, {
    ...(q.get("template") ? { template: q.get("template") as CoachShareTemplate } : {}),
    ...(q.get("format") ? { format: q.get("format") as ShareFormat } : {}),
    ...(q.get("photo") ? { photo: q.get("photo") as CoachSharePhoto } : {}),
    ...(q.get("specs") !== null ? { specs: (q.get("specs") ?? "").split(",").filter(Boolean) } : {}),
    ...(q.get("headline") !== null ? { showHeadline: q.get("headline") !== "0" } : {}),
    ...(q.get("qr") !== null ? { showQr: q.get("qr") !== "0" } : {}),
  });
  const s = t.coachProfile.shareCard;
  const layout = layoutCoachShareCard({
    card, options, locale, measure,
    labels: { cta: s.cardCta, verified: t.coachProfile.verification.badge, online: t.coachProfile.discovery.online, inPerson: t.coachProfile.discovery.inPerson, brand: APP_NAME },
    qr: options.showQr ? qrModules(card.url) : null,
  });
  const photos: CoachSharePhoto[] = [...(card.avatarUrl ? ["avatar" as const] : []), ...(card.coverUrl ? ["cover" as const] : []), "none"];
  return apiJson<CoachShareCardV1>({
    status: "ok",
    card: {
      layout, colors: SHARE_CARD_COLORS, options, customize: true, has_profile: true,
      avatar_url: null, photo_url: coachSharePhotoUrl(card, options.photo),
      file_name: coachShareFileName(card.slug, options.template, options.format), title: card.name,
    },
    options,
    templates: [...COACH_SHARE_TEMPLATES],
    formats: [...COACH_SHARE_FORMATS],
    photos,
    specs: selectableSpecializations(card).map((x) => ({ slug: x.slug, name: locale === "ro" ? x.name_ro : x.name_en })),
    max_specs: COACH_SHARE_MAX_SPECS,
    url: card.url,
  });
});
