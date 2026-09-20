// Machine-translate the exercise library into Romanian, then let an admin fix
// the result in /admin/exercises.
//
// The Free Exercise DB import lands 873 public-domain exercises with English
// names and English instructions (`exercises.name_en` / `instructions_en`) and
// nothing in `name_ro` / `instructions_ro`. Typing 873 names and ~3 700 steps by
// hand is a week; a pass of this script is a few minutes and gets most of the
// way there. Gym terminology is where machine translation slips ("deadlift" is
// îndreptări, not a mortal lift), so the prompt names the vocabulary and the
// admin desk exists to correct what still comes out wrong.
//
// Needs the SERVICE ROLE key (library rows are service-role writes; the admin
// desk uses the RLS policy from 20260916100000 instead) and Anthropic
// credentials — an API key from console.anthropic.com (Settings → API keys), or
// a profile stored by `ant auth login`, which the SDK picks up on its own:
//
//   $env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_..."   # PowerShell
//   $env:ANTHROPIC_API_KEY = "sk-ant-..."
//   node scripts/translate-exercises.mjs --dry-run --limit 5
//   node scripts/translate-exercises.mjs
//
// Safe to re-run: a row that already has a Romanian name is skipped, so an
// interrupted run resumes. `--force` re-translates everything, `--names-only`
// leaves the instructions alone.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BATCH = 10; // exercises per request — small enough to stay well inside max_tokens
const PAGE = 200;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");
const NAMES_ONLY = args.includes("--names-only");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) || 0 : 0;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

// .env.local first, then .env — this box keeps its variables in the latter.
function fromEnvFile(key) {
  for (const file of ["apps/web/.env.local", "apps/web/.env"]) {
    try {
      const line = readFileSync(join(root, file), "utf8")
        .split(/\r?\n/)
        .find((l) => l.trim().startsWith(`${key}=`));
      if (line) return line.slice(line.indexOf("=") + 1).trim();
    } catch {
      // try the next file
    }
  }
  return undefined;
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fromEnvFile("NEXT_PUBLIC_SUPABASE_URL");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fromEnvFile("SUPABASE_SERVICE_ROLE_KEY");

if (!URL_) fail("NEXT_PUBLIC_SUPABASE_URL is not set (apps/web/.env.local, apps/web/.env or the environment).");
if (!KEY) fail("SUPABASE_SERVICE_ROLE_KEY is not set. Supabase dashboard → Project Settings → API keys → service_role.");
// The SDK resolves credentials itself: ANTHROPIC_API_KEY, then
// ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile. Only stop when there
// is nothing at all to try, and say where a key comes from.
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn(
    "No ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN in the environment - trying a stored `ant auth login` profile. " +
      "If this fails with an authentication error: console.anthropic.com > Settings > API keys > Create key, " +
      "then set ANTHROPIC_API_KEY in the environment.",
  );
}

const supabase = createClient(URL_, KEY, { auth: { persistSession: false } });
const anthropic = new Anthropic();

const SYSTEM = `You translate strength-training content from English into Romanian for a fitness app used in Romania.

Rules:
- Use the vocabulary a Romanian gym actually uses: deadlift = îndreptări, squat = genuflexiuni, bench press = împins la piept (culcat), curl = flexii, row = ramat, press = împins, lunge = fandare, pulldown = tracțiuni la helcometru, raise = ridicări, extension = extensii, dumbbell = gantere, barbell = bară, kettlebell = kettlebell, cable = cablu/helcometru, machine = aparat, bodyweight = greutatea corpului, reps = repetări, set = serie.
- Keep brand and equipment names that Romanians use untranslated (Smith machine, kettlebell, TRX, EZ bar).
- A name is a short label, not a sentence: no final full stop, capitalise like a title in Romanian (first word only).
- Instructions: keep the same number of steps, one per line, in the same order. Imperative, second person singular ("Așază-te", "Împinge"), no numbering, no bullet characters.
- Use proper Romanian diacritics (ă â î ș ț).
- Translate nothing else and add nothing: no notes, no safety advice that is not in the source.`;

/** One request per batch, answered as JSON so the mapping back to ids cannot drift. */
async function translateBatch(rows) {
  const payload = rows.map((r) => ({
    id: r.id,
    name: r.name_en,
    ...(NAMES_ONLY ? {} : { instructions: r.instructions_en ?? "" }),
  }));

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["exercises"],
          properties: {
            exercises: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: NAMES_ONLY ? ["id", "name_ro"] : ["id", "name_ro", "instructions_ro"],
                properties: {
                  id: { type: "string" },
                  name_ro: { type: "string" },
                  ...(NAMES_ONLY ? {} : { instructions_ro: { type: "string" } }),
                },
              },
            },
          },
        },
      },
    },
    messages: [
      {
        role: "user",
        content:
          `Translate these ${payload.length} exercises into Romanian. Answer with one entry per exercise, same ids.\n\n` +
          JSON.stringify(payload, null, 2),
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Model did not answer with JSON: ${text.slice(0, 200)}`);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (parsed.exercises ?? []).filter((e) => byId.has(e.id));
}

async function main() {
  let from = 0;
  let translated = 0;
  let failed = 0;
  let stop = false;

  for (; !stop; ) {
    let query = supabase
      .from("exercises")
      .select("id, name_en, name_ro, instructions_en")
      .is("owner_id", null)
      .order("name_en")
      .range(from, from + PAGE - 1);
    if (!FORCE) query = query.is("name_ro", null);

    const { data, error } = await query;
    if (error) fail(`Could not read exercises: ${error.message}`);
    if (!data || data.length === 0) break;

    for (let i = 0; i < data.length && !stop; i += BATCH) {
      const slice = data.slice(i, i + BATCH);
      let results;
      try {
        results = await translateBatch(slice);
      } catch (e) {
        // A refused key will be refused 88 times over; say so once and stop.
        if (e?.status === 401) {
          fail(`Anthropic refused the API key (${e.message}). Set ANTHROPIC_API_KEY to a secret key from console.anthropic.com → Settings → API keys (it starts with sk-ant-), not the key's id.`);
        }
        if (e?.status === 400 && /credit balance/i.test(e.message ?? "")) {
          fail("The Anthropic account has no credit: console.anthropic.com → Plans & Billing. Nothing was translated.");
        }
        failed += slice.length;
        console.warn(`! batch at ${from + i}: ${e.message}`);
        continue;
      }

      for (const r of results) {
        const name = (r.name_ro ?? "").trim();
        if (!name) continue;
        const patch = { name_ro: name };
        if (!NAMES_ONLY) {
          const steps = (r.instructions_ro ?? "").trim();
          if (steps) patch.instructions_ro = steps;
        }
        if (DRY) {
          console.log(`${slice.find((s) => s.id === r.id)?.name_en}  →  ${name}`);
        } else {
          const { error: updateError } = await supabase.from("exercises").update(patch).eq("id", r.id);
          if (updateError) {
            failed++;
            console.warn(`! ${r.id}: ${updateError.message}`);
            continue;
          }
        }
        translated++;
        if (LIMIT && translated >= LIMIT) {
          stop = true;
          break;
        }
      }
      if (!DRY && translated % 50 === 0 && translated > 0) console.log(`… ${translated} translated`);
    }

    // Without --force the query itself moves forward (rows stop matching once
    // written), so paging from the start each round is what resumes correctly.
    if (FORCE) from += PAGE;
    if (DRY) from += PAGE;
  }

  console.log(
    `${DRY ? "[dry run] " : ""}${translated} exercises translated · ${failed} failed · model ${MODEL}`,
  );
  if (DRY) console.log("Nothing was written. Drop --dry-run to do it.");
  else console.log("Review and fix the wording in /admin/exercises.");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main().catch((e) => fail(e.stack ?? String(e)));
