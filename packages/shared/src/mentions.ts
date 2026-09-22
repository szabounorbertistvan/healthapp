// @mentions in comments.
//
// The rule this module exists to enforce: a comment body is TEXT, always, and
// a handle inside it is only a link when a `social_comment_mentions` row says
// so. Nothing here parses markup, produces markup, or trusts the body.
//
//   writing   extractMentionHandles(body) → handles the author typed
//             → the server resolves them to ids and writes mention rows
//   reading   commentSegments(body, mentions) → text and mention pieces
//             → React renders each piece as a text node or a <Link>
//
// Why segments rather than "replace @x with an anchor": producing HTML from
// user input is the whole class of bug this avoids. The component receives an
// array and renders elements; there is no string that could contain a tag, so
// there is nothing for an injected `<img onerror=…>` to be interpreted by.

/**
 * The username rule from the `users_username_format` constraint: 3–24
 * characters, letters/digits/underscore/dot, starting with a letter or digit.
 * Matching it here means a handle that could never exist is never looked up.
 */
const HANDLE = "[A-Za-z0-9][A-Za-z0-9_.]{2,23}";

/**
 * A mention is "@handle" preceded by the start of the string or a character
 * that is not part of a handle. The lookbehind-free form keeps this working in
 * every JS engine the app ships to.
 */
const MENTION_SCAN = new RegExp(`(^|[^A-Za-z0-9_.@])@(${HANDLE})`, "g");

export type MentionRef = {
  user_id: string;
  /** As stored on `users.username`. Null would make the mention unrenderable. */
  username: string;
};

/**
 * Every distinct handle the author typed, lower-cased, in the order they first
 * appear. Case is dropped because usernames are unique case-insensitively
 * (`users_username_lower_idx`), so "@Maria" and "@maria" are one person.
 *
 * Capped: a comment is 500 characters and a wall of handles is a notification
 * bomb, not a conversation.
 */
export const MENTIONS_MAX = 10;

export function extractMentionHandles(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // The scanner is stateful (`g`), so it is rebuilt per call rather than
  // shared — a leftover lastIndex would make the second call skip matches.
  const scan = new RegExp(MENTION_SCAN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = scan.exec(body)) !== null) {
    const handle = (match[2] ?? "").toLowerCase();
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
    if (out.length >= MENTIONS_MAX) break;
  }
  return out;
}

export type CommentSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; user_id: string; username: string };

/**
 * A comment body split into pieces for rendering.
 *
 * Only handles backed by a row in `mentions` become mention segments. A body
 * that says "@nobody" — or that was edited after the mention rows were written
 * — renders that text plainly, so the link set can never exceed what the
 * database recorded.
 */
export function commentSegments(body: string, mentions: readonly MentionRef[]): CommentSegment[] {
  const byHandle = new Map<string, MentionRef>();
  for (const m of mentions) {
    if (m.username) byHandle.set(m.username.toLowerCase(), m);
  }
  if (byHandle.size === 0) return body ? [{ kind: "text", text: body }] : [];

  const segments: CommentSegment[] = [];
  const scan = new RegExp(MENTION_SCAN.source, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = scan.exec(body)) !== null) {
    const lead = match[1] ?? "";
    const handle = match[2] ?? "";
    const ref = byHandle.get(handle.toLowerCase());
    if (!ref) continue;
    // The match starts at the character before the "@" when there is one, so
    // the boundary character belongs to the text before the mention.
    const at = match.index + lead.length;
    if (at > cursor) segments.push({ kind: "text", text: body.slice(cursor, at) });
    segments.push({ kind: "mention", text: `@${handle}`, user_id: ref.user_id, username: ref.username });
    cursor = at + 1 + handle.length;
  }

  if (cursor < body.length) segments.push({ kind: "text", text: body.slice(cursor) });
  return segments;
}

/**
 * The handle fragment being typed at the caret, for the suggestion list — or
 * null when the caret is not inside one.
 *
 * "@" on its own counts: the list opens as soon as the person commits to a
 * mention, rather than after they have already guessed at a spelling.
 */
export function mentionQueryAt(body: string, caret: number): { query: string; start: number } | null {
  const upto = body.slice(0, Math.max(0, Math.min(caret, body.length)));
  const at = upto.lastIndexOf("@");
  if (at < 0) return null;
  const before = at === 0 ? "" : upto[at - 1] ?? "";
  // Mid-word "@" is an email or a handle already written, not a new mention.
  if (before && /[A-Za-z0-9_.@]/.test(before)) return null;
  const fragment = upto.slice(at + 1);
  if (fragment.length > 24) return null;
  if (fragment && !/^[A-Za-z0-9][A-Za-z0-9_.]*$/.test(fragment)) return null;
  return { query: fragment, start: at };
}

/**
 * Put a chosen handle into the body, replacing the fragment being typed, and
 * report where the caret should land — after the trailing space, so the person
 * keeps typing rather than hunting for the end.
 */
export function applyMention(
  body: string,
  start: number,
  caret: number,
  username: string,
): { body: string; caret: number } {
  const head = body.slice(0, start);
  const tail = body.slice(Math.max(start, caret));
  const inserted = `@${username} `;
  return { body: `${head}${inserted}${tail}`, caret: head.length + inserted.length };
}

/**
 * Resolve typed handles against what the lookup returned.
 *
 * Handles with no user are dropped silently: the text stays in the comment and
 * simply is not a link. Failing the whole comment because somebody mistyped a
 * name would be a strange thing to do to them.
 */
export function resolveMentions(
  handles: readonly string[],
  known: readonly MentionRef[],
): MentionRef[] {
  const byHandle = new Map<string, MentionRef>();
  for (const k of known) {
    if (k.username) byHandle.set(k.username.toLowerCase(), k);
  }
  const out: MentionRef[] = [];
  const seen = new Set<string>();
  for (const handle of handles) {
    const ref = byHandle.get(handle.toLowerCase());
    if (!ref || seen.has(ref.user_id)) continue;
    seen.add(ref.user_id);
    out.push(ref);
  }
  return out;
}
