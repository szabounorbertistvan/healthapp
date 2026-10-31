import type { Locale } from "./config";

/**
 * Plural categories for the two languages, without depending on the runtime's
 * Intl (Hermes on older Android builds ships a partial one). The rules are
 * CLDR's, the same Intl.PluralRules answers:
 *
 *   en  one: n = 1 (an integer)                         other: everything else
 *   ro  one: n = 1 (an integer)
 *       few: a fraction, 0, or n % 100 in 1..19 (n ≠ 1) — "2 zile", "101 zile"
 *       other: the rest — exactly the numbers that take "de": "20 de zile", "100 de zile"
 */
export type PluralCategory = "one" | "few" | "other";

export function pluralCategory(locale: Locale, n: number): PluralCategory {
  if (!Number.isFinite(n)) return "other";
  const abs = Math.abs(n);
  const integer = Number.isInteger(abs);
  if (integer && abs === 1) return "one";
  if (locale === "en") return "other";
  if (!integer || abs === 0) return "few";
  const rem = abs % 100;
  return rem >= 1 && rem <= 19 ? "few" : "other";
}

/** A count that arrived as text ("1.000", "2,5", "12") read back as a number; NaN when it is not one. */
function countOf(value: string | number): number {
  if (typeof value === "number") return value;
  const text = value.trim().replace(/[\s .](?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  return /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}

/**
 * Picks the branch of a plural block for `value`:
 *   "{count, plural, one {# zi} few {# zile} other {# de zile}}"
 * `#` inside a branch is the value as it was passed (so a pre-formatted "1.000"
 * stays as written). A missing `few` falls back to `other` and a missing `one`
 * to `few`/`other` — which is why an English block (one/other only) and a
 * Romanian one (one/few/other) both work through the same rule: for English,
 * Romanian's "few" numbers are all English "other" ones.
 */
function choose(branches: Record<string, string>, value: string | number): string {
  const n = countOf(value);
  const exact = `=${n}`;
  if (exact in branches) return branches[exact]!;
  const category = pluralCategory("ro", n);
  const text =
    category === "one"
      ? branches.one ?? branches.few ?? branches.other
      : category === "few"
        ? branches.few ?? branches.other
        : branches.other;
  return (text ?? "").replace(/#/g, String(value));
}

/** The branches of "one {…} few {…} other {…}", braces nested one level deep allowed. */
function parseBranches(body: string): Record<string, string> | null {
  const branches: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i]!)) i++;
    if (i >= body.length) break;
    const keyMatch = /^(=\d+|zero|one|two|few|many|other)\s*\{/.exec(body.slice(i));
    if (!keyMatch) return null;
    const key = keyMatch[1]!;
    i += keyMatch[0].length;
    let depth = 1;
    const start = i;
    while (i < body.length && depth > 0) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}") depth--;
      i++;
    }
    if (depth !== 0) return null;
    branches[key] = body.slice(start, i - 1);
  }
  return "other" in branches ? branches : null;
}

/**
 * Replaces every `{name, plural, …}` block whose `name` is in `values` with its
 * chosen branch (placeholders inside the branch are left for the caller's
 * ordinary fill). Text without a plural block comes back unchanged.
 */
export function resolvePlurals(message: string, values: Record<string, string | number>): string {
  if (!message.includes(", plural,")) return message;
  let out = "";
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf("{", i);
    if (open === -1) break;
    const head = /^\{(\w+),\s*plural,/.exec(message.slice(open));
    if (!head) {
      out += message.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    let depth = 1;
    let j = open + 1;
    while (j < message.length && depth > 0) {
      if (message[j] === "{") depth++;
      else if (message[j] === "}") depth--;
      j++;
    }
    const name = head[1]!;
    const branches = depth === 0 ? parseBranches(message.slice(open + head[0].length, j - 1)) : null;
    out += message.slice(i, open);
    out += branches && name in values ? choose(branches, values[name]!) : message.slice(open, j);
    i = j;
  }
  return out + message.slice(i);
}
