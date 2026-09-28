import { describe, expect, it } from "vitest";
import { PHOTO_MAX_EDGE, photoFrame } from "./image-prepare";

describe("photoFrame", () => {
  it("shrinks a camera original to the long edge, keeping its shape", () => {
    const f = photoFrame(4000, 3000);
    expect(f).toMatchObject({ sx: 0, sy: 0, sw: 4000, sh: 3000, dw: PHOTO_MAX_EDGE, dh: 1200 });
  });
  it("leaves a small picture alone", () => {
    expect(photoFrame(800, 600)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 600, dw: 800, dh: 600 });
  });
  it("crops a tall portrait to 4:5, centred", () => {
    const f = photoFrame(3000, 4000);
    expect(f.sw).toBe(3000);
    expect(f.sh).toBe(3750);
    expect(f.sy).toBe(125);
    expect(f.dw).toBe(1280);
    expect(f.dh).toBe(1600);
  });
  it("crops a panorama to 16:9, centred", () => {
    const f = photoFrame(4000, 1000);
    expect(f.sh).toBe(1000);
    expect(f.sw).toBe(1778);
    expect(f.sx).toBe(1111);
    expect(f.dw).toBe(1600);
    expect(f.dh).toBe(900);
  });
  it("a 4:5 picture is not cropped at all", () => {
    expect(photoFrame(1080, 1350)).toMatchObject({ sx: 0, sy: 0, sw: 1080, sh: 1350 });
  });
});
