import { describe, expect, it } from "vitest";
import { isPostMediaUrl, mediaSource } from "./media-source";

const API = "https://www.voinic.fit";

describe("mediaSource", () => {
  it("sends the access token with a post picture from the app's own API", () => {
    expect(mediaSource(`${API}/api/media/abc.def`, API, "tok")).toEqual({
      uri: `${API}/api/media/abc.def`,
      headers: { Authorization: "Bearer tok" },
    });
  });
  it("never sends it anywhere else", () => {
    expect(mediaSource("https://res.cloudinary.com/x/image/upload/a.jpg", API, "tok")).toEqual({ uri: "https://res.cloudinary.com/x/image/upload/a.jpg" });
    expect(mediaSource(`${API}/exercises/squat.webp`, API, "tok")).toEqual({ uri: `${API}/exercises/squat.webp` });
    // a look-alike host that merely starts with the API's address
    expect(mediaSource(`${API}.evil.example/api/media/abc`, API, "tok")).toEqual({ uri: `${API}.evil.example/api/media/abc` });
  });
  it("is a plain source when signed out", () => {
    expect(mediaSource(`${API}/api/media/abc`, API, null)).toEqual({ uri: `${API}/api/media/abc` });
  });
  it("tolerates a trailing slash on the API address, and no address at all", () => {
    expect(isPostMediaUrl(`${API}/api/media/abc`, `${API}/`)).toBe(true);
    expect(isPostMediaUrl("/api/media/abc", "")).toBe(false);
  });
});
