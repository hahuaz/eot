import { and, asc, eq, InferSelectModel } from "drizzle-orm";

import { db } from "@/db/pool";
import { stockDividends } from "@/db/schema";

export type StockDividendDbRow = InferSelectModel<typeof stockDividends>;

/**
 * Every dividend payment on record for a (region, symbol), oldest to
 * newest. One row per ex-dividend date - callers that need a per-quarter
 * figure (e.g. for display) should bucket/sum these themselves.
 */
export async function getDividendHistory(
  region: string,
  symbol: string,
): Promise<StockDividendDbRow[]> {
  return db
    .select()
    .from(stockDividends)
    .where(
      and(
        eq(stockDividends.region, region),
        eq(stockDividends.symbol, symbol.toLowerCase()),
      ),
    )
    .orderBy(asc(stockDividends.date));
}

/**
 * Upserts a single dividend payment, keyed on (region, symbol, date).
 */
export async function upsertDividend(
  region: string,
  symbol: string,
  data: {
    date: number;
    price: number;
    totalDividend: number;
    netDividend: number;
    netDividendYield: number;
  },
): Promise<void> {
  await db
    .insert(stockDividends)
    .values({ region, symbol: symbol.toLowerCase(), ...data })
    .onConflictDoUpdate({
      target: [
        stockDividends.region,
        stockDividends.symbol,
        stockDividends.date,
      ],
      set: {
        price: data.price,
        totalDividend: data.totalDividend,
        netDividend: data.netDividend,
        netDividendYield: data.netDividendYield,
      },
    });
}
