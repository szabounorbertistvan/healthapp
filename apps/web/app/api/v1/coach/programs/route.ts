import type { CoachProgramsV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getPrograms, getRoster } from "@/lib/data";

// The coach's programs — the web's /programs, and /programs/new's client list.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [programs, roster] = await Promise.all([getPrograms(), getRoster()]);
  return apiJson<CoachProgramsV1>({ programs, roster });
});
