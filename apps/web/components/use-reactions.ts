"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyReaction, type ReactionState, type ReactionType } from "@healthapp/shared";
import { react } from "@/app/social-actions";
import type { FeedPost } from "@/lib/types";

/**
 * The reactions on one post. `press` is a button: the same one again takes
 * the reaction back, the other one replaces it (applyReaction mirrors
 * social_react). The state is local and moves at once; the server action
 * runs behind it, queued so two quick presses reach the database in order,
 * and the row it answers with is what the card settles on. Nothing refreshes
 * the page: a reaction is one small write, not a reason to re-render the
 * feed. Other people's counts arrive with the next navigation, and a refresh
 * from elsewhere on the page (a comment) re-seeds the state from the row.
 * `burst` changes whenever a reaction was GIVEN, which is what the sparks and
 * the splash key off; taking one back is quiet.
 */
export function useReactions(post: FeedPost) {
  const [error, setError] = useState<string | null>(null);
  const [burst, setBurst] = useState<{ type: ReactionType; at: number } | null>(null);
  const [state, setState] = useState<ReactionState>({ my_reaction: post.my_reaction, kudos_count: post.kudos_count, love_count: post.love_count });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // What the card shows right now, read by press() outside any updater: a
  // setState updater must stay pure, and StrictMode runs it twice — when the
  // server call was queued inside one, every press sent kudos and then took it
  // back (QA BUG-14).
  const current = useRef(state);
  const show = useCallback((next: ReactionState) => {
    current.current = next;
    setState(next);
  }, []);

  // The row is the truth whenever it arrives anew.
  useEffect(() => {
    show({ my_reaction: post.my_reaction, kudos_count: post.kudos_count, love_count: post.love_count });
  }, [show, post.my_reaction, post.kudos_count, post.love_count]);

  const press = useCallback((pressed: ReactionType, opts: { onlyGive?: boolean } = {}) => {
    if (post.mine) return;
    const cur = current.current;
    // A double-tap on the photo gives, never takes back — Instagram's rule,
    // and the one that keeps a stray second tap from undoing the first.
    if (opts.onlyGive && cur.my_reaction === pressed) {
      setBurst({ type: pressed, at: Date.now() });
      return;
    }
    if (cur.my_reaction !== pressed) setBurst({ type: pressed, at: Date.now() });
    setError(null);
    show(applyReaction(cur, pressed));
    queue.current = queue.current.then(async () => {
      const r = await react(post.id, pressed);
      if (!r.ok) {
        setError(r.message ?? "Error");
        show(cur); // back to what the card showed before this press
        return;
      }
      // Two presses raced and the database settled differently: follow the row.
      const settled = r.reaction ?? null;
      const now = current.current;
      if (now.my_reaction !== settled) show(applyReaction(now, settled ?? now.my_reaction!));
    });
  }, [post.mine, post.id, show]);

  return { state, press, error, burst };
}
