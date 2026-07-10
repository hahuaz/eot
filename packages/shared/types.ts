// Branded so a plain string can't be passed where a StockSymbol is expected
export type StockSymbol = string & { readonly __brand: "StockSymbol" };

export type StockConfig = {
  stockSymbol: StockSymbol;
  outstandingShares: number;
  // trim digit indicates how many digits are removed from the end of the metric value
  trimDigit: number;
  selectedGrowthMetrics: string[];
};

export const BASE_METRIC_NAMES = [
  "Cash & cash equivalents",
  "Short term liabilities",
  "Long term liabilities",
  "Equity",
  "Total assets",
  "Revenue",
  "Operating income",
  "Net income",
  "Price",
  "Dividend",
  "#config",
] as const;
export type BaseMetricNames = (typeof BASE_METRIC_NAMES)[number];

export const DERIVED_METRIC_NAMES = [
  "Net debt / operating income",
  "Enterprise value",
  "EV / operating income",
  "EV / net income",
  "Market value / book value",
  "USD Price",
  "USD Yield",
  "Observation Start Yield",
  "Selected growth median",
] as const;
export type DerivedMetricNames = (typeof DERIVED_METRIC_NAMES)[number];

export type MetricNames = BaseMetricNames | DerivedMetricNames;

export const STOCK_DATES = [
  "current",
  "2026/3/30",
  "2025/12/30",
  "2025/9/30",
  "2025/6/30",
  "2025/3/30",
  "2024/12/30",
  "2023/12/30",
  "2022/12/30",
  "2021/12/30",
  "2020/12/30",
  "2019/12/30",
] as const;

export type StockDate = (typeof STOCK_DATES)[number];

export const GROWTH_COLUMNS = [
  "Total growth",
  "Yearly growth",
  "TTM growth",
] as const;

export type GrowthColumns = (typeof GROWTH_COLUMNS)[number];

export type GrowthRecord = {
  // If a metric (e.g., net income) is negative for a given date, growth cannot be calculated. the value "N/A" is used to indicate this condition.
  [key in GrowthColumns]: number | "N/A";
};

export type BaseMetric = {
  metricName: BaseMetricNames;
} & {
  [key in StockDate]: number | null;
} & GrowthRecord;

export type DerivedMetric = {
  metricName: DerivedMetricNames;
} & {
  // while calculating the derived metric, if one of the base metrics is negative, the value is set to "N/A". e.g., net debt / operating income can be "N/A" if operating income is negative.
  [key in StockDate]: number | "N/A";
} & GrowthRecord;

export type StockDynamicInfo = {
  price: number;
  color?: string;
  notes?: string[];
};

export type StockDynamicInfoMap = {
  [key: StockSymbol]: StockDynamicInfo;
};

export type Stock = {
  stockSymbol: StockSymbol;
  metrics: (BaseMetric | DerivedMetric)[];
  availableDates: StockDate[];
  config: StockConfig;
  price: number;
  notes?: string[];
};

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

// API responses

export type StockResponse = {
  baseMetrics: BaseMetric[];
  derivedMetrics: DerivedMetric[];
  stockConfig: StockConfig;
};
