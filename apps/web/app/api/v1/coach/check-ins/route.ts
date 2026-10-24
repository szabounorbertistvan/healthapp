import type { CoachCheckInV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getCheckIns } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";

// The check-ins waiting for this coach's review, oldest first — the web's /check-ins.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [{ t }, rows] = await Promise.all([getI18n(), getCheckIns()]);
  const yesNo = (v: boolean) => (v ? t.clientWidgets.checkInForm.yes : t.clientWidgets.checkInForm.no);
  return apiJson<CoachCheckInV1[]>(
    rows.map((c) => ({
      id: c.id,
      client_id: c.client_id,
      name: c.full_name,
      week_start: c.week_start,
      submitted_at: c.submitted_at,
      weight_kg: c.weight_kg,
      scores: { sleep: c.sleep, energy: c.energy, stress: c.stress, hunger: c.hunger, recovery: c.recovery },
      previous: c.previous,
      note: c.note,
      answers: c.answers.map((a) => ({
        prompt: a.prompt,
        value: a.value_text ?? (a.value_bool !== null ? yesNo(a.value_bool) : a.value_num !== null ? String(a.value_num) : ""),
      })),
    })),
  );
});
