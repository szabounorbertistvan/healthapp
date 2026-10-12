import { describe, expect, it } from "vitest";
import {
  BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, QRCodeReader, RGBLuminanceSource,
} from "@zxing/library";
import {
  COACH_SHARE_FORMATS, COACH_SHARE_TEMPLATES, STORY_SAFE, cardPhotoRendition, coachShareCardFromPublic, coachShareFileName,
  coachSharePhotoUrl, defaultCoachShareOptions, initialsOf, layoutCoachShareCard, normalizeCoachShareOptions, shortProfileUrl, wrapText,
  type CoachShareCard, type CoachShareLabels, type CoachSharePublicSource, type MeasureText,
} from "./coach-share-card";
import type { ShareCardItem, ShareTextItem } from "./share-card";
import { qrModules } from "./qr";
import { coachProfileMessages } from "./i18n/messages/coach-profile";

/** 0.56 em per character plus tracking — the same shape as canvas measureText, deterministic. */
const measure: MeasureText = (text, size, _w, _f, tracking) => text.length * size * 0.56 + tracking * size * Math.max(0, text.length - 1);

const sp = (slug: string, en: string, ro: string, primary = false) => ({ slug, name_en: en, name_ro: ro, is_primary: primary });

// What coach_public_profile returns, with fields the card must never carry
const PUBLIC = {
  id: "p-1", user_id: "u-viewer-1", slug: "andrei-popescu", display_name: "  Andrei Popescu ", username: "andrei",
  avatar_url: "https://res.cloudinary.com/voinic/image/upload/c_fill,g_face,h_256,w_256,q_auto,f_auto/v1712/avatars/u1/avatar",
  cover_url: null, headline: "Strength coach for busy people", about: "PRIVATE-ABOUT text that must not be on a card",
  online: true, in_person: true, verified: true, followers: 1200, coaching_since: 2015,
  specializations: [sp("strength", "Strength", "Forță", true), sp("hypertrophy", "Hypertrophy", "Hipertrofie"),
    sp("powerlifting", "Powerlifting", "Powerlifting"), sp("weight-loss", "Weight Loss", "Slăbire"), sp("mobility", "Mobility & Flexibility", "Mobilitate și flexibilitate")],
  locations: [{ city_slug: "cluj-napoca", city: "Cluj-Napoca", city_en: "Cluj-Napoca", country_code: "RO", gym_name: "Iron Temple" }],
  services: [{ name: "Online plan", price_cents: 20000 }], certifications: [{ name: "PRIVATE-CERT", verified: false }],
  stats: { posts: 3, workouts: 210, badges: 4, fitness_score: 88 },
} as unknown as CoachSharePublicSource;

const SITE = "https://www.voinic.fit";
const typical = coachShareCardFromPublic(PUBLIC, SITE);
const long: CoachShareCard = {
  ...typical, slug: "alexandra-maria-constantinescu-vladescu", name: "Alexandra-Maria Constantinescu-Vlădescu",
  headline: "Pregătire fizică pentru sportivi tineri, recuperare activă după sezon, mobilitate, forță funcțională și obiceiuri sănătoase pentru întreaga familie.",
  avatarUrl: null,
  specializations: [sp("youth-athletic-development", "Youth Athletic Development", "Dezvoltare atletică pentru tineri", true),
    sp("sports-specific-conditioning", "Sports-Specific Conditioning", "Pregătire fizică specifică sportului"),
    sp("prenatal-postnatal-fitness", "Prenatal & Postnatal Fitness", "Fitness prenatal și postnatal"),
    sp("hiking-outdoor-fitness", "Hiking & Outdoor Fitness", "Drumeții și fitness în aer liber")],
  url: `${SITE}/coaches/alexandra-maria-constantinescu-vladescu`,
};
const bare: CoachShareCard = {
  slug: "ion", name: "Ion", headline: null, avatarUrl: null, coverUrl: null, specializations: [], city: null,
  online: true, inPerson: false, verified: false, url: `${SITE}/coaches/ion`,
};

const labelsFor = (locale: "en" | "ro"): CoachShareLabels => ({
  cta: coachProfileMessages[locale].shareCard.cardCta, verified: "Voinic Verified",
  online: "Online", inPerson: locale === "ro" ? "Față în față" : "In person", brand: "Voinic",
});

describe("the card's data comes from the public profile only", () => {
  it("picks the public fields and nothing else", () => {
    expect(Object.keys(typical).sort()).toEqual(
      ["avatarUrl", "city", "coverUrl", "headline", "inPerson", "name", "online", "slug", "specializations", "url", "verified"]);
    const all = JSON.stringify(typical);
    for (const secret of ["PRIVATE-ABOUT", "PRIVATE-CERT", "u-viewer-1", "20000", "fitness_score", "Iron Temple", "1200"]) {
      expect(all).not.toContain(secret);
    }
  });
  it("links to the canonical public page", () => {
    expect(typical.url).toBe("https://www.voinic.fit/coaches/andrei-popescu");
    expect(coachShareCardFromPublic(PUBLIC, "https://www.voinic.fit/").url).toBe("https://www.voinic.fit/coaches/andrei-popescu");
    expect(shortProfileUrl(typical.url)).toBe("voinic.fit/coaches/andrei-popescu");
  });
  it("trims the name, keeps verified as the database says, shows a city only for in-person coaching", () => {
    expect(typical.name).toBe("Andrei Popescu");
    expect(typical.verified).toBe(true);
    expect(typical.city).toEqual({ ro: "Cluj-Napoca", en: "Cluj-Napoca" });
    expect(coachShareCardFromPublic({ ...PUBLIC, in_person: false }, SITE).city).toBeNull();
    expect(coachShareCardFromPublic({ ...PUBLIC, verified: undefined }, SITE).verified).toBe(false);
  });
  it("an empty headline or photo is null, not an empty string", () => {
    const c = coachShareCardFromPublic({ ...PUBLIC, headline: "   ", avatar_url: "" }, SITE);
    expect(c.headline).toBeNull();
    expect(c.avatarUrl).toBeNull();
  });
});

describe("options: only the coach's own choices", () => {
  it("defaults: Signature, square, the profile photo, the first three non-primary specializations, QR on", () => {
    expect(defaultCoachShareOptions(typical)).toEqual({
      template: "signature", format: "square", photo: "avatar", specs: ["hypertrophy", "powerlifting", "weight-loss"], showHeadline: true, showQr: true,
    });
    expect(defaultCoachShareOptions(bare)).toMatchObject({ photo: "none", specs: [], showHeadline: false });
  });
  it("every template and format is accepted; anything else falls back", () => {
    for (const template of COACH_SHARE_TEMPLATES) for (const format of COACH_SHARE_FORMATS) {
      expect(normalizeCoachShareOptions(typical, { template, format })).toMatchObject({ template, format });
    }
    expect(normalizeCoachShareOptions(typical, { template: "neon" as never, format: "billboard" as never })).toMatchObject({ template: "signature", format: "square" });
  });
  it("drops a slug that is not one of the coach's own, the primary, duplicates, and keeps three at most", () => {
    const o = normalizeCoachShareOptions(typical, { specs: ["yoga", "strength", "mobility", "mobility", "hypertrophy", "powerlifting", "weight-loss"] });
    expect(o.specs).toEqual(["mobility", "hypertrophy", "powerlifting"]);
  });
  it("a photo the coach does not have becomes none; no headline cannot be shown", () => {
    expect(normalizeCoachShareOptions(typical, { photo: "cover" }).photo).toBe("avatar");
    expect(normalizeCoachShareOptions(bare, { photo: "avatar" }).photo).toBe("none");
    expect(normalizeCoachShareOptions(bare, { showHeadline: true }).showHeadline).toBe(false);
    expect(coachSharePhotoUrl(typical, "none")).toBeNull();
  });
  it("names the file after the coach, template and size", () => {
    expect(coachShareFileName("andrei-popescu", "athletic", "story")).toBe("voinic-andrei-popescu-athletic-story.png");
  });
});

describe("photo rendition", () => {
  it("asks Cloudinary for a sharp version of the same asset", () => {
    expect(cardPhotoRendition(typical.avatarUrl, 1080, 756, "face")).toBe(
      "https://res.cloudinary.com/voinic/image/upload/c_fill,g_face,w_1080,h_756,q_auto:good,f_jpg/v1712/avatars/u1/avatar");
  });
  it("leaves any other URL alone", () => {
    expect(cardPhotoRendition("https://example.com/a.jpg", 1080, 756, "face")).toBe("https://example.com/a.jpg");
    expect(cardPhotoRendition(null, 1, 1, "auto")).toBeNull();
  });
});

describe("wrapText", () => {
  const f = { size: 80, min: 40, weight: 800 as const, font: "display" as const };
  it("breaks after a hyphen or a slash instead of cutting a long word", () => {
    const r = wrapText(measure, "Alexandra-Maria Constantinescu-Vlădescu", f, 480, 3);
    expect(r.lines.join("")).toBe("Alexandra-MariaConstantinescu-Vlădescu");
    expect(r.lines.some((l) => l.endsWith("…"))).toBe(false);
    expect(wrapText(measure, "voinic.fit/coaches/alexandra-maria", { ...f, size: 30, min: 30 }, 360, 2).lines).toEqual(["voinic.fit/coaches/", "alexandra-maria"]);
  });
  it("keeps a no-break space together (the arrow stays with its word)", () => {
    const r = wrapText(measure, "Descoperă profilul meu →", { ...f, size: 30, min: 30 }, 330, 2);
    expect(r.lines[r.lines.length - 1]).toMatch(/meu →$/);
  });
  it("shrinks before it trims, and never returns a line wider than the box", () => {
    const r = wrapText(measure, "A very long headline ".repeat(12), f, 400, 2);
    expect(r.lines).toHaveLength(2);
    expect(r.size).toBe(40);
    expect(r.lines[1]!.endsWith("…")).toBe(true);
    for (const l of r.lines) expect(measure(l, r.size, 800, "display", 0)).toBeLessThanOrEqual(400);
  });
  it("an empty text is no lines", () => {
    expect(wrapText(measure, "   ", f, 400, 2).lines).toEqual([]);
  });
});

describe("initials", () => {
  it("first and last name, one letter for one word", () => {
    expect(initialsOf("Andrei Popescu")).toBe("AP");
    expect(initialsOf("Alexandra-Maria Constantinescu-Vlădescu")).toBe("AC");
    expect(initialsOf("Ion")).toBe("I");
    expect(initialsOf("  ")).toBe("?");
  });
});

// ---------- layout geometry, every template × format × profile ----------

type Box = { x0: number; y0: number; x1: number; y1: number; id: string };

function textBox(t: ShareTextItem): Box {
  const w = measure(t.text, t.size, t.weight, t.font, t.tracking ?? 0);
  const x0 = t.align === "left" ? t.x : t.align === "center" ? t.x - w / 2 : t.x - w;
  return { x0, x1: x0 + w, y0: t.y, y1: t.y + t.size, id: t.id };
}
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1 && a.y0 < b.y1 - 1 && b.y0 < a.y1 - 1;
const texts = (items: ShareCardItem[]) => items.filter((i): i is ShareTextItem => i.kind === "text");

const CARDS = { typical, long, bare } as const;

describe.each(COACH_SHARE_TEMPLATES)("template %s", (template) => {
  describe.each(COACH_SHARE_FORMATS)("%s", (format) => {
    describe.each(Object.keys(CARDS) as (keyof typeof CARDS)[])("%s profile", (name) => {
      const card = CARDS[name];
      for (const locale of ["ro", "en"] as const) {
        const options = normalizeCoachShareOptions(card, { template, format, photo: name === "typical" ? "avatar" : "none" });
        const layout = layoutCoachShareCard({ card, options, locale, labels: labelsFor(locale), measure, qr: qrModules(card.url) });
        const W = layout.width, H = layout.height;

        it(`${locale}: is exactly the format's pixel size`, () => {
          expect([W, H]).toEqual(format === "story" ? [1080, 1920] : [1080, 1080]);
        });
        it(`${locale}: every line fits its box and the canvas`, () => {
          for (const t of texts(layout.items)) {
            const b = textBox(t);
            expect(measure(t.text, t.size, t.weight, t.font, t.tracking ?? 0), t.id).toBeLessThanOrEqual(t.maxWidth + 0.5);
            expect(b.x0, t.id).toBeGreaterThanOrEqual(0);
            expect(b.x1, t.id).toBeLessThanOrEqual(W);
            expect(b.y1, t.id).toBeLessThanOrEqual(H);
          }
        });
        it(`${locale}: no two lines overlap`, () => {
          const boxes = texts(layout.items).map(textBox);
          for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            expect(overlaps(boxes[i]!, boxes[j]!), `${boxes[i]!.id} × ${boxes[j]!.id}`).toBe(false);
          }
        });
        it(`${locale}: nothing is drawn over the QR code`, () => {
          const qr = layout.items.find((i) => i.kind === "qr");
          expect(qr).toBeDefined();
          if (qr?.kind !== "qr") return;
          const q = { x0: qr.x, y0: qr.y, x1: qr.x + qr.size, y1: qr.y + qr.size, id: "qr" };
          for (const b of texts(layout.items).map(textBox)) expect(overlaps(b, q), b.id).toBe(false);
        });
        if (template !== "athletic") {
          it(`${locale}: no text over the photo`, () => {
            const p = layout.items.find((i) => i.kind === "photo");
            if (p?.kind !== "photo") throw new Error("no photo item");
            const box = { x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h, id: "photo" };
            for (const b of texts(layout.items).map(textBox)) expect(overlaps(b, box), b.id).toBe(false);
          });
        }
        if (format === "story") {
          it(`${locale}: all text sits inside the story's safe band`, () => {
            for (const t of texts(layout.items)) {
              expect(t.y, t.id).toBeGreaterThanOrEqual(STORY_SAFE.top);
              expect(t.y + t.size, t.id).toBeLessThanOrEqual(H - STORY_SAFE.bottom);
            }
          });
        }
        it(`${locale}: says only what the profile says`, () => {
          const all = texts(layout.items).map((t) => t.text).join(" | ");
          expect(all).not.toMatch(/PRIVATE|review|★|\d+ (clients|clienți)/i);
          if (!card.verified) expect(all).not.toContain("Verified");
          expect(all).toContain(shortProfileUrl(card.url).slice(0, 12));
        });
      }
    });
  });
});

describe("content choices reach the layout", () => {
  const base = { card: typical, locale: "ro" as const, labels: labelsFor("ro"), measure, qr: qrModules(typical.url) };
  const all = (o: Parameters<typeof normalizeCoachShareOptions>[1]) =>
    texts(layoutCoachShareCard({ ...base, options: normalizeCoachShareOptions(typical, o) }).items).map((t) => t.text).join(" ");
  it("the primary always, the picked specializations only", () => {
    const s = all({ specs: ["powerlifting"] });
    expect(s).toMatch(/FORȚĂ|Forță/);
    expect(s).toContain("Powerlifting");
    expect(s).not.toContain("Hipertrofie");
  });
  it("the headline and the QR code can be switched off", () => {
    expect(all({ showHeadline: false })).not.toContain("Strength coach for busy");
    const layout = layoutCoachShareCard({ ...base, options: normalizeCoachShareOptions(typical, { showQr: false }) });
    expect(layout.items.some((i) => i.kind === "qr")).toBe(false);
  });
  it("Minimal is set on the cream tile, the others on the brand's near-black", () => {
    for (const template of COACH_SHARE_TEMPLATES) {
      const l = layoutCoachShareCard({ ...base, options: normalizeCoachShareOptions(typical, { template }) });
      expect(l.background).toBe(template === "minimal" ? "tile" : "bg");
      const brand = l.items.find((i) => i.kind === "brand");
      expect(brand?.kind === "brand" && brand.tone === "dark").toBe(template === "minimal");
    }
  });
  it("English and Romanian calls to action", () => {
    expect(all({})).toContain("Descoperă profilul meu");
    const en = texts(layoutCoachShareCard({ ...base, locale: "en", labels: labelsFor("en"), options: normalizeCoachShareOptions(typical, {}) }).items);
    expect(en.map((t) => t.text).join(" ")).toContain("Discover my profile");
  });
});

describe("QR code", () => {
  /** Draws the matrix the way the painter does — whole-pixel modules, a 4-module quiet zone — and reads it back. */
  function decode(modules: boolean[][], cell = 6): string {
    const n = modules.length + 8;
    const size = n * cell;
    const lum = new Uint8ClampedArray(size * size).fill(255);
    modules.forEach((row, r) => row.forEach((dark, c) => {
      if (!dark) return;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) lum[((r + 4) * cell + y) * size + (c + 4) * cell + x] = 0;
    }));
    const bmp = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, size, size)));
    return new QRCodeReader().decode(bmp, new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]], [DecodeHintType.PURE_BARCODE, true]])).getText();
  }
  it.each([typical.url, long.url, bare.url])("scans back to %s", (url) => {
    expect(decode(qrModules(url))).toBe(url);
  });
  it("is square and small enough for big modules", () => {
    const m = qrModules(long.url);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    expect(m.length).toBeLessThanOrEqual(37); // version 5 or lower for a long profile URL at level M
  });
});

describe("UI copy", () => {
  it("the generator speaks both languages, with the same keys", () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k])).sort();
    expect(keys(coachProfileMessages.ro.shareCard)).toEqual(keys(coachProfileMessages.en.shareCard));
    expect(coachProfileMessages.ro.shareCard.title).toBe("Creează card de promovare");
    expect(coachProfileMessages.en.shareCard.title).toBe("Create share card");
    expect(coachProfileMessages.ro.shareCard.cardCta).toBe("Descoperă profilul meu");
  });
});
