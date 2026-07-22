/**
 * Fetches TR (Borsa Istanbul) cash dividend history from Yahoo Finance's
 * chart API (events=div) for every symbol in stock_info, and upserts one
 * row per payment into stock_dividends - date, share price on that date,
 * gross ("total") dividend per share, net (after the region's dividend
 * withholding tax) dividend, and the resulting yield (gross dividend /
 * price).
 *
 * KAP (the official Turkish disclosure platform, already used for
 * outstanding_shares - see import-outstanding-shares-from-kap.ts) doesn't
 * have a bulk/structured dividend-per-share table like it does for paid-in
 * capital: dividend distributions are individual per-company "Kar Payı
 * Dağıtım İşlemlerine İlişkin Bildirim" notification pages, not a
 * comparison table - too brittle to scrape reliably at bulk-symbol scale.
 * Yahoo's dividend events were spot-checked against KAP instead: GARAN's
 * 2025-03-28 gross dividend from this endpoint (4.389285 TRY) matches KAP's
 * own announced figure (4.3892854 TRY) to 6 decimal places, and THYAO/ASELS
 * histories return plausible dates/amounts consistent with public
 * reporting - so Yahoo is used directly rather than attempting KAP first.
 *
 * stock_dividends has this script as its sole writer, so every run always
 * overwrites (no hand-entered data here to protect, unlike
 * quarterly_stock_prices' old dividend column this replaced).
 *
 * Usage:
 *   tsx src/scripts/import-tr-dividends.ts             # all TR symbols
 *   tsx src/scripts/import-tr-dividends.ts froto ahgaz  # only these
 */
import "@/config";

import { REGION_CONFIG } from "@/constants";
import { pool } from "@/db/pool";
import { getSymbols } from "@/db/stock-info.repository";
import { upsertDividend } from "@/db/stock-dividends.repository";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const REGION = "tr";
const HISTORY_RANGE = "max";

type DailyPoint = { date: Date; close: number };
type DividendEvent = { date: Date; amount: number };

function toYahooSymbol(symbol: string): string {
  return `${symbol.toUpperCase()}.IS`;
}

async function fetchChartData(
  yahooSymbol: string,
): Promise<{ points: DailyPoint[]; dividends: DividendEvent[] }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=${HISTORY_RANGE}&events=div`;
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
  const points: DailyPoint[] = timestamps
    .map((ts, i) => ({ date: new Date(ts * 1000), close: closes[i] }))
    .filter((point): point is DailyPoint => point.close != null);

  const dividendsRaw: Record<string, { date: number; amount: number }> =
    result.events?.dividends ?? {};
  const dividends: DividendEvent[] = Object.values(dividendsRaw).map(
    (event) => ({
      date: new Date(event.date * 1000),
      amount: event.amount,
    }),
  );

  return { points, dividends };
}

/** Last daily point on or before `target` (points assumed ascending by date). */
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

async function importSymbol(symbol: string): Promise<number> {
  const yahooSymbol = toYahooSymbol(symbol);
  const { points, dividends } = await fetchChartData(yahooSymbol);
  const { dividendTax } = REGION_CONFIG[REGION];

  let count = 0;
  for (const event of dividends) {
    const priceOnExDate = findClosestOnOrBefore(points, event.date);
    if (!priceOnExDate || priceOnExDate.close === 0) {
      console.warn(
        `${symbol} - no price found for ex-div date ${event.date.toISOString().slice(0, 10)}, skipping this dividend event`,
      );
      continue;
    }

    await upsertDividend(REGION, symbol, {
      date: event.date.getTime(),
      price: priceOnExDate.close,
      totalDividend: event.amount,
      netDividend: event.amount * (1 - dividendTax),
      netDividendYield:
        (event.amount * (1 - dividendTax)) / priceOnExDate.close,
    });
    count++;
  }

  return count;
}

async function main() {
  const only = process.argv.slice(2).map((s) => s.toLowerCase());

  const allSymbols = await getSymbols(REGION);
  const symbols = allSymbols.filter(
    (symbol) => only.length === 0 || only.includes(symbol),
  );

  console.log(`Importing dividends for ${symbols.length} TR symbol(s)...`);

  for (const symbol of symbols) {
    try {
      const count = await importSymbol(symbol);
      console.log(`${symbol} - upserted ${count} dividend payment(s)`);
    } catch (error) {
      console.error(`${symbol} - failed -`, error);
    }
  }

  console.log("Done.");
  await pool.end();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
