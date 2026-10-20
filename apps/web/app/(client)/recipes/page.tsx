import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { getImportProposal, getMyRecipes, readPendingHandoff } from "@/lib/recipes-data";
import { RecipeCard } from "@/components/recipes";
import { RecipeImportDialog } from "@/components/recipe-import-dialog";
import { NewRecipeButton } from "@/components/recipe-editor-dialog";
import { EmptyState } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";

type ErrorKey = "HANDOFF_EXPIRED" | "HANDOFF_SIGNATURE" | "HANDOFF_MALFORMED" | "HANDOFF_TOO_LARGE" | "HANDOFF_NOT_CONFIGURED";
const ERRORS: readonly ErrorKey[] = ["HANDOFF_EXPIRED", "HANDOFF_SIGNATURE", "HANDOFF_MALFORMED", "HANDOFF_TOO_LARGE", "HANDOFF_NOT_CONFIGURED"];

/**
 * My recipes. `?import=1` is where /recipes/receive sends a person after a
 * DishFinder hand-off: the signed recipe waits in a cookie, is verified again
 * here, and opens the import dialog over the list. `?handoff_error=` says why
 * a hand-off was refused.
 */
export default async function RecipesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ t }, params, recipes] = await Promise.all([getI18n(), searchParams, getMyRecipes()]);
  const m = t.clientApp.recipes;
  const pending = params.import === "1" ? await readPendingHandoff() : null;
  const proposal = pending?.ok ? await getImportProposal(pending.handoff) : null;
  const rawError = typeof params.handoff_error === "string" ? params.handoff_error : pending && !pending.ok ? pending.error : null;
  const error = rawError && (ERRORS as readonly string[]).includes(rawError) ? (rawError as ErrorKey) : null;

  return (
    <div className="mx-auto max-w-[1600px]">
      <Link href="/food" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink">
        <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
        {t.common.nav.nutrition}
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{m.title}</h1>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">{m.intro}</p>
        </div>
        <NewRecipeButton />
      </div>

      {error ? <p role="alert" className="mt-4 max-w-2xl rounded-2xl bg-warn-soft px-4 py-3 text-[13px] font-semibold text-warn">{m.errors[error]}</p> : null}

      {recipes.length === 0 ? (
        <div className="mt-5"><EmptyState plain title={m.empty} hint={m.emptyHint} /></div>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {recipes.map((r) => <RecipeCard key={r.id} recipe={r} />)}
        </div>
      )}

      {proposal ? (
        <RecipeImportDialog
          title={proposal.handoff.recipe.title}
          url={proposal.handoff.recipe.url}
          image={proposal.handoff.recipe.image}
          servings={proposal.handoff.recipe.servings}
          perServing={proposal.handoff.recipe.per_serving}
          lines={proposal.lines.map((l) => ({ label: l.label, grams: l.grams, food: l.food }))}
          existing={proposal.existing}
        />
      ) : null}
    </div>
  );
}
