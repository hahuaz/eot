import type { StockMetric, StockMetricName } from "@eot/shared";

import { OBSERVATION_START_DATE } from "@/lib/constants";
import { toQuarterLabel, yearsBetweenQuarters } from "@/lib/dates";
import { round } from "@/lib/utils";
import { GrowthColumns, NO_GROWTH } from "@/services/stock/growth-columns";

/**
 * Every stock's growth summary uses this same fixed metric set - one
 * answer for every symbol rather than a per-stock choice.
 */
const GROWTH_SUMMARY_METRIC_NAMES: StockMetricName[] = [
  "Revenue",
  "Operating income",
  "Equity",
];

/**
 * Mean of Total/TTM growth across GROWTH_SUMMARY_METRIC_NAMES, annualized
 * into Yearly growth the same way - computed from the already-computed
 * per-metric growth columns (GROWTH_APPLIED_METRIC_NAMES already covers
 * all three). A metric whose own Total/TTM growth isn't a plain number
 * (missing data, or "N/A" from a non-positive endpoint) is skipped rather
 * than failing the whole average.
 */
export function computeGrowthSummary(
  quartersAscending: string[],
  metrics: StockMetric[],
): GrowthColumns {
  const selected = GROWTH_SUMMARY_METRIC_NAMES.map((name) =>
    metrics.find((m) => m.metricName === name),
  ).filter(
    (m): m is StockMetric =>
      m != null &&
      typeof m.totalGrowth === "number" &&
      typeof m.ttmGrowth === "number",
  );

  if (selected.length === 0 || quartersAscending.length === 0) return NO_GROWTH;

  const avgTotalGrowth =
    selected.reduce((sum, m) => sum + (m.totalGrowth as number), 0) /
    selected.length;
  const avgTtmGrowth =
    selected.reduce((sum, m) => sum + (m.ttmGrowth as number), 0) /
    selected.length;

  const firstQuarter = quartersAscending[0];
  const lastQuarter = quartersAscending[quartersAscending.length - 1];
  const yearsPassed = yearsBetweenQuarters(firstQuarter, lastQuarter);

  return {
    totalGrowth: round(avgTotalGrowth),
    ttmGrowth: round(avgTtmGrowth),
    yearlyGrowth:
      yearsPassed > 0
        ? round(Math.pow(1 + avgTotalGrowth, 1 / yearsPassed) - 1)
        : null,
  };
}

/**
 * Single point-to-point USD return from OBSERVATION_START_QUARTER to the
 * live price - reads off the already-computed "USD Price" metric (built
 * once per symbol in buildPriceMetrics) rather than recomputing the USD
 * conversion, and returns null (not a blank derived metric with no value)
 * when that quarter has no price yet - e.g. a symbol that IPO'd after the
 * observation date.
 *
 * Listing-only (not one of STOCK_METRIC_NAMES) - the per-symbol detail
 * page doesn't show it.
 */
export function computeObservationStartYield(
  metrics: StockMetric[],
): number | null {
  const usdPriceMetric = metrics.find((m) => m.metricName === "USD Price");
  const OBSERVATION_START_QUARTER = toQuarterLabel(OBSERVATION_START_DATE);
  const observationStartPrice =
    usdPriceMetric?.values[OBSERVATION_START_QUARTER];
  const currentPrice = usdPriceMetric?.current;

  if (
    typeof observationStartPrice !== "number" ||
    observationStartPrice <= 0 ||
    typeof currentPrice !== "number"
  ) {
    return null;
  }

  return round((currentPrice - observationStartPrice) / observationStartPrice);
}
