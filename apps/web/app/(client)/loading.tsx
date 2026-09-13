import { PageSpinner } from "@/components/spinner";

/**
 * Shown while any client screen's data is in flight.
 *
 * Every route in this group reads the database on every request, so a
 * navigation used to leave the previous screen frozen until the whole read
 * finished. The shell and tab bar stay put; only the content area waits.
 */
export default function ClientLoading() {
  return <PageSpinner />;
}
