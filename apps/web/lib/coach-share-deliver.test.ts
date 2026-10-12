import { describe, expect, it, vi } from "vitest";
import { canShareAnything, copyProfileLink, shareCoachCard } from "./coach-share-deliver";
import { coverCrop, paintShareCard, renderShareCard, type ShareAssets, type ShareCanvas, type ShareContext2D } from "./share-card-render";
import { layoutCoachShareCard, normalizeCoachShareOptions, type CoachShareCard, type MeasureText } from "./coach-share-card";
import { qrModules } from "./qr";

const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
const data = { title: "Andrei Popescu", url: "https://www.voinic.fit/coaches/andrei-popescu" };

describe("native sharing", () => {
  it("shares the image itself, with the title and the profile link, where files can be shared", async () => {
    const share = vi.fn(async () => undefined);
    const out = await shareCoachCard(png, "card.png", data, { share, canShare: () => true });
    expect(out).toBe("shared");
    const arg = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(arg.files?.[0]?.name).toBe("card.png");
    expect(arg.files?.[0]?.type).toBe("image/png");
    expect(arg.title).toBe("Andrei Popescu");
    expect(arg.text).toBe(data.url);
  });
  it("shares the link only where the share sheet takes no files — and says so", async () => {
    const share = vi.fn(async () => undefined);
    expect(await shareCoachCard(png, "card.png", data, { share, canShare: () => false })).toBe("shared-link");
    expect(share).toHaveBeenCalledWith({ title: data.title, url: data.url });
  });
  it("no share sheet: unsupported (the page offers Download instead)", async () => {
    expect(await shareCoachCard(png, "card.png", data, undefined)).toBe("unsupported");
    expect(await shareCoachCard(png, "card.png", data, {} as never)).toBe("unsupported");
    expect(canShareAnything(undefined)).toBe(false);
    expect(canShareAnything({ share: async () => undefined })).toBe(true);
  });
  it("closing the sheet is a cancel, a refusal is unsupported — never a crash", async () => {
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    expect(await shareCoachCard(png, "c.png", data, { share: async () => { throw abort; }, canShare: () => true })).toBe("cancelled");
    expect(await shareCoachCard(png, "c.png", data, { share: async () => { throw new Error("NotAllowed"); }, canShare: () => true })).toBe("unsupported");
  });
  it("never claims to have posted anywhere: the only outcomes are the share sheet or a download", async () => {
    const outcomes = new Set<string>();
    for (const canShare of [true, false]) outcomes.add(await shareCoachCard(png, "c.png", data, { share: async () => undefined, canShare: () => canShare }));
    expect([...outcomes].sort()).toEqual(["shared", "shared-link"]);
  });
});

describe("copy link", () => {
  it("writes the canonical URL", async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await copyProfileLink(data.url, { writeText })).toBe(true);
    expect(writeText).toHaveBeenCalledWith(data.url);
  });
  it("false when the clipboard is missing or refuses (the page then selects the link)", async () => {
    expect(await copyProfileLink(data.url, undefined)).toBe(false);
    expect(await copyProfileLink(data.url, { writeText: async () => { throw new Error("denied"); } })).toBe(false);
  });
});

// ---------- the painter's coach-card parts ----------

type Call = { name: string; args: unknown[] };
function recorder(): { ctx: ShareContext2D; calls: Call[] } {
  const calls: Call[] = [];
  let font = "";
  const gradient = { addColorStop: () => undefined } as unknown as CanvasGradient;
  const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }); };
  const ctx = {
    get font() { return font; }, set font(v: string) { font = v; },
    fillStyle: "", strokeStyle: "", lineWidth: 1, textAlign: "left", textBaseline: "top", letterSpacing: "0px", globalAlpha: 1,
    fillRect: rec("fillRect"), fillText: rec("fillText"),
    measureText: (text: string) => ({ width: text.length * 0.56 * Number(/(\d+)px/.exec(font)?.[1] ?? 0) }),
    beginPath: rec("beginPath"), closePath: rec("closePath"), arc: rec("arc"), roundRect: rec("roundRect"),
    moveTo: rec("moveTo"), lineTo: rec("lineTo"), quadraticCurveTo: rec("quadraticCurveTo"),
    fill: rec("fill"), stroke: rec("stroke"), clip: rec("clip"), save: rec("save"), restore: rec("restore"),
    createRadialGradient: () => gradient, createLinearGradient: () => gradient, drawImage: rec("drawImage"),
  };
  return { ctx: ctx as unknown as ShareContext2D, calls };
}

const measure: MeasureText = (text, size) => text.length * size * 0.56;
const card: CoachShareCard = {
  slug: "andrei-popescu", name: "Andrei Popescu", headline: "Strength coach", avatarUrl: "https://example.com/a.jpg", coverUrl: null,
  specializations: [{ slug: "strength", name_en: "Strength", name_ro: "Forță", is_primary: true }], city: null, online: true, inPerson: false,
  verified: false, url: "https://www.voinic.fit/coaches/andrei-popescu",
};
const fonts = { display: "exo2", body: "inter" };
const img = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as unknown as CanvasImageSource;

describe("painting a coach card", () => {
  it("crops the photo to cover its box — never stretched", () => {
    expect(coverCrop({ w: 1600, h: 600 }, { w: 400, h: 600 })).toEqual({ sx: 600, sy: 0, sw: 400, sh: 600 });
    const c = coverCrop({ w: 600, h: 1200 }, { w: 600, h: 600 }, 0.35);
    expect(c.sw / c.sh).toBeCloseTo(1, 5);
    expect(c.sy).toBeCloseTo(210, 5);
    const layout = layoutCoachShareCard({ card, options: normalizeCoachShareOptions(card, { template: "minimal" }), locale: "en",
      labels: { cta: "Discover my profile", verified: "Voinic Verified", online: "Online", inPerson: "In person", brand: "Voinic" }, measure, qr: qrModules(card.url) });
    const { ctx, calls } = recorder();
    const photo = img(1600, 600);
    paintShareCard(ctx, layout, { fonts, mark: null, wordmark: null, avatar: null, photo } as ShareAssets);
    const draw = calls.find((c) => c.name === "drawImage" && c.args[0] === photo)!;
    const [, , , sw, sh, , , dw, dh] = draw.args as number[];
    expect((sw as number) / (sh as number)).toBeCloseTo((dw as number) / (dh as number), 3);
  });
  it("without a photo: the initials over the faint brand mark, no image drawn for the portrait", () => {
    const layout = layoutCoachShareCard({ card: { ...card, avatarUrl: null }, options: normalizeCoachShareOptions({ ...card, avatarUrl: null }, {}), locale: "en",
      labels: { cta: "Discover my profile", verified: "V", online: "Online", inPerson: "In person", brand: "Voinic" }, measure, qr: null });
    const { ctx, calls } = recorder();
    const mark = img(681, 681);
    paintShareCard(ctx, layout, { fonts, mark, wordmark: null, avatar: null, photo: null } as ShareAssets);
    expect(calls.some((c) => c.name === "fillText" && c.args[0] === "AP")).toBe(true);
    expect(calls.filter((c) => c.name === "drawImage" && c.args[0] === mark).length).toBeGreaterThanOrEqual(2); // brand + watermark
  });
  it("QR modules land on whole pixels", () => {
    const layout = layoutCoachShareCard({ card, options: normalizeCoachShareOptions(card, { format: "story" }), locale: "en",
      labels: { cta: "Discover my profile", verified: "V", online: "Online", inPerson: "In person", brand: "Voinic" }, measure, qr: qrModules(card.url) });
    const qr = layout.items.find((i) => i.kind === "qr");
    if (qr?.kind !== "qr") throw new Error("no qr");
    const { ctx, calls } = recorder();
    paintShareCard(ctx, { ...layout, items: [qr] }, { fonts, mark: null, wordmark: null, avatar: null } as ShareAssets);
    const cells = calls.filter((c) => c.name === "fillRect").slice(1).map((c) => c.args as number[]);
    expect(cells.length).toBe(qr.modules.flat().filter(Boolean).length);
    for (const [x, y, w, h] of cells) {
      expect(Number.isInteger(w) && Number.isInteger(h) && w === h).toBe(true);
      expect(Number.isInteger(x! - qr.x) && Number.isInteger(y! - qr.y)).toBe(true);
    }
  });
  it("the light template uses the dark wordmark", () => {
    const layout = layoutCoachShareCard({ card, options: normalizeCoachShareOptions(card, { template: "minimal" }), locale: "en",
      labels: { cta: "Discover my profile", verified: "V", online: "Online", inPerson: "In person", brand: "Voinic" }, measure, qr: null });
    const { ctx, calls } = recorder();
    const light = img(781, 141), dark = img(781, 141);
    paintShareCard(ctx, layout, { fonts, mark: null, wordmark: light, wordmarkDark: dark, avatar: null } as ShareAssets);
    expect(calls.some((c) => c.name === "drawImage" && c.args[0] === dark)).toBe(true);
    expect(calls.some((c) => c.name === "drawImage" && c.args[0] === light)).toBe(false);
  });
  it("exports a PNG at the layout's exact size", async () => {
    for (const format of ["square", "story"] as const) {
      const layout = layoutCoachShareCard({ card, options: normalizeCoachShareOptions(card, { format }), locale: "en",
        labels: { cta: "Discover my profile", verified: "V", online: "Online", inPerson: "In person", brand: "Voinic" }, measure, qr: qrModules(card.url) });
      const { ctx } = recorder();
      let size: [number, number] = [0, 0];
      let type = "";
      const canvas: ShareCanvas = {
        width: 0, height: 0, getContext: () => ctx,
        toBlob: (cb, t) => { type = t ?? ""; cb(png); },
      };
      const blob = await renderShareCard(layout, {
        assets: { fonts, mark: null, wordmark: null, avatar: null },
        createCanvas: (w, h) => { size = [w, h]; return canvas; },
      });
      expect(size).toEqual(format === "story" ? [1080, 1920] : [1080, 1080]);
      expect(type).toBe("image/png");
      expect(blob.type).toBe("image/png");
    }
  });
});
