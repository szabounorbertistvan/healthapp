"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setFeedbackStatus } from "@/app/admin-actions";

type Status = "new" | "seen" | "done";

/** One-tap triage for a feedback row: no confirm, it is reversible. */
export function FeedbackStatus({ id, status, labels }: {
  id: number; status: Status; labels: { markSeen: string; markDone: string; reopen: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (next: Status) => start(async () => {
    const res = await setFeedbackStatus(id, next);
    if (res.ok) router.refresh();
  });
  const btn = "inline-flex h-8 items-center rounded-lg bg-surface px-3 text-[12px] font-bold text-ink-soft hover:text-ink disabled:opacity-50";
  return (
    <span className="flex gap-1.5">
      {status === "new" ? <button type="button" disabled={pending} onClick={() => go("seen")} className={btn}>{labels.markSeen}</button> : null}
      {status !== "done" ? <button type="button" disabled={pending} onClick={() => go("done")} className={btn}>{labels.markDone}</button> : null}
      {status === "done" ? <button type="button" disabled={pending} onClick={() => go("new")} className={btn}>{labels.reopen}</button> : null}
    </span>
  );
}
