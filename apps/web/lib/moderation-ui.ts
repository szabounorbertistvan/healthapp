/**
 * Mute / Block / Report on the screen, as data: which actions a menu offers,
 * and the steps the sheet walks through. Pure, so vitest covers it
 * (lib/moderation-ui.test.ts). What the actions DO is the database's.
 */
import type { ReportReason } from "@healthapp/shared";

export type MenuAction = "edit" | "delete" | "mute" | "unmute" | "block" | "unblock" | "report";

/**
 * A post's ••• menu. Your own post: edit and delete. Anyone else's: mute or
 * unmute, block or unblock, report — never both halves of a pair. A post by
 * someone you blocked does not reach the page at all (the server hides it);
 * the unblock entry exists for the rare row that does, never "Block" again.
 */
export function postMenuActions(s: { mine: boolean; muted: boolean; blocked: boolean }): MenuAction[] {
  if (s.mine) return ["edit", "delete"];
  if (s.blocked) return ["unblock", "report"];
  return [s.muted ? "unmute" : "mute", "block", "report"];
}

/**
 * A profile's ••• menu. Nothing on your own. Blocked: unblock and report
 * only — muting someone you have blocked would be a second switch for
 * something already hidden.
 */
export function profileMenuActions(s: { me: boolean; muted: boolean; blocked: boolean }): MenuAction[] {
  if (s.me) return [];
  if (s.blocked) return ["unblock", "report"];
  return [s.muted ? "unmute" : "mute", "block", "report"];
}

// ---------- the sheet's steps ----------

export type SheetStep =
  | { step: "menu" }
  | { step: "confirm-block" }
  | { step: "report"; reason: ReportReason | null; details: string }
  | { step: "pending"; from: "menu" | "confirm-block" | "report" }
  | { step: "done"; what: "muted" | "unmuted" | "blocked" | "unblocked" | "reported" }
  | { step: "error"; back: "menu" | "confirm-block" | "report" };

export type SheetEvent =
  | { type: "choose"; action: "mute" | "unmute" | "block" | "unblock" | "report" }
  | { type: "confirm" }
  | { type: "reason"; reason: ReportReason }
  | { type: "details"; details: string }
  | { type: "submit" }
  | { type: "result"; ok: boolean; what: "muted" | "unmuted" | "blocked" | "unblocked" | "reported" }
  | { type: "back" };

/**
 * Mute, unmute and unblock go straight to the request; Block asks first;
 * Report asks for a reason. One request at a time: while one is pending,
 * every other event is ignored. A failure lands on an error step that goes
 * back to where it came from — nothing is assumed to have happened.
 */
export function sheetReducer(state: SheetStep, event: SheetEvent): SheetStep {
  if (state.step === "pending") {
    if (event.type !== "result") return state;
    return event.ok ? { step: "done", what: event.what } : { step: "error", back: state.from };
  }
  switch (event.type) {
    case "choose":
      if (state.step !== "menu") return state;
      if (event.action === "block") return { step: "confirm-block" };
      if (event.action === "report") return { step: "report", reason: null, details: "" };
      return { step: "pending", from: "menu" };
    case "confirm":
      return state.step === "confirm-block" ? { step: "pending", from: "confirm-block" } : state;
    case "reason":
      return state.step === "report" ? { ...state, reason: event.reason } : state;
    case "details":
      return state.step === "report" ? { ...state, details: event.details } : state;
    case "submit":
      return state.step === "report" && state.reason ? { step: "pending", from: "report" } : state;
    case "back":
      if (state.step === "error") {
        return state.back === "report" ? { step: "report", reason: null, details: "" } : { step: state.back };
      }
      return { step: "menu" };
    default:
      return state;
  }
}
