// HealthApp · food-search edge function
// Local `foods` cache first, then Open Food Facts (free API). External hits are
// upserted into `foods` so the cache grows organically (plan §7).
// GET /functions/v1/food-search?q=chicken&locale=ro
import { createClient } from "jsr:@supabase/supabase-js@2";
import { portionsFromOff } from "../_shared/portions.ts";

const OFF_USER_AGENT = "HealthApp/0.1 (relu.plesciuc@sfappworks.com)"; // required by OFF API policy

type FoodResult = {
  food_id: string | null;
  external: { source: string; id: string } | null;
  name: string;
  brand: string | null;
  per_100g: { kcal: number; protein: number; carbs: number; fat: number };
  verified: boolean;
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const locale = url.searchParams.get("locale") === "en" ? "en" : "ro";
  if (q.length < 2) return json({ results: [] });

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // verify caller is an authenticated user (function runs with service role)
  const jwt = authHeader.replace("Bearer ", "");
  const { data: userData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !userData.user) return json({ error: "unauthorized" }, 401);

  // 1) local cache + customs (customs and verified rank first)
  // strip PostgREST filter metacharacters from user input
  const safe = q.replace(/[,()%\\]/g, " ").trim();
  const { data: local } = await supabase
    .from("foods")
    .select("id, source, external_id, name_en, name_ro, brand, kcal_100g, protein_100g, carbs_100g, fat_100g, verified")
    .or(`name_en.ilike.%${safe}%,name_ro.ilike.%${safe}%,brand.ilike.%${safe}%`)
    .order("verified", { ascending: false })
    .limit(15);

  const results: FoodResult[] = (local ?? []).map((f) => ({
    food_id: f.id,
    external: f.external_id ? { source: f.source, id: f.external_id } : null,
    name: (locale === "ro" ? f.name_ro : f.name_en) ?? f.name_en ?? f.name_ro,
    brand: f.brand,
    per_100g: { kcal: +f.kcal_100g, protein: +f.protein_100g, carbs: +f.carbs_100g, fat: +f.fat_100g },
    verified: f.verified,
  }));

  // 2) top up from Open Food Facts if the cache is thin
  if (results.length < 10) {
    try {
      const products = await fetchOffProducts(q);
      const seen = new Set(results.map((r) => r.external?.id));

      for (const p of products) {
        const n = p.nutriments ?? {};
        const kcal = n["energy-kcal_100g"];
        const code = p.code == null ? "" : String(p.code);
        const name = typeof p.product_name === "string" ? p.product_name.trim() : "";
        if (!name || !code || kcal == null || seen.has(code)) continue;

        const row = {
          source: "off",
          external_id: code,
          barcode: code,
          name_en: name,
          brand: firstBrand(p.brands),
          kcal_100g: round2(kcal),
          protein_100g: round2(n.proteins_100g ?? 0),
          carbs_100g: round2(n.carbohydrates_100g ?? 0),
          fat_100g: round2(n.fat_100g ?? 0),
          portions: portionsFromOff(p),
        };
        // cache for next time; ignore conflicts from concurrent searches
        const { data: cached } = await supabase
          .from("foods")
          .upsert(row, { onConflict: "source,external_id", ignoreDuplicates: false })
          .select("id")
          .single();

        results.push({
          food_id: cached?.id ?? null,
          external: { source: "off", id: code },
          name,
          brand: row.brand,
          per_100g: { kcal: row.kcal_100g, protein: row.protein_100g, carbs: row.carbs_100g, fat: row.fat_100g },
          verified: false,
        });
        if (results.length >= 20) break;
      }
    } catch (_e) {
      // OFF unreachable → degrade gracefully to local-only results
    }
  }

  return json({ results });
});

// The subset of an Open Food Facts product this function reads. Both search
// APIs return it, with one difference: `brands` is a comma-joined string from
// the legacy CGI and an array from Search-a-licious.
type OffProduct = {
  code?: unknown;
  product_name?: unknown;
  brands?: unknown;
  nutriments?: Record<string, unknown>;
  serving_size?: unknown;
  serving_quantity?: unknown;
  product_quantity?: unknown;
  categories_tags?: unknown;
};

const OFF_FIELDS =
  "code,product_name,brands,nutriments,serving_size,serving_quantity,product_quantity,categories_tags";

/**
 * Open Food Facts has two search APIs. Search-a-licious
 * (search.openfoodfacts.org) is the supported one: sub-second and not
 * throttled per IP. The legacy CGI `search.pl` answers 503 after a handful of
 * requests a minute from one address — and every instance of this function
 * shares one — which is how the food list came to be empty in production. It
 * stays as a fallback only, for the day the newer service is down.
 *
 * Never throws; the caller treats an empty array as "OFF had nothing".
 */
async function fetchOffProducts(q: string): Promise<OffProduct[]> {
  const init = { headers: { "User-Agent": OFF_USER_AGENT }, signal: AbortSignal.timeout(5000) };

  try {
    const res = await fetch(
      `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=15&fields=${OFF_FIELDS}`,
      init,
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.hits) && data.hits.length > 0) return data.hits as OffProduct[];
    }
  } catch (_e) {
    // fall through to the legacy endpoint
  }

  try {
    const res = await fetch(
      "https://world.openfoodfacts.org/cgi/search.pl?action=process&json=1&search_simple=1" +
        `&page_size=15&search_terms=${encodeURIComponent(q)}&fields=${OFF_FIELDS}`,
      init,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.products) ? (data.products as OffProduct[]) : [];
  } catch (_e) {
    return [];
  }
}

function firstBrand(brands: unknown): string | null {
  const first = Array.isArray(brands) ? brands[0] : typeof brands === "string" ? brands.split(",")[0] : null;
  const clean = typeof first === "string" ? first.trim() : "";
  return clean || null;
}

function round2(v: unknown): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
