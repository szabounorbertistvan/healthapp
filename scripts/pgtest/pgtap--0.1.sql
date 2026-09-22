-- A stub pgTAP: just enough of the API for supabase/tests/*.sql to run.
--
-- Real pgTAP is a C extension that cannot be installed into the embedded
-- Postgres this harness downloads. These are plain plpgsql stand-ins with the
-- same names, argument orders and TAP output, so the suites in supabase/tests
-- run unmodified and CI (which has the real thing) stays the source of truth.
--
-- Add a function here the moment a suite needs one — a missing assertion shows
-- up as `function <name>(...) does not exist`, which fails the whole file.
create sequence if not exists extensions.pgtap_seq;
grant usage, select, update on sequence extensions.pgtap_seq to public;

create or replace function plan(int) returns setof text language plpgsql as $$
begin
  perform setval('extensions.pgtap_seq', 1, false);
  return next '1..' || $1;
end;
$$;

create or replace function ok(boolean, text default '') returns text language plpgsql as $$
declare n int;
begin
  n := nextval('extensions.pgtap_seq');
  if $1 then return 'ok ' || n || ' - ' || coalesce($2, ''); end if;
  return 'not ok ' || n || ' - ' || coalesce($2, '');
end;
$$;

create or replace function is(anyelement, anyelement, text default '') returns text language plpgsql as $$
declare n int;
begin
  n := nextval('extensions.pgtap_seq');
  if $1 is not distinct from $2 then return 'ok ' || n || ' - ' || coalesce($3, ''); end if;
  return 'not ok ' || n || ' - ' || coalesce($3, '') ||
    ' (have: ' || coalesce($1::text, 'NULL') || ', want: ' || coalesce($2::text, 'NULL') || ')';
end;
$$;

create or replace function isnt(anyelement, anyelement, text default '') returns text language plpgsql as $$
declare n int;
begin
  n := nextval('extensions.pgtap_seq');
  if $1 is distinct from $2 then return 'ok ' || n || ' - ' || coalesce($3, ''); end if;
  return 'not ok ' || n || ' - ' || coalesce($3, '');
end;
$$;

create or replace function throws_ok(text, text default null, text default '') returns text language plpgsql as $$
declare n int; state text;
begin
  n := nextval('extensions.pgtap_seq');
  begin
    execute $1;
  exception when others then
    get stacked diagnostics state = returned_sqlstate;
    if $2 is null or state = $2 then return 'ok ' || n || ' - ' || coalesce($3, ''); end if;
    return 'not ok ' || n || ' - ' || coalesce($3, '') || ' (sqlstate ' || state || ')';
  end;
  return 'not ok ' || n || ' - ' || coalesce($3, '') || ' (no exception raised)';
end;
$$;

create or replace function lives_ok(text, text default '') returns text language plpgsql as $$
declare n int;
begin
  n := nextval('extensions.pgtap_seq');
  begin
    execute $1;
  exception when others then
    return 'not ok ' || n || ' - ' || coalesce($2, '') || ' (' || sqlerrm || ')';
  end;
  return 'ok ' || n || ' - ' || coalesce($2, '');
end;
$$;

-- Each query is materialised ONCE: some of the functions under test are not
-- idempotent, and running them twice would change the answer.
create or replace function set_eq(text, text, text default '') returns text language plpgsql as $$
declare n int; extra int; missing int;
begin
  n := nextval('extensions.pgtap_seq');
  execute 'create temp table pgtap_a on commit drop as ' || $1;
  execute 'create temp table pgtap_b on commit drop as ' || $2;
  execute 'select count(*) from (select * from pgtap_a except all select * from pgtap_b) x' into extra;
  execute 'select count(*) from (select * from pgtap_b except all select * from pgtap_a) x' into missing;
  drop table pgtap_a; drop table pgtap_b;
  if extra = 0 and missing = 0 then return 'ok ' || n || ' - ' || coalesce($3, ''); end if;
  return 'not ok ' || n || ' - ' || coalesce($3, '') || ' (extra ' || extra || ', missing ' || missing || ')';
end;
$$;

create or replace function finish() returns setof text language plpgsql as $$
begin
  return next '# done';
end;
$$;

-- throws_ok(sql, sqlstate, errmsg, description) — the 4-arg form.
create or replace function throws_ok(text, text, text, text) returns text language plpgsql as $$
declare n int; state text; msg text;
begin
  n := nextval('extensions.pgtap_seq');
  begin
    execute $1;
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if ($2 is null or state = $2) and ($3 is null or msg = $3) then
      return 'ok ' || n || ' - ' || coalesce($4, '');
    end if;
    return 'not ok ' || n || ' - ' || coalesce($4, '') || ' (sqlstate ' || state || ', msg ' || msg || ')';
  end;
  return 'not ok ' || n || ' - ' || coalesce($4, '') || ' (no exception raised)';
end;
$$;

create or replace function has_table(text, text, text default '') returns text language plpgsql as $$
declare n int; found boolean;
begin
  n := nextval('extensions.pgtap_seq');
  select exists (select 1 from pg_tables where schemaname = $1 and tablename = $2) into found;
  if found then return 'ok ' || n || ' - ' || coalesce($3, ''); end if;
  return 'not ok ' || n || ' - ' || coalesce($3, '');
end;
$$;

create or replace function has_column(text, text, text, text default '') returns text language plpgsql as $$
declare n int; found boolean;
begin
  n := nextval('extensions.pgtap_seq');
  select exists (select 1 from information_schema.columns
                 where table_schema = $1 and table_name = $2 and column_name = $3) into found;
  if found then return 'ok ' || n || ' - ' || coalesce($4, ''); end if;
  return 'not ok ' || n || ' - ' || coalesce($4, '');
end;
$$;

create or replace function has_function(text, text, text default '') returns text language plpgsql as $$
declare n int; found boolean;
begin
  n := nextval('extensions.pgtap_seq');
  select exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                 where ns.nspname = $1 and p.proname = $2) into found;
  if found then return 'ok ' || n || ' - ' || coalesce($3, ''); end if;
  return 'not ok ' || n || ' - ' || coalesce($3, '');
end;
$$;

create or replace function cmp_ok(anyelement, text, anyelement, text default '') returns text language plpgsql as $$
declare n int; passed boolean;
begin
  n := nextval('extensions.pgtap_seq');
  execute format('select $1 %s $2', $2) using $1, $3 into passed;
  if coalesce(passed, false) then return 'ok ' || n || ' - ' || coalesce($4, ''); end if;
  return 'not ok ' || n || ' - ' || coalesce($4, '') ||
    ' (have: ' || coalesce($1::text, 'NULL') || ' ' || $2 || ' ' || coalesce($3::text, 'NULL') || ')';
end;
$$;
