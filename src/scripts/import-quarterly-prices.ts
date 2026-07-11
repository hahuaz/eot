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
  const points = await fetchDailyHistory(yahooSymbol);
  if (points.length === 0) {
    throw new Error(`No price history returned for ${yahooSymbol}`);
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
