import { asc, eq, InferSelectModel } from "drizzle-orm";

import { db } from "@/db/pool";
import { symbolPrices } from "@/db/schema";

export type SymbolPriceDbRow = InferSelectModel<typeof symbolPrices>;

/**
 * Fetches the full ascending price history for a symbol from the symbol_prices table.
 */
export async function getSymbolPriceHistory(
  symbol: string,
): Promise<{ date: number; value: number }[]> {
  return db
    .select({ date: symbolPrices.date, value: symbolPrices.value })
    .from(symbolPrices)
    .where(eq(symbolPrices.symbol, symbol.toUpperCase()))
    .orderBy(asc(symbolPrices.date));
}

/**
 * Upserts a single daily price point for a symbol, keyed on (symbol, date).
 */
export async function upsertSymbolPrice(
  symbol: string,
  date: number,
  value: number,
): Promise<void> {
  await db
    .insert(symbolPrices)
    .values({ symbol: symbol.toUpperCase(), date, value })
    .onConflictDoUpdate({
      target: [symbolPrices.symbol, symbolPrices.date],
      set: { value },
    });
}
