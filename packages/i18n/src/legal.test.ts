import { describe, expect, it } from "vitest";
import { LEGAL, parseInline } from "./legal";

const vars = { app: "Voinic", email: "contact@voinic.fit" };

describe("parseInline", () => {
  it("fills {app} and {email} and splits the markup into runs", () => {
    expect(parseInline("**Export** — {app}, *active*, `_ga`, [{email}](mailto:{email}).", vars)).toEqual([
      { text: "Export", bold: true },
      { text: " — Voinic, " },
      { text: "active", italic: true },
      { text: ", " },
      { text: "_ga", code: true },
      { text: ", " },
      { text: "contact@voinic.fit", href: "mailto:contact@voinic.fit" },
      { text: "." },
    ]);
  });

  it("leaves plain text as one run", () => {
    expect(parseInline("No markup here.", vars)).toEqual([{ text: "No markup here." }]);
  });
});

describe("LEGAL", () => {
  it("has the same sections, blocks and list lengths in both languages", () => {
    for (const page of ["terms", "privacy"] as const) {
      const { en, ro } = LEGAL[page];
      expect(ro.sections.length).toBe(en.sections.length);
      en.sections.forEach((s, i) => {
        const other = ro.sections[i]!;
        expect(other.blocks.map((b) => Object.keys(b)[0])).toEqual(s.blocks.map((b) => Object.keys(b)[0]));
        s.blocks.forEach((b, j) => {
          if ("ul" in b) expect((other.blocks[j] as { ul: string[] }).ul.length).toBe(b.ul.length);
        });
      });
    }
  });

  it("leaves no markup unparsed", () => {
    for (const page of Object.values(LEGAL)) {
      for (const doc of Object.values(page)) {
        for (const s of doc.sections) {
          for (const b of s.blocks) {
            const texts = "p" in b ? [b.p] : "ul" in b ? b.ul : [];
            for (const t of texts) {
              for (const span of parseInline(t, vars)) expect(span.text).not.toMatch(/\*|`|\]\(|\{app\}|\{email\}/);
            }
          }
        }
      }
    }
  });
});
