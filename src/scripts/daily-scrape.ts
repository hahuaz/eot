import fs from "fs";
import path from "path";

// execute config to load environment variables
import "../config";

import type { Site } from "../types/index";
import { scrape } from "../lib/scrape";
import { updateSheet } from "../lib/save-to-sheet";
import { parseCSV, unparseCSV } from "../lib/index";

import { Daily } from "../types/index";

const TR_STOCK_PATH = path.join(
  process.cwd(),
  "local-data",
  "stocks-dynamic",
  "tr.json",
);

if (!fs.existsSync(TR_STOCK_PATH)) {
  throw new Error(`File not found: ${TR_STOCK_PATH}`);
}

const TR_FUND_SITES: Site = {
  domain: "https://fintables.com/",
  resources: [
    "fonlar/ZBJ",
    "fonlar/PPN",
    "fonlar/BGP",
    "fonlar/DBB",
    "fonlar/GA1",
    "fonlar/GUB",
    "fonlar/MUT",
    "fonlar/HMG",
    "fonlar/APT",
    "fonlar/NRG",
    "fonlar/FIT",
    "fonlar/TP2",
    "fonlar/PRY",
    "fonlar/GTZ",
    "fonlar/GRO",
    "fonlar/EIL",
  ],
  querySelector:
    "div.flex-shrink-0.relative span.inline-flex.items-center.tabular-nums",
  isLocalTr: true,
};

const GENERIC_SITES: Site = {
  domain: "https://www.tradingview.com/",
  resources: [
    "symbols/USDTRY",
    "symbols/EURTRY",
    "symbols/BIST-ALTIN",
    "symbols/GOLD?exchange=TVC",
    "symbols/AMEX-GLD",
  ],
  querySelector:
    "#js-category-content > div.js-symbol-page-header-root > div > div.symbolRow-NopKb87z > div > div.quotesRow-iJMmXWiA > div:nth-child(1) > div > div.lastContainer-zoF9r75I > span.last-zoF9r75I.js-symbol-last",
};

const TR_STOCK_SITES: Site = {
  domain: "https://www.tradingview.com/",
  querySelector: GENERIC_SITES.querySelector,
  resources: [],
};

/**
 * It will populate the resources of tr stocks from local json file.
 */
function populateTrStockResources() {
  const trStocksJson = fs.readFileSync(TR_STOCK_PATH, "utf-8");
  const trStocks = JSON.parse(trStocksJson) as Record<string, any>;

  // Exclude "test" stock
  const trStockKeys = Object.keys(trStocks).filter((key) => key !== "test");
  if (trStockKeys.length === 0) {
    console.log("No TR stocks found, skipping.");
    return;
  }

  TR_STOCK_SITES.resources = trStockKeys.map((key) => `symbols/${key}`);
}

async function scrapeTrStocks() {
  const scrapeResult = await scrape([TR_STOCK_SITES]);
  const trStocksJson = fs.readFileSync(TR_STOCK_PATH, "utf-8");
  const trStocks = JSON.parse(trStocksJson) as Record<string, any>;

  for (const result of scrapeResult) {
    const stockSymbol = result.resource.split("/")[1];
    if (trStocks[stockSymbol]) {
      trStocks[stockSymbol].price = Number(result.value);
    }
  }

  fs.writeFileSync(TR_STOCK_PATH, JSON.stringify(trStocks, null, 2));
}

function updateCsvFile(
  filePath: string,
  currentDate: string,
  scrapeValue: string,
) {
  if (fs.existsSync(filePath)) {
    const dailyCsvContent = parseCSV<Daily>({ filePath, header: true });
    const { data: dailyData } = dailyCsvContent;
    const lastEntry = dailyData[0];

    if (lastEntry?.date === currentDate) {
      lastEntry.value = Number(scrapeValue);
    } else {
      dailyData.unshift({ date: currentDate, value: Number(scrapeValue) });
    }

    unparseCSV<Daily>({ data: dailyData, filePath, header: true });
  } else {
    const fileContent = `date,value\n${currentDate},${scrapeValue}\n`;
    fs.writeFileSync(filePath, fileContent);
  }
}

async function processGenericSites(
  genericSiteResults: any[],
  currentDate: string,
) {
  for (const scrape of genericSiteResults) {
    const fileName = `${scrape.resource}.csv`;
    const filePath = path.join(process.cwd(), "local-data", "daily", fileName);
    updateCsvFile(filePath, currentDate, scrape.value);
  }
  console.log("updated locale daily data");
}

async function processTrFunds(trFundsScrapeResult: any[], currentDate: string) {
  // some of resources will be saved to local-data/daily
  const selectedTrFunds = ["BGP"];
  for (const fund of selectedTrFunds) {
    const scrapeResult = trFundsScrapeResult.find(
      (scrape) => scrape.resource === fund,
    );
    if (scrapeResult) {
      const fileName = `${scrapeResult.resource}.csv`;
      const filePath = path.join(
        process.cwd(),
        "local-data",
        "daily",
        fileName,
      );
      updateCsvFile(filePath, currentDate, scrapeResult.value);
    } else {
      console.log(`no scrape result found for ${fund}`);
    }
  }
  console.log(`selected TR Funds updated in daily data`);
}

async function main() {
  const now = new Date();
  const currentDate = `${now.getFullYear()}/${
    now.getMonth() + 1
  }/${now.getDate()}`;

  populateTrStockResources();

  const genericSiteResults = await scrape([GENERIC_SITES]);
  await processGenericSites(genericSiteResults, currentDate);

  const trFundsScrapeResult = await scrape([TR_FUND_SITES]);
  await updateSheet([...trFundsScrapeResult, ...genericSiteResults]);
  console.log("updated TR Funds in Google Sheet");

  await processTrFunds(trFundsScrapeResult, currentDate);

  await scrapeTrStocks();
  console.log("scraped TR stocks and saved in local-data");

  console.log("all done!");
}

main();
