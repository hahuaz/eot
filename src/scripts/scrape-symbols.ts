// execute config to load environment variables
import "@/config";

import type { ScrapeItem } from "@/types";
import {
  fetchFintables,
  fetchTradingViewPrices,
  updateSheetSymbols,
} from "@/lib/index";
import { upsertSymbolPrice } from "@/db/yield-prices.repository";
import { getSymbols } from "@/db/stock-info.repository";
import { upsertCurrentPrice } from "@/db/quarterly-stock-prices.repository";
import {
  getDailySavedSymbols,
  getSymbolsByScrapeType,
} from "@/db/symbols.repository";

const TR_REGION = "tr";

async function scrapeTrStocks() {
  const symbols = await getSymbols(TR_REGION);
  if (symbols.length === 0) {
    console.log("No TR stocks found, skipping.");
    return;
  }

  const results = await fetchTradingViewPrices(symbols, true);

  for (const result of results) {
    // only the current price gets overridden; color/notes are untouched
    await upsertCurrentPrice(TR_REGION, result.symbol, Number(result.value));
  }
}

async function saveToSymbolPricesTable(
  allResults: ScrapeItem[],
  currentDate: number,
) {
  const dailySavedSymbols = await getDailySavedSymbols();
  const filteredResults = allResults.filter((result) =>
    dailySavedSymbols.has(result.symbol.toUpperCase()),
  );
  for (const result of filteredResults) {
    await upsertSymbolPrice(result.symbol, currentDate, Number(result.value));
  }
  console.log("Updated symbol_prices table.");
}

async function main() {
  try {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0); // Set to start of day (UTC)
    const currentDate = now.getTime(); // Unix timestamp at start of day

    const [tradingviewSymbols, fintablesSymbols] = await Promise.all([
      getSymbolsByScrapeType("tradingview"),
      getSymbolsByScrapeType("fintables"),
    ]);
    const [tradingviewResults, fintableResults] = await Promise.all([
      fetchTradingViewPrices(tradingviewSymbols, false),
      fetchFintables(fintablesSymbols),
    ]);
    const allResults = [...tradingviewResults, ...fintableResults];

    await updateSheetSymbols(allResults);
    console.log("Existing rows updated for sheet");

    await saveToSymbolPricesTable(allResults, currentDate);

    await scrapeTrStocks();
    console.log("scraped TR stocks and saved to stock_prices table");

    console.log("all done!");
  } catch (error) {
    console.error("Error in main:", error);
    throw error;
  }
}

main();
