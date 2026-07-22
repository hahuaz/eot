/**
 * Fetches quarterly + current stock prices from Yahoo Finance's chart API
 * for every (region, symbol) in stock_info, and upserts them into
 * quarterly_stock_prices.
 *
 * Uses daily-interval history (not Yahoo's 3-month-interval buckets, whose
 * candle timestamps are anchored to each exchange's local quarter boundary
 * and drift across a UTC day depending on timezone - unreliable for
 * labelling quarters). Instead, for each calendar quarter we take the last
 * trading day on or before that quarter's end date.
 *
 * Every run also scans for suspiciously large single-day jumps (see
 * warnOnSuspiciousJumps) and prints a warning - this is how KBORU's
 * mistimed split adjustment was originally caught. It's detection only;
 * confirming the real split ratio/date and adding a KNOWN_SPLIT_TIMING_FIXES
 * entry is a manual follow-up.
 *
 * Usage:
 *   tsx src/scripts/import-quarterly-prices.ts                   # all stocks in stock_info
 *   tsx src/scripts/import-quarterly-prices.ts tr:garan us:aapl  # specific region:symbol pairs
 */
import "@/config";

import { pool } from "@/db/pool";
import { getStockInfoMap } from "@/db/stock-info.repository";
import {
  upsertCurrentPrice,
  upsertQuarterlyPrice,
} from "@/db/quarterly-stock-prices.repository";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

// Yahoo ticker suffix per region. TR stocks trade on Borsa Istanbul; US
// stocks need no suffix.
const REGION_YAHOO_SUFFIX: Record<string, string> = {
  tr: ".IS",
  us: "",
};

const HISTORY_RANGE = "10y";

type DailyPoint = { date: Date; close: number };

/**
 * Known cases where Yahoo's raw chart-API data applies a stock split's
 * price adjustment starting from the wrong date, confirmed against the
 * exchange's official disclosure. Every daily close strictly before
 * `appliedFrom` (the date Yahoo incorrectly started adjusting from) gets
 * divided by `factor` here, at fetch time, so every re-import self-heals
 * instead of needing a one-off DB patch that a later run would overwrite.
 */
const KNOWN_SPLIT_TIMING_FIXES: Record<
  string,
  Record<string, { appliedFrom: string; factor: number }>
> = {
  tr: {
    // KBORU did a 500% bonus capital increase (100M -> 600M TL, i.e. 6
    // shares for every 1 held) with KAP's confirmed ex-date of 2025-06-04,
    // but Yahoo's history shows the 6x price adjustment already applied
    // from 2025-01-02 onward - 5 months early.
    kboru: { appliedFrom: "2025-01-02", factor: 6 },
    // CCOLA did a 1000% bonus capital increase (254,370,782 -> 2,798,078,602
    // TL, exactly 11x shares) with KAP's confirmed free-share date of
    // 2024-08-13, but Yahoo's history jumps 846.00 -> 78.27 on 2024-08-01 -
    // 12 days early.
    ccola: { appliedFrom: "2024-08-01", factor: 11 },
    // BSOKE did a 300% *paid* rights issue (400M -> 1.6B TL, 4x shares at
    // ~1 TL nominal subscription) with KAP's confirmed rights-start date of
    // 2024-12-10, but Yahoo's history already shows the theoretical
    // ex-rights price (60.00 -> 15.47) on 2024-12-02 - 8 days early. Unlike
    // the bonus-issue cases above, a rights issue's price drop isn't a
    // clean share-count ratio (subscribers pay for the new shares), so this
    // factor is the ratio Yahoo's own (correctly computed, just
    // wrongly-dated) jump already reflects, not a KAP-published number.
    bsoke: { appliedFrom: "2024-12-02", factor: 3.8790358763541035 },
    // KONTR did a 100% *paid* rights issue (650M -> 1.3B TL, 2x shares at
    // ~1 TL nominal subscription, "0%" premium) with KAP's confirmed
    // rights-start date of 2025-12-09, but Yahoo's history already shows
    // the theoretical ex-rights price (33.40 -> 17.18) on 2025-12-01 - 8
    // days early. Same empirical-ratio caveat as BSOKE above.
    kontr: { appliedFrom: "2025-12-01", factor: 1.9439635754803675 },
  },
};

function applyKnownSplitTimingFixes(
  region: string,
  symbol: string,
  points: DailyPoint[],
): DailyPoint[] {
  const fix = KNOWN_SPLIT_TIMING_FIXES[region]?.[symbol];
  if (!fix) return points;

  const cutover = new Date(fix.appliedFrom).getTime();
  return points.map((point) =>
    point.date.getTime() < cutover
      ? { ...point, close: point.close / fix.factor }
      : point,
  );
}

// Consecutive trading days moving by more than this ratio is effectively
// impossible under normal trading (exchanges enforce daily price-move
// limits) - it almost always means a stock split's price adjustment landed
// on the wrong day in Yahoo's history, the same shape of bug KBORU had (see
// KNOWN_SPLIT_TIMING_FIXES). This only logs a warning for investigation -
// confirming the true split ratio/date needs checking the exchange's
// official disclosure, so nothing gets auto-corrected here.
const SUSPICIOUS_JUMP_RATIO = 1.5;

function warnOnSuspiciousJumps(
  region: string,
  symbol: string,
  points: DailyPoint[],
): void {
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const ratio = prev.close / curr.close;
    if (ratio <= SUSPICIOUS_JUMP_RATIO && ratio >= 1 / SUSPICIOUS_JUMP_RATIO) {
      continue;
    }

    console.warn(
      `⚠ ${region}:${symbol} - possible unadjusted split: ` +
        `${prev.date.toISOString().slice(0, 10)} (${prev.close.toFixed(2)}) -> ` +
        `${curr.date.toISOString().slice(0, 10)} (${curr.close.toFixed(2)}), ratio ${ratio.toFixed(2)}x`,
    );
  }
}

// TR quarterly prices only need to go back this far - anything older is
// being dropped in favor of this newer, self-healing import. Regions absent
// from this map (e.g. us) keep their full available history.
const REGION_EARLIEST_QUARTER: Partial<
  Record<string, { year: number; quarter: number }>
> = {
  tr: { year: 2024, quarter: 1 },
};

function quarterStartDate(year: number, quarter: number): Date {
  return new Date(Date.UTC(year, (quarter - 1) * 3, 1));
}

function toYahooSymbol(region: string, symbol: string): string {
  const suffix = REGION_YAHOO_SUFFIX[region];
  if (suffix == null) {
    throw new Error(`No Yahoo suffix mapping for region "${region}"`);
  }
  return `${symbol.toUpperCase()}${suffix}`;
}

async function fetchDailyHistory(yahooSymbol: string): Promise<DailyPoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=${HISTORY_RANGE}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  const data = await res.json();

  const result = data?.chart?.result?.[0];
  if (!result) {
    throw new Error(
      `Yahoo chart API error for ${yahooSymbol}: ${JSON.stringify(data?.chart?.error)}`,
    );
  }

  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

  return timestamps
    .map((ts, i) => ({ date: new Date(ts * 1000), close: closes[i] }))
    .filter((point): point is DailyPoint => point.close != null);
}

/** Calendar quarters from `firstDate` through the last fully completed quarter before `now`. */
function listCompletedQuarters(
  firstDate: Date,
  now: Date,
): { year: number; quarter: number }[] {
  const quarters: { year: number; quarter: number }[] = [];
  let year = firstDate.getUTCFullYear();
  let quarter = Math.ceil((firstDate.getUTCMonth() + 1) / 3);

  const currentYear = now.getUTCFullYear();
  const currentQuarter = Math.ceil((now.getUTCMonth() + 1) / 3);

  while (
    year < currentYear ||
    (year === currentYear && quarter < currentQuarter)
  ) {
    quarters.push({ year, quarter });
    quarter++;
    if (quarter > 4) {
      quarter = 1;
      year++;
    }
  }

  return quarters;
}

/**
 * End of the quarter's last calendar day (23:59:59.999 UTC), not midnight.
 * Yahoo's daily candles are timestamped at each exchange's market-open time
 * (e.g. ~06:30 UTC for Istanbul), which is after midnight UTC - comparing
 * against midnight would incorrectly exclude the quarter-end trading day
 * itself and silently fall back to the prior trading day.
 */
function quarterEndDate(year: number, quarter: number): Date {
  const endMonth = quarter * 3; // 3, 6, 9, 12
  return new Date(Date.UTC(year, endMonth, 0, 23, 59, 59, 999));
}

/** Last daily point on or before `target` (skips weekends/holidays since only trading days are present). */
function findClosestOnOrBefore(
  points: DailyPoint[],
  target: Date,
): DailyPoint | undefined {
  let result: DailyPoint | undefined;
  for (const point of points) {
    if (point.date.getTime() > target.getTime()) break;
    result = point;
  }
  return result;
}

async function importSymbol(region: string, symbol: string): Promise<number> {
  const yahooSymbol = toYahooSymbol(region, symbol);
  const rawPoints = await fetchDailyHistory(yahooSymbol);
  if (rawPoints.length === 0) {
    throw new Error(`No price history returned for ${yahooSymbol}`);
  }
  const fixedPoints = applyKnownSplitTimingFixes(region, symbol, rawPoints);

  // Scan the full fetched history (not just what's actually stored below),
  // so a floored region still gets flagged for splits sitting just outside
  // its stored window.
  warnOnSuspiciousJumps(region, symbol, fixedPoints);

  const floor = REGION_EARLIEST_QUARTER[region];
  const points = floor
    ? fixedPoints.filter(
        (point) =>
          point.date.getTime() >=
          quarterStartDate(floor.year, floor.quarter).getTime(),
      )
    : fixedPoints;
  if (points.length === 0) {
    console.warn(
      `${region}:${symbol} - no price history on/after ${floor!.year}Q${floor!.quarter}, skipping`,
    );
    return 0;
  }

  const quarters = listCompletedQuarters(points[0].date, new Date());

  let count = 0;
  for (const { year, quarter } of quarters) {
    const point = findClosestOnOrBefore(points, quarterEndDate(year, quarter));
    if (!point) continue; // not listed yet as of this quarter's end

    await upsertQuarterlyPrice(
      region,
      symbol,
      `${year}Q${quarter}`,
      point.close,
    );
    count++;
  }

  const latest = points[points.length - 1];
  await upsertCurrentPrice(region, symbol, latest.close);
  count++;

  return count;
}

async function main() {
  const argPairs = process.argv.slice(2);

  const targets: { region: string; symbol: string }[] = [];
  if (argPairs.length > 0) {
    for (const arg of argPairs) {
      const [region, symbol] = arg.split(":");
      if (!region || !symbol) {
        throw new Error(
          `Invalid target "${arg}", expected "<region>:<symbol>"`,
        );
      }
      targets.push({ region, symbol });
    }
  } else {
    for (const region of Object.keys(REGION_YAHOO_SUFFIX)) {
      const infoMap = await getStockInfoMap(region);
      for (const symbol of Object.keys(infoMap)) {
        if (symbol === "test") continue;
        targets.push({ region, symbol });
      }
    }
  }

  console.log(
    `Importing quarterly prices for ${targets.length} (region, symbol) pair(s)...`,
  );

  for (const { region, symbol } of targets) {
    try {
      const count = await importSymbol(region, symbol);
      console.log(`${region}:${symbol} - upserted ${count} price point(s)`);
    } catch (error) {
      console.error(`${region}:${symbol} - failed -`, error);
    }
  }

  console.log("Done.");
  await pool.end();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
