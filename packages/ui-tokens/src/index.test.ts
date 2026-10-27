import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dark, light, storyColor, type ColorTokens } from "./index";

// The web's palette is CSS (Tailwind v4 reads --color-* from globals.css); the
// mobile app's is this package. They drifted once — the package kept an old
// green palette for months after the brand went gold — so the CSS is the
// reference and this test reads it.

const css = readFileSync(
  fileURLToPath(new URL("../../../apps/web/app/globals.css", import.meta.url)),
  "utf8",
);

/** The --color-* declarations of the first block whose selector matches. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`${selector} not found in globals.css`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, close).matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1]!] = m[2]!.toLowerCase();
  }
  return out;
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function expectMatches(tokens: ColorTokens, fromCss: Record<string, string>) {
  for (const [key, value] of Object.entries(tokens)) {
    expect({ token: key, value }).toEqual({ token: key, value: fromCss[kebab(key)] });
  }
}

describe("ui-tokens mirror apps/web/app/globals.css", () => {
  it("dark = the @theme block", () => {
    expectMatches(dark, block("@theme {"));
  });

  it("story colours = their --color-story-* tokens", () => {
    const theme = block("@theme {");
    for (const [key, value] of Object.entries(storyColor)) expect({ token: key, value }).toEqual({ token: key, value: theme[kebab(key)] });
  });

  it("light = the explicit light theme block", () => {
    expectMatches(light, block(':root[data-theme="light"] {'));
  });
});
