import {
  bigint,
  boolean,
  doublePrecision,
  index,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

// Which financial-statement template a symbol's quarterly PDF follows -
// null (the vast majority of symbols) means the general CMB/BIST template
// extract-financial-values.ts's base `sections` config targets. Banks
// (BDDK-regulated), insurers (SEDDK-regulated), and "finance" companies
// (BDDK-regulated factoring/leasing/consumer-finance/savings-finance firms,
// e.g. ktlev - a different BDDK chart of accounts than banks despite the
// same regulator) file under entirely different regulatory chart-of-accounts
// templates - different line-item vocabulary, different section structure,
// and (banks/finance specifically) different number formatting - so
// extraction needs to pick a matching keyword config per symbol rather than
// trying to make one shared config understand every template at once.
export const PDF_TYPES = ["bank", "insurance", "finance"] as const;
export type PdfType = (typeof PDF_TYPES)[number];

export const stockInfo = pgTable(
  "stock_info",
  {
    region: text("region").notNull(),
    symbol: text("symbol").notNull(),
    color: text("color"),
    notes: text("notes").array(),
    outstandingShares: doublePrecision("outstanding_shares"),
    trimDigit: doublePrecision("trim_digit"),
    pdfType: text("pdf_type").$type<PdfType>(),
  },
  (table) => [primaryKey({ columns: [table.region, table.symbol] })],
);

// quarter is '<year>Q<1-4>' or the CURRENT_PRICE_SENTINEL sentinel 'CURRENT'.
export const quarterlyStockPrices = pgTable(
  "quarterly_stock_prices",
  {
    region: text("region").notNull(),
    symbol: text("symbol").notNull(),
    quarter: text("quarter").notNull(),
    price: doublePrecision("price"),
  },
  (table) => [
    primaryKey({ columns: [table.region, table.symbol, table.quarter] }),
  ],
);

// One row per actual dividend payment (ex-dividend date)
export const stockDividends = pgTable(
  "stock_dividends",
  {
    region: text("region").notNull(),
    symbol: text("symbol").notNull(),
    date: bigint("date", { mode: "number" }).notNull(), // unix ms, ex-dividend date
    price: doublePrecision("price").notNull(), // share price on that date
    totalDividend: doublePrecision("total_dividend").notNull(), // gross, per share
    netDividend: doublePrecision("net_dividend").notNull(), // after region's dividend withholding tax. Tax could change overtime so save net as well.
    netDividendYield: doublePrecision("net_dividend_yield").notNull(), // netDividend / price
  },
  (table) => [
    primaryKey({ columns: [table.region, table.symbol, table.date] }),
  ],
);

// Source of truth for which non-BIST symbols (FX pairs, gold, TR funds,
// ...) the daily scrape tracks and how each one is fetched, plus which
// symbols the yield service exposes. BIST stocks are tracked separately,
// via stock_info.
export const SCRAPE_TYPES = ["fintables", "tradingview"] as const;
export type ScrapeType = (typeof SCRAPE_TYPES)[number];

export const symbols = pgTable("symbols", {
  symbol: text("symbol").primaryKey(),
  isDailySaved: boolean("is_daily_saved").notNull().default(false), // whether daily-scrape persists this symbol's price into symbol_prices
  scrapeType: text("scrape_type").$type<ScrapeType>(), // which scraper (fintables/tradingview) fetches this symbol's price - null if neither (e.g. a yield symbol whose price history is otherwise maintained)
  isYieldIncluded: boolean("is_yield_included").notNull().default(false), // whether the yield service exposes this symbol
  withholdingTax: doublePrecision("withholding_tax").notNull().default(0), // yield service: fraction withheld from raw yield, e.g. 0.175
  genUsdBench: boolean("gen_usd_bench").notNull().default(false), // yield service: also generate a `<symbol>_USDTRY` composite benchmarked against USDTRY
});

export const symbolPrices = pgTable(
  "symbol_prices",
  {
    symbol: text("symbol").notNull(),
    date: bigint("date", { mode: "number" }).notNull(),
    value: doublePrecision("value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.symbol, table.date] }),
    index("idx_symbol_prices_symbol_date").on(table.symbol, table.date.desc()),
  ],
);

export const qoqFinancialReports = pgTable(
  "qoq_financial_reports",
  {
    region: text("region").notNull(),
    symbol: text("symbol").notNull(),
    quarter: text("quarter").notNull(),
    cashAndEquivalents: doublePrecision("cash_and_equivalents"),
    financialInvestments: doublePrecision("financial_investments"),
    noncurrentFinancialInvestments: doublePrecision(
      "noncurrent_financial_investments",
    ),
    shortTermBorrowings: doublePrecision("short_term_borrowings"),
    currentPortionOfLongTermBorrowings: doublePrecision(
      "current_portion_of_long_term_borrowings",
    ),
    shortTermLeaseLiabilities: doublePrecision("short_term_lease_liabilities"),
    longTermBorrowings: doublePrecision("long_term_borrowings"),
    longTermLeaseLiabilities: doublePrecision("long_term_lease_liabilities"),
    equity: doublePrecision("equity"),
    totalAssets: doublePrecision("total_assets"),
    revenue: doublePrecision("revenue"),
    operatingIncome: doublePrecision("operating_income"),
    netIncome: doublePrecision("net_income"),
  },
  (table) => [
    primaryKey({ columns: [table.region, table.symbol, table.quarter] }),
  ],
);
