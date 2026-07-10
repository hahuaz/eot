import { pool } from "@/db/pool";

export type StockPriceRow = {
  price: number;
  color?: string;
  notes?: string[];
};

/**
 * Fetches all stock_prices rows for a region, keyed by symbol. Unlike
 * symbol_prices, this table has no time dimension: each (region, symbol)
 * has exactly one current row that gets overwritten in place.
 */
export async function getStockPricesMap(
  region: string,
): Promise<Record<string, StockPriceRow>> {
  const { rows } = await pool.query<{
    symbol: string;
    price: number;
    color: string | null;
    notes: string[] | null;
  }>(`SELECT symbol, price, color, notes FROM stock_prices WHERE region = $1`, [
    region,
  ]);

  return Object.fromEntries(
    rows.map((row) => [
      row.symbol,
      {
        price: row.price,
        ...(row.color ? { color: row.color } : {}),
        ...(row.notes && row.notes.length > 0 ? { notes: row.notes } : {}),
      },
    ]),
  );
}

/**
 * Fetches a single (region, symbol) row. Used when only one stock is
 * needed, so callers don't have to pull the whole region's table just to
 * read one row.
 */
export async function getStockPrice(
  region: string,
  symbol: string,
): Promise<StockPriceRow | undefined> {
  const { rows } = await pool.query<{
    symbol: string;
    price: number;
    color: string | null;
    notes: string[] | null;
  }>(
    `SELECT symbol, price, color, notes FROM stock_prices WHERE region = $1 AND symbol = $2`,
    [region, symbol],
  );

  const row = rows[0];
  if (!row) {
    return undefined;
  }

  return {
    price: row.price,
    ...(row.color ? { color: row.color } : {}),
    ...(row.notes && row.notes.length > 0 ? { notes: row.notes } : {}),
  };
}

/**
 * Overrides just the current price for a (region, symbol), leaving any
 * existing color/notes untouched.
 */
export async function upsertStockPrice(
  region: string,
  symbol: string,
  price: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO stock_prices (region, symbol, price)
     VALUES ($1, $2, $3)
     ON CONFLICT (region, symbol) DO UPDATE SET price = EXCLUDED.price`,
    [region, symbol.toLowerCase(), price],
  );
}

/**
 * Upserts the full record (price + color + notes) for a (region, symbol).
 * Intended for the one-off JSON backfill, not for routine price updates.
 */
export async function upsertStockDynamicInfo(
  region: string,
  symbol: string,
  data: StockPriceRow,
): Promise<void> {
  await pool.query(
    `INSERT INTO stock_prices (region, symbol, price, color, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (region, symbol) DO UPDATE
       SET price = EXCLUDED.price, color = EXCLUDED.color, notes = EXCLUDED.notes`,
    [
      region,
      symbol.toLowerCase(),
      data.price,
      data.color ?? null,
      data.notes ?? null,
    ],
  );
}
