// Profile field rules shared by the sign-up form, the complete-profile step and
// the server action that saves them. Mirrors users_username_format in SQL
// (migration 20260910100000).

export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.]{2,23}$/;
export const MIN_AGE = 13;
export const MAX_AGE = 100;

export const SEXES = ["male", "female", "other"] as const;

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value.trim());
}

export function isValidAge(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_AGE && value <= MAX_AGE;
}

/** users.birth_year is what the database stores; the form asks for an age. */
export function birthYearFromAge(age: number, now = new Date()): number {
  return now.getFullYear() - age;
}
