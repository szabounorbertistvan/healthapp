// Reactions under StrictMode (QA BUG-14, 2026-09-29): the server call used to be
// queued inside a setState updater, which StrictMode runs twice — one press
// sent kudos and then took it back, so the count never moved in development.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import type { FeedPost } from "@/lib/types";
import "@/test/render";
import { useReactions } from "./use-reactions";

const react = vi.fn();
vi.mock("@/app/social-actions", () => ({ react: (...a: unknown[]) => react(...a) }));

const post = { id: "p1", mine: false, my_reaction: null, kudos_count: 2, love_count: 0 } as unknown as FeedPost;
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

describe("useReactions", () => {
  beforeEach(() => react.mockReset());

  it("sends one request per press and keeps the count", async () => {
    react.mockResolvedValue({ ok: true, reaction: "kudos" });
    const { result } = renderHook(() => useReactions(post), { wrapper: strict });
    act(() => result.current.press("kudos"));
    await waitFor(() => expect(react).toHaveBeenCalledTimes(1));
    expect(react).toHaveBeenCalledWith("p1", "kudos");
    expect(result.current.state).toEqual({ my_reaction: "kudos", kudos_count: 3, love_count: 0 });
  });

  it("puts the count back when the request fails", async () => {
    react.mockResolvedValue({ ok: false, message: "nope" });
    const { result } = renderHook(() => useReactions(post), { wrapper: strict });
    act(() => result.current.press("kudos"));
    await waitFor(() => expect(result.current.error).toBe("nope"));
    expect(react).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ my_reaction: null, kudos_count: 2, love_count: 0 });
  });

  it("a double-tap on a post already given kudos takes nothing back", async () => {
    const given = { ...post, my_reaction: "kudos", kudos_count: 3 } as FeedPost;
    const { result } = renderHook(() => useReactions(given), { wrapper: strict });
    act(() => result.current.press("kudos", { onlyGive: true }));
    expect(react).not.toHaveBeenCalled();
    expect(result.current.state.kudos_count).toBe(3);
  });
});
