import Link from "next/link";
import { getPrograms } from "@/lib/data";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { timeAgo } from "@/lib/format";

export default async function ProgramsPage() {
  const programs = await getPrograms();
  return (
    <div>
      <PageTitle title="Programs">
        <Link
          href="/programs/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          New program
        </Link>
      </PageTitle>
      {programs.length === 0 ? (
        <EmptyState title="No programs yet" hint="Create one and pull exercises from the 873-exercise library." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((p) => (
            <Link key={p.id} href={`/programs/${p.id}`}>
              <Card className="h-full transition hover:border-accent">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold">{p.name}</p>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                    p.status === "published" ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
                  }`}>{p.status}</span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{p.client_name}</p>
                <p className="mt-3 text-xs text-ink-faint">{p.days} days · updated {timeAgo(p.updated_at)}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
