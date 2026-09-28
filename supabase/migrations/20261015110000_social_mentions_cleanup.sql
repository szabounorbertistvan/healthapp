-- Retro-validation of mention rows written before the current rules.
--
-- 20261012100000 validates a mention row on insert (the handle is in the
-- text, the person may appear to the author and may see the post), and
-- 20261013100000 prunes the rows an EDIT stops naming. Rows written before
-- either existed were never checked. On read they are already filtered
-- (social_visible_post_mentions / social_visible_comment_mentions, and since
-- 20261015100000 the tables' SELECT policies), so nothing is shown that
-- should not be; this removes the ones that can never become valid again.
--
-- The one clear rule: the mentioned person's username is not among the
-- handles the post's or comment's CURRENT text contains — parsed by
-- social_mention_handles(), the same parser the insert check and the prune
-- trigger use. A handle that is not in the text will not come back into it
-- without an edit, and an edit writes its own rows. That also covers a row
-- for someone who has no username at all.
--
-- Deliberately kept: rows whose person is suspended, being deleted, behind a
-- block or unable to see the post. Each of those can be undone, and a deleted
-- row cannot; the read path hides them while they hold. Rows on a soft-deleted
-- post are kept too (the text is still there and nothing shows them).
--
-- Idempotent: a second run finds nothing. Only mention rows are touched, and
-- nothing references them. The rule lives in a function (owner-only) so the
-- pgTAP suite runs exactly this code against rows it fabricates.

create or replace function public.social_mentions_cleanup()
returns table (post_rows int, comment_rows int)
language plpgsql security definer set search_path = public as $$
begin
  delete from public.social_post_mentions m
  using public.social_posts p, public.users u
  where p.id = m.post_id
    and u.id = m.user_id
    and not coalesce(lower(u.username) = any (public.social_mention_handles(p.text)), false);
  get diagnostics post_rows = row_count;

  delete from public.social_comment_mentions m
  using public.social_comments c, public.users u
  where c.id = m.comment_id
    and u.id = m.user_id
    and not coalesce(lower(u.username) = any (public.social_mention_handles(c.body)), false);
  get diagnostics comment_rows = row_count;

  return next;
end;
$$;
revoke execute on function public.social_mentions_cleanup() from public, anon, authenticated;

do $$
declare r record;
begin
  select * into r from public.social_mentions_cleanup();
  raise notice 'mention cleanup: % post rows, % comment rows removed', r.post_rows, r.comment_rows;
end;
$$;
