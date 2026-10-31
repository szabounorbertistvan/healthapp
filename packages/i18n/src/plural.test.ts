import { describe, expect, it } from "vitest";
import { fill } from "./index";
import { pluralCategory } from "./plural";

describe("pluralCategory", () => {
  it("follows CLDR for Romanian: one / few / other (the 'de' numbers)", () => {
    expect(pluralCategory("ro", 1)).toBe("one");
    for (const n of [0, 2, 5, 19, 101, 119, 1001]) expect(pluralCategory("ro", n)).toBe("few");
    for (const n of [20, 25, 30, 99, 100, 120, 200, 1000]) expect(pluralCategory("ro", n)).toBe("other");
    expect(pluralCategory("ro", 1.5)).toBe("few");
  });

  it("agrees with Intl.PluralRules where the runtime has it", () => {
    const rules = new Intl.PluralRules("ro");
    for (let n = 0; n <= 250; n++) expect(pluralCategory("ro", n)).toBe(rules.select(n));
  });

  it("English is one / other", () => {
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("en", 0)).toBe("other");
    expect(pluralCategory("en", 3)).toBe("other");
  });
});

describe("fill with plural blocks", () => {
  const ro = "{count, plural, one {# zi} few {# zile} other {# de zile}}";
  it("writes Romanian counts correctly", () => {
    expect(fill(ro, { count: 1 })).toBe("1 zi");
    expect(fill(ro, { count: 0 })).toBe("0 zile");
    expect(fill(ro, { count: 7 })).toBe("7 zile");
    expect(fill(ro, { count: 19 })).toBe("19 zile");
    expect(fill(ro, { count: 30 })).toBe("30 de zile");
    expect(fill(ro, { count: 101 })).toBe("101 zile");
    expect(fill(ro, { count: 120 })).toBe("120 de zile");
  });

  it("handles a branch with no number, and other placeholders around and inside", () => {
    const times = "Te-ai antrenat aici {n, plural, one {o dată} few {de # ori} other {de # de ori}} luna asta, la {gym}";
    expect(fill(times, { n: 1, gym: "X" })).toBe("Te-ai antrenat aici o dată luna asta, la X");
    expect(fill(times, { n: 3, gym: "X" })).toBe("Te-ai antrenat aici de 3 ori luna asta, la X");
    expect(fill(times, { n: 21, gym: "X" })).toBe("Te-ai antrenat aici de 21 de ori luna asta, la X");
    expect(fill("{n, plural, one {# set din {total}} other {# seturi din {total}}}", { n: 1, total: 4 })).toBe("1 set din 4");
  });

  it("works for an English one/other block", () => {
    const en = "{count, plural, one {# day} other {# days}}";
    expect(fill(en, { count: 1 })).toBe("1 day");
    expect(fill(en, { count: 0 })).toBe("0 days");
    expect(fill(en, { count: 25 })).toBe("25 days");
  });

  it("keeps a pre-formatted count as written", () => {
    expect(fill("{n, plural, one {# record} few {# recorduri} other {# de recorduri}}", { n: "1.000" })).toBe("1.000 de recorduri");
  });

  it("leaves a block alone when its value is missing, and plain messages unchanged", () => {
    expect(fill("{n, plural, one {# zi} other {# zile}}", {})).toBe("{n, plural, one {# zi} other {# zile}}");
    expect(fill("acum {days} zile", { days: 3 })).toBe("acum 3 zile");
  });
});
