-- HealthApp schema · 10 admin role
-- Separate migration: a new enum value cannot be used in the same transaction
-- that adds it, so policies/functions referencing 'admin' live in the next file.
alter type user_role add value if not exists 'admin';
