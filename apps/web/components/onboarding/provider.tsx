"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { markOnboarding } from "@/app/onboarding-actions";
import { settle } from "@/lib/settle-action";
import {
  mergeStates, parseOnboardingState, pendingSync, type OnboardingMark, type OnboardingState,
} from "@/lib/onboarding-model";

/**
 * The signed-in person's onboarding marks, shared by every tour, the setup
 * card and the /onboarding flow under one shell.
 *
 * The server's copy (onboarding_state) is the truth and follows the person
 * across devices. A mark is applied here at once and sent in the background;
 * if the write fails it is kept on this device (`pendingKey`) so the tip does
 * not come back on the next page, and sent again on the next load. Storage
 * the browser refuses (private mode, a full quota) only loses that fallback.
 */
type OnboardingContext = {
  /** null = unknown: nothing opens by itself. */
  state: OnboardingState | null;
  /** The device-wide "no automatic tips" switch (localStorage `voinic-tips` = off). */
  deviceOff: boolean;
  /** Apply a mark now; resolves true once the server has it, false if it is only kept on this device. */
  mark: (key: string, mark: OnboardingMark) => Promise<boolean>;
};

const Ctx = createContext<OnboardingContext | null>(null);

/** The device-wide switch; the E2E suites set it so a tip never covers a control a test clicks. */
export const DEVICE_TIPS_KEY = "voinic-tips";
const pendingKey = (userId: string) => `voinic-onboarding-pending:${userId}`;

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage refused: the mark still holds for this page view
  }
}
function readPending(userId: string): OnboardingState {
  const raw = readLocal(pendingKey(userId));
  if (!raw) return {};
  try {
    return parseOnboardingState(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function OnboardingProvider({
  userId, initial, children,
}: {
  userId: string;
  initial: OnboardingState | null;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<OnboardingState | null>(initial);
  const [deviceOff, setDeviceOff] = useState(false);
  const pending = useRef<Record<string, OnboardingMark>>({});

  // A new server copy (after a refresh) replaces ours, with anything still unsent on top.
  useEffect(() => {
    setState(mergeStates(initial, pending.current));
  }, [initial]);

  const persistPending = useCallback(() => {
    const keys = Object.keys(pending.current);
    writeLocal(pendingKey(userId), keys.length > 0 ? JSON.stringify(pending.current) : null);
  }, [userId]);

  const send = useCallback(async (key: string, value: OnboardingMark): Promise<boolean> => {
    const result = await settle(() => markOnboarding(key, value), "unreachable");
    if (result.ok) {
      if (pending.current[key] === value) {
        delete pending.current[key];
        persistPending();
      }
      return true;
    }
    pending.current = { ...pending.current, [key]: value };
    persistPending();
    return false;
  }, [persistPending]);

  // On load: what this device holds and the server lacks, applied and sent again.
  useEffect(() => {
    setDeviceOff(readLocal(DEVICE_TIPS_KEY) === "off");
    const local = readPending(userId);
    pending.current = local;
    if (Object.keys(local).length === 0) return;
    setState((s) => mergeStates(s, local));
    if (initial === null) return; // the server cannot be read now; try on a later load
    for (const [key, value] of pendingSync(initial, local)) void send(key, value);
    // only on mount and when the person changes — a later `initial` is handled above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const mark = useCallback(
    (key: string, value: OnboardingMark) => {
      setState((s) => ({ ...(s ?? {}), [key]: value }));
      return send(key, value);
    },
    [send],
  );

  const value = useMemo(() => ({ state, deviceOff, mark }), [state, deviceOff, mark]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Outside a provider (a public page, signed out) everything reads as unknown and marks go nowhere. */
export function useOnboarding(): OnboardingContext {
  return useContext(Ctx) ?? NO_PROVIDER;
}

const NO_PROVIDER: OnboardingContext = {
  state: null,
  deviceOff: true,
  mark: async () => false,
};
