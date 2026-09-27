import { PostSkeleton } from "@/components/social-skeleton";

/** One post while social_post() is in flight: the back pill and the card's shape. */
export default function PostLoading() {
  return (
    <div className="mx-auto w-full max-w-[500px]" aria-busy="true">
      <span className="block h-9 w-24 animate-pulse rounded-full bg-surface" />
      <div className="mt-4">
        <PostSkeleton />
      </div>
    </div>
  );
}
