// The browser half of the coach share card: loads what the card draws (the
// brand fonts and PNGs, the chosen photo, the QR code), lays it out with real
// text measurements and paints a PNG at the exact format size. The preview on
// the page *is* this PNG, so what the coach sees is the file they get.
import { canvasMeasure, loadShareFonts, loadShareImage, renderShareCard, tintImage, type ShareFonts } from "./share-card-render";
import { SHARE_CARD_COLORS, SHARE_FORMAT_SIZE, type ShareCardLayout } from "./share-card";
import {
  cardPhotoRendition, coachSharePhotoUrl, layoutCoachShareCard,
  type CoachShareCard, type CoachShareLabels, type CoachShareOptions,
} from "./coach-share-card";
import { qrModules } from "./qr";

type Brand = { fonts: ShareFonts; mark: HTMLImageElement | null; wordmark: HTMLImageElement | null; wordmarkDark: HTMLCanvasElement | null };

let brand: Promise<Brand> | null = null;
const photos = new Map<string, Promise<HTMLImageElement | null>>();
const codes = new Map<string, boolean[][]>();

function loadBrand(): Promise<Brand> {
  brand ??= Promise.all([
    loadShareFonts(),
    loadShareImage("/brand/voinic-mark.png"),
    loadShareImage("/brand/voinic-wordmark.png"),
  ]).then(([fonts, mark, wordmark]) => ({ fonts, mark, wordmark, wordmarkDark: tintImage(wordmark, SHARE_CARD_COLORS.tileInk) }));
  return brand;
}

/**
 * The chosen photo, sharp: a 1080 px rendition of the same Cloudinary asset
 * first, the stored URL if that is refused, nothing (the initial) if neither
 * loads. Loaded with CORS so the canvas stays exportable — a tainted canvas
 * could not be turned into a PNG at all.
 */
function loadPhoto(card: CoachShareCard, options: CoachShareOptions): Promise<HTMLImageElement | null> {
  const url = coachSharePhotoUrl(card, options.photo);
  if (!url) return Promise.resolve(null);
  const { width, height } = SHARE_FORMAT_SIZE[options.format];
  const big = cardPhotoRendition(url, width, Math.round(height * 0.7), options.photo === "avatar" ? "face" : "auto");
  const key = `${big}|${url}`;
  let p = photos.get(key);
  if (!p) {
    p = loadShareImage(big, true).then((img) => img ?? (big !== url ? loadShareImage(url, true) : null));
    photos.set(key, p);
  }
  return p;
}

function qrFor(url: string): boolean[][] {
  let m = codes.get(url);
  if (!m) { m = qrModules(url); codes.set(url, m); }
  return m;
}

export async function renderCoachShareCard(input: {
  card: CoachShareCard; options: CoachShareOptions; locale: "en" | "ro"; labels: CoachShareLabels;
}): Promise<{ blob: Blob; layout: ShareCardLayout; photoLoaded: boolean }> {
  const [b, photo] = await Promise.all([loadBrand(), loadPhoto(input.card, input.options)]);
  const layout = layoutCoachShareCard({ ...input, measure: canvasMeasure(b.fonts), qr: qrFor(input.card.url) });
  const blob = await renderShareCard(layout, {
    assets: { fonts: b.fonts, mark: b.mark, wordmark: b.wordmark, wordmarkDark: b.wordmarkDark, avatar: null, photo },
  });
  return { blob, layout, photoLoaded: Boolean(photo) };
}
