import { describe, expect, it } from "vitest";
import { pickExerciseVideo, youtubeEmbedUrl, youtubeVideoId } from "./video";

describe("youtubeVideoId", () => {
  it("reads the shapes people paste", () => {
    const id = "dQw4w9WgXcQ";
    for (const input of [
      id,
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=30s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://youtu.be/${id}?t=12`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      `youtube.com/watch?v=${id}`,
    ]) {
      expect(youtubeVideoId(input), input).toBe(id);
    }
  });

  it("rejects anything that is not a YouTube video", () => {
    for (const input of [
      "", "   ", null, undefined,
      "https://vimeo.com/123456",
      "https://evil.example/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)",
      "https://www.youtube.com/watch?v=tooshort",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/",
      "not a url at all",
    ]) {
      expect(youtubeVideoId(input), String(input)).toBeNull();
    }
  });

  it("does not fall for a lookalike host", () => {
    expect(youtubeVideoId("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeVideoId("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});

describe("youtubeEmbedUrl", () => {
  it("builds a nocookie embed", () => {
    expect(youtubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });
  it("is null for junk", () => {
    expect(youtubeEmbedUrl("https://vimeo.com/1")).toBeNull();
  });
});

describe("pickExerciseVideo", () => {
  const own = "https://youtu.be/dQw4w9WgXcQ";
  const coach = "https://youtu.be/M7lc1UVf-VE";
  const row = "https://youtu.be/aqz-KE-bpKQ";

  it("prefers your own link, then your coach's, then the exercise's", () => {
    expect(pickExerciseVideo({ own, coach, exercise: row })).toEqual({ url: own, source: "own" });
    expect(pickExerciseVideo({ coach, exercise: row })).toEqual({ url: coach, source: "coach" });
    expect(pickExerciseVideo({ exercise: row })).toEqual({ url: row, source: "exercise" });
  });

  it("skips a layer that is not a YouTube video", () => {
    expect(pickExerciseVideo({ own: "https://evil.example", coach })).toEqual({ url: coach, source: "coach" });
    expect(pickExerciseVideo({ own: null, coach: "", exercise: "javascript:alert(1)" })).toBeNull();
  });

  it("normalises a bare id to a youtu.be link", () => {
    expect(pickExerciseVideo({ own: "dQw4w9WgXcQ" })).toEqual({ url: own, source: "own" });
  });
});
