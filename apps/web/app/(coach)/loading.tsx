import { PageSpinner } from "@/components/spinner";

/**
 * Shown while any coach screen's data is in flight. The sidebar is in the
 * layout, so it never blanks — only the content area waits.
 */
export default function CoachLoading() {
  return <PageSpinner />;
}
