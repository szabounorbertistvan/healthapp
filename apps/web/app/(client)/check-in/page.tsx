import { getMyCheckInState } from "@/lib/client-data";
import { Card, PageTitle } from "@/components/ui";
import { CheckInForm } from "@/components/check-in-form";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";

export default async function CheckInPage() {
  const { t } = await getI18n();
  const state = await getMyCheckInState();

  return (
    <div className="space-y-4">
      <PageTitle title={t.clientApp.checkIn.title}>
        <span className="text-xs text-ink-faint">
          {fill(t.clientApp.checkIn.weekOf, { date: state.week_start })}
        </span>
      </PageTitle>

      {state.submitted ? (
        <Card>
          <p className="font-semibold">{t.clientApp.checkIn.submittedTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.clientApp.checkIn.submittedBody}</p>
        </Card>
      ) : (
        <CheckInForm />
      )}

      {state.last ? (
        <Card>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {fill(t.clientApp.checkIn.lastCheckIn, { date: state.last.week_start })}
          </p>
          {state.last.weight_kg !== null ? (
            <p className="text-sm">
              {t.clientApp.checkIn.weightLabel}{" "}
              <b className="tabular-nums">{state.last.weight_kg} kg</b>
            </p>
          ) : null}
          {state.last.note ? (
            <p className="mt-1 text-sm italic text-ink-soft">{state.last.note}</p>
          ) : null}
          {state.last.coach_feedback ? (
            <div className="mt-3 rounded-lg bg-accent-soft p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
                {t.clientApp.checkIn.coachFeedback}
              </p>
              <p className="mt-1 text-sm leading-snug text-ink-soft">{state.last.coach_feedback}</p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-faint">
              {state.last.reviewed
                ? t.clientApp.checkIn.reviewed
                : t.clientApp.checkIn.waitingReview}
            </p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
