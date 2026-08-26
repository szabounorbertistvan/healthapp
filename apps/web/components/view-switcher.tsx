"use client";
import { useState, useTransition } from "react";
import { setView } from "@/app/view-actions";
import { useI18n } from "@/lib/i18n/client";

/**
 * Admin-only surface switch. Sits in both sidebars so a tester can walk the
 * coach workspace and any client app without signing in twice.
 */
export function ViewSwitcher({
  surface,
  clients,
  activeClientId,
}: {
  surface: "coach" | "client";
  clients: { id: string; name: string }[];
  activeClientId?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const go = (target: string) => startTransition(async () => void setView(target));

  return (
    <div className={`rounded-lg border border-line p-2 ${pending ? "opacity-60" : ""}`}>
      <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {t.common.viewSwitcher.viewingAs}
      </p>

      <div className="mt-1.5 flex gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => go("coach")}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${
            surface === "coach" ? "bg-accent text-white" : "bg-bg text-ink-soft hover:text-ink"
          }`}
        >
          {t.common.viewSwitcher.coach}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => (surface === "client" ? setOpen((v) => !v) : go(`client:${clients[0]?.id}`))}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${
            surface === "client" ? "bg-accent text-white" : "bg-bg text-ink-soft hover:text-ink"
          }`}
        >
          {t.common.viewSwitcher.client}
        </button>
      </div>

      {surface === "client" ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-1.5 flex w-full items-center justify-between rounded-md px-1 py-1 text-left text-xs text-ink-soft hover:text-ink"
          >
            <span className="truncate">
              {clients.find((c) => c.id === activeClientId)?.name ?? t.common.viewSwitcher.pickClient}
            </span>
            <span aria-hidden className="ml-1 text-ink-faint">
              {open ? "▲" : "▼"}
            </span>
          </button>
          {open ? (
            <ul className="mt-1 max-h-48 overflow-y-auto">
              {clients.map((client) => (
                <li key={client.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setOpen(false);
                      go(`client:${client.id}`);
                    }}
                    className={`w-full truncate rounded-md px-2 py-1.5 text-left text-xs ${
                      client.id === activeClientId
                        ? "bg-accent-soft font-semibold text-accent-ink"
                        : "text-ink-soft hover:bg-bg"
                    }`}
                  >
                    {client.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
