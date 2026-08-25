import Link from "next/link";
import { getRoster } from "@/lib/data";
import { Card, PageTitle } from "@/components/ui";
import { NewPlanForm } from "@/components/new-plan-form";

export default async function NewPlanPage() {
  const roster = await getRoster();
  return (
    <div>
      <Link href="/nutrition" className="text-sm text-accent-ink hover:underline">
        &larr; Nutrition
      </Link>
      <PageTitle title="New nutrition plan" />
      <Card>
        <NewPlanForm roster={roster} />
      </Card>
    </div>
  );
}
