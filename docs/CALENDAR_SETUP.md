# Calendar connections: switching them on

The code is complete (2026-12-07): Google and Microsoft adapters
(`apps/web/lib/calendar/google.ts`, `microsoft.ts`), the OAuth start and callback
routes (`app/api/calendar/[provider]/connect|callback`), the sync worker
(`app/api/cron/calendar-sync`), and the coach's card on `/bookings/availability`.
Until the settings below exist, the card says "Coming soon" — nothing half-works.

A provider turns on when **all** of its settings are present
(`lib/calendar/registry.ts`). You can switch on one provider and not the other.

## 1. Settings common to both (Vercel → Settings → Environment Variables, Production)

| Name | Value |
|---|---|
| `CALENDAR_TOKEN_KEY` | 32 random bytes, base64. Make one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep a copy: losing it means every coach reconnects. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` (secret). Only the server reads it. |
| `CALENDAR_CRON_SECRET` | Any long random string (the same command). The worker refuses calls without it. |
| `NEXT_PUBLIC_SITE_URL` | `https://www.voinic.fit` (the callback address is built from it). |

## 2. Google Calendar

1. https://console.cloud.google.com → create a project "Voinic".
2. APIs & Services → Library → enable **Google Calendar API**.
3. OAuth consent screen → External → app name Voinic, support email, logo, the
   privacy and terms links (`/privacy`, `/terms`). Scopes: add
   `.../auth/calendar.freebusy` and `.../auth/calendar.calendarlist.readonly`
   (plus `openid`, `email`). Both calendar scopes are "sensitive": Google reviews
   the app before anyone outside your test users can connect (a few days; a short
   video of the connect flow is asked for).
4. Credentials → Create credentials → OAuth client ID → Web application.
   Authorized redirect URI: `https://www.voinic.fit/api/calendar/google/callback`.
5. In Vercel: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`.

## 3. Microsoft Outlook / 365

1. https://entra.microsoft.com → App registrations → New registration.
   Supported account types: **Accounts in any organizational directory and personal
   Microsoft accounts**. Redirect URI (Web): `https://www.voinic.fit/api/calendar/microsoft/callback`.
2. Certificates & secrets → New client secret (note the expiry; set a reminder).
3. API permissions → Microsoft Graph → Delegated → `Calendars.ReadBasic`,
   `offline_access`, `openid`, `email`.
4. In Vercel: `MICROSOFT_CALENDAR_CLIENT_ID` (the Application ID), `MICROSOFT_CALENDAR_CLIENT_SECRET`.

## 4. The worker's schedule

The worker must be called every 15 minutes. In Supabase → SQL Editor (replace the secret):

```sql
select cron.schedule('calendar-sync', '*/15 * * * *', $$
  select net.http_get(
    url := 'https://www.voinic.fit/api/cron/calendar-sync',
    headers := jsonb_build_object('Authorization', 'Bearer <CALENDAR_CRON_SECRET>'),
    timeout_milliseconds := 55000
  );
$$);
```

(`pg_cron` and `pg_net` are already used by the rest-timer push.) To stop it:
`select cron.unschedule('calendar-sync');`

## 5. Check

Redeploy, open `/bookings/availability` as a coach: the provider shows **Connect**.
Connect, allow, come back to "Calendar connected". The worker's answer
(`{"synced":…,"failed":…,"revoked":…}`) is in `net._http_response`.
