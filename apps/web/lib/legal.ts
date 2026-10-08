/**
 * The version of the Terms + Privacy Policy + health-data consent a person
 * agrees to, stored as `users.consent_version` (20261113110000). A date, so it
 * reads as "the text as of". Bump it when /terms or /privacy change in a way
 * people must agree to again; both layouts send anyone without a consent to
 * /complete-profile, which records it through accept_consent().
 */
export const CONSENT_VERSION = "2026-10-08";
