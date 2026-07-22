import { asc, eq, InferSelectModel } from "drizzle-orm";

import { db } from "@/db/pool";
import { ScrapeType, symbols } from "@/db/schema";

export type SymbolDbRow = InferSelectModel<typeof symbols>;

/**
 * All symbols fetched by a given scraper (fintables/tradingview), e.g. the
 * TR fund codes vs. the generic FX/gold symbols daily-scrape pulls from
 * TradingView directly (BIST stocks aren't here - those come from
 * stock_info).
 */
export async function getSymbolsByScrapeType(
  scrapeType: ScrapeType,
): Promise<string[]> {
  const rows = await db
    .select({ symbol: symbols.symbol })
    .from(symbols)
    .where(eq(symbols.scrapeType, scrapeType))
    .orderBy(asc(symbols.symbol));

  return rows.map((row) => row.symbol);
}

/** Every symbol whose daily price should be persisted into symbol_prices. */
export async function getDailySavedSymbols(): Promise<Set<string>> {
  const rows = await db
    .select({ symbol: symbols.symbol })
    .from(symbols)
    .where(eq(symbols.isDailySaved, true));

  return new Set(rows.map((row) => row.symbol));
}

export type YieldSymbolConfig = {
  symbol: string;
  withholdingTax: number;
  genUsdBench: boolean;
};

/** Get ever symbol that is included in yield calculations. */
export async function getYieldSymbols(): Promise<YieldSymbolConfig[]> {
  return db
    .select({
      symbol: symbols.symbol,
      withholdingTax: symbols.withholdingTax,
      genUsdBench: symbols.genUsdBench,
    })
    .from(symbols)
    .where(eq(symbols.isYieldIncluded, true))
    .orderBy(asc(symbols.symbol));
}

/**
 * Upserts a symbol's tracking config, keyed on symbol - a true partial
 * patch, only the fields actually passed get written.
 */
export async function upsertSymbol(
  symbol: string,
  data: {
    scrapeType?: ScrapeType;
    isDailySaved?: boolean;
    isYieldIncluded?: boolean;
    withholdingTax?: number;
    genUsdBench?: boolean;
  },
): Promise<void> {
  const fields: Partial<{
    scrapeType: ScrapeType;
    isDailySaved: boolean;
    isYieldIncluded: boolean;
    withholdingTax: number;
    genUsdBench: boolean;
  }> = {};
  if (data.scrapeType !== undefined) fields.scrapeType = data.scrapeType;
  if (data.isDailySaved !== undefined) fields.isDailySaved = data.isDailySaved;
  if (data.isYieldIncluded !== undefined) {
    fields.isYieldIncluded = data.isYieldIncluded;
  }
  if (data.withholdingTax !== undefined) {
    fields.withholdingTax = data.withholdingTax;
  }
  if (data.genUsdBench !== undefined) fields.genUsdBench = data.genUsdBench;

  await db
    .insert(symbols)
    .values({ symbol: symbol.toUpperCase(), ...fields })
    .onConflictDoUpdate({
      target: [symbols.symbol],
      set: fields,
    });
}
