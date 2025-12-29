import path from "path";
import fs from "fs";

import { Site } from "@/types";

export const DATA_DIR = path.join(process.cwd(), "local-data");
export const DAILY_DIR = path.join(DATA_DIR, "daily");

export const TR_DYNAMIC_PATH = path.join(DATA_DIR, "stocks-dynamic", "tr.json");

if (!fs.existsSync(TR_DYNAMIC_PATH)) {
  throw new Error(`File not found: ${TR_DYNAMIC_PATH}`);
}

export const OBSERVATION_START_DATE = "2024-12-30";

export const DAILY_SAVED_SYMBOLS = ["BGP", "USDTRY", "EURTRY", "GOLD"] as const;

export const TR_FUND_SYMBOLS: Site = {
  domain: "https://fintables.com/",
  endpoints: [
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

export const GENERIC_SYMBOLS: Site = {
  domain: "https://www.tradingview.com/",
  endpoints: [
    "symbols/USDTRY",
    "symbols/EURTRY",
    "symbols/BIST-ALTIN",
    "symbols/GOLD?exchange=TVC",
  ],
  querySelector:
    "#js-category-content > div.js-symbol-page-header-root > div > div.symbolRow-NopKb87z > div > div.quotesRow-iJMmXWiA > div:nth-child(1) > div > div.lastContainer-zoF9r75I > span.last-zoF9r75I.js-symbol-last",
};

export const TR_STOCK_SYMBOLS: Site = {
  domain: GENERIC_SYMBOLS.domain,
  querySelector: GENERIC_SYMBOLS.querySelector,
  endpoints: [],
};
