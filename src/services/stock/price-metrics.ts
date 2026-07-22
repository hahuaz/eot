import type { StockMetric } from "@eot/shared";

import { StockDividendDbRow } from "@/db/stock-dividends.repository";
import { toQuarterLabel } from "@/lib/dates";
import { round } from "@/lib/utils";
import {
  NO_GROWTH,
  computeUsdYieldGrowthColumns,
  qoqGrowthValue,
} from "@/services/stock/growth-columns";
import { UsdTryHistory, toUsdValue } from "@/services/stock/usd-conversion";

export type PriceMetrics = {
  metrics: StockMetric[];
  priceValues: Record<string, number | null>;
  currentPrice: number | null;
};

/**
 * Builds the four price-derived metrics (Price, USD Price, Dividend Yield,
 * Total USD Yield) from quarterly_stock_prices (see getQuarterlyPriceHistory)
 * and stock_dividends (see getDividendHistory), keyed by this same quarter
 * format, unlike qoq_financial_reports's Kalem-based columns. Total USD
 * Yield = USD price's QoQ return plus the quarter's net (after-tax) dividend
 * yield - walking `quartersAscending` (no fixed quarter list here). A
 * quarter's Price can legitimately be null (e.g. before a late IPO's first
 * trade), but once a Price exists its USDTRY rate must too - toUsdValue
 * throws rather than resolving to null, since a missing FX quote is a data
 * gap to fix, not a legitimate absence.
 *
 * stock_dividends holds one row per actual payment date, not per quarter -
 * multiple payments landing in the same quarter (e.g. installments) have
 * their yields summed here into that quarter's single Dividend Yield figure.
 *
 * "current" (live price) comes from quarterly_stock_prices'
 * CURRENT_PRICE_SENTINEL row - already included in `priceHistory` since it's fetched the
 * same way as every other quarter. Price gets the live value, Dividend
 * Yield gets none (no live dividend concept), USD Price/Total USD Yield
 * derive from Price's live value the same way their quarterly figures do.
 *
 * Also returns the raw price values/current price - reused by
 * buildEnterpriseValueMetrics, which needs Price the same way this does.
 */
export function buildPriceMetrics(
  priceHistory: Record<string, number>,
  dividendHistory: StockDividendDbRow[],
  quartersAscending: string[],
  usdTryHistory: UsdTryHistory,
): PriceMetrics {
  const priceValues: Record<string, number | null> = {};
  const dividendValues: Record<string, number | null> = {};
  const usdPriceValues: Record<string, number | null> = {};

  const dividendYieldByQuarter = new Map<string, number>();
  for (const dividend of dividendHistory) {
    const quarter = toQuarterLabel(dividend.date);
    dividendYieldByQuarter.set(
      quarter,
      (dividendYieldByQuarter.get(quarter) ?? 0) + dividend.netDividendYield,
    );
  }

  for (const quarter of quartersAscending) {
    const price = priceHistory[quarter] ?? null;
    priceValues[quarter] = price;
    dividendValues[quarter] = dividendYieldByQuarter.get(quarter) ?? null;
    usdPriceValues[quarter] =
      price == null ? null : toUsdValue(price, quarter, usdTryHistory);
  }

  const usdYieldValues: Record<string, number | null> = {};
  quartersAscending.forEach((quarter, i) => {
    const previousQuarter = quartersAscending[i - 1];
    const usdPrice = usdPriceValues[quarter];
    const previousUsdPrice =
      previousQuarter != null ? usdPriceValues[previousQuarter] : null;

    if (
      usdPrice == null ||
      previousUsdPrice == null ||
      previousUsdPrice === 0
    ) {
      usdYieldValues[quarter] = null;
      return;
    }

    const netDividendYield = dividendValues[quarter] ?? 0;
    const usdPriceYield = (usdPrice - previousUsdPrice) / previousUsdPrice;
    usdYieldValues[quarter] = round(usdPriceYield + netDividendYield);
  });

  const growthOf = (
    values: Record<string, number | null>,
  ): Record<string, number | null> =>
    Object.fromEntries(
      quartersAscending.map((quarter, i) => [
        quarter,
        qoqGrowthValue(
          values[quarter],
          i > 0 ? values[quartersAscending[i - 1]] : null,
        ),
      ]),
    );

  // Latest defined USDTRY rate in the DB, not necessarily "today" - whatever
  // the most recent daily quote happens to be, per usdTryHistory's own
  // ascending date order
  const currentUsdTryRate = usdTryHistory[usdTryHistory.length - 1]?.value;
  if (currentUsdTryRate == null) {
    throw new Error("No USDTRY rate available.");
  }
  const currentPrice = priceHistory.CURRENT ?? null;
  const currentUsdPrice =
    currentPrice == null ? null : currentPrice / currentUsdTryRate;

  const lastQuarter = quartersAscending[quartersAscending.length - 1];
  const lastUsdPrice = usdPriceValues[lastQuarter];
  // No dividend term here: Dividend Yield's own "current" is null (see
  // below), so there's no live dividend figure to add in.
  const currentUsdYield =
    currentUsdPrice == null || lastUsdPrice == null || lastUsdPrice === 0
      ? null
      : round((currentUsdPrice - lastUsdPrice) / lastUsdPrice);

  const metrics: StockMetric[] = [
    {
      metricName: "Price",
      values: priceValues,
      qoqGrowth: growthOf(priceValues),
      current: currentPrice,
      ...NO_GROWTH,
    },
    {
      metricName: "USD Price",
      values: usdPriceValues,
      qoqGrowth: growthOf(usdPriceValues),
      current: currentUsdPrice,
      ...NO_GROWTH,
    },
    {
      metricName: "Dividend Yield",
      values: dividendValues,
      qoqGrowth: growthOf(dividendValues),
      current: null,
      ...NO_GROWTH,
    },
    // Total USD Yield is itself already a period-over-period return, so put qoqGrowth as null.
    // Its Total/Yearly/TTM growth columns, unlike the QoQ one, ARE meaningful - see computeUsdYieldGrowthColumns.
    {
      metricName: "Total USD Yield",
      values: usdYieldValues,
      qoqGrowth: Object.fromEntries(quartersAscending.map((q) => [q, null])),
      current: currentUsdYield,
      ...computeUsdYieldGrowthColumns(
        usdYieldValues,
        quartersAscending,
        currentUsdYield,
      ),
    },
  ];

  return { metrics, priceValues, currentPrice };
}
