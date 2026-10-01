"use client";
import Link from "next/link";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { CoachPublicPost } from "@/lib/coach-profile";
import { useSocialFormat } from "../social";

/**
 * A coach's public posts for a reader who is not signed in: text, date and
 * counts from coach_public_posts(). Pictures are left out — post media is
 * served by /api/media, which requires a session by design — and the count
 * says so. A signed-in reader gets the Social V2 PostCard instead.
 */
export function PublicPostList({ posts, allHref }: { posts: CoachPublicPost[]; allHref: string }) {
  const { t } = useI18n();
  const p = t.coachProfile.publicPage;
  const f = useSocialFormat();
  return (
    <div>
      <ul className="grid gap-3" data-testid="coach-public-posts">
        {posts.map((post) => (
          <li key={post.id} className="rounded-3xl bg-surface p-5">
            <p className="text-[12px] text-ink-faint">{f.when(post.created_at)}</p>
            {post.text ? <p className="mt-1.5 whitespace-pre-line text-[14.5px] leading-relaxed">{post.text}</p> : null}
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-faint">
              <span>{fill(p.reactions, { n: post.reactions })}</span>
              <span>{fill(p.comments, { n: post.comments })}</span>
              {post.photos > 0 ? <span>{fill(p.photosHidden, { n: post.photos })}</span> : null}
            </p>
          </li>
        ))}
      </ul>
      <Link href={allHref} className="mt-4 inline-flex text-[14px] font-semibold text-accent-ink hover:underline">
        {p.seeAllPosts} →
      </Link>
    </div>
  );
}
