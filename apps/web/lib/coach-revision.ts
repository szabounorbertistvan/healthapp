/**
 * Staged revisions of a published coach profile (20261108100000), the pure
 * part: the payload's shape (what coach_profile_snapshot() returns), how the
 * editor's writes patch it, how it is laid over the live profile for the
 * editor, and what changed for the admin. No React, no network — tested in
 * lib/coach-revision.test.ts. The database judges every saved payload with
 * the real tables (coach_revision_check), so nothing here is the authority.
 */
import type { CoachCertificationRow, CoachServiceRow, MyCoachProfile } from "./coach-profile";

export type RevisionService = {
  id: string; name: string; description: string | null; kind: CoachServiceRow["kind"]; delivery: CoachServiceRow["delivery"];
  duration_value: number | null; duration_unit: CoachServiceRow["duration_unit"]; price_cents: number | null;
  currency: string; price_unit: CoachServiceRow["price_unit"]; price_public: boolean; active: boolean; sort_order: number;
};
export type RevisionCertification = {
  id: string; name: string; issuer: string | null; year: number | null; credential_number: string | null;
  expires_on: string | null; sort_order: number; verification_status?: CoachCertificationRow["verification_status"];
};
export type RevisionPayload = {
  headline: string | null;
  about: string | null;
  coaching_since: number | null;
  online: boolean;
  in_person: boolean;
  specializations: { slug: string; is_primary: boolean }[];
  languages: string[];
  locations: { city_slug: string; gym_name: string | null; gym_id: string | null }[];
  services: RevisionService[];
  certifications: RevisionCertification[];
};

export type RevisionStatus = "editing" | "pending_review" | "rejected";
export type CoachRevisionInfo = { status: RevisionStatus; review_note: string | null; submitted_at: string | null };

// ---------- the editor's writes, as patches ----------

export function withSpecializations(p: RevisionPayload, slugs: string[], primary: string | null): RevisionPayload {
  return { ...p, specializations: slugs.map((slug) => ({ slug, is_primary: slug === primary })) };
}

export function withLocations(p: RevisionPayload, locations: { city: string; gymName?: string | null; gymId?: string | null }[]): RevisionPayload {
  return { ...p, locations: locations.map((l) => ({ city_slug: l.city, gym_name: l.gymName?.trim() || null, gym_id: l.gymId ?? null })) };
}

/** Insert (an id not in the copy yet) or replace (an id already there) one service. */
export function withService(p: RevisionPayload, s: RevisionService): RevisionPayload {
  const at = p.services.findIndex((x) => x.id === s.id);
  const services = at < 0 ? [...p.services, s] : p.services.map((x, i) => (i === at ? s : x));
  return { ...p, services };
}

export function withoutService(p: RevisionPayload, id: string): RevisionPayload {
  return { ...p, services: p.services.filter((s) => s.id !== id) };
}

/** The coach's order: exactly the copy's services, positions as sort_order. Null when the list does not match. */
export function withServiceOrder(p: RevisionPayload, ids: string[]): RevisionPayload | null {
  const known = new Set(p.services.map((s) => s.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) return null;
  const pos = new Map(ids.map((id, i) => [id, i]));
  return { ...p, services: [...p.services].map((s) => ({ ...s, sort_order: pos.get(s.id)! })).sort((a, b) => a.sort_order - b.sort_order) };
}

export function withCertification(p: RevisionPayload, c: RevisionCertification): RevisionPayload {
  const at = p.certifications.findIndex((x) => x.id === c.id);
  // a certificate keeps its review state in the copy; the trigger resets it on approval if it was renamed
  const keep = at >= 0 ? { verification_status: p.certifications[at]!.verification_status } : {};
  const next = { ...c, ...keep };
  const certifications = at < 0 ? [...p.certifications, next] : p.certifications.map((x, i) => (i === at ? next : x));
  return { ...p, certifications };
}

export function withoutCertification(p: RevisionPayload, id: string): RevisionPayload {
  return { ...p, certifications: p.certifications.filter((c) => c.id !== id) };
}

// ---------- the editor reads the copy ----------

/**
 * The live profile with the copy's content laid over it: what the editor
 * shows while a revision is open. Operational fields (status, slug, cover,
 * accepting, booking settings) stay the live ones.
 */
export function overlayRevision(mine: MyCoachProfile, p: RevisionPayload): MyCoachProfile {
  const liveServices = new Map(mine.services.map((s) => [s.id, s]));
  const liveCerts = new Map(mine.certifications.map((c) => [c.id, c]));
  return {
    ...mine,
    profile: { ...mine.profile, headline: p.headline, about: p.about, coaching_since: p.coaching_since, online: p.online, in_person: p.in_person },
    specializations: p.specializations,
    languages: p.languages,
    locations: p.locations,
    services: p.services.map((s) => ({ ...(liveServices.get(s.id) ?? ({} as CoachServiceRow)), ...s } as CoachServiceRow)),
    certifications: p.certifications.map((c) => ({
      ...(liveCerts.get(c.id) ?? ({ verification_status: "unverified", admin_note: null } as unknown as CoachCertificationRow)),
      ...c,
    } as CoachCertificationRow)),
  };
}

// ---------- what changed, for the admin ----------

export type RevisionChange =
  | { field: "headline" | "about" | "coaching_since" | "delivery"; before: string; after: string }
  | { field: "specializations" | "languages" | "locations"; before: string; after: string }
  | { field: "service" | "certification"; change: "added" | "removed" | "changed"; name: string; before?: string; after?: string };

const text = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function serviceLine(s: RevisionService): string {
  const price = s.price_cents === null ? s.price_unit : `${(s.price_cents / 100).toFixed(2)} ${s.currency}/${s.price_unit}`;
  return [s.name, s.description ?? "", s.kind, s.delivery, price, s.active ? "on" : "off"].join(" · ");
}
function certLine(c: RevisionCertification): string {
  return [c.name, c.issuer ?? "", c.year ?? "", c.expires_on ?? ""].join(" · ");
}

/** Every difference between what is live and what the coach proposes, in reading order. */
export function revisionDiff(live: RevisionPayload, next: RevisionPayload): RevisionChange[] {
  const out: RevisionChange[] = [];
  for (const field of ["headline", "about", "coaching_since"] as const) {
    if (text(live[field]) !== text(next[field])) out.push({ field, before: text(live[field]), after: text(next[field]) });
  }
  const delivery = (p: RevisionPayload) => [p.online ? "online" : null, p.in_person ? "in person" : null].filter(Boolean).join(" + ") || "—";
  if (delivery(live) !== delivery(next)) out.push({ field: "delivery", before: delivery(live), after: delivery(next) });
  const list = <T,>(xs: T[], f: (x: T) => string) => xs.map(f).sort().join(", ") || "—";
  const spec = (s: { slug: string; is_primary: boolean }) => (s.is_primary ? `${s.slug} (primary)` : s.slug);
  if (list(live.specializations, spec) !== list(next.specializations, spec)) {
    out.push({ field: "specializations", before: list(live.specializations, spec), after: list(next.specializations, spec) });
  }
  if (list(live.languages, (x) => x) !== list(next.languages, (x) => x)) {
    out.push({ field: "languages", before: list(live.languages, (x) => x), after: list(next.languages, (x) => x) });
  }
  const loc = (l: RevisionPayload["locations"][number]) => (l.gym_name ? `${l.city_slug} (${l.gym_name})` : l.city_slug);
  if (list(live.locations, loc) !== list(next.locations, loc)) {
    out.push({ field: "locations", before: list(live.locations, loc), after: list(next.locations, loc) });
  }
  const pair = <T extends { id: string; name: string }>(field: "service" | "certification", a: T[], b: T[], line: (x: T) => string) => {
    const before = new Map(a.map((x) => [x.id, x]));
    const after = new Map(b.map((x) => [x.id, x]));
    for (const x of b) {
      const old = before.get(x.id);
      if (!old) out.push({ field, change: "added", name: x.name, after: line(x) });
      else if (line(old) !== line(x)) out.push({ field, change: "changed", name: x.name, before: line(old), after: line(x) });
    }
    for (const x of a) if (!after.has(x.id)) out.push({ field, change: "removed", name: x.name, before: line(x) });
  };
  pair("service", live.services, next.services, serviceLine);
  pair("certification", live.certifications, next.certifications, certLine);
  return out;
}
