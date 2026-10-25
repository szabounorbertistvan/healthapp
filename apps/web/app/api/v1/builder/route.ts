import type { BuilderV1, WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { builderProgram } from "@/lib/api/builder";
import { getProgram, getProgramActivation } from "@/lib/data";
import { hasActiveCoach } from "@/lib/client-data";
import {
  activateProgram,
  createProgram,
  addProgramExercise,
  addSoloProgramDay,
  createSoloProgram,
  deleteProgram,
  duplicateProgramDay,
  duplicateProgramExercise,
  getMySoloPrograms,
  moveProgramDay,
  moveProgramExercise,
  publishProgram,
  removeProgramDay,
  removeProgramExercise,
  renameProgramDay,
  setProgramExerciseMeasure,
  setProgramExerciseNotes,
  updateProgramExercise,
} from "@/app/builder-actions";

// The client's own program builder — the web's /workout/build on a phone. GET is
// what that page reads (coached? → nothing to build; else the own programs and
// the one open); POST runs one of the same builder actions, named by `op`. The
// actions validate their own input and the policies decide who may write.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  if (await hasActiveCoach()) return apiJson<BuilderV1>({ coached: true, programs: [], open: null });
  const programs = await getMySoloPrograms();
  const wanted = new URL(request.url).searchParams.get("program");
  const openId = programs.find((p) => p.id === wanted)?.id ?? programs[0]?.id ?? null;
  const [program, activation] = openId ? await Promise.all([getProgram(openId), getProgramActivation(openId)]) : [null, null];
  return apiJson<BuilderV1>({
    coached: false,
    programs,
    open: program && builderProgram(program, activation),
  });
});

type Body = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const dir = (v: unknown): -1 | 1 => (v === -1 ? -1 : 1);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Body | null;
  if (!b || typeof b.op !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid request" }, 400);
  const program = str(b.programId);
  let result: { ok: boolean; message?: string; id?: string };
  switch (b.op) {
    case "create":
      // Every solo program is RIR, as the web's create form makes it.
      result = await createSoloProgram({ name: str(b.name), intensityMode: "rir" });
      break;
    case "createForClient":
      // The coach's new program for one of their clients (programs_coach_all decides).
      result = await createProgram({
        name: str(b.name),
        clientId: str(b.clientId),
        clientName: str(b.clientName),
        weeks: typeof b.weeks === "number" ? b.weeks : 1,
        intensityMode: b.intensityMode === "rpe" || b.intensityMode === "simple" ? b.intensityMode : "rir",
      });
      break;
    case "addDay":
      result = await addSoloProgramDay(program, str(b.name), Array.isArray(b.muscleGroups) ? b.muscleGroups.filter((g): g is string => typeof g === "string") : []);
      break;
    case "renameDay":
      result = await renameProgramDay(program, str(b.dayId), str(b.name));
      break;
    case "moveDay":
      result = await moveProgramDay(program, str(b.dayId), dir(b.direction));
      break;
    case "duplicateDay":
      result = await duplicateProgramDay(program, str(b.dayId));
      break;
    case "removeDay":
      result = await removeProgramDay(program, str(b.dayId));
      break;
    case "addExercise":
      result = await addProgramExercise({ programId: program, dayId: str(b.dayId), exerciseId: str(b.exerciseId), exerciseName: str(b.exerciseName) });
      break;
    case "updateExercise":
      result = await updateProgramExercise({
        programId: program,
        exerciseRowId: str(b.rowId),
        target_sets: typeof b.sets === "number" ? b.sets : NaN,
        target_reps: str(b.reps),
        target_weight_kg: numOrNull(b.weightKg),
        target_rpe: numOrNull(b.rpe),
        rest_seconds: numOrNull(b.restSeconds),
      });
      break;
    case "moveExercise":
      result = await moveProgramExercise(program, str(b.dayId), str(b.rowId), dir(b.direction));
      break;
    case "duplicateExercise":
      result = await duplicateProgramExercise(program, str(b.rowId));
      break;
    case "removeExercise":
      result = await removeProgramExercise(program, str(b.rowId));
      break;
    case "measure":
      result = await setProgramExerciseMeasure(program, str(b.rowId), str(b.measure));
      break;
    case "notes":
      result = await setProgramExerciseNotes(program, str(b.rowId), str(b.notes));
      break;
    case "publish":
      result = await publishProgram(program);
      break;
    case "activate":
      result = await activateProgram(program);
      break;
    case "delete":
      result = await deleteProgram(program);
      break;
    default:
      return apiJson<WriteResultV1>({ ok: false, message: "unknown op" }, 400);
  }
  return apiJson<WriteResultV1 & { id?: string }>({ ok: result.ok, message: result.message, id: result.id });
});
