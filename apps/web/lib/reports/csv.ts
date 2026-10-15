// CSV for spreadsheets — RFC 4180, built cell by cell, never by string concatenation.
//
//   - UTF-8 with a byte-order mark, so Excel opens ă â î ș ț correctly (LibreOffice
//     and Google Sheets ignore the mark).
//   - Comma separated, CRLF line ends; a cell holding a comma, a quote, a CR or an
//     LF is quoted, and its quotes doubled.
//   - Numbers are written as plain numbers with a dot (ISO, the form every
//     spreadsheet import understands); missing values are empty cells — never 0.
//   - Formula injection: a TEXT cell that starts with = + - @ tab or CR would be
//     run as a formula by a spreadsheet ("=HYPERLINK(...)" typed as a food name).
//     Such a cell is prefixed with an apostrophe, the OWASP-recommended
//     neutraliser. Numeric cells are never touched, so −2.5 stays a number.
export type CsvCell = string | number | boolean | null | undefined;

export const CSV_BOM = "﻿";
const FORMULA_START = /^[=+\-@\t\r]/;

/** A text value made safe to open in a spreadsheet. */
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function numberCell(n: number): string {
  if (!Number.isFinite(n)) return "";
  // no exponent notation for ordinary values, no float noise past 6 decimals
  const rounded = Math.round(n * 1e6) / 1e6;
  return String(rounded);
}

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return numberCell(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  const text = neutralizeFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: header row, then one line per row. Every row must have the header's length. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    if (row.length !== headers.length) throw new Error(`CSV row has ${row.length} cells, header has ${headers.length}`);
    lines.push(row.map(csvCell).join(","));
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
