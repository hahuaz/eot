import path from "path";

import { Site } from "@/types";

export const DATA_DIR = path.join(process.cwd(), "local-data");
export const DAILY_DIR = path.join(DATA_DIR, "daily");

// TODO: client can pick observation start date
export const OBSERVATION_START_DATE = 1735516800000;
export const OBSERVATION_START_DATE_STR = "2024/12/30";

export const DAILY_SAVED_SYMBOLS = [
  "BGP",
  "TP2",
  "USDTRY",
  "EURTRY",
  "GOLD",
] as const;

export const TR_FUND_SYMBOLS: Site = {
  domain: "https://fintables.com/",
  endpoints: [
    "fonlar/BGP",
    "fonlar/TP2",
    "fonlar/PRY",
    "fonlar/GTZ",
    "fonlar/GRO",
    "fonlar/PNU",
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
    "symbols/AMEX-GLD",
  ],
  querySelector:
    "#js-category-content > div.js-symbol-page-header-root > div > div.symbolRow-IzU2Iqkz > div > div.quotesRow-QSRrQgkm > div:nth-child(1) > div > div.lastContainer-fzcYMweq > span.last-fzcYMweq.js-symbol-last",
};

export const TR_STOCK_SYMBOLS: Site = {
  domain: GENERIC_SYMBOLS.domain,
  querySelector: GENERIC_SYMBOLS.querySelector,
  endpoints: [],
};

export const ALL_TR_STOCK_SYMBOLS = [
  "agesa",
  "ahgaz",
  "aksen",
  "alfas",
  "anhyt",
  "ansgr",
  "arclk",
  "asels",
  "astor",
  "banvt",
  "basgz",
  "bimas",
  "bobet",
  "brsan",
  "bsoke",
  "ccola",
  "cimsa",
  "cvkmd",
  "desa",
  "doas",
  "eggub",
  "ekgyo",
  "enkai",
  "eregl",
  "eupwr",
  "froto",
  "garan",
  "genil",
  "gesan",
  "glyho",
  "goknr",
  "grsel",
  "gubrf",
  "httbt",
  "kboru",
  "kfein",
  "kimmr",
  "kontr",
  "koton",
  "ktlev",
  "lmkdc",
  "marbl",
  "megmt",
  "mgros",
  "mpark",
  "odine",
  "ofsym",
  "orge",
  "oyakc",
  "paseu",
  "penta",
  "pgsus",
  "pltur",
  "raysg",
  "rgyas",
  "rygyo",
  "rysas",
  "segmn",
  "sekur",
  "selec",
  "sokm",
  "suntk",
  "suwen",
  "tabgd",
  "tarkm",
  "tavhl",
  "tborg",
  "tcell",
  "test",
  "tgsas",
  "thyao",
  "toaso",
  "trgyo",
  "ttkom",
  "ttrak",
  "tuprs",
  "tursg",
  "ulker",
  "vakko",
  "vestl",
  "ykbnk",
  "zrgyo",
];
