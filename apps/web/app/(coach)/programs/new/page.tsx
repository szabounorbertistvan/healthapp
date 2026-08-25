import Link from "next/link";
import { getRoster } from "@/lib/data";
import { Card, PageTitle } from "@/components/ui";
import { NewProgramForm } from "@/components/new-program-form";

export default async function NewProgramPage() {
  const roster = await getRoster();

  return (
    <div>
      <Link href="/programs" className="text-sm text-accent-ink hover:underline">
        ← Programs
      </Link>
      <PageTitle title="New program" />
      <Card>
        <NewProgramForm roster={roster} />
      </Card>
    </div>
  );
}
