import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GoalDashboard } from "@/lib/goals-data";
import { dict, renderWithApp } from "@/test/render";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const createGoal = vi.fn();
vi.mock("@/app/goal-actions", () => ({
  createGoal: (...args: unknown[]) => createGoal(...args),
  closeGoal: vi.fn(),
  deleteGoal: vi.fn(),
  updateGoal: vi.fn(),
}));

// Imported after the mocks so the component binds to them.
const { GoalsPanel } = await import("./goals");

const g = dict("en").clientApp.goals;

function dashboard(over: Partial<GoalDashboard> = {}): GoalDashboard {
  return {
    today: "2026-10-15",
    mainGoal: null,
    active: [],
    closed: [],
    current: {
      body_weight: { value: 82.4, missing: null },
      weekly_workouts: { value: null, missing: "no_workouts" },
      consistency: { value: null, missing: "too_little_history" },
      kcal_on_target: { value: null, missing: "no_kcal_target" },
      protein_avg: { value: null, missing: "too_few_logged_days" },
      circumference: {},
    },
    exercises: [{ id: "ex-bench", name: "Bench press", current: 90 }],
    kcalTarget: null,
    ...over,
  };
}

const target = (unit: string) => screen.getByLabelText(`${g.target} (${unit})`);
const start = (unit: string) => screen.getByLabelText(new RegExp(`^${g.start} \\(${unit}\\)`));
const submit = () => screen.getByRole("button", { name: g.create });

describe("GoalsPanel — new goal form", () => {
  beforeEach(() => {
    createGoal.mockReset();
    refresh.mockReset();
  });

  it("opens on the form when there is no active goal, with the start prefilled from the latest weigh-in", () => {
    renderWithApp(<GoalsPanel dashboard={dashboard()} />);
    expect(screen.getByRole("button", { name: g.metric.body_weight })).toHaveAttribute("aria-pressed", "true");
    expect(start("kg")).toHaveValue("82.4");
    expect(screen.getByText(g.metricHint.body_weight)).toBeInTheDocument();
    // nothing to go back to, so no Cancel
    expect(screen.queryByRole("button", { name: g.cancel })).toBeNull();
  });

  it("refuses an empty target without calling the server", async () => {
    const user = userEvent.setup();
    renderWithApp(<GoalsPanel dashboard={dashboard()} />);
    await user.click(submit());
    expect(screen.getByText(g.targetRequired)).toBeInTheDocument();
    expect(target("kg")).toHaveAttribute("aria-invalid", "true");
    expect(createGoal).not.toHaveBeenCalled();
  });

  it("shows and accepts pounds, and sends kilograms", async () => {
    createGoal.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderWithApp(<GoalsPanel dashboard={dashboard()} />, { weight: "lb" });
    expect(start("lb")).toHaveValue("181.7");
    await user.type(target("lb"), "170,5"); // a Romanian keyboard's decimal comma
    await user.click(submit());
    expect(createGoal).toHaveBeenCalledTimes(1);
    const input = createGoal.mock.calls[0]![0];
    expect(input).toMatchObject({ metric: "body_weight", direction: "decrease", exerciseId: null, measureKey: null, title: null, targetDate: null });
    expect(input.targetValue).toBeCloseTo(77.34, 2);
    expect(input.startValue).toBeCloseTo(82.42, 1);
  });

  it("switches metric: a lift goal follows the first exercise, only goes up and drops the old direction", async () => {
    createGoal.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderWithApp(<GoalsPanel dashboard={dashboard()} />);
    expect(screen.getByRole("button", { name: g.decrease })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: g.metric.lift_weight }));
    expect(screen.queryByRole("button", { name: g.decrease })).toBeNull();
    expect(screen.getByLabelText(g.exercise)).toHaveValue("ex-bench");
    expect(start("kg")).toHaveValue("90");

    await user.type(target("kg"), "100");
    await user.click(submit());
    expect(createGoal.mock.calls[0]![0]).toMatchObject({ metric: "lift_weight", direction: "increase", exerciseId: "ex-bench", targetValue: 100, startValue: 90 });
  });

  it("blocks a goal the person has no data for", async () => {
    const user = userEvent.setup();
    renderWithApp(<GoalsPanel dashboard={dashboard({ exercises: [] })} />);
    await user.click(screen.getByRole("button", { name: g.metric.lift_weight }));
    expect(screen.getByText(g.noLifts)).toBeInTheDocument();
    expect(submit()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: g.metric.kcal_on_target }));
    expect(screen.getByText(g.noKcalTarget)).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });

  it("keeps the form and shows the server's refusal", async () => {
    createGoal.mockResolvedValue({ ok: false, message: "The target is already where you are." });
    const user = userEvent.setup();
    renderWithApp(<GoalsPanel dashboard={dashboard()} />);
    await user.type(target("kg"), "82.4");
    await user.click(submit());
    expect(await screen.findByText("The target is already where you are.")).toBeInTheDocument();
    expect(submit()).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says the server did not answer instead of crashing when the action rejects", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    createGoal.mockRejectedValue(new Error("fetch failed"));
    const user = userEvent.setup();
    renderWithApp(<GoalsPanel dashboard={dashboard()} />);
    await user.type(target("kg"), "78");
    await user.click(submit());
    expect(await screen.findByText(dict("en").common.actions.unreachable)).toBeInTheDocument();
    quiet.mockRestore();
  });

  it("closes the form and refreshes after a goal is created", async () => {
    createGoal.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderWithApp(<GoalsPanel dashboard={dashboard()} />);
    await user.type(target("kg"), "78");
    await user.click(submit());
    expect(await screen.findByRole("button", { name: g.newGoal })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: g.create })).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
