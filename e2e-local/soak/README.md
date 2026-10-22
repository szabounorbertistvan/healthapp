# Soak suite — the app played against itself, round after round

```bash
npm run e2e:soak
```

Three seeded people (`supabase/seed/e2e.sql`, "the soak trio") use Voinic the way real
ones do, together, in a loop, on a **throwaway local** Supabase:

| Account | Role | Plays |
|---|---|---|
| `e2e-soak-coach@voinic.test` | coach | writes programs and plans, reads workouts, comments, answers check-ins and messages, accepts and ends coaching |
| `e2e-soak-client@voinic.test` | client with that coach | trains from the coach's program, eats the plan, checks in, writes back, posts |
| `e2e-soak-solo@voinic.test` | client, no coach | builds and follows their own program, logs food, habits, weigh-ins; asks the coach for coaching and ends it again every round |

Password for all three (local stack only): `Voinic-E2E-local-1`. They exist nowhere else.

## What one round does

| File | Journey |
|---|---|
| `sweep.spec.ts` | every screen of each role (and a detail page from each list) opens: status < 400, no login bounce, no error boundary, no hydration mismatch — on desktop **and** a phone (Pixel 7) |
| `10-coached-training.spec.ts` | coach writes + publishes a program → client logs two sets (one with a decimal comma) and finishes → coach comments on the workout → client reads it |
| `20-messages.spec.ts` | coach ↔ client messages, both ways, once each, in order |
| `30-coached-nutrition.spec.ts` | coach plans a breakfast with a USDA food and publishes → client taps "Ate as planned" → logged once |
| `40-check-in.spec.ts` | client checks in (weight with a comma, a note) → coach reviews with feedback → client reads it |
| `50-solo.spec.ts` | solo builds their own program, trains from it, logs food by search (grams with a comma), adds a habit, weighs in |
| `60-social.spec.ts` | client posts → coach follows, gives kudos, comments → client sees the notifications |
| `70-coaching-lifecycle.spec.ts` | solo finds the coach → request → accept → start → message → pause → resume → end |

Every step is checked on screen **and** in the database (through the stack's own service role).
Rounds leave history behind on purpose — sessions, messages, past coaches pile up as on a real
account — and remove only what would block the next round (this round's program, plan, post…).

## Running it

Once per machine: `cd scripts/pgtest && npm install`, `npx playwright install chromium`, and on
Windows the GoTrue / PostgREST builds in `.tools/` (see `e2e-local/README.md`, "Windows"; the
runner picks them up from there).

```bash
npm run e2e:soak                      # until Ctrl+C
npm run e2e:soak -- --hours 8         # overnight
npm run e2e:soak -- --rounds 3
npm run e2e:soak -- --grep lifecycle  # only matching journeys
npm run e2e:soak -- --no-build        # reuse the last build
```

The runner starts the stack (fresh database, seeded with the USDA foods too) and a production
build of the app on `http://localhost:3211` once, built into `apps/web/.next-soak` so a dev server
on this tree keeps working. It refuses to start if any of its ports is already taken.

## Reading the results

- `e2e-local/.soak/log.md` — one line per round: passed, failed, skipped, minutes, what failed.
- `e2e-local/.soak/summary.md` — every failure seen so far, how many times, first and last round,
  first line of the error. Something that fails every round is a bug or a broken journey;
  something that fails once in thirty is a race worth a look.
- `e2e-local/.soak/round-<n>/` — traces and screenshots of a failed round
  (`npx playwright show-trace e2e-local/.soak/round-<n>/<test>/trace.zip`). A clean round leaves nothing.

## It cannot touch production

The same guard as `e2e-local/`: `target()` refuses any non-loopback Supabase or app address and any
key minted for a hosted project, and every browser context aborts requests that leave the machine
(a test that tried fails). The live keys in `apps/web/.env.local` are blanked for the build.

## Adding a journey

A new `NN-name.spec.ts` here runs in file order after the others. Use `soakAs(browser, who)` for a
person's page, `rows()` / `remove()` / `patch()` from `../backend` to check and tidy, and `ROUND` in
the names of anything the round creates. Undo only what would break the next round.
