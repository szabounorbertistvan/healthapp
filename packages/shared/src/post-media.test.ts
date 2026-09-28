import { describe, expect, it } from "vitest";
import {
  POST_MEDIA_MAX,
  carouselLoaded,
  carouselStep,
  isPostMediaPublicId,
  mediaFrameRatio,
  mediaOrientation,
  mediaSlotsLeft,
  normalizeMediaItems,
  storedMediaProblem,
  validateMediaFile,
} from "./post-media";

const me = "e1000000-0000-0000-0000-00000000000a";
const other = "e1000000-0000-0000-0000-00000000000f";
const id = (n: number, user = me) => `voinic/posts/${user}/m-00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

describe("validateMediaFile", () => {
  it("takes a photo", () => {
    expect(validateMediaFile({ type: "image/jpeg", size: 3_000_000 })).toBeNull();
    expect(validateMediaFile({ type: "image/HEIC", size: 3_000_000 })).toBeNull();
  });
  it("refuses what is not a photo, whatever it is called", () => {
    expect(validateMediaFile({ type: "application/x-msdownload", size: 10 })).toBe("type");
    expect(validateMediaFile({ type: "image/svg+xml", size: 10 })).toBe("type");
    expect(validateMediaFile({ type: "video/mp4", size: 10 })).toBe("type");
    expect(validateMediaFile({ type: "", size: 10 })).toBe("type");
  });
  it("refuses an empty or oversized file", () => {
    expect(validateMediaFile({ type: "image/png", size: 0 })).toBe("empty");
    expect(validateMediaFile({ type: "image/png", size: 26 * 1024 * 1024 })).toBe("size");
  });
});

describe("slots", () => {
  it("counts down from ten", () => {
    expect(mediaSlotsLeft(0)).toBe(POST_MEDIA_MAX);
    expect(mediaSlotsLeft(7)).toBe(3);
    expect(mediaSlotsLeft(12)).toBe(0);
  });
});

describe("isPostMediaPublicId", () => {
  it("is the author's own minted id and nothing else", () => {
    expect(isPostMediaPublicId(id(1), me)).toBe(true);
    expect(isPostMediaPublicId(id(1, other), me)).toBe(false);
    expect(isPostMediaPublicId(`voinic/posts/${me}/photo`, me)).toBe(false);
    expect(isPostMediaPublicId(`voinic/progress/${me}/m-00000000-0000-0000-0000-000000000001`, me)).toBe(false);
    expect(isPostMediaPublicId(`${id(1)}/../x`, me)).toBe(false);
    expect(isPostMediaPublicId(42, me)).toBe(false);
  });
});

describe("normalizeMediaItems", () => {
  it("keeps order, trims alt text, and treats an empty one as none", () => {
    expect(normalizeMediaItems([
      { publicId: id(2), width: 1080, height: 1350, alt: "  squat\n  PR  " },
      { publicId: id(1), width: 1600, height: 900, alt: "   " },
    ], me)).toEqual([
      { public_id: id(2), width: 1080, height: 1350, alt: "squat PR" },
      { public_id: id(1), width: 1600, height: 900, alt: null },
    ]);
  });
  it("no list is no pictures", () => {
    expect(normalizeMediaItems(undefined, me)).toEqual([]);
    expect(normalizeMediaItems(null, me)).toEqual([]);
  });
  it("caps alt text at 300 characters", () => {
    const [item] = normalizeMediaItems([{ publicId: id(1), width: 10, height: 10, alt: "x".repeat(400) }], me)!;
    expect(item!.alt).toHaveLength(300);
  });
  it("refuses more than ten, a duplicate, someone else's, or a bad size — as a whole", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ publicId: id(i), width: 10, height: 10 }));
    expect(normalizeMediaItems(eleven, me)).toBeNull();
    expect(normalizeMediaItems(eleven.slice(0, 10), me)).toHaveLength(10);
    expect(normalizeMediaItems([{ publicId: id(1), width: 10, height: 10 }, { publicId: id(1), width: 10, height: 10 }], me)).toBeNull();
    expect(normalizeMediaItems([{ publicId: id(1, other), width: 10, height: 10 }], me)).toBeNull();
    expect(normalizeMediaItems([{ publicId: id(1), width: 10.5, height: 10 }], me)).toBeNull();
    expect(normalizeMediaItems([{ publicId: id(1), width: 0, height: 10 }], me)).toBeNull();
    expect(normalizeMediaItems([{ publicId: id(1), width: 30000, height: 10 }], me)).toBeNull();
    expect(normalizeMediaItems({ publicId: id(1) }, me)).toBeNull();
    expect(normalizeMediaItems(["x"], me)).toBeNull();
  });
});

describe("storedMediaProblem", () => {
  const ok = { resource_type: "image", format: "jpg", bytes: 400_000, width: 1080, height: 1350 };
  it("accepts a stored photo", () => expect(storedMediaProblem(ok)).toBeNull());
  it("names what is wrong with it", () => {
    expect(storedMediaProblem(undefined)).toBe("missing");
    expect(storedMediaProblem({ ...ok, resource_type: "video" })).toBe("kind");
    expect(storedMediaProblem({ ...ok, format: "gif" })).toBe("format");
    expect(storedMediaProblem({ ...ok, format: "svg" })).toBe("format");
    expect(storedMediaProblem({ ...ok, bytes: 9 * 1024 * 1024 })).toBe("size");
    expect(storedMediaProblem({ ...ok, width: 0 })).toBe("dimensions");
  });
});

describe("the gallery frame", () => {
  it("is the first picture's shape, bounded to 4:5 … 16:9", () => {
    expect(mediaFrameRatio({ width: 1080, height: 1080 })).toBe(1);
    expect(mediaFrameRatio({ width: 1080, height: 1350 })).toBeCloseTo(0.8);
    expect(mediaFrameRatio({ width: 1000, height: 3000 })).toBeCloseTo(0.8);
    expect(mediaFrameRatio({ width: 4000, height: 1000 })).toBeCloseTo(16 / 9);
    expect(mediaFrameRatio(undefined)).toBe(1);
  });
  it("names the orientation", () => {
    expect(mediaOrientation({ width: 1080, height: 1350 })).toBe("portrait");
    expect(mediaOrientation({ width: 1000, height: 1020 })).toBe("square");
    expect(mediaOrientation({ width: 1600, height: 900 })).toBe("landscape");
  });
});

describe("the carousel", () => {
  it("steps within its ends", () => {
    expect(carouselStep(0, 4, 1)).toBe(1);
    expect(carouselStep(3, 4, 1)).toBe(3);
    expect(carouselStep(0, 4, -1)).toBe(0);
    expect(carouselStep(2, 0, 1)).toBe(0);
  });
  it("loads what was seen and the next slide, not the rest", () => {
    expect(carouselLoaded(0, 0)).toBe(true);
    expect(carouselLoaded(1, 0)).toBe(true);
    expect(carouselLoaded(2, 0)).toBe(false);
    expect(carouselLoaded(5, 4)).toBe(true);
  });
});
