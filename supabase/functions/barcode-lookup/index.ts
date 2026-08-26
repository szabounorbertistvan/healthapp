// BuddyGym · barcode-lookup edge function
// Cache first, then Open Food Facts product API (free). 404 → client offers
// search / custom food (spec C3: never a dead end).
// GET /functions/v1/barcode-lookup?code=5941234567890
import { createClient } from "jsr:@supabase/supabase-js@2";
import { portionsFromOff } from "../_shared/portions.ts";

const OFF_USER_AGENT = "BuddyGym/0.1 (relu.plesciuc@sfappworks.com)";

Deno.serve(async (req) => {
  // Accepts ?code= (the documented GET form) or {"code":"..."} in a POST body,
  // which is what supabase-js invoke() sends — it has no query-param option.
  let code = (new URL(req.url).searchParams.get("code") ?? "").trim();
  if (!code && req.method === "POST") {
    try {
      const body = await req.json();
      code = String(body?.code ?? "").trim();
    } catch {
      // no body, fall through to the validation below
    }
  }
  if (!/^\d{6,14}$/.test(code)) return json({ error: "invalid_barcode" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !userData.user) return json({ error: "unauthorized" }, 401);

  // 1) cache
  const { data: cached } = await supabase
    .from("foods")
    .select("id, source, external_id, name_en, name_ro, brand, kcal_100g, protein_100g, carbs_100g, fat_100g, verified, portions")
    .eq("barcode", code)
    .limit(1)
    .maybeSingle();
  if (cached) return json({ food: shape(cached) });

  // 2) Open Food Facts v2 product API
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json` +
        "?fields=code,product_name,brands,nutriments,serving_size,serving_quantity,product_quantity,categories_tags",
      { headers: { "User-Agent": OFF_USER_AGENT }, signal: AbortSignal.timeout(5000) },
    );
    if (res.status === 404) return json({ error: "not_found" }, 404);
    const data = await res.json();
    const p = data.product;
    const kcal = p?.nutriments?.["energy-kcal_100g"];
    if (data.status !== 1 || !p?.product_name || kcal == null) {
      return json({ error: "not_found" }, 404);
    }

    const row = {
      source: "off",
      external_id: String(p.code),
      barcode: String(p.code),
      name_en: p.product_name,
      brand: p.brands?.split(",")[0]?.trim() ?? null,
      kcal_100g: round2(kcal),
      protein_100g: round2(p.nutriments.proteins_100g ?? 0),
      carbs_100g: round2(p.nutriments.carbohydrates_100g ?? 0),
      fat_100g: round2(p.nutriments.fat_100g ?? 0),
      portions: portionsFromOff(p),
    };
    const { data: inserted } = await supabase
      .from("foods")
      .upsert(row, { onConflict: "source,external_id" })
      .select("id, source, external_id, name_en, name_ro, brand, kcal_100g, protein_100g, carbs_100g, fat_100g, verified, portions")
      .single();

    return json({ food: shape(inserted!) });
  } catch (_e) {
    return json({ error: "upstream_unavailable" }, 503);
  }
});

// deno-lint-ignore no-explicit-any
function shape(f: any) {
  return {
    food_id: f.id,
    external: f.external_id ? { source: f.source, id: f.external_id } : null,
    name: f.name_ro ?? f.name_en,
    brand: f.brand,
    per_100g: { kcal: +f.kcal_100g, protein: +f.protein_100g, carbs: +f.carbs_100g, fat: +f.fat_100g },
    verified: f.verified,
    portions: f.portions ?? [],
  };
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
