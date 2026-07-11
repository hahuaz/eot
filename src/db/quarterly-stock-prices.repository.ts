import { pool } from "@/db/pool";

/**
 * Sentinel quarter value standing in for "current" (live/latest) price, so
 * this one table can hold both historical quarter closes and the current
 * price without a separate column.
 */
export const CURRENT_QUARTER = "CURRENT";

export type QuarterlyPriceRow = {
  price?: number;
  dividend?: number;
};

/**
 * Fetches every (region, symbol)'s current price, keyed by symbol.
 * Equivalent to what stock_prices.price used to provide directly.
 */
export async function getCurrentPricesMap(
  region: string,
): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ symbol: string; price: number | null }>(
    `SELECT symbol, price FROM quarterly_stock_prices WHERE region = $1 AND quarter = $2 AND price IS NOT NULL`,
    [region, CURRENT_QUARTER],
  );

  return Object.fromEntries(
    rows.map((row) => [row.symbol, row.price as number]),
  );
}

/**
 * Fetches a single (region, symbol)'s current price.
 */
export async function getCurrentPrice(
  region: string,
  symbol: string,
): Promise<number | undefined> {
  const { rows } = await pool.query<{ price: number | null }>(
    `SELECT price FROM quarterly_stock_prices WHERE region = $1 AND symbol = $2 AND quarter = $3`,
    [region, symbol, CURRENT_QUARTER],
  );

  return rows[0]?.price ?? undefined;
}

/**
 * Fetches the full quarterly price/dividend history for a (region, symbol),
 * keyed by quarter (including the CURRENT_QUARTER row, if present), ordered
 * oldest to newest.
 */
export async function getQuarterlyPriceHistory(
  region: string,
  symbol: string,
): Promise<Record<string, QuarterlyPriceRow>> {
  const { rows } = await pool.query<{
    quarter: string;
    price: number | null;
    dividend: number | null;
  }>(
    `SELECT quarter, price, dividend FROM quarterly_stock_prices
     WHERE region = $1 AND symbol = $2
     ORDER BY quarter ASC`,
    [region, symbol],
  );

  return Object.fromEntries(
    rows.map((row) => [
      row.quarter,
      {
        ...(row.price != null && { price: row.price }),
        ...(row.dividend != null && { dividend: row.dividend }),
      },
    ]),
  );
}

/**
 * Upserts just the current price for a (region, symbol).
 */
export async function upsertCurrentPrice(
  region: string,
  symbol: string,
  price: number,
): Promise<void> {
  await upsertQuarterlyPrice(region, symbol, CURRENT_QUARTER, price);
}

/**
 * Upserts a single historical quarter's price for a (region, symbol),
 * leaving any existing dividend value for that quarter untouched. Quarter
 * must be in '<year>Q<1-4>' form (e.g. '2025Q1'), or the CURRENT_QUARTER
 * sentinel.
 */
export async function upsertQuarterlyPrice(
  region: string,
  symbol: string,
  quarter: string,
  price: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO quarterly_stock_prices (region, symbol, quarter, price)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (region, symbol, quarter) DO UPDATE SET price = EXCLUDED.price`,
    [region, symbol.toLowerCase(), quarter, price],
  );
}

/**
 * Upserts a single quarter's dividend for a (region, symbol), leaving any
 * existing price for that quarter untouched.
 */
export async function upsertQuarterlyDividend(
  region: string,
  symbol: string,
  quarter: string,
  dividend: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO quarterly_stock_prices (region, symbol, quarter, dividend)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (region, symbol, quarter) DO UPDATE SET dividend = EXCLUDED.dividend`,
    [region, symbol.toLowerCase(), quarter, dividend],
  );
}
