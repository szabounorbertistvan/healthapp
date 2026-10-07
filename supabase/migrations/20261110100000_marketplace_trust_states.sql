-- HealthApp schema · marketplace trust: the enum value, on its own
--
-- Postgres will not use an enum value in the transaction that added it, so
-- the new notification category comes first, alone (the pattern of
-- 20261109100000). 20261110110000 is the moderation that uses it.
--
-- 'marketplace': what moderation tells a coach about their own listing —
-- verification approved / rejected, the profile approved, returned,
-- unpublished, suspended or restored, a review about them hidden. Never who
-- decided, never the report or the reporter.

alter type public.notification_category add value if not exists 'marketplace';
