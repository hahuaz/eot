import type { StockMetricName } from "@eot/shared";
import { QoqFinancialReportDbRow } from "@/db/qoq-financial-reports.repository";

export type FinancialReportColumn = Exclude<
  keyof QoqFinancialReportDbRow,
  "region" | "symbol" | "quarter"
>;

export type MetricSpec =
  | { kind: "column"; column: FinancialReportColumn }
  | { kind: "sum"; columns: FinancialReportColumn[] };

/**
 * How each balance-sheet/income display metric is read off a
 * qoq_financial_reports row - a straight column passthrough for most, but
 * the three balance-sheet headline figures are a sum of several
 * finer-grained columns, computed here rather than at write time so the DB
 * keeps every "Kalem" line item on its own column. Price/Dividend Yield/USD
 * Price/Total USD Yield/enterprise-value metrics aren't here - they come
 * from a different table or are derived, see price-metrics.ts/
 * enterprise-value-metrics.ts.
 */
export const METRIC_SPECS: Partial<Record<StockMetricName, MetricSpec>> = {
  "Cash and equivalents": {
    kind: "sum",
    columns: [
      "cashAndEquivalents",
      "financialInvestments",
      "noncurrentFinancialInvestments",
    ],
  },
  "Short term debt": {
    kind: "sum",
    columns: [
      "shortTermBorrowings",
      "currentPortionOfLongTermBorrowings",
      "shortTermLeaseLiabilities",
    ],
  },
  "Long term debt": {
    kind: "sum",
    columns: ["longTermBorrowings", "longTermLeaseLiabilities"],
  },
  Equity: { kind: "column", column: "equity" },
  "Total assets": { kind: "column", column: "totalAssets" },
  Revenue: { kind: "column", column: "revenue" },
  "Operating income": { kind: "column", column: "operatingIncome" },
  "Net income": { kind: "column", column: "netIncome" },
};

/**
 * The subset of financial-report metrics that get Total/Yearly/TTM growth -
 * "Cash and equivalents"/"Short term debt"/"Long term debt" are point-in-
 * time balance-sheet snapshots that don't get growth columns here.
 */
export const GROWTH_APPLIED_METRIC_NAMES: StockMetricName[] = [
  "Equity",
  "Total assets",
  "Revenue",
  "Operating income",
  "Net income",
];

/**
 * Resolves metric's value for given spec. A "sum" spec treats a
 * null component as 0 so one missing sub-line item (e.g. no lease
 * liabilities that period) doesn't blank out the whole total - only a
 * quarter with *no* component data at all resolves to null.
 */
export function resolveMetricValue(
  row: QoqFinancialReportDbRow | undefined,
  spec: MetricSpec,
): number | null {
  if (!row) return null;
  if (spec.kind === "column") return row[spec.column] ?? null;

  const values = spec.columns.map((column) => row[column]);
  if (values.every((v) => v == null)) return null;
  return values.reduce((total: number, v) => total + (v ?? 0), 0);
}

/**
 * The three income-statement metrics (unlike the balance-sheet ones, which
 * are point-in-time snapshots a rolling sum wouldn't make sense for) are
 * shown as trailing-twelve-month (TTM) sums rather than a single quarter's
 * standalone figure - each quarter's own figure is seasonal on its own
 * (e.g. a retailer's Q4), so a bare quarter-to-quarter comparison
 * exaggerates swings that are just calendar timing, not real growth. Used
 * both for what the Income statement section displays and as the
 * denominator for the EV multiples (EV/operating income, EV/net income,
 * Net debt/operating income) - a single quarter's income there would make
 * those multiples just as seasonally jumpy.
 */
export const TTM_SUMMED_METRIC_NAMES: StockMetricName[] = [
  "Revenue",
  "Operating income",
  "Net income",
];

/**
 * Sums `values[quarter]` with the 3 quarters immediately before it, for
 * every quarter in `quartersAscending` - null wherever that full 4-quarter
 * window isn't entirely available (the first 3 quarters of any symbol's
 * history, or any quarter whose window crosses a gap in the data), rather
 * than silently summing a partial window.
 */
export function computeTtmSum(
  values: Record<string, number | null>,
  quartersAscending: string[],
): Record<string, number | null> {
  const ttmValues: Record<string, number | null> = {};
  quartersAscending.forEach((quarter, i) => {
    if (i < 3) {
      ttmValues[quarter] = null;
      return;
    }
    const window = quartersAscending.slice(i - 3, i + 1).map((q) => values[q]);
    ttmValues[quarter] = window.some((v) => v == null)
      ? null
      : window.reduce((sum: number, v) => sum + (v as number), 0);
  });
  return ttmValues;
}
