import { describe, expect, test, vi } from "vitest";
import { DEFAULT_SHARE_OPTIONS, layoutShareCard, type ShareCardLabels, type WorkoutShareCard } from "./share-card";
import {
  canShareFile,
  deliverShareImage,
  paintShareCard,
  renderShareCard,
  shareFileName,
  type ShareAssets,
  type ShareCanvas,
  type ShareContext2D,
} from "./share-card-render";

// The painter is driven with a recording context: no canvas exists in node,
// but what matters — the pixel size of the image, every line being drawn,
// long lines shrinking instead of overflowing — is visible in the calls.

const labels: ShareCardLabels = {
  workoutComplete: "Workout Complete",
  duration: "Duration",
  exercises: "Exercises",
  sets: "Sets",
  volume: "Volume",
  volumeUnit: "kg",
  trainingLoad: "Training Load",
  loadCategory: { very_light: "Very Light", light: "Light", moderate: "Moderate", hard: "Hard", very_hard: "Very Hard" },
  newPr: "New PR",
  prsCount: "{count} PRs",
  morePrs: "+{count} more",
  brand: "Voinic",
};

const card: WorkoutShareCard = {
  session_id: "s-1",
  workout: { kind: "workout", name: "Leg day", date: "2026-09-15", duration_min: 72, exercises: 8, sets: 24, volume_kg: 8420, load: 78, prs: 1 },
  prs: [{ exercise: "Squat", weight_kg: 140, reps: 5 }],
  profile: { name: "norbert", username: "norbert", avatar_url: null },
};

type Call = { name: string; args: unknown[] };

/** A 2D context that records calls and measures text as 0.55 em per character. */
function recorder(charWidth = 0.55): { ctx: ShareContext2D; calls: Call[] } {
  const calls: Call[] = [];
  let font = "";
  const gradient = { addColorStop: () => undefined } as unknown as CanvasGradient;
  const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }); };
  const ctx = {
    get font() { return font; },
    set font(v: string) { font = v; calls.push({ name: "font", args: [v] }); },
    fillStyle: "", strokeStyle: "", lineWidth: 1, textAlign: "left" as CanvasTextAlign, textBaseline: "top" as CanvasTextBaseline,
    letterSpacing: "0px", globalAlpha: 1,
    fillRect: rec("fillRect"), fillText: rec("fillText"),
    measureText: (text: string) => ({ width: text.length * charWidth * Number(/(\d+)px/.exec(font)?.[1] ?? 0) }),
    beginPath: rec("beginPath"), closePath: rec("closePath"), arc: rec("arc"), roundRect: rec("roundRect"),
    moveTo: rec("moveTo"), lineTo: rec("lineTo"), quadraticCurveTo: rec("quadraticCurveTo"),
    fill: rec("fill"), stroke: rec("stroke"), clip: rec("clip"), save: rec("save"), restore: rec("restore"),
    createRadialGradient: () => gradient, createLinearGradient: () => gradient, drawImage: rec("drawImage"),
  };
  return { ctx: ctx as unknown as ShareContext2D, calls };
}

function fakeCanvas(): { canvas: ShareCanvas; calls: Call[]; toBlobType: string[] } {
  const { ctx, calls } = recorder();
  const toBlobType: string[] = [];
  const canvas: ShareCanvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb, type) => { toBlobType.push(type ?? ""); cb(new Blob(["png"], { type: "image/png" })); },
  };
  return { canvas, calls, toBlobType };
}

const assets: ShareAssets = { fonts: { display: "Exo2Test", body: "InterTest" }, mark: null, wordmark: null, avatar: null };

describe("renderShareCard", () => {
  test("renders a Story card on a 1080 × 1920 canvas as PNG", async () => {
    const { canvas, toBlobType } = fakeCanvas();
    const layout = layoutShareCard({ card, options: DEFAULT_SHARE_OPTIONS, locale: "en", labels });
    const blob = await renderShareCard(layout, { assets, createCanvas: (w, h) => { canvas.width = w; canvas.height = h; return canvas; } });
    expect([canvas.width, canvas.height]).toEqual([1080, 1920]);
    expect(toBlobType).toEqual(["image/png"]);
    expect(blob.type).toBe("image/png");
  });

  test("renders a Square card on a 1080 × 1080 canvas", async () => {
    const { canvas } = fakeCanvas();
    const layout = layoutShareCard({ card, options: { ...DEFAULT_SHARE_OPTIONS, format: "square" }, locale: "en", labels });
    await renderShareCard(layout, { assets, createCanvas: (w, h) => { canvas.width = w; canvas.height = h; return canvas; } });
    expect([canvas.width, canvas.height]).toEqual([1080, 1080]);
  });

  test("rejects when the canvas has no 2D context", async () => {
    const layout = layoutShareCard({ card, options: DEFAULT_SHARE_OPTIONS, locale: "en", labels });
    const canvas: ShareCanvas = { width: 0, height: 0, getContext: () => null, toBlob: () => undefined };
    await expect(renderShareCard(layout, { assets, createCanvas: () => canvas })).rejects.toThrow();
  });
});

describe("paintShareCard", () => {
  const layout = layoutShareCard({ card, options: DEFAULT_SHARE_OPTIONS, locale: "en", labels });

  test("paints the background at full size and draws every line of the layout", () => {
    const { ctx, calls } = recorder();
    paintShareCard(ctx, layout, assets);
    expect(calls[0]).toEqual({ name: "fillRect", args: [0, 0, 1080, 1920] });
    const drawn = calls.filter((c) => c.name === "fillText").map((c) => c.args[0]);
    for (const item of layout.items) if (item.kind === "text") expect(drawn).toContain(item.text);
    expect(drawn).toContain("LEG DAY");
    expect(drawn).toContain("78");
    expect(drawn).toContain("8,420");
    expect(drawn).toContain("@norbert");
    // The brand PNGs were not given, so the name is set as text instead.
    expect(drawn).toContain("VOINIC");
  });

  test("uses the app's display face for numbers and the body face for labels", () => {
    const { ctx, calls } = recorder();
    paintShareCard(ctx, layout, assets);
    const fonts = calls.filter((c) => c.name === "font").map((c) => String(c.args[0]));
    expect(fonts.some((f) => /^800 \d+px Exo2Test$/.test(f))).toBe(true);
    expect(fonts.some((f) => /^600 \d+px InterTest$/.test(f))).toBe(true);
  });

  test("shrinks a line that would not fit its box instead of overflowing", () => {
    const wide = layoutShareCard({
      card: { ...card, workout: { ...card.workout, name: "Upper body strength" } },
      options: DEFAULT_SHARE_OPTIONS, locale: "en", labels,
    });
    const { ctx, calls } = recorder(0.6);
    paintShareCard(ctx, wide, assets);
    const nameItem = wide.items.find((i): i is Extract<typeof i, { kind: "text" }> => i.kind === "text" && i.id === "name")!;
    const idx = calls.findIndex((c) => c.name === "fillText" && c.args[0] === nameItem.text);
    expect(idx).toBeGreaterThan(0);
    const fontBefore = [...calls.slice(0, idx)].reverse().find((c) => c.name === "font")!;
    const size = Number(/(\d+)px/.exec(String(fontBefore.args[0]))![1]);
    expect(size).toBeLessThan(nameItem.size);
    expect(size * 0.6 * nameItem.text.length).toBeLessThanOrEqual(nameItem.maxWidth + 1);
  });

  test("trims a line with an ellipsis once it would have to go below half size", () => {
    const wide = layoutShareCard({
      card: { ...card, workout: { ...card.workout, name: "An extraordinarily long workout day name that cannot possibly fit on one line" } },
      options: DEFAULT_SHARE_OPTIONS, locale: "en", labels,
    });
    const { ctx, calls } = recorder(0.6);
    paintShareCard(ctx, wide, assets);
    const nameItem = wide.items.find((i): i is Extract<typeof i, { kind: "text" }> => i.kind === "text" && i.id === "name")!;
    const drawn = calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
    const line = drawn.find((d) => d.endsWith("…") && nameItem.text.startsWith(d.slice(0, -1)))!;
    expect(line).toBeDefined();
    const idx = calls.findIndex((c) => c.name === "fillText" && c.args[0] === line);
    const size = Number(/(\d+)px/.exec(String([...calls.slice(0, idx)].reverse().find((c) => c.name === "font")!.args[0]))![1]);
    expect(size).toBe(Math.round(nameItem.size / 2));
    expect(size * 0.6 * line.length).toBeLessThanOrEqual(nameItem.maxWidth + 1);
  });

  test("draws the avatar image clipped to a circle when one loaded, an initial otherwise", () => {
    const img = {} as CanvasImageSource;
    const a = recorder();
    paintShareCard(a.ctx, layout, { ...assets, avatar: img });
    expect(a.calls.some((c) => c.name === "clip")).toBe(true);
    expect(a.calls.some((c) => c.name === "drawImage" && c.args[0] === img)).toBe(true);
    const b = recorder();
    paintShareCard(b.ctx, layout, assets);
    expect(b.calls.some((c) => c.name === "fillText" && c.args[0] === "N")).toBe(true);
  });
});

describe("delivering the image", () => {
  const blob = new Blob(["png"], { type: "image/png" });

  test("file name carries the day and the format", () => {
    expect(shareFileName("2026-09-15", "story")).toBe("voinic-workout-2026-09-15-story.png");
  });

  test("uses the Web Share API when the browser can share files", async () => {
    const share = vi.fn(async () => undefined);
    const nav = { share, canShare: () => true };
    const download = vi.fn();
    expect(canShareFile(new File([blob], "x.png", { type: "image/png" }), nav)).toBe(true);
    const how = await deliverShareImage(blob, "x.png", "Leg day", { nav, download });
    expect(how).toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0]![0 as never] as unknown as { files: File[]; title: string };
    expect(arg.files[0]!.name).toBe("x.png");
    expect(arg.title).toBe("Leg day");
    expect(download).not.toHaveBeenCalled();
  });

  test("falls back to Save Image when the browser cannot share files", async () => {
    const download = vi.fn();
    const noFiles = { share: async () => undefined, canShare: () => false };
    expect(canShareFile(new File([blob], "x.png"), noFiles)).toBe(false);
    expect(await deliverShareImage(blob, "x.png", "Leg day", { nav: noFiles, download })).toBe("saved");
    expect(download).toHaveBeenCalledWith(blob, "x.png");
  });

  test("falls back to Save Image when there is no Web Share API at all", async () => {
    const download = vi.fn();
    expect(canShareFile(new File([blob], "x.png"), undefined)).toBe(false);
    expect(canShareFile(new File([blob], "x.png"), {} as Navigator)).toBe(false);
    expect(await deliverShareImage(blob, "x.png", "Leg day", { nav: {} as Navigator, download })).toBe("saved");
    expect(download).toHaveBeenCalledTimes(1);
  });

  test("a closed share sheet is a cancel, not a failure and not a download", async () => {
    const download = vi.fn();
    const nav = { share: async () => { throw Object.assign(new Error("closed"), { name: "AbortError" }); }, canShare: () => true };
    expect(await deliverShareImage(blob, "x.png", "Leg day", { nav, download })).toBe("cancelled");
    expect(download).not.toHaveBeenCalled();
  });

  test("a share sheet that rejects the file still saves it", async () => {
    const download = vi.fn();
    const nav = { share: async () => { throw new TypeError("unsupported"); }, canShare: () => true };
    expect(await deliverShareImage(blob, "x.png", "Leg day", { nav, download })).toBe("saved");
    expect(download).toHaveBeenCalledTimes(1);
  });
});
