// Branded so a plain string can't be passed where a StockSymbol is expected
export type StockSymbol = string & { readonly __brand: "StockSymbol" };

export type CumulativeYield = {
  date: number;
  // e.g. 0.05 means a 5% increase
  value: number;
};

export type YoyYield = {
  date: number;
  // Date 1 year ago used as baseline, or oldest available if 1 year not available
  baselineDate: number;
  // Actual days passed from baseline
  daysPassed: number;
  // e.g. 0.05 means a 5% annualized return
  yoyReturnPercent: number;
};

// One entry per yield-included symbol (base symbols from the symbols table
// plus their generated `<symbol>_USDTRY` composites) - see
// YieldService.getAllYieldData.
export type YieldSymbolData = {
  symbol: string;
  cumulativeYields: CumulativeYield[];
  yoyYields: YoyYield[];
};

// --- Stock data (qoq_financial_reports) ---
//
// qoq_financial_reports stores every "Kalem" line item extract-pdf's
// basic-extract.ts pulls out as its own column - but the metrics below sum
// several of those columns back into "Cash and equivalents"/"Short term
// debt"/"Long term debt" at read time (see StockService), so the page shows
// consolidated figures while the DB keeps the finer-grained data underneath.
// Quarters aren't a fixed list: only whatever quarters have actually been
// pushed so far, so the response carries its own `quarters` list instead of
// callers assuming a known set of dates. Growth here is QoQ
// (quarter over quarter, vs. the immediately preceding quarter) rather than
// Total/Yearly/TTM growth computed against fixed multi-year windows - not
// enough history yet for YoY-style growth to be meaningful.

export const STOCK_METRIC_NAMES = [
  "Cash and equivalents",
  "Short term debt",
  "Long term debt",
  "Equity",
  "Total assets",
  "Revenue",
  "Operating income",
  "Net income",
  // Enterprise value and its multiples - computed from Price (see below),
  // outstandingShares (from stock_info, see StockService's
  // buildEnterpriseValueMetrics), and the balance-sheet/income metrics
  // above. These never get Total/Yearly/TTM growth (not in
  // GROWTH_APPLIED_METRICS there either).
  "Enterprise value",
  "Net debt / operating income",
  "EV / operating income",
  "EV / net income",
  "Market value / book value",
  // Price/Dividend Yield come from quarterly_stock_prices (already keyed by
  // this same '<year>Q<1-4>' quarter format) rather than
  // qoq_financial_reports - see StockService's buildPriceMetrics. USD
  // Price/Total USD Yield are computed from those (see
  // toUsdValue/usdYieldMetric).
  "Price",
  "USD Price",
  "Dividend Yield",
  "Total USD Yield",
] as const;
export type StockMetricName = (typeof STOCK_METRIC_NAMES)[number];

export type StockMetric = {
  metricName: StockMetricName;
  // value per quarter (e.g. "2025Q1"), null where that quarter has no
  // figure for this metric. "N/A" is only used by the EV-multiple ratios
  // (EV/operating income, EV/net income, Net debt/operating income) for a
  // quarter whose income denominator is zero or negative - a ratio
  // genuinely isn't meaningful from/to a non-positive income, as opposed to
  // null (the figure is simply missing).
  values: Record<string, number | "N/A" | null>;
  // QoQ growth (e.g. 0.05 = +5%) vs. the chronologically preceding
  // quarter, keyed by the LATER quarter of the pair. Null for a quarter
  // with no preceding quarter to compare against, or where either side is
  // null/"N/A"/zero (division by zero / not comparable).
  qoqGrowth: Record<string, number | null>;
  // Live/latest-known value - same as the latest quarter's value for every
  // financial-report metric; the actual live price for Price/USD Price;
  // null for Dividend Yield (no live dividend concept) and for any metric
  // never computed "current" for.
  current: number | "N/A" | null;
  // Multi-year growth - only computed for the same metric set (Equity,
  // Total assets, Revenue, Operating income, Net income, and Total USD
  // Yield via its own compound-return formula); every other metric
  // (including Price/USD Price/Dividend Yield) leaves these null. "N/A"
  // mirrors the same sentinel for a non-positive endpoint value growth
  // can't be computed from/to; null means not computed for this metric at
  // all, or missing
  // data (e.g. no USDTRY rate for the required quarter).
  totalGrowth: number | "N/A" | null;
  yearlyGrowth: number | "N/A" | null;
  ttmGrowth: number | "N/A" | null;
};

export type StockResponse = {
  // Every quarter with data for this symbol, newest first.
  quarters: string[];
  metrics: StockMetric[];
};

// One entry per symbol, mirroring how the listing screen flattens
// baseMetrics/derivedMetrics/stockConfig/stockDynamic into a per-row
// summary (see StockService.getAllStockData).
export type StockSummaryEntry = {
  symbol: string;
  // From stock_info - the same table/columns the listing reads
  // (getStockInfoMap), surfaced here for the listing.
  notes: string[] | null;
  color: string | null;
  response: StockResponse;
  // Average Total/TTM growth across a fixed metric set (Revenue/Operating
  // income/Equity - see StockService's GROWTH_SUMMARY_METRIC_NAMES),
  // annualized into Yearly growth the same way - the same three metrics
  // for every stock. "N/A"/null follow the same meaning as StockMetric's
  // own growth columns.
  growthSummary: {
    totalGrowth: number | "N/A" | null;
    yearlyGrowth: number | "N/A" | null;
    ttmGrowth: number | "N/A" | null;
  };
  // Single point-to-point USD return from a fixed reference date
  // (OBSERVATION_START_DATE) to the live price - listing-only, not one
  // of the per-symbol detail page's metrics. Null if the symbol has no
  // price yet at that reference date (e.g. IPO'd after it).
  observationStartYield: number | null;
};
