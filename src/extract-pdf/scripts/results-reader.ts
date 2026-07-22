// Shared by every script that consumes basic-extract.ts's per-quarter
// resultsDir CSVs (push-detailed-results.ts -> Google Sheets,
// push-financial-reports-db.ts -> Postgres): quarter/symbol discovery, CSV
// parsing, and the quarter-only revenue derivation (year-to-date minus prior
// quarter). Kept as plain
// functions here (rather than importing basic-extract.ts itself) because
// basic-extract.ts runs its whole extraction pipeline as a side effect of
// being loaded - see generate-verify-html.ts's CRITICAL_LABELS comment for
// the same constraint.

import fs from "fs";
import path from "path";

export const ROOT_DIR = path.join(__dirname, "..");
// Sibling of assets/pdfs/ (same per-quarter shape) - see basic-extract.ts's
// RESULTS_ROOT_DIR.
export const RESULTS_ROOT_DIR = path.join(ROOT_DIR, "assets", "results");

// The three revenue-section labels basic-extract.ts writes (see its
// `sections.revenue.keywordSchemas`).
export const REVENUE_LABELS = [
  "hasılat",
  "esas faaliyet karı",
  "ana ortaklık payları",
];

export function symbolFromFilename(filename: string): string {
  return filename.replace(/\.csv$/i, "").toLowerCase();
}

export function parseCsv(filePath: string): string[][] {
  return fs
    .readFileSync(filePath, "utf-8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(","));
}

/** Parses a Turkish-formatted or plain-digit number token (e.g. "18.068.564", "(1.234)", "-1234") into a plain integer. */
export function parseTurkishNumber(token: string): number {
  const trimmed = token.trim();
  const isNegative = trimmed.startsWith("(") || trimmed.startsWith("-");
  const digits = trimmed.replace(/\D/g, "");
  return (parseInt(digits, 10) || 0) * (isNegative ? -1 : 1);
}

/**
 * Formats a plain integer back into a value string, matching the dot-free
 * convention basic-extract.ts's own resultsDir CSVs already use (see its
 * stripThousandsSeparators) - not toLocaleString("tr-TR"), which would
 * reintroduce literal "." thousands separators into the string pushed to
 * Sheets/the DB (the DB path happens to survive that via its own
 * parseTurkishNumber re-parse, but Sheets doesn't - it writes the dotted
 * string as-is).
 */
export function formatSummedNumber(n: number): string {
  return String(n);
}

export function quarterResultsDir(quarter: string): string {
  return path.join(RESULTS_ROOT_DIR, quarter);
}

/** Reads a resultsDir CSV back into a label -> value map, or null if that quarter/symbol was never processed. */
export function readCsvValues(csvPath: string): Record<string, string> | null {
  if (!fs.existsSync(csvPath)) return null;
  const [, ...dataRows] = parseCsv(csvPath);
  return Object.fromEntries(dataRows.map(([label, value]) => [label, value]));
}

/**
 * Every quarter with a results/ folder containing at least one CSV, e.g.
 * ["2026Q1", "2025Q4", ..., "2025Q1"] - newest first, which for this
 * "YYYYQN" naming is just a reverse plain string sort (each field is
 * fixed-width, so lexicographic order matches calendar order).
 */
export function discoverQuarters(): string[] {
  if (!fs.existsSync(RESULTS_ROOT_DIR)) return [];
  return fs
    .readdirSync(RESULTS_ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((quarter) => {
      const dir = quarterResultsDir(quarter);
      return (
        fs.existsSync(dir) &&
        fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith(".csv"))
      );
    })
    .sort()
    .reverse();
}

/** Every symbol that has a results CSV in at least one of `quarters`. */
export function discoverSymbols(quarters: string[]): string[] {
  const symbols = new Set<string>();
  for (const quarter of quarters) {
    for (const file of fs.readdirSync(quarterResultsDir(quarter))) {
      if (file.toLowerCase().endsWith(".csv")) {
        symbols.add(symbolFromFilename(file));
      }
    }
  }
  return Array.from(symbols).sort();
}

/**
 * Quarter immediately before `quarter` in calendar order (year-wraparound
 * aware: Q1 -> prior year's Q4), independent of whether that quarter's
 * results actually exist on disk.
 */
export function previousQuarter(quarter: string): string {
  const year = Number(quarter.slice(0, 4));
  const quarterNum = Number(quarter.slice(5));
  return quarterNum === 1 ? `${year - 1}Q4` : `${year}Q${quarterNum - 1}`;
}

/**
 * Per-symbol reporting-unit corrections: a company whose PDFs switched from
 * printing full TL figures to Bin TL (thousands) partway through its
 * history - basic-extract.ts just reads each quarter's printed number as-is
 * (see its stripThousandsSeparators), so every Kalem value in a quarter
 * before the switch is ~1000x too large relative to the same Kalem in a
 * quarter after it. Every value for a quarter strictly before
 * `beforeQuarter` is divided by `divisor` here at push time, so both
 * the DB and the Sheet see one consistent unit across a symbol's whole
 * history, without needing to edit the historical CSVs (which stay a
 * faithful record of exactly what each PDF printed). stock_info.trimDigit
 * must be set to `divisor` for these symbols to convert that consistent
 * unit back to real absolute value (see getStockData).
 *
 * tabgd, oyakc: both switched to Bin TL starting 2025Q4. lmkdc, pgsus: both
 * switched starting 2026Q1. All four spotted via a ~1000x single-quarter
 * Equity drop that detectScaleBreak below flags.
 */
export const SCALE_OVERRIDES: Record<
  string,
  { beforeQuarter: string; divisor: number }
> = {
  tabgd: { beforeQuarter: "2025Q4", divisor: 1000 },
  oyakc: { beforeQuarter: "2025Q4", divisor: 1000 },
  lmkdc: { beforeQuarter: "2026Q1", divisor: 1000 },
  pgsus: { beforeQuarter: "2026Q1", divisor: 1000 },
};

export function applyScaleOverride(
  quarter: string,
  symbol: string,
  values: Record<string, string>,
): Record<string, string> {
  const override = SCALE_OVERRIDES[symbol];
  if (!override || quarter >= override.beforeQuarter) return values;

  return Object.fromEntries(
    Object.entries(values).map(([label, value]) => [
      label,
      formatSummedNumber(
        Math.round(parseTurkishNumber(value) / override.divisor),
      ),
    ]),
  );
}

/**
 * Detects (doesn't correct anything) when Equity drops by ~2+ orders of
 * magnitude from the previous quarter to this one, after SCALE_OVERRIDES
 * has already been applied to both sides - the signature of a PDF quietly
 * switching its reporting unit that basic-extract.ts has no way to detect
 * on its own (it just reads the number printed for that quarter). Equity
 * only (not every Kalem label): it's a balance-sheet total that almost
 * never moves 50x+ in one quarter for a real business reason, unlike
 * income/debt lines, which can legitimately swing that hard (see e.g.
 * oyakc paying down a loan or a weak income quarter) and would just be
 * noise here. A quarter this fires for either needs a new SCALE_OVERRIDES
 * entry, or is a genuine (if extreme) event a human should glance at.
 *
 * Returns a warning string rather than logging directly - callers collect
 * these across the whole run and print them together at the end, so a hit
 * doesn't get lost between the per-symbol progress lines each push script
 * already prints. Returns null when nothing looks off.
 */
const SCALE_BREAK_DROP_RATIO = 50;
const SCALE_BREAK_LABEL = "ana ortaklığa ait özkaynaklar"; // Equity

export function detectScaleBreak(
  symbol: string,
  quarter: string,
  values: Record<string, string>,
): string | null {
  const value = values[SCALE_BREAK_LABEL];
  if (value === undefined) return null;

  const prevQuarter = previousQuarter(quarter);
  const prevValuesRaw = readCsvValues(
    path.join(quarterResultsDir(prevQuarter), `${symbol}.csv`),
  );
  if (!prevValuesRaw) return null;
  const prevValue = applyScaleOverride(prevQuarter, symbol, prevValuesRaw)[
    SCALE_BREAK_LABEL
  ];
  if (prevValue === undefined) return null;

  const current = Math.abs(parseTurkishNumber(value));
  const previous = Math.abs(parseTurkishNumber(prevValue));
  if (current === 0 || previous === 0) return null;

  if (previous / current < SCALE_BREAK_DROP_RATIO) return null;

  return `${symbol} Equity ${prevQuarter}->${quarter}: ${previous} -> ${current} (~${Math.round(previous / current)}x drop)`;
}

/**
 * basic-extract.ts's resultsDir CSVs hold the revenue-section labels as
 * year-to-date cumulative totals straight from the PDF - Q2 is Jan-Jun, Q3
 * is Jan-Sep, Q4 is the annual Jan-Dec total (annual reports never print a
 * separate Oct-Dec column to match against, so basic-extract.ts leaves it
 * untouched for verify.html to check against the PDF page). Only Q1's
 * year-to-date figure already equals its standalone-quarter figure.
 *
 * What gets pushed (to Sheets or the DB) needs each quarter's standalone
 * figure instead, so it's derived here at push time: subtract the prior
 * quarter's year-to-date figure from the current quarter's, for each
 * revenue-section label, without touching the on-disk CSV.
 *
 * Note: this assumes every quarter's saved value is a genuine year-to-date
 * figure, which is true for most symbols - but some (e.g. kfein - see
 * readme.md's 2025q3 note) never print a quarterly breakdown at all, so
 * this will under/over-subtract for them. Known cases like that need a
 * manual correction after pushing (same pattern as basic-extract.ts's
 * applyManualCorrections).
 *
 * Leaves `values` unchanged if `quarter` is a Q1, or if the prior quarter's
 * results are missing for this symbol (e.g. a company listed mid-year).
 */
export function applyQuarterOnlyRevenue(
  quarter: string,
  symbol: string,
  values: Record<string, string>,
): Record<string, string> {
  if (quarter.endsWith("Q1")) return values;

  const prevQuarter = previousQuarter(quarter);
  const prevValuesRaw = readCsvValues(
    path.join(quarterResultsDir(prevQuarter), `${symbol}.csv`),
  );
  if (!prevValuesRaw) {
    console.warn(
      `  ⚠ ${symbol} ${quarter}: missing ${prevQuarter} results, using year-to-date value as-is`,
    );
    return values;
  }
  const prevValues = applyScaleOverride(prevQuarter, symbol, prevValuesRaw);

  const adjusted = { ...values };
  for (const label of REVENUE_LABELS) {
    if (!(label in adjusted)) continue;

    adjusted[label] = formatSummedNumber(
      parseTurkishNumber(adjusted[label]) -
        parseTurkishNumber(prevValues[label] ?? "0"),
    );
  }
  return adjusted;
}
