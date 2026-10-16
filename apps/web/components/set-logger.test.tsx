// The set logger when the request dies on the way. Production's app_errors
// holds five rows from 28.09 (/workout/<id>/log: Safari's "Load failed" and
// Next's "An unexpected response was received from the server."): the build
// live then awaited logSet / finishWorkout inside startTransition with no
// catch, so a dropped connection threw into the error boundary. f8227b8 (01.10)
// sends such a set to the offline outbox and answers a failed finish in place;
// these tests hold that line.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { normalizeRestPrefs } from "@healthapp/shared";
import { dict, renderWithApp } from "@/test/render";
import type { ClientWorkoutDay } from "@/lib/types";

const logSet = vi.fn();
const finishWorkout = vi.fn();
vi.mock("@/app/client-actions-app", () => ({
  logSet: (...a: unknown[]) => logSet(...a),
  finishWorkout: (...a: unknown[]) => finishWorkout(...a),
}));
// Server actions of the children (video picker, rest settings): never reached here.
vi.mock("@/app/library-actions", () => ({ setExerciseVideo: vi.fn() }));
vi.mock("@/app/rest-actions", () => ({ removePushSubscription: vi.fn(), savePushSubscription: vi.fn(), saveRestPrefs: vi.fn() }));
const queue = vi.fn();
const flush = vi.fn(async () => []);
vi.mock("@/lib/offline/sync", () => ({
  useOfflineSets: () => ({ queued: [], queue, flush, dismissFailed: vi.fn() }),
}));
vi.mock("@/lib/rest-timer/client", () => ({
  useRestTimer: () => ({
    timer: null, remaining: 0, prefs: normalizeRestPrefs(null),
    start: vi.fn(), pause: vi.fn(), resume: vi.fn(), extend: vi.fn(), skip: vi.fn(), dismiss: vi.fn(), clear: vi.fn(),
  }),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { SetLogger } from "./set-logger";

const day: ClientWorkoutDay = {
  day_id: "d1", day_name: "Push", program_id: "p1", program_name: "Block", is_own: true,
  intensity_mode: "simple", type: null, logged: [], session_id: null, completed: false,
  exercises: [{
    id: "pe1", exercise_id: "e1", exercise: "Bench press", sets: 3, reps: "8", weight: "60 kg", rpe: "", rest: "",
    weight_kg: 60, rpe_value: null, rest_seconds: null, position: 0, circuit: null,
  }],
};

describe("SetLogger — a request that never answers", () => {
  beforeEach(() => {
    logSet.mockReset(); finishWorkout.mockReset(); queue.mockReset(); refresh.mockReset();
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("keeps a set whose request died on the phone instead of throwing", async () => {
    logSet.mockRejectedValue(new TypeError("Load failed"));
    queue.mockResolvedValue({ id: "q1" });
    renderWithApp(<SetLogger day={day} />);
    fireEvent.click(screen.getByRole("button", { name: dict().clientWidgets.setLogger.logSet }));
    expect(await screen.findByText(dict().clientWidgets.setLogger.savedOnPhone)).toBeInTheDocument();
    expect(queue).toHaveBeenCalledTimes(1);
    expect(queue.mock.calls[0][0]).toBe("d1");
    // Offline, a refresh would fall into a full page load (and the offline page).
    expect(refresh).not.toHaveBeenCalled();
  });

  it("still shows a refusal from the server as final, without queueing", async () => {
    logSet.mockResolvedValue({ ok: false, message: "Weight is out of range" });
    renderWithApp(<SetLogger day={day} />);
    fireEvent.click(screen.getByRole("button", { name: dict().clientWidgets.setLogger.logSet }));
    expect(await screen.findByText("Weight is out of range")).toBeInTheDocument();
    expect(queue).not.toHaveBeenCalled();
  });

  it("answers a finish whose request died in place", async () => {
    finishWorkout.mockRejectedValue(new Error("An unexpected response was received from the server."));
    renderWithApp(<SetLogger day={{ ...day, logged: [{
      id: "s1", program_exercise_id: "pe1", exercise_id: "e1", exercise: "Bench press", set_index: 1,
      weight_kg: 60, reps: 8, duration_seconds: null, rpe: null, rir: null, notes: null, is_pr: false, at: "2026-10-16T08:00:00Z",
    }] }} />);
    fireEvent.click(screen.getByRole("button", { name: dict().clientWidgets.setLogger.finishWorkout }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(dict().clientWidgets.setLogger.finishNeedsSync));
  });
});
