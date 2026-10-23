# Soak run, night of 2026-10-22

`npm run e2e:soak -- --hours 8` on the owner's Windows box, local stack. Rounds 3–29 were full
(about 200 checks each); rounds 1–2 were a short lifecycle-only check. Rounds slowed from 15 to
22.5 minutes over the night — every test about 1.7× slower, `/library` included (see
[docs/PERFORMANCE.md](../PERFORMANCE.md)).

## What each failure was

| Failure | Cause | Done |
|---|---|---|
| lifecycle, rounds 13–29 | the real cap of 10 coaching requests per person per 24 h (`20261103100000`), met after 10 rounds | the journey moves earlier rounds' requests back a day (4763fe0) |
| lifecycle, rounds 5, 9, 11, 12 | the pause landed, but the screen showed it after the 15 s wait: the action took ~7 s and the refresh ~4 s, behind a burst of sidebar prefetches | investigated in docs/PERFORMANCE.md |
| social, 6 rounds | the coach's comment was typed before the post page had hydrated and was wiped | the step types until the box holds the text, then presses Post (4763fe0) |
| `/notifications` on a phone, once | a hydration mismatch, not reproduced since | open |
| nutrition, once | a click timed out on the slowest part of the night | open, likely the same slowness |

## The summary as the runner wrote it

| times | first round | last round | test | error |
|---|---|---|---|---|
| 21 | 5 | 29 | discover → request → accept → start → message → pause → resume → end [soak] | Error: expect(locator).toBeVisible() failed |
| 6 | 5 | 25 | client posts → coach follows, gives kudos, comments → client is notified [soak] | Error: expect(locator).toBeVisible() failed |
| 1 | 8 | 8 | sweep as solo › /notifications [soak-phone] | Error: hydration errors (server and client rendered different HTML) |
| 1 | 24 | 24 | coach plans a breakfast → client logs it as planned [soak] | TimeoutError: locator.click: Timeout 20000ms exceeded. |

### Findings (noticed, not failed)

A streamed copy of a page left hidden in the DOM (docs/GAPS.md, "Streamed page content left
behind"). Rounds in which each was seen:

| rounds | first | last | finding |
|---|---|---|---|
| 25 | 3 | 29 | orphaned streamed segment on /today [soak] |
| 12 | 8 | 29 | orphaned streamed segment on /food [soak] |
| 10 | 4 | 26 | orphaned streamed segment on /messages/:id [soak] |
| 9 | 5 | 26 | orphaned streamed segment on /progress [soak] |
| 5 | 12 | 27 | orphaned streamed segment on /notifications [soak] |
| 1 | 3 | 3 | orphaned streamed segment on /coaches/e2e-soak-coach [soak] |

The full per-round log and the traces stay on the machine that ran it, in
`e2e-local/.soak/archive-2026-10-22/` (gitignored).
