import { and, asc, eq, InferSelectModel, isNotNull } from "drizzle-orm";

import { db } from "@/db/pool";
import { quarterlyStockPrices } from "@/db/schema";

/**
 * Sentinel value stored in the `quarter` column standing in for the latest
 * price - not itself a quarter - so this one table can hold both historical
 * quarter closes and the current price without a separate column.
 */
export const CURRENT_PRICE_SENTINEL = "CURRENT";

export type QuarterlyStockPriceDbRow = InferSelectModel<
  typeof quarterlyStockPrices
>;

/**
 * Fetches every (region, symbol)'s current price, keyed by symbol.
 */
export async function getCurrentPricesMap(
  region: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      symbol: quarterlyStockPrices.symbol,
      price: quarterlyStockPrices.price,
    })
    .from(quarterlyStockPrices)
    .where(
      and(
        eq(quarterlyStockPrices.region, region),
        eq(quarterlyStockPrices.quarter, CURRENT_PRICE_SENTINEL),
        isNotNull(quarterlyStockPrices.price),
      ),
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
  const rows = await db
    .select({ price: quarterlyStockPrices.price })
    .from(quarterlyStockPrices)
    .where(
      and(
        eq(quarterlyStockPrices.region, region),
        eq(quarterlyStockPrices.symbol, symbol),
        eq(quarterlyStockPrices.quarter, CURRENT_PRICE_SENTINEL),
      ),
    );

  return rows[0]?.price ?? undefined;
}

/**
 * Fetches the full quarterly price history for a (region, symbol), keyed by
 * quarter (including the CURRENT_PRICE_SENTINEL row, if present), ordered oldest
 * to newest. Quarters with no price recorded are omitted.
 */
export async function getQuarterlyPriceHistory(
  region: string,
  symbol: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      quarter: quarterlyStockPrices.quarter,
      price: quarterlyStockPrices.price,
    })
    .from(quarterlyStockPrices)
    .where(
      and(
        eq(quarterlyStockPrices.region, region),
        eq(quarterlyStockPrices.symbol, symbol),
      ),
    )
    .orderBy(asc(quarterlyStockPrices.quarter));

  return Object.fromEntries(
    rows
      .filter((row) => row.price != null)
      .map((row) => [row.quarter, row.price as number]),
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
  await upsertQuarterlyPrice(region, symbol, CURRENT_PRICE_SENTINEL, price);
}

/**
 * Upserts a single historical quarter's price for a (region, symbol).
 * Quarter must be in '<year>Q<1-4>' form (e.g. '2025Q1'), or the
 * CURRENT_PRICE_SENTINEL sentinel.
 */
export async function upsertQuarterlyPrice(
  region: string,
  symbol: string,
  quarter: string,
  price: number,
): Promise<void> {
  await db
    .insert(quarterlyStockPrices)
    .values({ region, symbol: symbol.toLowerCase(), quarter, price })
    .onConflictDoUpdate({
      target: [
        quarterlyStockPrices.region,
        quarterlyStockPrices.symbol,
        quarterlyStockPrices.quarter,
      ],
      set: { price },
    });
}
