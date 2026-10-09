// Marketplace email copy, RO + EN, Voinic branding.
//
// Content is deliberately thin: who did what, when (for a session), and a
// button into the app. Never message text, review text, notes, prices or
// anything about health. A new message is announced without even the
// sender's name. Every value that came from a user (a display name) is
// escaped for HTML and stripped of line breaks before it reaches a subject.

export type EmailLocale = "ro" | "en";

export interface TemplateInput {
  category: string;
  event: string;
  locale: string | null | undefined;
  /** The other person's public display name (username or full name), or null. */
  actorName: string | null;
  /** A booking's start, ISO; shown in `timeZone` for booking emails. */
  startsAt?: string | null;
  timeZone?: string | null;
  /** Absolute link into the app (site URL + marketplaceEmailPath). */
  link: string;
  /** Absolute link to where notification settings live. */
  settingsLink: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

type Copy = { subject: string; heading: string; body: string; cta: string };
type Vars = { name: string; when: string };

/** The default when the account's locale is unknown: the product is Romanian first. */
export function emailLocale(locale: string | null | undefined): EmailLocale {
  return locale === "en" ? "en" : "ro";
}

const COPY: Record<EmailLocale, Record<string, (v: Vars) => Copy>> = {
  ro: {
    "coaching_request/sent": (v) => ({ subject: `Cerere nouă de coaching de la ${v.name}`, heading: "Ai o cerere nouă de coaching", body: `${v.name} ar vrea să lucreze cu tine.`, cta: "Vezi cererea" }),
    "coaching_request/accepted": (v) => ({ subject: `${v.name} ți-a acceptat cererea`, heading: "Cererea ta a fost acceptată", body: `${v.name} ți-a acceptat cererea de coaching.`, cta: "Deschide Voinic" }),
    "coaching_request/declined": (v) => ({ subject: `Răspuns la cererea ta de coaching`, heading: "Cererea ta nu a fost acceptată", body: `${v.name} nu poate prelua cererea ta acum. Poți căuta alt antrenor în Voinic.`, cta: "Vezi cererile tale" }),
    "coaching_request/started": (v) => ({ subject: `${v.name} a început coaching-ul cu tine`, heading: "Coaching-ul a început", body: `${v.name} este acum antrenorul tău în Voinic.`, cta: "Deschide Voinic" }),
    "booking/booked": (v) => ({ subject: `Programare nouă: ${v.when}`, heading: "Ai o programare nouă", body: `${v.name} a rezervat o sesiune pe ${v.when}.`, cta: "Vezi programarea" }),
    "booking/requested": (v) => ({ subject: `Cerere de programare: ${v.when}`, heading: "O programare așteaptă confirmarea ta", body: `${v.name} vrea o sesiune pe ${v.when}.`, cta: "Confirmă sau refuză" }),
    "booking/confirmed": (v) => ({ subject: `Programare confirmată: ${v.when}`, heading: "Sesiunea ta e confirmată", body: `${v.name} a confirmat sesiunea de pe ${v.when}.`, cta: "Vezi programarea" }),
    "booking/declined": (v) => ({ subject: `Programare refuzată`, heading: "Sesiunea nu a fost confirmată", body: `${v.name} nu poate ține sesiunea de pe ${v.when}.`, cta: "Vezi programările" }),
    "booking/cancelled": (v) => ({ subject: `Programare anulată: ${v.when}`, heading: "O sesiune a fost anulată", body: `${v.name} a anulat sesiunea de pe ${v.when}.`, cta: "Vezi programările" }),
    "booking/reminder": (v) => ({ subject: `Reminder: sesiune ${v.when}`, heading: "Sesiunea ta se apropie", body: `Ai o sesiune cu ${v.name} pe ${v.when}.`, cta: "Vezi programarea" }),
    "new_message/*": () => ({ subject: "Ai un mesaj nou în Voinic", heading: "Ai un mesaj nou", body: "Ai primit un mesaj nou. Deschide conversația în Voinic ca să-l citești.", cta: "Deschide conversația" }),
    "review/published": (v) => ({ subject: `Recenzie nouă de la ${v.name}`, heading: "Ai o recenzie nouă", body: `${v.name} ți-a lăsat o recenzie pe profilul de antrenor.`, cta: "Vezi recenziile" }),
    "review/response": (v) => ({ subject: `${v.name} ți-a răspuns la recenzie`, heading: "Recenzia ta a primit un răspuns", body: `${v.name} a răspuns la recenzia ta.`, cta: "Vezi răspunsul" }),
    "marketplace/profile_published": () => ({ subject: "Profilul tău de antrenor e public", heading: "Profilul tău e public", body: "Profilul tău de antrenor a fost aprobat și apare acum în directorul Voinic.", cta: "Vezi profilul" }),
    "marketplace/profile_returned": () => ({ subject: "Profilul tău de antrenor are nevoie de modificări", heading: "Profilul tău are nevoie de modificări", body: "Echipa Voinic ți-a lăsat o notă pe pagina profilului de antrenor.", cta: "Vezi nota" }),
    "marketplace/revision_approved": () => ({ subject: "Modificările profilului tău sunt publice", heading: "Modificările tale sunt publice", body: "Pagina ta publică arată acum modificările trimise.", cta: "Vezi profilul" }),
    "marketplace/revision_returned": () => ({ subject: "Modificările profilului tău au nevoie de o revizuire", heading: "Modificările tale au nevoie de o revizuire", body: "Pagina ta publică a rămas neschimbată. Echipa Voinic ți-a lăsat o notă.", cta: "Vezi nota" }),
  },
  en: {
    "coaching_request/sent": (v) => ({ subject: `New coaching request from ${v.name}`, heading: "You have a new coaching request", body: `${v.name} would like to work with you.`, cta: "View request" }),
    "coaching_request/accepted": (v) => ({ subject: `${v.name} accepted your request`, heading: "Your request was accepted", body: `${v.name} accepted your coaching request.`, cta: "Open Voinic" }),
    "coaching_request/declined": (v) => ({ subject: "An answer to your coaching request", heading: "Your request was not accepted", body: `${v.name} can't take your request right now. You can find another coach on Voinic.`, cta: "View your requests" }),
    "coaching_request/started": (v) => ({ subject: `${v.name} started coaching you`, heading: "Coaching has started", body: `${v.name} is now your coach on Voinic.`, cta: "Open Voinic" }),
    "booking/booked": (v) => ({ subject: `New booking: ${v.when}`, heading: "You have a new booking", body: `${v.name} booked a session on ${v.when}.`, cta: "View booking" }),
    "booking/requested": (v) => ({ subject: `Booking request: ${v.when}`, heading: "A booking is waiting for you", body: `${v.name} would like a session on ${v.when}.`, cta: "Confirm or decline" }),
    "booking/confirmed": (v) => ({ subject: `Booking confirmed: ${v.when}`, heading: "Your session is confirmed", body: `${v.name} confirmed your session on ${v.when}.`, cta: "View booking" }),
    "booking/declined": (v) => ({ subject: "Booking declined", heading: "Your session was not confirmed", body: `${v.name} can't hold the session on ${v.when}.`, cta: "View bookings" }),
    "booking/cancelled": (v) => ({ subject: `Booking cancelled: ${v.when}`, heading: "A session was cancelled", body: `${v.name} cancelled the session on ${v.when}.`, cta: "View bookings" }),
    "booking/reminder": (v) => ({ subject: `Reminder: session ${v.when}`, heading: "Your session is coming up", body: `You have a session with ${v.name} on ${v.when}.`, cta: "View booking" }),
    "new_message/*": () => ({ subject: "You have a new message on Voinic", heading: "You have a new message", body: "You received a new message. Open the conversation on Voinic to read it.", cta: "Open conversation" }),
    "review/published": (v) => ({ subject: `New review from ${v.name}`, heading: "You have a new review", body: `${v.name} left a review on your coach profile.`, cta: "View reviews" }),
    "review/response": (v) => ({ subject: `${v.name} answered your review`, heading: "Your review got an answer", body: `${v.name} answered your review.`, cta: "View the answer" }),
    "marketplace/profile_published": () => ({ subject: "Your coach profile is live", heading: "Your profile is live", body: "Your coach profile was approved and now appears in the Voinic directory.", cta: "View profile" }),
    "marketplace/profile_returned": () => ({ subject: "Your coach profile needs changes", heading: "Your profile needs changes", body: "The Voinic team left a note on your coach profile page.", cta: "View the note" }),
    "marketplace/revision_approved": () => ({ subject: "Your profile changes are live", heading: "Your changes are live", body: "Your public page now shows the changes you submitted.", cta: "View profile" }),
    "marketplace/revision_returned": () => ({ subject: "Your profile changes need another look", heading: "Your changes need another look", body: "Your public page is unchanged. The Voinic team left you a note.", cta: "View the note" }),
  },
};

const FOOTER: Record<EmailLocale, { why: string; settings: string }> = {
  ro: { why: "Primești acest email pentru că ai un cont Voinic și această notificare este pornită.", settings: "Setări notificări" },
  en: { why: "You are receiving this because you have a Voinic account and this notification is on.", settings: "Notification settings" },
};

const FALLBACK_NAME: Record<EmailLocale, string> = { ro: "Cineva", en: "Someone" };

/** One line, no control characters, bounded — safe in a subject header. */
export function oneLine(value: string, max = 60): string {
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatWhen(startsAt: string | null | undefined, timeZone: string | null | undefined, locale: EmailLocale): string {
  if (!startsAt) return locale === "ro" ? "data programată" : "the scheduled time";
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return locale === "ro" ? "data programată" : "the scheduled time";
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { ...opts, timeZone: timeZone ?? "Europe/Bucharest" }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { ...opts, timeZone: "Europe/Bucharest" }).format(date);
  }
}

/** Renders one marketplace email, or null for an event that has no template. */
export function renderMarketplaceEmail(input: TemplateInput): RenderedEmail | null {
  const locale = emailLocale(input.locale);
  const template = COPY[locale][`${input.category}/${input.event}`];
  if (!template) return null;

  const name = oneLine(input.actorName?.trim() || FALLBACK_NAME[locale], 40);
  const when = formatWhen(input.startsAt, input.timeZone, locale);
  const plain = template({ name, when });
  const safe = template({ name: escapeHtml(name), when: escapeHtml(when) });
  const link = escapeHtml(input.link);
  const settings = escapeHtml(input.settingsLink);
  const footer = FOOTER[locale];

  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(oneLine(plain.subject, 120))}</title></head>
<body style="margin:0;padding:0;background:#f4f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#121519;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3ef;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e4e1d8;border-radius:14px;overflow:hidden;">
        <tr><td style="background:#0b0b0d;padding:18px 28px;">
          <span style="display:inline-block;width:30px;height:30px;line-height:30px;background:#d4a938;border-radius:8px;color:#0b0b0d;font-weight:900;font-size:16px;text-align:center;vertical-align:middle;">V</span>
          <span style="padding-left:10px;font-size:17px;font-weight:800;color:#f2efe8;vertical-align:middle;">Voinic</span>
        </td></tr>
        <tr><td style="padding:28px 28px 8px 28px;">
          <h1 style="margin:0 0 10px 0;font-size:21px;line-height:1.3;font-weight:800;">${safe.heading}</h1>
          <p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;color:#3f3d38;">${safe.body}</p>
          <a href="${link}" style="display:inline-block;background:#d4a938;color:#0b0b0d;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;">${safe.cta}</a>
        </td></tr>
        <tr><td style="padding:22px 28px 24px 28px;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#807c73;">${escapeHtml(footer.why)} <a href="${settings}" style="color:#807c73;">${escapeHtml(footer.settings)}</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${plain.heading}\n\n${plain.body}\n\n${plain.cta}: ${input.link}\n\n—\n${footer.why}\n${footer.settings}: ${input.settingsLink}\n`;
  return { subject: oneLine(plain.subject, 120), html, text };
}

/** Every category/event that has copy, in both languages — the tests hold this equal to the rules. */
export function templateKeys(locale: EmailLocale): string[] {
  return Object.keys(COPY[locale]).sort();
}
