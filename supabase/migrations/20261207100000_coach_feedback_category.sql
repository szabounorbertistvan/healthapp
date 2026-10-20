-- Notification category for a coach's comment on a workout (2026-12-07)
--
-- Alone in its file: Postgres will not use an enum value in the transaction
-- that added it, and 20261207110000 writes notifications with it
-- (same split as 20261109100000 / 20261110100000).

alter type notification_category add value if not exists 'coach_feedback';
