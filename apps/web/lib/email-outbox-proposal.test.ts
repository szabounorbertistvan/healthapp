import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MARKETPLACE_EMAIL_RULES } from "@healthapp/shared";

// The outbox proposal decides in SQL which notifications are queued; the
// dispatcher decides in TypeScript which are sent. The two lists must match.
const SQL = readFileSync(path.resolve(__dirname, "../../../supabase/proposals/20261114100000_email_outbox.sql"), "utf8");

describe("email outbox proposal", () => {
  it("queues exactly the categories, events and holds the policy sends", () => {
    const body = SQL.slice(SQL.indexOf("from (values"), SQL.indexOf(") r(category, event, delay)"));
    const sqlRules = [...body.matchAll(/\('([a-z_]+)', '([a-z_*]+)', (\d+)\)/g)].map((m) => `${m[1]}/${m[2]}/${m[3]}`).sort();
    const tsRules = MARKETPLACE_EMAIL_RULES.map((r) => `${r.category}/${r.event}/${r.delayMinutes}`).sort();
    expect(sqlRules).toEqual(tsRules);
  });
});
