import { getSymbolPriceHistory } from "@/db/yield-prices.repository";
import { parseQuarter } from "@/lib/dates";

const USDTRY_SYMBOL = "USDTRY";

export type UsdTryHistory = { date: number; value: number }[];

export function getUsdTryHistory(): Promise<UsdTryHistory> {
  return getSymbolPriceHistory(USDTRY_SYMBOL);
}

/** Returns last day of `quarter` (e.g. "2025Q1" -> 2025-03-31), as a UTC timestamp - the target date/USDTRY quote a quarter's figures are converted at. */
function quarterEndTimestamp(quarter: string): number {
  const { year, q } = parseQuarter(quarter);
  // Date.UTC's month is 0-indexed, so passing day 0 of month (q*3) rolls
  // back to the last day of the actual quarter-end month (e.g. q=1 ->
  // month index 3 = April -> day 0 = March 31).
  return Date.UTC(year, q * 3, 0);
}

/** Returns the closest daily USDTRY quote to `targetMs`, or null if nothing in history is within MAX_RATE_MATCH_DISTANCE_MS of it. */
function closestUsdTryRate(
  history: UsdTryHistory,
  targetMs: number,
): number | null {
  let closest: UsdTryHistory[number] | null = null;
  for (const entry of history) {
    if (
      closest == null ||
      Math.abs(entry.date - targetMs) < Math.abs(closest.date - targetMs)
    ) {
      closest = entry;
    }
  }

  // Why "closest" instead of an exact match: a true quarter-end is Mar 31/
  // Jun 30/Sep 30/Dec 31, but symbol_prices dates its rows on day
  // min(30, daysInMonth) instead (see import-usdtry-history.ts).
  // One day short of the real quarter-end.
  //
  // 10 days as the cutoff: comfortably covers that guaranteed 1-day gap
  // plus normal weekend/holiday slack, while still being tight enough that
  // a truly missing month can't accidentally match some other month's rate.
  const MAX_RATE_MATCH_DISTANCE_MS = 10 * 24 * 60 * 60 * 1000;
  if (
    closest == null ||
    Math.abs(closest.date - targetMs) > MAX_RATE_MATCH_DISTANCE_MS
  ) {
    return null;
  }

  return closest.value;
}

// TODO: no region check right now (always converts TRY->USD). US stocks
// are already USD-denominated, so this would produce wrong numbers for them.
export function toUsdValue(
  value: number,
  quarter: string,
  usdTryHistory: UsdTryHistory,
): number {
  const rate = closestUsdTryRate(usdTryHistory, quarterEndTimestamp(quarter));
  if (rate == null) {
    throw new Error(`No USDTRY rate available for quarter ${quarter}`);
  }

  return value / rate;
}
