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
