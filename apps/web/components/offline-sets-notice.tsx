"use client";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useOfflineSets } from "@/lib/offline/sync";
import { formatSetDuration, kgToDisplay } from "@healthapp/shared";
import { useUnits } from "@/lib/units/client";

/**
 * Above every (client) screen while sets wait in the offline outbox: how many
 * are only on this phone, and — the one case that needs the person — any the
 * server refused when they were replayed, with its reason.
 */
export function OfflineSetsNotice() {
  const { t } = useI18n();
  const u = useUnits();
  const m = t.clientWidgets.setLogger;
  const { queued, dismissFailed } = useOfflineSets();
  const waiting = queued.filter((item) => !item.error).length;
  const failed = queued.filter((item) => item.error);
  if (waiting === 0 && failed.length === 0) return null;
  return (
    <div className="mb-4 space-y-2" role="status">
      {waiting > 0 ? (
        <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] text-ink-soft">
          {waiting === 1 ? m.pendingSyncOne : fill(m.pendingSync, { count: waiting })}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <div className="space-y-2 rounded-2xl bg-risk-soft px-4 py-3">
          {failed.map((item) => (
            <p key={item.id} className="text-[13px] font-semibold text-risk">
              {fill(m.syncFailed, {
                set: `${item.input.exerciseName} · ${
                  item.input.durationSeconds
                    ? formatSetDuration(item.input.durationSeconds)
                    : `${kgToDisplay(item.input.weightKg, u.weightUnit)} ${u.weightUnit} × ${item.input.reps}`
                }`,
                message: item.error || m.couldNotLogSet,
              })}
            </p>
          ))}
          <button type="button" onClick={() => void dismissFailed()} className="text-[12.5px] font-semibold text-ink-soft hover:text-ink">
            {m.dismiss}
          </button>
        </div>
      ) : null}
    </div>
  );
}
