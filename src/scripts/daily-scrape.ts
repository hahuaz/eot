// execute config to load environment variables
import "@/config";

import fs from "fs";
import path from "path";

import type { DailyPrice, ScrapeItem } from "@/types";
import {
  scrape,
  updateSheet,
  updateCsvFile,
  TR_DYNAMIC_PATH,
  DAILY_SAVED_SYMBOLS,
  TR_FUND_SYMBOLS,
  GENERIC_SYMBOLS,
  TR_STOCK_SYMBOLS,
} from "@/lib/index";

async function scrapeTrStocks() {
  const trStocksJson = fs.readFileSync(TR_DYNAMIC_PATH, "utf-8");
  const trStocks = JSON.parse(trStocksJson) as Record<
    string,
    { price?: number }
  >;

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
      trStocks[stockSymbol].price = Number(result.value);
    }
  }

  fs.writeFileSync(TR_DYNAMIC_PATH, JSON.stringify(trStocks, null, 2));
}

function updateDailyCsv(symbol: string, currentDate: string, value: string) {
  const fileName = `${symbol}.csv`;
  const filePath = path.join(process.cwd(), "local-data", "daily", fileName);
  updateCsvFile<DailyPrice>(
    filePath,
    { date: currentDate, value: Number(value) },
    "date",
  );
}

function saveToLocalDailyCsv(allResults: ScrapeItem[], currentDate: string) {
  const filteredResults = allResults.filter((result) => {
    return DAILY_SAVED_SYMBOLS.includes(
      result.symbol as (typeof DAILY_SAVED_SYMBOLS)[number],
    );
  });
  for (const result of filteredResults) {
    updateDailyCsv(result.symbol, currentDate, result.value);
  }
  console.log("Updated local daily CSV files");
}

async function main() {
  try {
    const now = new Date();
    const currentDate = now.toLocaleDateString("en-CA"); // YYYY-MM-DD format

    const allResults = await scrape([GENERIC_SYMBOLS, TR_FUND_SYMBOLS]);

    await updateSheet(allResults);
    console.log("Updated Google Sheet with all scraped data");

    saveToLocalDailyCsv(allResults, currentDate);

    // await scrapeTrStocks();
    // console.log("scraped TR stocks and saved in local-data");

    console.log("all done!");
  } catch (error) {
    console.error("Error in main:", error);
    throw error;
  }
}

main();
