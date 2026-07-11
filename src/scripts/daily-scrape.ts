// execute config to load environment variables
import "@/config";

import type { ScrapeItem } from "@/types";
import {
  scrape,
  updateScrapeSheet,
  DAILY_SAVED_SYMBOLS,
  TR_FUND_SYMBOLS,
  GENERIC_SYMBOLS,
  TR_STOCK_SYMBOLS,
} from "@/lib/index";
import { upsertSymbolPrice } from "@/db/yield-prices.repository";
import { getStockInfoMap } from "@/db/stock-info.repository";
import { upsertCurrentPrice } from "@/db/quarterly-stock-prices.repository";

const TR_REGION = "tr";

async function scrapeTrStocks() {
  const trStocks = await getStockInfoMap(TR_REGION);

  const trStockKeys = Object.keys(trStocks).filter((key) => key !== "test");
  if (trStockKeys.length === 0) {
    console.log("No TR stocks found, skipping.");
    return;
  }

  TR_STOCK_SYMBOLS.endpoints = trStockKeys.map((key) => `symbols/${key}`);

  const scrapeResults = await scrape([TR_STOCK_SYMBOLS]);

  for (const result of scrapeResults) {
    const stockSymbol = result.symbol;
    if (trStocks[stockSymbol]) {
      // only the current price gets overridden; color/notes are untouched
      await upsertCurrentPrice(TR_REGION, stockSymbol, Number(result.value));
    }
  }
}

async function saveToSymbolPricesTable(
  allResults: ScrapeItem[],
  currentDate: number,
) {
  const filteredResults = allResults.filter((result) => {
    return DAILY_SAVED_SYMBOLS.includes(
      result.symbol as (typeof DAILY_SAVED_SYMBOLS)[number],
    );
  });
  for (const result of filteredResults) {
    await upsertSymbolPrice(result.symbol, currentDate, Number(result.value));
  }
  console.log("Updated symbol_prices table in Postgres");
}

async function main() {
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Set to start of day
    const currentDate = now.getTime(); // Unix timestamp at start of day

    const allResults = await scrape([GENERIC_SYMBOLS, TR_FUND_SYMBOLS]);

    await updateScrapeSheet(allResults);
    console.log("Updated Google Sheet with all scraped data");

    await saveToSymbolPricesTable(allResults, currentDate);

    // await scrapeTrStocks();
    // console.log("scraped TR stocks and saved to stock_prices table");

    console.log("all done!");
  } catch (error) {
    console.error("Error in main:", error);
    throw error;
  }
}

main();
