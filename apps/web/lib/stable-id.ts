/**
 * A stable uuid derived from a natural key.
 *
 * client_generated_id is a uuid column with a unique constraint, and it is the
 * whole retry-safety story: the same logical write must always produce the same
 * id. Random uuids would defeat that, so this hashes the key into a v5-shaped
 * value. Not cryptographic — it only needs to be deterministic and spread out.
 *
 * Lives here rather than beside the writes because the readers need it too: to
 * show what has already been logged today, client-data.ts has to address the
 * same session row the next write will.
 */
export function uuidFrom(key: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  const block = (seed: number, n: number) => {
    let out = "";
    let s = seed >>> 0;
    while (out.length < n) {
      s = Math.imul(s ^ (s >>> 15), 0x2545f491) >>> 0;
      out += s.toString(16).padStart(8, "0");
    }
    return out.slice(0, n);
  };
  const a = block(h1, 8);
  const b = block(h1 ^ h2, 4);
  const c = `5${block(h2, 3)}`; // version 5 nibble
  const d = ((parseInt(block(h2 ^ 0x9e3779b9, 1), 16) & 0x3) | 0x8).toString(16) + block(h1 ^ 0x5bf03635, 3);
  const e = block(h2 ^ h1, 12);
  return `${a}-${b}-${c}-${d}-${e}`;
}

/** The deterministic key for one client's session on one program day, one date. */
export function sessionKeyFor(userId: string, dayId: string, isoDate: string): string {
  return uuidFrom(`${userId}:${dayId}:${isoDate}`);
}
