-- HealthApp schema · coaching lifecycle, part 1: the new enum values
--
-- On its own because Postgres refuses to use an enum value in the transaction
-- that added it ("unsafe use of new value"), and part 2
-- (20261109110000_coaching_lifecycle.sql) uses 'paused' in an index predicate
-- and in constraints. Each migration file is one transaction.
--
--   relationship_status   + paused     a coaching relationship on a break
--   audit_action          + RELATIONSHIP_PAUSED, RELATIONSHIP_RESUMED
--   notification_category + coaching  paused / resumed / ended notices

alter type public.relationship_status add value if not exists 'paused' after 'active';
alter type public.audit_action add value if not exists 'RELATIONSHIP_PAUSED';
alter type public.audit_action add value if not exists 'RELATIONSHIP_RESUMED';
alter type public.notification_category add value if not exists 'coaching';
