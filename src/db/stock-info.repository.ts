import { pool } from "@/db/pool";

export type StockInfoRow = {
  color?: string;
  notes?: string[];
};

/**
 * Fetches all stock_info rows for a region, keyed by symbol. Price now
 * lives separately in quarterly_stock_prices; this table is just the
 * per-stock metadata (color/notes) that gets overwritten in place.
 */
export async function getStockInfoMap(
  region: string,
): Promise<Record<string, StockInfoRow>> {
  const { rows } = await pool.query<{
    symbol: string;
    color: string | null;
    notes: string[] | null;
  }>(`SELECT symbol, color, notes FROM stock_info WHERE region = $1`, [region]);

  return Object.fromEntries(
    rows.map((row) => [
      row.symbol,
      {
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
export async function getStockInfo(
  region: string,
  symbol: string,
): Promise<StockInfoRow | undefined> {
  const { rows } = await pool.query<{
    symbol: string;
    color: string | null;
    notes: string[] | null;
  }>(
    `SELECT symbol, color, notes FROM stock_info WHERE region = $1 AND symbol = $2`,
    [region, symbol],
  );

  const row = rows[0];
  if (!row) {
    return undefined;
  }

  return {
    ...(row.color ? { color: row.color } : {}),
    ...(row.notes && row.notes.length > 0 ? { notes: row.notes } : {}),
  };
}

/**
 * Upserts the color/notes record for a (region, symbol).
 */
export async function upsertStockInfo(
  region: string,
  symbol: string,
  data: StockInfoRow,
): Promise<void> {
  await pool.query(
    `INSERT INTO stock_info (region, symbol, color, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (region, symbol) DO UPDATE
       SET color = EXCLUDED.color, notes = EXCLUDED.notes`,
    [region, symbol.toLowerCase(), data.color ?? null, data.notes ?? null],
  );
}

export type StockConfigRow = {
  outstandingShares: number;
  trimDigit: number;
  selectedGrowthMetrics: string[];
};

/**
 * Fetches the valuation config (outstandingShares, trimDigit,
 * selectedGrowthMetrics) for a (region, symbol) - formerly the CSV's
 * #config row.
 */
export async function getStockConfig(
  region: string,
  symbol: string,
): Promise<StockConfigRow | undefined> {
  const { rows } = await pool.query<{
    outstanding_shares: number | null;
    trim_digit: number | null;
    growth_selection: string[] | null;
  }>(
    `SELECT outstanding_shares, trim_digit, growth_selection FROM stock_info
     WHERE region = $1 AND symbol = $2`,
    [region, symbol],
  );

  const row = rows[0];
  if (
    !row ||
    row.outstanding_shares == null ||
    row.trim_digit == null ||
    row.growth_selection == null
  ) {
    return undefined;
  }

  return {
    outstandingShares: row.outstanding_shares,
    trimDigit: row.trim_digit,
    selectedGrowthMetrics: row.growth_selection,
  };
}

/**
 * Upserts just the valuation config for a (region, symbol), leaving any
 * existing color/notes untouched.
 */
export async function upsertStockConfig(
  region: string,
  symbol: string,
  config: StockConfigRow,
): Promise<void> {
  await pool.query(
    `INSERT INTO stock_info (region, symbol, outstanding_shares, trim_digit, growth_selection)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (region, symbol) DO UPDATE
       SET outstanding_shares = EXCLUDED.outstanding_shares,
           trim_digit = EXCLUDED.trim_digit,
           growth_selection = EXCLUDED.growth_selection`,
    [
      region,
      symbol.toLowerCase(),
      config.outstandingShares,
      config.trimDigit,
      config.selectedGrowthMetrics,
    ],
  );
}
