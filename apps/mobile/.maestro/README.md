# Maestro flows — the app's journeys on a real phone or emulator

[Maestro](https://maestro.mobile.dev) drives an installed build (EAS `preview` or `development`)
through the journeys the plan calls mandatory. Each flow is plain YAML, matched on the
**English** UI (set the phone to English, or switch to EN under More → Language first).

They run against **whatever server the build points at** — the live one for an EAS build.
Use a test account, never a real person's:

```bash
maestro test apps/mobile/.maestro --env EMAIL=you+test@example.com --env PASSWORD=…
```

| Flow | What it proves |
|---|---|
| `01-sign-in.yaml` | sign-in → Today shows the week |
| `02-offline-set.yaml` | a set logged in airplane mode shows "Waiting for signal", then syncs |
| `03-food-search.yaml` | search a food, add a portion to lunch |
| `04-habit-and-check-in.yaml` | open habits and the weekly check-in |
| `05-coach-inbox.yaml` | a coach account sees Clients, Inbox, Chats |

Not in CI: there is no device farm wired up. Run them before every store release
(docs/ANDROID_RELEASE.md).
