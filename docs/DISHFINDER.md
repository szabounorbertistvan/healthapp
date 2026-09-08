# DishFinder — sibling project, and the deep-link idea

**Status: researched, nothing built.** This is a feasibility note so a future
session doesn't have to re-read the other repo. No code in HealthApp references
DishFinder today.

## What DishFinder is

A separate full-stack product owned by the same person, at `D:\react\dishfinder`
(not a workspace of this repo, not a package — a wholly separate deployment).

- Next.js 15 client on Vercel, Express 5 server on Fly.io, Postgres on Neon,
  Cloudinary images, Socket.io realtime. Its own JWT auth, its own users.
- Restaurant discovery: menus searchable **by ingredient**, plus dietary/allergen
  filters. Per-dish macros exist (`ingredient_nutrition` per-100g + a
  "calculate from ingredients" flow on menu items).
- `/cooking`: ~52k recipes searchable by included/excluded ingredients.
- 7 languages including RO and EN — the same pair HealthApp ships.

Read `D:\react\dishfinder\PROJECT_DESCRIPTION.md` for the full feature list and
`D:\react\dishfinder\CLAUDE.md` for its conventions. Treat both as reference for
*that* project; they do not govern work in this repo.

## The idea

A HealthApp client has a coach-built meal — a list of ingredients and grams. Give
them a button that opens DishFinder with those ingredients **already in the
filters**: "cook something with this" → `/cooking`, "eating out" →
`/restaurants`. A plain outbound link. No API call, no shared database, no auth
handoff, no data written anywhere.

## Why it's cheap: the URL contract already exists

DishFinder's finder pages read their whole filter state from the query string,
and it already builds this exact link internally — `/cooking` has an
`eatingOutHref` that hands its filters to `/restaurants`
(`client/app/cooking/CookingClient.tsx`). The encoder/decoder lives in
`client/app/restaurants/finderUrlState.ts`.

| Param | Format | `/cooking` | `/restaurants` |
|---|---|---|---|
| `q` | free text | ✅ | ✅ |
| `ingredients` | JSON `[{"id":123,"name":"chicken breast"}]` | ✅ | ✅ |
| `excludeIngredients` | same JSON shape | ✅ | ✅ |
| `allergens` | csv, e.g. `gluten,dairy` | ✅ | ✅ |
| `diet` | csv, e.g. `vegan,gluten_free` | ❌ | ✅ |
| `nutrients` | csv of `lowCalorie,highProtein,lowCarb,lowFat` | ❌ | ✅ |
| `pet` `open` `price` `nopizza` | flags | ❌ | ✅ |

The `nutrients` presets are the interesting ones for a fitness app — they map to
≤500 kcal, ≥20 g protein, ≤30 g carbs, ≤15 g fat **per serving**
(`client/app/hooks/useSearch.ts:330`).

## The two real obstacles

**1. There is no shared ingredient identifier — and USDA FDC is not one yet.**
The intent is for both products to key ingredients to USDA FoodData Central.
Neither does today (checked 2026-08-26):

- **HealthApp** has `'usda'` in the `food_source` enum
  (`20260823000100_types.sql:9`) and the spec says "local foods → USDA/OFF", but
  both edge functions call **Open Food Facts only**. Nothing ever writes a `usda`
  row, and there is no `fdc_id` column — `foods.external_id` holds an OFF product
  code.
- **DishFinder** has no `fdc_id` anywhere either — not in `schema.sql`, not in
  `full_dump.sql`. `ingredients` is matched on `name_en`; `ingredient_nutrition`
  is a **hand-curated seed** (`data/ingredientNutrition.seed.json`, loaded by
  `scripts/seedIngredientNutrition.js`) whose `source` is `curated` or `manual`.
  There is a generic `source_ref varchar(80)` "upstream id when there is one" —
  the right place for an FDC id, currently unused by the seed.

So a shared FDC id would make the mapping trivial, but it is **work in both
repos**, not a join that already exists. Until then, the URL wants a numeric
DishFinder `ingredient.id` and HealthApp has UUID rows with free-text names.
Ways out, cheapest first:

- **Name only.** Send `?q=<food name>` and skip `ingredients` entirely. Zero
  work, no mapping to maintain, much weaker matching — DishFinder's `q` searches
  dish/recipe *titles*, not ingredient lists, so it does not use the feature that
  makes DishFinder worth linking to.
- **Resolve at link time.** `GET /api/translations/ingredients?search=<3+ chars>`
  on the DishFinder server is public (rate-limited 120/min, 3-char minimum, no
  API key) and returns ingredients with translations. Call it server-side from a
  HealthApp server action, cache the hit on a new nullable
  `foods.dishfinder_ingredient_id` column, and the mapping fills in organically
  the same way the OFF food cache does. This is the approach that fits how this
  codebase already thinks.
- **Hand-map the staples.** The coach-plan vocabulary is small — a few hundred
  whole foods cover almost every plan. A seeded lookup table, no runtime
  dependency at all.
- **Put an FDC id on both sides.** `foods.fdc_id` here,
  `ingredient_nutrition.source_ref` there (the column already exists for exactly
  this). The right long-term answer, and it pays for itself beyond this feature —
  USDA is a better macro source for whole foods than OFF, which is a *packaged
  product* database and thin on "chicken breast, raw".

**2. Public recipe reads are off in production.** `/api/recipes/search` and
`/api/recipes/:id` sit behind a `disablePublicRecipes` kill switch —
**blocked by default in prod** until scraper mitigations land, re-enabled with
`ENABLE_PUBLIC_RECIPES=1` (`server/middleware/disablePublicRecipes.js`). So a
`/cooking` deep link may land on a 503 today. The **restaurant** dish search
(`/api/restaurants/search/dishes`) has no such switch — the eating-out half of the
idea works now, the cooking half depends on someone flipping that secret.

## Fit against this app's requirements

**Where it fits.** PRODUCT_SPEC C8 has no answer for the client who is standing in
a restaurant, and adherence drops exactly there. The restaurant finder plus
`nutrients=highProtein` is a genuine answer, and it is the one HealthApp surface
that would otherwise need a whole restaurant database to build.

**Where it pulls against the spec.** The plan's non-negotiable is *concrete
coach-built meals* — the coach decides what the client eats. A discovery link
points the other way. Framing decides whether it helps: **"here is how to cook
what your coach prescribed"** keeps the coach in charge; **"find something else to
eat"** quietly replaces them. The first is additive; the second changes the
product.

**Macro fidelity is the honest limitation.** A plan meal is grams of named
ingredients with exact macros. A DishFinder recipe is a serving of something whose
per-person weight is not modelled, and the nutrition endpoint returns per-100g
values *per ingredient*, not a per-serving total. So a client can be pointed at a
matching recipe, but they cannot log it against the plan without weighing what
they actually ate. Restaurant dishes are better — they carry per-serving macros —
but they are still someone else's numbers. Any version of this should send people
to *discover*, then log what they ate the normal way. Promising "swap the planned
meal for this recipe and your macros still hit" would be a lie.

**Privacy.** A redirect puts the ingredient list, and possibly allergens, into a
URL on another origin — health-adjacent data leaving the app. It should be an
explicit user tap, never automatic, and the URL must carry ingredients only: no
user id, no plan id, no coach id, nothing that identifies who is eating.

**Coupling.** As a link it is zero coupling — DishFinder can be down and HealthApp
is unaffected apart from a dead-end tab. That changes the moment anything is
fetched inline (a result count, a preview card): then HealthApp's page render
depends on another product's uptime, rate limits and kill switches. Keep it a
link unless there is a strong reason not to.

## Verdict: does it break the regime?

**The cooking direction does not.** "What can I cook with the ingredients my coach
gave me" is *constraint-preserving* — same ingredients, different method. It
doesn't change what the client eats, it removes the reason they don't eat it
(not knowing what to do with 150 g of chicken and 80 g of rice). That is the
strongest argument for the whole idea and it should be built first.

Two caveats that are manageable, not fatal:

- **Recipes bring extra ingredients.** A recipe matching chicken + rice also calls
  for oil, butter, a sauce. 30 g of olive oil is ~270 kcal the plan never
  accounted for. DishFinder's fewest-ingredients-first ordering already limits the
  damage; the honest fix is to tell the client to log what they actually added,
  not to pretend the recipe equals the planned meal.
- **Cooking changes macros.** Less of a problem than expected: DishFinder's seed
  is deliberate about this — cooked values for staples served cooked, raw for
  meat specced by raw weight, plus an as-weighed yield conversion. It handles this
  more carefully than HealthApp currently does.

**The restaurant direction is the one to hold.** It's the genuinely useful
unserved case, but it's also where "find something else to eat" lives, and it's
the half that can drift into replacing the coach's decision. Bounded by the
coach's ingredients plus `nutrients=highProtein` it stays defensible — but it is a
product decision, not a technical one, and it doesn't need to ship at the same
time.

## If it ever gets built

Smallest honest version: one `dishfinderUrl(foods, opts)` helper in
`apps/web/lib/`, a `NEXT_PUBLIC_DISHFINDER_URL` env var (absent = no button
rendered), name-only `q` links to start, and the
`foods.dishfinder_ingredient_id` column added when name-only proves too weak.
Both buttons live on the client food page next to a planned meal.
