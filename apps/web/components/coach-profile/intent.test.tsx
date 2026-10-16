// Back from signing in with "Save" in mind: /coaches/<slug>?intent=save saves
// once and drops the intent from the URL. The URL must be cleaned even when the
// save never got an answer — before settle() a rejected action left
// ?intent=save in place (and an unhandled rejection behind), so a reload
// repeated the save attempt.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderWithApp } from "@/test/render";

const toggleCoachSave = vi.fn();
const follow = vi.fn();
vi.mock("@/app/coach-profile-actions", () => ({ toggleCoachSave: (...a: unknown[]) => toggleCoachSave(...a) }));
vi.mock("@/app/social-actions", () => ({ follow: (...a: unknown[]) => follow(...a) }));
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

import { FollowIntent, SaveIntent } from "./intent";

describe("SaveIntent / FollowIntent", () => {
  beforeEach(() => {
    toggleCoachSave.mockReset(); follow.mockReset(); replace.mockReset(); refresh.mockReset();
  });

  it("saves once, then drops the intent from the URL", async () => {
    toggleCoachSave.mockResolvedValue({ ok: true, saved: true });
    renderWithApp(<SaveIntent profileId="p1" saved={false} slug="alpha" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/coaches/alpha", { scroll: false }));
    expect(toggleCoachSave).toHaveBeenCalledTimes(1);
    expect(toggleCoachSave).toHaveBeenCalledWith("p1", false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("still drops the intent when the save never answered", async () => {
    toggleCoachSave.mockRejectedValue(new TypeError("Failed to fetch"));
    renderWithApp(<SaveIntent profileId="p1" saved={false} slug="alpha" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/coaches/alpha", { scroll: false }));
  });

  it("only cleans the URL when the coach is already saved", async () => {
    renderWithApp(<SaveIntent profileId="p1" saved slug="alpha" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/coaches/alpha", { scroll: false }));
    expect(toggleCoachSave).not.toHaveBeenCalled();
  });

  it("follow: the same, when the request never answered", async () => {
    follow.mockRejectedValue(new TypeError("Failed to fetch"));
    renderWithApp(<FollowIntent userId="u1" following={false} slug="alpha" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/coaches/alpha", { scroll: false }));
    expect(follow).toHaveBeenCalledTimes(1);
  });
});
