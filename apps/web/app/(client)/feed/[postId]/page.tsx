import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost } from "@/lib/social-data";
import { Comments, PostCard } from "@/components/social";
import { getI18n } from "@/lib/i18n/server";

export default async function PostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { t } = await getI18n();
  const { postId } = await params;
  const data = await getPost(postId);
  if (!data) notFound();
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/feed" className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
        ← {t.common.social.feed}
      </Link>
      <PostCard post={data.post} detail />
      <Comments postId={postId} comments={data.comments} />
    </div>
  );
}
