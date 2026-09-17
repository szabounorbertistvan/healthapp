"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LengthUnit, WeightUnit } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { Role } from "@/lib/entitlements";
import { Card } from "./ui";
import { Avatar } from "./social";
import {
  downloadMyData, removeAvatar, requestAccountDeletion, requestAvatarUpload, saveAvatar, updateAccount,
} from "@/app/profile-actions";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

const FIELD =
  "mt-1.5 h-11 w-full rounded-2xl bg-bg px-3.5 text-[14px] text-ink outline-none ring-accent/50 focus:ring-2";
const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50";
const SMALL_BUTTON =
  "inline-flex h-9 items-center justify-center rounded-xl bg-bg px-3.5 text-[13px] font-semibold text-ink hover:bg-accent-soft/60 disabled:opacity-50";

/**
 * Profile fields plus the time zone the reminder jobs read. Shared by the
 * client's /account and the coach's /settings: the check-in day and the
 * leaderboard switch only mean something to a client, so they follow `role`.
 */
export function ProfileForm({
  role,
  avatarUrl,
  photoUploads,
  fullName,
  username,
  city,
  bio,
  timezone,
  checkInWeekday,
  leaderboardVisibility,
  weightUnit,
  lengthUnit,
}: {
  role: Role;
  avatarUrl: string | null;
  /** False when Cloudinary is not configured on this deployment. */
  photoUploads: boolean;
  fullName: string;
  username: string;
  city: string;
  bio: string;
  timezone: string;
  checkInWeekday: number;
  leaderboardVisibility: "public" | "followers" | "private";
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
}) {
  const { t } = useI18n();
  const a = t.clientApp.account;
  const router = useRouter();
  const [form, setForm] = useState({
    fullName,
    username,
    city,
    bio,
    timezone,
    checkInWeekday,
    leaderboardVisibility,
    weightUnit,
    lengthUnit,
  });
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The browser knows the real zone; offering it as one tap beats asking
  // someone to spell "Europe/Bucharest" into a text box.
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function save() {
    setError(null);
    setState("idle");
    start(async () => {
      const result = await updateAccount(form);
      if (result.ok) {
        setState("saved");
        router.refresh();
        return;
      }
      setState("error");
      setError(
        result.errorCode === "NAME" ? a.errName
          : result.errorCode === "USERNAME_FORMAT" ? a.errUsernameFormat
          : result.errorCode === "USERNAME_TAKEN" ? a.errUsernameTaken
          : result.errorCode === "CITY" ? a.errCity
          : result.errorCode === "BIO" ? a.errBio
          : result.message ?? a.errGeneric,
      );
    });
  }

  return (
    <Card plain>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{a.profile}</p>
      <div className="mt-3">
        <AvatarPicker name={form.username || form.fullName} url={avatarUrl} enabled={photoUploads} />
      </div>
      <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
        <label className="block text-[13px] font-semibold text-ink-soft">
          {a.fullName}
          <input
            className={FIELD}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </label>
        <label className="block text-[13px] font-semibold text-ink-soft">
          {a.username}
          <input
            className={FIELD}
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </label>
      </div>
      <label className="mt-3.5 block text-[13px] font-semibold text-ink-soft">
        {a.city}
        <input
          className={FIELD}
          value={form.city}
          maxLength={80}
          placeholder={a.cityPlaceholder}
          autoComplete="address-level2"
          onChange={(e) => setForm({ ...form, city: e.target.value })}
        />
      </label>
      <label className="mt-3.5 block text-[13px] font-semibold text-ink-soft">
        {a.bio}
        <textarea
          className={`${FIELD} h-auto min-h-24 resize-y py-2.5 leading-relaxed`}
          value={form.bio}
          maxLength={500}
          rows={3}
          onChange={(e) => setForm({ ...form, bio: e.target.value })}
        />
      </label>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">{a.bioHint}</p>

      <label className="mt-3.5 block text-[13px] font-semibold text-ink-soft">
        {a.timezone}
        <input
          className={FIELD}
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        />
      </label>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">{a.timezoneHint}</p>
      {detected && detected !== form.timezone ? (
        <button
          type="button"
          onClick={() => setForm({ ...form, timezone: detected })}
          className="mt-2 text-[12.5px] font-semibold text-accent-ink hover:underline"
        >
          {fill(a.useDetected, { zone: detected })}
        </button>
      ) : null}

      {/* Display only. The columns stay metric, so switching to pounds cannot
          rewrite a single stored number — see packages/shared/src/units.ts. */}
      <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
        <label className="block text-[13px] font-semibold text-ink-soft">
          {a.weightUnit}
          <select
            className={FIELD}
            value={form.weightUnit}
            onChange={(e) => setForm({ ...form, weightUnit: e.target.value as WeightUnit })}
          >
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </select>
        </label>
        <label className="block text-[13px] font-semibold text-ink-soft">
          {a.lengthUnit}
          <select
            className={FIELD}
            value={form.lengthUnit}
            onChange={(e) => setForm({ ...form, lengthUnit: e.target.value as LengthUnit })}
          >
            <option value="cm">cm</option>
            <option value="in">in</option>
          </select>
        </label>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">{a.unitsHint}</p>

      {role === "client" ? (
      <>
      <label className="mt-3.5 block text-[13px] font-semibold text-ink-soft">
        {a.checkInDay}
        <select
          className={FIELD}
          value={form.checkInWeekday}
          onChange={(e) => setForm({ ...form, checkInWeekday: Number(e.target.value) })}
        >
          {a.weekdayNames.map((day, i) => (
            <option key={day} value={i}>
              {day}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">{a.checkInDayHint}</p>

      {/* Leaderboard visibility defaults to "public" in SQL and had no control
          anywhere, so everyone was on the boards without ever choosing to be.
          It belongs on the account screen, not buried in the leaderboard. */}
      <label className="mt-3.5 block text-[13px] font-semibold text-ink-soft">
        {a.leaderboards}
        <select
          className={FIELD}
          value={form.leaderboardVisibility}
          onChange={(e) =>
            setForm({ ...form, leaderboardVisibility: e.target.value as typeof form.leaderboardVisibility })
          }
        >
          <option value="public">{a.visibilityPublic}</option>
          <option value="followers">{a.visibilityFollowers}</option>
          <option value="private">{a.visibilityPrivate}</option>
        </select>
      </label>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">{a.leaderboardsHint}</p>
      </>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={pending} className={BUTTON}>
          {pending ? a.saving : a.save}
        </button>
        {state === "saved" && !pending ? <span className="text-[13px] text-accent-ink">{a.saved}</span> : null}
        {error ? <span className="text-[13px] text-risk">{error}</span> : null}
      </div>
    </Card>
  );
}

/**
 * The profile picture: upload one, replace it, or drop it. The file goes to
 * Cloudinary from the browser against a ticket the server signed, exactly as
 * progress photos do (components/progress-photos.tsx), and the column is
 * written only once the asset exists.
 */
function AvatarPicker({ name, url, enabled }: { name: string; url: string | null; enabled: boolean }) {
  const { t } = useI18n();
  const a = t.clientApp.account;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError(a.photoNotImage);
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError(a.photoTooLarge);
      return;
    }
    setBusy(true);
    try {
      const permission = await requestAvatarUpload();
      if (!permission.ok || !permission.ticket) {
        setError(permission.message ?? a.errPhoto);
        return;
      }
      const ticket = permission.ticket;
      const body = new FormData();
      body.append("file", file);
      body.append("api_key", ticket.apiKey);
      for (const [key, value] of Object.entries(ticket.fields)) body.append(key, value);
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${ticket.cloudName}/image/upload`,
        { method: "POST", body },
      );
      if (!response.ok) {
        setError(a.errPhoto);
        return;
      }
      const uploaded = (await response.json()) as { public_id?: string; version?: number };
      if (!uploaded.public_id || !uploaded.version) {
        setError(a.errPhoto);
        return;
      }
      const saved = await saveAvatar({ publicId: uploaded.public_id, version: uploaded.version });
      if (!saved.ok) {
        setError(saved.message ?? a.errPhoto);
        return;
      }
      router.refresh();
    } catch {
      setError(a.errPhoto);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const result = await removeAvatar();
      if (!result.ok) {
        setError(result.message ?? a.errGeneric);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name} url={url} size="h-16 w-16" />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink-soft">{a.photo}</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <div className="mt-1.5 flex flex-wrap gap-2">
          {enabled ? (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={SMALL_BUTTON}>
              {busy ? a.photoUploading : url ? a.changePhoto : a.addPhoto}
            </button>
          ) : null}
          {url ? (
            <button type="button" onClick={remove} disabled={busy} className={`${SMALL_BUTTON} text-ink-soft`}>
              {a.removePhoto}
            </button>
          ) : null}
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">
          {enabled ? a.photoHint : a.photoUnavailable}
        </p>
        {error ? <p className="mt-1 text-[12.5px] text-risk">{error}</p> : null}
      </div>
    </div>
  );
}

/** GDPR art. 15/20 — the whole account as a file the person keeps. */
export function DataExportCard() {
  const { t } = useI18n();
  const a = t.clientApp.account;
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setNote(null);
    start(async () => {
      const result = await downloadMyData();
      if (!result.ok || !result.json) {
        setNote(result.message ?? a.errGeneric);
        return;
      }
      // The action hands back a string rather than a URL: the file is built
      // from the person's own session and never has to exist on a server.
      const url = URL.createObjectURL(new Blob([result.json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename ?? "data.json";
      link.click();
      URL.revokeObjectURL(url);
      if (result.json.includes('"_errors"')) setNote(a.exportPartial);
    });
  }

  return (
    <Card plain>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{a.yourData}</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{a.exportBody}</p>
      <button onClick={run} disabled={pending} className={`${BUTTON} mt-4`}>
        {pending ? a.exportPending : a.exportButton}
      </button>
      {note ? <p className="mt-2.5 text-[12.5px] text-ink-faint">{note}</p> : null}
    </Card>
  );
}

/** GDPR art. 17. Typing DELETE is the confirmation the spec (G2) asks for. */
export function DeleteAccountCard() {
  const { t } = useI18n();
  const a = t.clientApp.account;
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      const result = await requestAccountDeletion();
      if (result.ok) {
        setDone(result.purgeAfter ? new Date(result.purgeAfter).toLocaleDateString() : "");
        return;
      }
      setError(result.message ?? a.errGeneric);
    });
  }

  if (done !== null) {
    return (
      <div className="rounded-3xl bg-risk-soft px-5 py-[18px]">
        <p className="text-[13.5px] leading-relaxed text-risk">{fill(a.deleteDone, { date: done })}</p>
      </div>
    );
  }

  return (
    <Card plain>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-risk">{a.deleteTitle}</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{a.deleteBody}</p>
      <label className="mt-3.5 block text-[13px] font-semibold text-ink-soft">
        {a.deleteConfirm}
        <input className={FIELD} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <button
        onClick={run}
        disabled={pending || confirm.trim().toUpperCase() !== "DELETE"}
        className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-risk px-5 font-display text-sm font-bold text-bg hover:opacity-90 disabled:opacity-40"
      >
        {pending ? a.deletePending : a.deleteButton}
      </button>
      {error ? <p className="mt-2.5 text-[13px] text-risk">{error}</p> : null}
    </Card>
  );
}
