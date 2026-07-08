import { Pool } from "pg";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }
  return url;
}

export const pool = new Pool({
  connectionString: getDatabaseUrl(),
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client:", err);
});

/**
 * Fetches the full ascending price history for a symbol from the symbol_prices table.
 */
export async function getSymbolPriceHistory(
  symbol: string,
): Promise<{ date: number; value: number }[]> {
  const { rows } = await pool.query<{ date: string; value: number }>(
    `SELECT date, value FROM symbol_prices WHERE symbol = $1 ORDER BY date ASC`,
    [symbol.toUpperCase()],
  );
  return rows.map((row) => ({ date: Number(row.date), value: row.value }));
}

/**
 * Upserts a single daily price point for a symbol, keyed on (symbol, date).
 */
export async function upsertSymbolPrice(
  symbol: string,
  date: number,
  value: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO symbol_prices (symbol, date, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (symbol, date) DO UPDATE SET value = EXCLUDED.value`,
    [symbol.toUpperCase(), date, value],
  );
}

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
