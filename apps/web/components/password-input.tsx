"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";

/**
 * A password field with the eye that shows or hides what was typed. The toggle
 * is a real button (keyboard-reachable, labelled), not an icon on the input,
 * and it never submits the form. `className` is the input's own class list so
 * each form keeps its field style; the button is laid over the right edge.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & { className: string }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${className} pr-11`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t.login.hidePassword : t.login.showPassword}
        title={visible ? t.login.hidePassword : t.login.showPassword}
        aria-pressed={visible}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-faint hover:text-ink"
      >
        {visible ? (
          // eye with a slash: the password is showing, click to hide
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="M9.9 5.2A10.4 10.4 0 0 1 12 5c5 0 8.6 3.7 10 7-.5 1.1-1.2 2.3-2.2 3.4" />
            <path d="M6.6 6.6C4.4 8 3 10 2 12c1.4 3.3 5 7 10 7 1.5 0 2.9-.3 4.1-.9" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
            <path d="M2 12c1.4-3.3 5-7 10-7s8.6 3.7 10 7c-1.4 3.3-5 7-10 7S3.4 15.3 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
