export type StockSymbol = string;

export type StockConfig = {
  stockSymbol: StockSymbol;
  outstandingShares: number;
  // trim digit indicates how many digits are removed from the end of the metric value
  trimDigit: number;
  selectedGrowthMetrics: string[];
};

export type Inflation = {
  date: string;
  mom: number;
  qoq: number;
  yoy: number;
  ytd: number;
  accumulative: number;
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
  "Yield",
  "Selected growth median",
] as const;
export type DerivedMetricNames = (typeof DERIVED_METRIC_NAMES)[number];

export type MetricNames = BaseMetricNames | DerivedMetricNames;

export const DATES = [
  "current",
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

export type Dates = (typeof DATES)[number];

export const GROWTH_COLUMNS = [
  "Total growth",
  "Yearly growth",
  "TTM growth",
] as const;

export type GrowthColumns = (typeof GROWTH_COLUMNS)[number];

export type GrowthRecord = {
  // If a metric (e.g., net income) is negative for a given date, growth cannot be calculated. the value "N/A" is used to indicate this condition.
  // TODO: remove null if growth never assigned as null
  [key in GrowthColumns]?: number | "N/A";
};

export type BaseMetric = {
  metricName: BaseMetricNames;
} & {
  [key in Dates]: number | null;
} & GrowthRecord;

export type DerivedMetric = {
  metricName: DerivedMetricNames;
} & {
  // while calculating the derived metric, if one of the base metrics is negative, the value is set to "N/A". e.g., net debt / operating income can be "N/A" if operating income is negative.
  [key in Dates]: number | "N/A";
} & GrowthRecord;

export type StockDynamicInfo = {
  price: number;
  notes?: string[];
};

export type StockDynamicInfoMap = {
  [key: StockSymbol]: StockDynamicInfo;
};

export type Stock = {
  stockSymbol: StockSymbol;
  metrics: (BaseMetric | DerivedMetric)[];
  availableDates: Dates[];
  config: StockConfig;
  price: number;
  notes?: string[];
};

export type CumulativeReturn = {
  date: string; // YYYY-MM-DD
  // e.g. 0.05 means a 5% increase
  value: number;
};

export type CumulativeReturns = {
  usdtry: CumulativeReturn[];
  eurtry: CumulativeReturn[];
  mixedCurrency: CumulativeReturn[];
  bgp: CumulativeReturn[];
  gold: CumulativeReturn[];
};

// API responses

export type StockResponse = {
  baseMetrics: BaseMetric[];
  derivedMetrics: DerivedMetric[];
  stockConfig: StockConfig;
};
