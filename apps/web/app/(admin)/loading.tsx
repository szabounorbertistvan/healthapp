import { PageSpinner } from "@/components/spinner";

/** The admin shell stays; only the content area waits on its RPCs. */
export default function AdminLoading() {
  return <PageSpinner />;
}
