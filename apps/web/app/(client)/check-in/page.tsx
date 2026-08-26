import { getMyCheckInState } from "@/lib/client-data";
import { Card, PageTitle } from "@/components/ui";
import { CheckInForm } from "@/components/check-in-form";

export default async function CheckInPage() {
  const state = await getMyCheckInState();

  return (
    <div className="space-y-4">
      <PageTitle title="Weekly check-in">
        <span className="text-xs text-ink-faint">week of {state.week_start}</span>
      </PageTitle>

      {state.submitted ? (
        <Card>
          <p className="font-semibold">Check-in submitted</p>
          <p className="mt-1 text-sm text-ink-soft">
            Your coach reviews it and replies with feedback. Come back next Monday.
          </p>
        </Card>
      ) : (
        <CheckInForm />
      )}

      {state.last ? (
        <Card>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Last check-in · week of {state.last.week_start}
          </p>
          {state.last.weight_kg !== null ? (
            <p className="text-sm">
              Weight <b className="tabular-nums">{state.last.weight_kg} kg</b>
            </p>
          ) : null}
          {state.last.note ? (
            <p className="mt-1 text-sm italic text-ink-soft">{state.last.note}</p>
          ) : null}
          {state.last.coach_feedback ? (
            <div className="mt-3 rounded-lg bg-accent-soft p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
                Coach feedback
              </p>
              <p className="mt-1 text-sm leading-snug text-ink-soft">{state.last.coach_feedback}</p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-faint">
              {state.last.reviewed ? "Reviewed by your coach." : "Waiting on your coach to review."}
            </p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
