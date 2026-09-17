import { kgToDisplay } from "@healthapp/shared";
import { getMyCheckInState } from "@/lib/client-data";
import { getProfile } from "@/lib/data";
import { Card } from "@/components/ui";
import { CheckInForm } from "@/components/check-in-form";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";

/**
 * The weekly check-in: one readable column — the form (or the "already sent"
 * note), then last week's answers with the coach's reply underneath in the
 * accent block Today uses for the same voice.
 */
export default async function CheckInPage() {
  const [{ t }, state, profile] = await Promise.all([
    getI18n(),
    getMyCheckInState(),
    getProfile(),
  ]);
  const weightUnit = profile?.weight_unit ?? "kg";

  return (
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
          {t.clientApp.checkIn.title}
        </h1>
        <span className="text-[12.5px] tabular-nums text-ink-faint">
          {fill(t.clientApp.checkIn.weekOf, { date: state.week_start })}
        </span>
      </header>

      <div className="mt-5 space-y-4 sm:mt-6">
        {state.submitted ? (
          <Card plain>
            <p className="font-display text-lg font-bold tracking-tight">{t.clientApp.checkIn.submittedTitle}</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{t.clientApp.checkIn.submittedBody}</p>
          </Card>
        ) : (
          <CheckInForm />
        )}

        {state.last ? (
          <>
            <Card plain>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {fill(t.clientApp.checkIn.lastCheckIn, { date: state.last.week_start })}
              </p>
              {state.last.weight_kg !== null ? (
                <p className="mt-2 text-sm text-ink-soft">
                  {t.clientApp.checkIn.weightLabel}{" "}
                  <b className="font-semibold tabular-nums text-ink">
                    {kgToDisplay(state.last.weight_kg, weightUnit)} {weightUnit}
                  </b>
                </p>
              ) : null}
              {state.last.note ? (
                <p className="mt-2 text-[13.5px] italic leading-relaxed text-ink-soft">{state.last.note}</p>
              ) : null}
              {state.last.coach_feedback ? null : (
                <p className="mt-3 text-[12.5px] text-ink-faint">
                  {state.last.reviewed
                    ? t.clientApp.checkIn.reviewed
                    : t.clientApp.checkIn.waitingReview}
                </p>
              )}
            </Card>

            {state.last.coach_feedback ? (
              <div className="rounded-3xl bg-accent-soft px-5 py-[18px]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
                  {t.clientApp.checkIn.coachFeedback}
                </p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{state.last.coach_feedback}</p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
