import { and, asc, eq, InferSelectModel } from "drizzle-orm";

import { db } from "@/db/pool";
import { stockInfo } from "@/db/schema";

export type StockInfoDbRow = InferSelectModel<typeof stockInfo>;

/**
 * Every symbol tracked for `region` - stock_info is the source of truth for
 * which symbols exist (other tables like qoq_financial_reports/
 * quarterly_stock_prices only have data for a symbol once their own
 * pipelines have run for it).
 */
export async function getSymbols(region: string): Promise<string[]> {
  const rows = await db
    .select({ symbol: stockInfo.symbol })
    .from(stockInfo)
    .where(eq(stockInfo.region, region))
    .orderBy(asc(stockInfo.symbol));

  return rows.map((row) => row.symbol);
}

// color/notes pass through as-is (null when unset) - callers handle that,
// this isn't the place to shape them for display. outstandingShares/
// trimDigit narrow to plain numbers since both functions below throw if
// either is still null.
type StockInfoValue = {
  color: string | null;
  notes: string[] | null;
  outstandingShares: number;
  trimDigit: number;
};

/**
 * Fetches all stock_info rows for a region, keyed by symbol.
 */
export async function getStockInfoMap(
  region: string,
): Promise<Record<string, StockInfoValue>> {
  const rows = await db
    .select()
    .from(stockInfo)
    .where(eq(stockInfo.region, region));

  return Object.fromEntries(
    rows.map((row) => {
      if (row.outstandingShares == null || row.trimDigit == null) {
        throw new Error(
          `stock_info row for ${region}:${row.symbol} is missing outstandingShares/trimDigit - set both via upsertStockInfo before it can be read.`,
        );
      }

      return [
        row.symbol,
        {
          color: row.color,
          notes: row.notes,
          outstandingShares: row.outstandingShares,
          trimDigit: row.trimDigit,
        },
      ];
    }),
  );
}

/**
 * Fetches a single (region, symbol) row - color/notes plus valuation config,
 * all four stock_info fields together. Used when only one stock is needed,
 * so callers don't have to pull the whole region's table just to read one
 * row.
 */
export async function getStockInfo(
  region: string,
  symbol: string,
): Promise<StockInfoValue> {
  const rows = await db
    .select()
    .from(stockInfo)
    .where(and(eq(stockInfo.region, region), eq(stockInfo.symbol, symbol)));

  const row = rows[0];
  if (!row) {
    throw new Error(`stock_info row for ${region}:${symbol} is not found.`);
  }

  if (row.outstandingShares == null || row.trimDigit == null) {
    throw new Error(
      `stock_info row for ${region}:${symbol} is missing outstandingShares/trimDigit`,
    );
  }

  return {
    color: row.color,
    notes: row.notes,
    outstandingShares: row.outstandingShares,
    trimDigit: row.trimDigit,
  };
}

/**
 * Upserts a stock_info record for a (region, symbol) - a true partial
 * patch, every field independent of every other: only the fields actually
 * passed get written, anything omitted is left exactly as it is.
 */
export async function upsertStockInfo(
  region: string,
  symbol: string,
  data: {
    color?: string;
    notes?: string[];
    outstandingShares?: number;
    trimDigit?: number;
  },
): Promise<void> {
  const fields: Partial<{
    color: string;
    notes: string[];
    outstandingShares: number;
    trimDigit: number;
  }> = {};
  if (data.color !== undefined) fields.color = data.color;
  if (data.notes !== undefined) fields.notes = data.notes;
  if (data.outstandingShares !== undefined) {
    fields.outstandingShares = data.outstandingShares;
  }
  if (data.trimDigit !== undefined) fields.trimDigit = data.trimDigit;

  await db
    .insert(stockInfo)
    .values({ region, symbol: symbol.toLowerCase(), ...fields })
    .onConflictDoUpdate({
      target: [stockInfo.region, stockInfo.symbol],
      set: fields,
    });
}

/**
 * Fetches every (region, symbol)'s outstanding_shares, keyed by symbol -
 * only symbols that already have a stock_info row (nothing is created
 * here). Used by share-count refreshes that only care about updating
 * existing symbols, not the full valuation config.
 */
export async function getOutstandingSharesMap(
  region: string,
): Promise<Record<string, number | null>> {
  const rows = await db
    .select({
      symbol: stockInfo.symbol,
      outstandingShares: stockInfo.outstandingShares,
    })
    .from(stockInfo)
    .where(eq(stockInfo.region, region));

  return Object.fromEntries(
    rows.map((row) => [row.symbol, row.outstandingShares]),
  );
}
