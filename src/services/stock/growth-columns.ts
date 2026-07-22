import { quarterOneYearBefore, yearsBetweenQuarters } from "@/lib/dates";
import { round } from "@/lib/utils";
import { toUsdValue, UsdTryHistory } from "@/services/stock/usd-conversion";

export type Value = number | "N/A" | null;

export type GrowthColumns = {
  totalGrowth: number | "N/A" | null;
  yearlyGrowth: number | "N/A" | null;
  ttmGrowth: number | "N/A" | null;
};

export const NO_GROWTH: GrowthColumns = {
  totalGrowth: null,
  yearlyGrowth: null,
  ttmGrowth: null,
};

/** Plain QoQ growth: (value - previousValue) / |previousValue|, or null when either side is missing/"N/A"/zero. */
export function qoqGrowthValue(
  value: Value,
  previousValue: Value,
): number | null {
  return typeof value !== "number" ||
    typeof previousValue !== "number" ||
    previousValue === 0
    ? null
    : round((value - previousValue) / Math.abs(previousValue));
}

/**
 * Total/Yearly/TTM growth for a value-type metric: growth is measured on
 * the USD-converted value (so it reflects real, currency-adjusted
 * movement, not just nominal TRY growth), from the oldest to the newest
 * quarter for Total/Yearly, and from one year before the newest quarter to
 * the newest for TTM. "N/A" means an endpoint that's zero or negative (no
 * meaningful percentage growth from/to a non-positive base); null means no
 * value at all for the quarter needed. Throws if a needed quarter has a
 * value but no USDTRY rate to convert it with (see toUsdValue) - this
 * assumes usdTryHistory covers every quarter qoq_financial_reports does.
 */
export function computeValueGrowthColumns(
  values: Record<string, number | null>,
  quartersAscending: string[],
  usdTryHistory: UsdTryHistory,
): GrowthColumns {
  if (quartersAscending.length === 0) return NO_GROWTH;

  // The first quarter with an actual value, not necessarily
  // quartersAscending[0] - a TTM-summed metric (see computeTtmSum) has no
  // value at all for its first 3 quarters, and a recently-IPO'd symbol can
  // have gaps for the same reason regular values are missing.
  const firstQuarter = quartersAscending.find((q) => values[q] != null);
  const lastQuarter = quartersAscending[quartersAscending.length - 1];
  const firstValue = firstQuarter != null ? values[firstQuarter] : null;
  const lastValue = values[lastQuarter];

  let totalGrowth: number | "N/A" | null = null;
  let yearlyGrowth: number | "N/A" | null = null;
  if (firstQuarter != null && firstValue != null && lastValue != null) {
    if (firstValue <= 0 || lastValue <= 0) {
      totalGrowth = "N/A";
      yearlyGrowth = "N/A";
    } else {
      const usdFirst = toUsdValue(firstValue, firstQuarter, usdTryHistory);
      const usdLast = toUsdValue(lastValue, lastQuarter, usdTryHistory);
      const growth = (usdLast - usdFirst) / usdFirst;
      totalGrowth = round(growth);
      const yearsPassed = yearsBetweenQuarters(firstQuarter, lastQuarter);
      yearlyGrowth =
        yearsPassed > 0
          ? round(Math.pow(1 + growth, 1 / yearsPassed) - 1)
          : "N/A";
    }
  }

  const ttmStartQuarter = quarterOneYearBefore(lastQuarter);
  const ttmStartValue = values[ttmStartQuarter];
  let ttmGrowth: number | "N/A" | null = null;
  if (ttmStartValue != null && lastValue != null) {
    if (ttmStartValue <= 0 || lastValue <= 0) {
      ttmGrowth = "N/A";
    } else {
      const usdTtmStart = toUsdValue(
        ttmStartValue,
        ttmStartQuarter,
        usdTryHistory,
      );
      const usdLast = toUsdValue(lastValue, lastQuarter, usdTryHistory);
      ttmGrowth = round((usdLast - usdTtmStart) / usdTtmStart);
    }
  }

  return { totalGrowth, yearlyGrowth, ttmGrowth };
}

/**
 * Total/Yearly/TTM growth for Total USD Yield specifically: compounds every
 * period's own yield together - including the live "current" period's
 * yield (return from the newest known quarter to the live price) - rather
 * than diffing two level values like computeValueGrowthColumns, since Total
 * USD Yield is already a period return.
 */
export function computeUsdYieldGrowthColumns(
  usdYieldValues: Record<string, number | null>,
  quartersAscending: string[],
  currentYield: number | null,
): GrowthColumns {
  if (quartersAscending.length === 0) return NO_GROWTH;

  const compound = (yields: Array<number | null>): number | null => {
    const known = yields.filter((y): y is number => y != null);
    if (known.length === 0) return null;
    return round(known.reduce((acc, y) => acc * (1 + y), 1) - 1);
  };

  const allYields = [
    ...quartersAscending.map((q) => usdYieldValues[q]),
    currentYield,
  ];
  const totalGrowth = compound(allYields);

  const firstQuarter = quartersAscending[0];
  const lastQuarter = quartersAscending[quartersAscending.length - 1];
  const yearsPassed = yearsBetweenQuarters(firstQuarter, lastQuarter);
  const yearlyGrowth =
    totalGrowth != null && yearsPassed > 0
      ? round(Math.pow(1 + totalGrowth, 1 / yearsPassed) - 1)
      : null;

  // Trailing twelve months: every quarter strictly after (one year before
  // the newest quarter), plus the live "current" period - null (not a
  // silent fallback to the full history) if that quarter isn't in the data
  // at all, i.e. less than a year of history.
  const ttmStartQuarter = quarterOneYearBefore(lastQuarter);
  const ttmStartIndex = quartersAscending.indexOf(ttmStartQuarter);
  const ttmGrowth =
    ttmStartIndex === -1
      ? null
      : compound([
          ...quartersAscending
            .slice(ttmStartIndex + 1)
            .map((q) => usdYieldValues[q]),
          currentYield,
        ]);

  return { totalGrowth, yearlyGrowth, ttmGrowth };
}
