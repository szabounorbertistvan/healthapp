import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost } from "@/lib/social-data";
import { PostCard } from "@/components/social";
import { CommentThread } from "@/components/comment-thread";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const BACK = "m15 6-6 6 6 6";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One post and its conversation.
 *
 * getPost() returns null for anything the reader may not see — social_post()
 * and social_post_comments() both go through can_see_post — so nothing is
 * fetched and then hidden. A well-formed id that comes back empty is usually
 * a link that was valid once (a notification, a shared link): the post was
 * deleted, made "only me", is followers-only after an unfollow, or sits
 * behind a block. That lands on a plain "no longer available" card with the
 * way back, never the bare 404 — and it deliberately does not say which of
 * those it was, so the page reveals nothing the reader may not know. A
 * malformed id is still a 404.
 */
export default async function PostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { t } = await getI18n();
  const { postId } = await params;
  if (!UUID.test(postId)) notFound();
  const data = await getPost(postId);
  const back = (
    <Link
      href="/feed"
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
    >
      <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
      {t.common.social.feed}
    </Link>
  );
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-[500px]">
        {back}
        <div role="status" className="mt-4 rounded-3xl bg-surface px-6 py-10 text-center">
          <p className="font-display text-lg font-bold tracking-tight">{t.common.social.postGone}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{t.common.social.postGoneHint}</p>
        </div>
      </div>
    );
  }
  return (
    // One post and its comments — a document, so a readable column.
    <div className="mx-auto w-full max-w-[500px]">
      {back}
      <div className="mt-4 space-y-4">
        <PostCard post={data.post} detail />
        {/* The comment button on the card jumps here. */}
        <div id="comments" className="scroll-mt-24">
          <CommentThread postId={postId} page={data.comments} commentCount={data.post.comment_count} />
        </div>
      </div>
    </div>
  );
}
