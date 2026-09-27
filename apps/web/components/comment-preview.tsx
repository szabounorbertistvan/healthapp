"use client";
import Link from "next/link";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { commentPreviewModel } from "@/lib/comment-preview";
import { SOCIAL } from "@/lib/social-ui";
import type { CommentPreviewItem } from "@/lib/types";
import { useSocialFormat } from "./social";
import { MentionText } from "./social-v2";

/**
 * Up to two comments under a feed card, then "View all N comments".
 *
 *   fancp  Great session! @ownercp
 *   coachcp · edited  Watch the depth on the last set
 *   View all 12 comments
 *
 * Presentation only: the comments, their order and who may see them were
 * decided by the database (social_comment_preview); the total is the post's
 * own comment_count. Each line is the author's name — a link to their profile
 * — then the text through MentionText, the same renderer the rest of the
 * social surfaces use, so a mention is a link only where the database
 * resolved it and a comment is never parsed as markup. Two lines at most per
 * comment; the rest is clipped.
 *
 * The rest of each line opens the post's thread (#comments) through a link
 * laid over the whole row, under the name and mention links — so a tap on
 * the text never lands on a profile by accident, and no link sits inside
 * another. Nothing renders at all when there is nothing to show.
 */
export function CommentPreview({ postId, total, items }: { postId: string; total: number; items: CommentPreviewItem[] }) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const s = t.common.social;
  const model = commentPreviewModel({ postId, total, items });
  if (!model.viewAll && model.items.length === 0) return null;

  const focus = "rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  return (
    <div className="mt-1.5 px-4">
      {model.items.length > 0 && model.viewAll ? (
        <ul aria-label={s.commentPreview} className="space-y-0.5">
          {model.items.map((c) => (
            <li key={c.id} className="relative">
              {/* The row's own target: the thread. Under the name and mention links. */}
              <Link
                href={model.viewAll!.href}
                aria-label={fill(s.openCommentOf, { name: c.author_name })}
                title={f.at(c.created_at)}
                className={`absolute inset-0 ${focus}`}
              />
              <MentionText
                text={c.body}
                mentions={c.mentions}
                lead={
                  <>
                    <Link
                      href={`/people/${c.user_id}`}
                      className={`relative z-10 font-semibold hover:underline ${focus}`}
                    >
                      {c.author_name}
                    </Link>
                    {c.edited_at ? <span className="text-[12px] text-ink-faint"> · {s.edited}</span> : null}{" "}
                  </>
                }
                // Mentions sit above the row's link too; line breaks fold into the two lines.
                className={`line-clamp-2 break-words text-[14px] leading-snug text-ink [&_a]:relative [&_a]:z-10`}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {model.viewAll ? (
        <Link
          href={model.viewAll.href}
          aria-label={model.viewAll.one ? s.viewCommentAria : fill(s.viewCommentsAria, { count: f.n(model.viewAll.count) })}
          className={`mt-1 inline-block ${SOCIAL.text.secondary} text-ink-faint hover:text-ink-soft hover:underline ${focus}`}
        >
          {model.viewAll.one ? s.viewOneComment : fill(s.viewAllComments, { count: f.n(model.viewAll.count) })}
        </Link>
      ) : null}
    </div>
  );
}
