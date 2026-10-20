"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { bulkClientAction } from "@/app/bulk-actions";
import { settle } from "@/lib/settle-action";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { FIELD } from "@/lib/form-classes";
import { Chip } from "./ui";
import type { Signal } from "@/lib/types";

type Client = { id: string; name: string; signal: Signal };
type Program = { id: string; name: string; client: string };
type Kind = "message" | "habit" | "program";

// 0 = Sunday, the habits table's convention; shown Monday first
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * The same action for several clients at once (/clients): a message, a habit,
 * or a copy of a program. Pick the clients (all, or the ones who need you),
 * pick what to do, send. Each client is written separately on the server, so
 * the answer says how many it worked for.
 */
export function BulkActions({ clients, programs, canCopyPrograms }: { clients: Client[]; programs: Program[]; canCopyPrograms: boolean }) {
  const { t } = useI18n();
  const m = t.coachApp.clients.bulk;
  const [open, setOpen] = useState(false);
  if (clients.length < 2) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-full bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink">
        {m.button}
      </button>
      {open ? <BulkDialog clients={clients} programs={programs} canCopyPrograms={canCopyPrograms} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function BulkDialog({ clients, programs, canCopyPrograms, onClose }: {
  clients: Client[]; programs: Program[]; canCopyPrograms: boolean; onClose: () => void;
}) {
  const { t } = useI18n();
  const m = t.coachApp.clients.bulk;
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<Kind>("message");
  const [body, setBody] = useState("");
  const [habit, setHabit] = useState("");
  const [days, setDays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);
  const needYou = useMemo(() => clients.filter((c) => c.signal !== "on_track").map((c) => c.id), [clients]);

  function toggle(id: string) {
    setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    setStatus(null);
  }

  function send() {
    const clientIds = [...picked];
    if (clientIds.length === 0) { setStatus({ ok: false, text: m.pickClients }); return; }
    if (kind === "message" && !body.trim()) { setStatus({ ok: false, text: m.messageRequired }); return; }
    if (kind === "habit" && (!habit.trim() || days.size === 0)) { setStatus({ ok: false, text: m.habitRequired }); return; }
    if (kind === "program" && !programId) { setStatus({ ok: false, text: m.programRequired }); return; }
    setStatus(null);
    start(async () => {
      const input: Parameters<typeof bulkClientAction>[0] =
        kind === "message" ? { kind: "message", clientIds, body: body.trim() }
        : kind === "habit" ? { kind: "habit", clientIds, name: habit.trim(), weekdays: [...days] }
        : { kind: "program", clientIds, programId };
      const res = await settle(() => bulkClientAction(input), t.common.actions.unreachable);
      const doneN = "done" in res && typeof res.done === "number" ? res.done : 0;
      const failedN = "failed" in res && typeof res.failed === "number" ? res.failed : clientIds.length - doneN;
      if (!res.ok && doneN === 0) {
        setStatus({ ok: false, text: res.errorCode === "UPGRADE_REQUIRED" ? m.upgrade : m.failed });
        return;
      }
      setStatus({ ok: failedN === 0, text: failedN === 0 ? fill(m.doneAll, { n: doneN }) : fill(m.donePart, { n: doneN, failed: failedN }) });
      if (kind === "message") setBody("");
      router.refresh();
    });
  }

  const kinds: { k: Kind; label: string }[] = [
    { k: "message", label: m.kindMessage },
    { k: "habit", label: m.kindHabit },
    ...(canCopyPrograms && programs.length > 0 ? [{ k: "program" as const, label: m.kindProgram }] : []),
  ];

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <Dialog.Popup initialFocus={closeRef}
            className="flex max-h-[100dvh] w-full max-w-xl flex-col overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 outline-none sm:max-h-[92vh] sm:rounded-2xl sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Dialog.Title className="font-display text-lg font-bold tracking-tight">{m.title}</Dialog.Title>
                <p className="mt-1 text-[12.5px] text-ink-soft">{m.lead}</p>
              </div>
              <Dialog.Close ref={closeRef} aria-label={m.close}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft hover:border-accent hover:text-ink">✕</Dialog.Close>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{fill(m.picked, { n: picked.size })}</span>
              <button type="button" onClick={() => setPicked(new Set(clients.map((c) => c.id)))} className="text-[12px] font-semibold text-accent-ink hover:underline">{m.all}</button>
              {needYou.length > 0 ? (
                <button type="button" onClick={() => setPicked(new Set(needYou))} className="text-[12px] font-semibold text-accent-ink hover:underline">{fill(m.needYou, { n: needYou.length })}</button>
              ) : null}
              {picked.size > 0 ? <button type="button" onClick={() => setPicked(new Set())} className="text-[12px] font-semibold text-ink-faint hover:text-ink">{m.none}</button> : null}
            </div>
            <ul className="mt-2 max-h-56 divide-y divide-line/60 overflow-y-auto rounded-xl bg-bg px-3">
              {clients.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2 text-[13.5px]">
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 accent-[var(--color-accent)]" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                    {c.signal !== "on_track" ? <span className={`text-[11.5px] font-semibold ${c.signal === "at_risk" ? "text-risk" : "text-warn"}`}>{m.signal[c.signal]}</span> : null}
                  </label>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap gap-1.5" role="tablist">
              {kinds.map((o) => <Chip key={o.k} on={kind === o.k} onToggle={() => { setKind(o.k); setStatus(null); }}>{o.label}</Chip>)}
            </div>

            {kind === "message" ? (
              <label className="mt-3 block text-[12.5px] font-semibold text-ink-soft">
                {m.messageLabel}
                <textarea id="bulk-message" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000}
                  placeholder={m.messagePlaceholder} className={`${FIELD} py-2`} />
                <span className="mt-1 block text-[11.5px] font-normal text-ink-faint">{m.messageHint}</span>
              </label>
            ) : kind === "habit" ? (
              <div className="mt-3">
                <label className="block text-[12.5px] font-semibold text-ink-soft">
                  {m.habitLabel}
                  <input id="bulk-habit" value={habit} onChange={(e) => setHabit(e.target.value)} maxLength={80}
                    placeholder={m.habitPlaceholder} className={FIELD} />
                </label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {WEEK_ORDER.map((d) => (
                    <Chip key={d} on={days.has(d)} onToggle={() => setDays((prev) => { const next = new Set(prev); if (next.has(d)) next.delete(d); else next.add(d); return next; })}>
                      {m.weekdays[d]}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : (
              <label className="mt-3 block text-[12.5px] font-semibold text-ink-soft">
                {m.programLabel}
                <select id="bulk-program" value={programId} onChange={(e) => setProgramId(e.target.value)} className={FIELD}>
                  {programs.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.client}</option>)}
                </select>
                <span className="mt-1 block text-[11.5px] font-normal text-ink-faint">{m.programHint}</span>
              </label>
            )}

            {status ? <p role="status" className={`mt-3 text-[12.5px] font-semibold ${status.ok ? "text-accent-ink" : "text-risk"}`}>{status.text}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={pending}
                className="inline-flex h-10 items-center rounded-xl px-4 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50">{m.close}</button>
              <button type="button" onClick={send} disabled={pending || picked.size === 0}
                className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-[13px] font-bold text-accent-fg disabled:opacity-50">
                {pending ? m.sending : fill(m.send, { n: picked.size })}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
