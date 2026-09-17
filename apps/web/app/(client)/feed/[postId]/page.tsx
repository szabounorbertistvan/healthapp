import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost } from "@/lib/social-data";
import { Comments, PostCard } from "@/components/social";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const BACK = "m15 6-6 6 6 6";

export default async function PostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { t } = await getI18n();
  const { postId } = await params;
  const data = await getPost(postId);
  if (!data) notFound();
  return (
    // One post and its comments — a document, so a readable column.
    <div className="mx-auto max-w-[680px]">
      <Link
        href="/feed"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {t.common.social.feed}
      </Link>
      <div className="mt-4 space-y-4">
        <PostCard post={data.post} detail />
        <Comments postId={postId} comments={data.comments} />
      </div>
    </div>
  );
}
