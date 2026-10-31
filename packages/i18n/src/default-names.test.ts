import { describe, expect, it } from "vitest";
import { localizeDefaultName } from "./default-names";

describe("localizeDefaultName", () => {
  it("shows the app's own default names in the current language, whichever language stored them", () => {
    expect(localizeDefaultName("plan", "My targets", "ro")).toBe("Obiectivele mele");
    expect(localizeDefaultName("plan", "Obiectivele mele", "en")).toBe("My targets");
    expect(localizeDefaultName("meal", "Breakfast", "ro")).toBe("Mic dejun");
    expect(localizeDefaultName("meal", "snack", "ro")).toBe("Gustare");
    expect(localizeDefaultName("goal", "Fat loss", "ro")).toBe("Pierdere de grăsime");
    expect(localizeDefaultName("habit", "Drink 2 L of water", "ro")).toBe("Bea 2 L de apă");
  });

  it("never touches a name the person typed", () => {
    expect(localizeDefaultName("meal", "Post-workout shake", "ro")).toBe("Post-workout shake");
    expect(localizeDefaultName("plan", "Cut 2026", "ro")).toBe("Cut 2026");
    expect(localizeDefaultName("habit", "Read 10 pages", "ro")).toBe("Read 10 pages");
    expect(localizeDefaultName("plan", null, "ro")).toBeNull();
  });
});
