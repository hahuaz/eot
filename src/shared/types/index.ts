export type StockSymbol = string;

export type StockConfig = {
  stockSymbol: StockSymbol;
  outstandingShares: number;
  trimDigit: number;
  growthParams: string[];
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
  "Balance sheet",
  "Cash & cash equivalents",
  "Short term liabilities",
  "Long term liabilities",
  "Equity",
  "Total assets",
  "Income statement",
  "Revenue",
  "Operating income",
  "Net income",
  "Statistics",
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
  "Selected growth",
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
  // If a metric (e.g., net income) is negative for a given date, growth cannot be calculated. the value "negative" is used to indicate this condition.
  [key in GrowthColumns]?: number | null | "negative";
};

export type BaseMetric = {
  metricName: BaseMetricNames;
} & {
  // stock maybe recently made IPO and the value of equity for a date can be null in the db so to not deal with null values we are creating availableDates array and using it instead of dates array. Regardless, while equity is defined price can be null for newly listed stocks so null should be assigned as value
  // stock may not have debt or cash for a given date so the value for that date is null in the db. we're always assigning 0 if the value retrival returns null. Instead of manually assigning 0 in the db, we using code to do so.
  [key in Dates]: number | null;
} & GrowthRecord;

export type DerivedMetric = {
  metricName: DerivedMetricNames;
} & {
  // while calculating the metric, if one of the base metrics is negative, the value is set to "negative". e.g., net debt / operating income can be negative if operating income is negative.
  [key in Dates]: number | "negative";
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
