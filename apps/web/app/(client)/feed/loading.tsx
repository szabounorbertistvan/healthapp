import { FeedSkeleton } from "@/components/social-skeleton";

/** The feed's own placeholder: the column, stories and two posts, not a spinner. */
export default function FeedLoading() {
  return <FeedSkeleton />;
}
