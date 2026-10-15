import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exerciseStats, repRecords, type ExerciseSessionEntry } from "@healthapp/shared";
import { ExerciseAnalytics } from "./exercise-analytics";
import { dict, renderWithApp } from "@/test/render";

const d = dict("en").clientApp.exerciseDetail;
const TODAY = "2026-10-15";

/** One working set per session; newest first, the order the data layer hands down. */
function session(id: string, day: string, weight_kg: number, reps: number): ExerciseSessionEntry {
  return {
    session_id: id,
    at: `${day}T08:00:00.000Z`,
    day,
    name: "Push day",
    sets: [{ set_index: 0, weight_kg, reps, rpe: null, rir: null, is_pr: false }],
    volume_kg: weight_kg * reps,
    top_weight_kg: weight_kg,
    top_reps: reps,
    best_1rm: weight_kg > 0 ? weight_kg * (1 + reps / 30) : null,
  };
}

const sessions = [
  session("s3", "2026-10-12", 100, 5), // 3 days ago
  session("s2", "2026-08-31", 95, 5), // 45 days ago
  session("s1", "2026-03-29", 80, 5), // 200 days ago
];

function mount(list: ExerciseSessionEntry[] = sessions, initialRange: 7 | 30 | 90 | 365 | null = 30) {
  return renderWithApp(
    <ExerciseAnalytics
      sessions={list}
      stats={exerciseStats(list)}
      records={repRecords(list)}
      initialRange={initialRange}
      todayIso={TODAY}
      timeZone="UTC"
      truncated={false}
    />,
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });
/** The three load charts (weight, volume, 1RM), each a card titled by its <p>. */
const chart = (title: string) => screen.getByText(title).parentElement as HTMLElement;

describe("ExerciseAnalytics — range switching", () => {
  it("opens on the given range, which holds one session: a figure, not a line", () => {
    mount();
    expect(tab("30d")).toHaveAttribute("aria-selected", "true");
    expect(tab("90d")).toHaveAttribute("aria-selected", "false");
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(within(chart(d.chartWeight)).getByText(/One session so far/)).toBeInTheDocument();
    expect(within(chart(d.chartWeight)).getByText("100")).toBeInTheDocument();
  });

  it("draws a line once the window holds two sessions, and every point in All", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(tab("90d"));
    expect(tab("90d")).toHaveAttribute("aria-selected", "true");
    expect(tab("30d")).toHaveAttribute("aria-selected", "false");
    expect(within(chart(d.chartWeight)).getByRole("img")).toHaveAccessibleName("2 · 95 → 100 kg");
    expect(within(chart(d.chartWeight)).getByText("+5 kg")).toBeInTheDocument();

    await user.click(tab(d.rangeAll));
    expect(within(chart(d.chartWeight)).getByRole("img")).toHaveAccessibleName("3 · 80 → 100 kg");
    expect(within(chart(d.chartVolume)).getByRole("img")).toHaveAccessibleName("3 · 400 → 500 kg");
  });

  it("shows the empty message for a window with no sessions", async () => {
    const user = userEvent.setup();
    mount([sessions[1]!, sessions[2]!], null);
    await user.click(tab("7d"));
    expect(within(chart(d.chartWeight)).getByText(d.noneInRange)).toBeInTheDocument();
    expect(within(chart(d.chart1rm)).getByText(d.noneInRange)).toBeInTheDocument();
    // the history below the charts is the whole list, whatever the range
    expect(screen.getAllByText("Push day")).toHaveLength(2);
  });

  it("converts the plotted loads to the reader's unit", async () => {
    const user = userEvent.setup();
    renderWithApp(
      <ExerciseAnalytics sessions={sessions} stats={exerciseStats(sessions)} records={[]} initialRange={null}
        todayIso={TODAY} timeZone="UTC" truncated={false} />,
      { weight: "lb" },
    );
    expect(tab(d.rangeAll)).toHaveAttribute("aria-selected", "true");
    expect(within(chart(d.chartWeight)).getByRole("img").getAttribute("aria-label")).toMatch(/^3 · 176\.4 → 220\.5 lb$/);
    await user.click(tab("30d"));
    expect(within(chart(d.chartWeight)).getByText("220.5")).toBeInTheDocument();
  });

  it("shows only reps for a lift never loaded", () => {
    const bodyweight = [session("b2", "2026-10-12", 0, 15), session("b1", "2026-10-05", 0, 12)];
    mount(bodyweight);
    expect(screen.queryByText(d.chartWeight)).toBeNull();
    expect(screen.getByRole("img")).toHaveAccessibleName(`2 · 12 → 15 ${d.repsUnit}`);
  });
});
