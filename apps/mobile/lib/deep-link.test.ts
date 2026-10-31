import { describe, expect, it } from "vitest";
import { appPathFor } from "./deep-link";

describe("appPathFor", () => {
  it("opens the web's Today and other renamed pages on the app's own screens", () => {
    expect(appPathFor("voinic://today")).toBe("/");
    expect(appPathFor("voinic:///today")).toBe("/");
    expect(appPathFor("/today")).toBe("/");
    expect(appPathFor("https://www.voinic.fit/today?lang=ro")).toBe("/");
    expect(appPathFor("exp://192.168.1.5:8081/--/today")).toBe("/");
    expect(appPathFor("voinic://dashboard")).toBe("/clients");
    expect(appPathFor("voinic://workout/import")).toBe("/workout-import");
    expect(appPathFor("voinic://food/plan/")).toBe("/meal-plan");
  });

  it("leaves every other link exactly as it came", () => {
    expect(appPathFor("voinic://auth/callback?code=abc")).toBe("voinic://auth/callback?code=abc");
    expect(appPathFor("/workout/6dd616e1-189a-41a4-90b1-146b11e6130b")).toBe("/workout/6dd616e1-189a-41a4-90b1-146b11e6130b");
    expect(appPathFor("voinic://check-in")).toBe("voinic://check-in");
    expect(appPathFor("voinic://nowhere")).toBe("voinic://nowhere");
    expect(appPathFor("voinic://constructor")).toBe("voinic://constructor");
  });
});
