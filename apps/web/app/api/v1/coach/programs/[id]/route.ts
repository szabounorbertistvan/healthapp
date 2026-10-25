import type { CoachProgramV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { builderProgram } from "@/lib/api/builder";
import { canEdit } from "@/lib/can-edit";
import { getProgram, getProgramActivation } from "@/lib/data";

// One of the coach's programs — the web's /programs/[id]: the structure, which
// of the client's programs is followed, and can_edit_program() (read-only once
// the coaching ended or is paused). Writes go through /api/v1/builder.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const [program, activation, access] = await Promise.all([getProgram(id), getProgramActivation(id), canEdit("can_edit_program", { p_program: id })]);
  if (!program) return apiError("not_found", 404);
  return apiJson<CoachProgramV1>({
    ...builderProgram(program, activation),
    client_name: program.client_name,
    can_edit: access === "edit" ? true : access === "read-only" ? false : null,
  });
});
