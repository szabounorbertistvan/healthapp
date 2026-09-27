import { PostSkeleton } from "@/components/social-skeleton";
import { SOCIAL } from "@/lib/social-ui";

/** /saved while its read is in flight: the title, the hint, two cards. */
export default function SavedLoading() {
  return (
    <div className={SOCIAL.column} aria-busy="true">
      <span className="block h-7 w-24 animate-pulse rounded-full bg-surface" />
      <span className="mt-2 block h-3 w-56 animate-pulse rounded-full bg-surface" />
      <div className={`mt-4 space-y-3 sm:space-y-5 ${SOCIAL.bleed}`}>
        <PostSkeleton bleed />
        <PostSkeleton bleed />
      </div>
    </div>
  );
}
