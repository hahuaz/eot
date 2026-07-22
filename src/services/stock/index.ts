import { STOCK_METRIC_NAMES } from "@eot/shared";
import type {
  StockSymbol,
  StockMetric,
  StockMetricName,
  StockResponse,
  StockSummaryEntry,
} from "@eot/shared";

import { REGIONS } from "@/constants";
import type { Region } from "@/constants";
import { getFinancialReportsBySymbol } from "@/db/qoq-financial-reports.repository";
import { getQuarterlyPriceHistory } from "@/db/quarterly-stock-prices.repository";
import { getDividendHistory } from "@/db/stock-dividends.repository";
import {
  getSymbols,
  getStockInfoMap,
  getStockInfo,
} from "@/db/stock-info.repository";
import { BadRequestError } from "@/lib/errors";

import {
  GROWTH_APPLIED_METRIC_NAMES,
  METRIC_SPECS,
  MetricSpec,
  TTM_SUMMED_METRIC_NAMES,
  computeTtmSum,
  resolveMetricValue,
} from "@/services/stock/financial-metrics";
import {
  NO_GROWTH,
  computeValueGrowthColumns,
  qoqGrowthValue,
} from "@/services/stock/growth-columns";
import { getUsdTryHistory } from "@/services/stock/usd-conversion";
import { buildPriceMetrics } from "@/services/stock/price-metrics";
import { buildEnterpriseValueMetrics } from "@/services/stock/enterprise-value-metrics";
import {
  computeGrowthSummary,
  computeObservationStartYield,
} from "@/services/stock/listing-metrics";

export function requireRegion(region: unknown): Region {
  if (typeof region !== "string" || !REGIONS.includes(region as Region)) {
    throw new BadRequestError(`Invalid or missing region parameter: ${region}`);
  }
  return region as Region;
}

export function requireStockSymbol(stockSymbol: unknown): StockSymbol {
  if (typeof stockSymbol !== "string" || !stockSymbol) {
    throw new BadRequestError(`Stock symbol is required.`);
  }
  return stockSymbol as StockSymbol;
}

/** Every symbol tracked for `region` - see stock-info.repository's getSymbols. */
export async function getStockSymbols(region: Region): Promise<string[]> {
  return getSymbols(region);
}

/**
 * Builds the full stock response for a (region, symbol). Every metric
 * (balance sheet, income statement, enterprise value, price/dividend/
 * yield) carries:
 *   - a value for every quarter pushed so far;
 *   - QoQ growth: how much the value changed from the immediately
 *     preceding quarter - "preceding" in time, not in array position, so
 *     a gap in the data (e.g. a missing quarter) makes the next quarter's
 *     growth null instead of comparing across the gap;
 *   - a "current" (latest known) value;
 *   - Total/Yearly/TTM growth columns, where applicable.
 */
export async function getStockData(
  region: Region,
  symbol: StockSymbol,
): Promise<StockResponse> {
  const [
    financialReports,
    priceHistory,
    dividendHistory,
    stockInfo,
    usdTryHistory,
  ] = await Promise.all([
    getFinancialReportsBySymbol(region, symbol),
    getQuarterlyPriceHistory(region, symbol),
    getDividendHistory(region, symbol),
    getStockInfo(region, symbol),
    getUsdTryHistory(),
  ]);
  const reportsByQuarter = Object.fromEntries(
    financialReports.map((report) => [report.quarter, report]),
  );

  // '<year>Q<1-4>' strings sort correctly lexicographically - ascending
  // (oldest -> newest) here since QoQ growth is computed walking forward.
  // Driven by qoq_financial_reports alone, not quarterly_stock_prices
  // (which has a much longer history) - the quarter columns are however
  // far the financial-report pipeline has gotten, with price data joined
  // onto that same set.
  const quartersAscending = Object.keys(reportsByQuarter).sort();

  if (quartersAscending.length === 0) {
    throw new BadRequestError(
      `No financial reports found for ${symbol} (${region})`,
    );
  }

  // qoq_financial_reports are trimmed for readability
  // trimDigit will be used as multiplier to bring them to real absolute values.
  const trimDigit = stockInfo?.trimDigit ?? 1;

  const yoyReportsByMetric: Partial<
    Record<StockMetricName, Record<string, number | null>>
  > = {};
  for (const [metricName, spec] of Object.entries(METRIC_SPECS) as [
    StockMetricName,
    MetricSpec,
  ][]) {
    const scaledValues = Object.fromEntries(
      quartersAscending.map((quarter) => {
        const raw = resolveMetricValue(reportsByQuarter[quarter], spec);
        return [quarter, raw == null ? null : raw * trimDigit];
      }),
    );
    yoyReportsByMetric[metricName] = TTM_SUMMED_METRIC_NAMES.includes(
      metricName,
    )
      ? computeTtmSum(scaledValues, quartersAscending)
      : scaledValues;
  }
  // console.log("yoyReportsByMetric", yoyReportsByMetric);

  // Computes growth calculation for financial report metrics
  const financialReportMetrics: StockMetric[] = STOCK_METRIC_NAMES.filter(
    (metricName): metricName is StockMetricName => metricName in METRIC_SPECS,
  ).map((metricName) => {
    const values = yoyReportsByMetric[metricName]!;
    const qoqGrowth: Record<string, number | null> = Object.fromEntries(
      quartersAscending.map((quarter, i) => [
        quarter,
        qoqGrowthValue(
          values[quarter],
          i > 0 ? values[quartersAscending[i - 1]] : null,
        ),
      ]),
    );

    const lastQuarter = quartersAscending[quartersAscending.length - 1];
    const growth = GROWTH_APPLIED_METRIC_NAMES.includes(metricName)
      ? computeValueGrowthColumns(values, quartersAscending, usdTryHistory)
      : NO_GROWTH;

    return {
      metricName,
      values,
      qoqGrowth,
      current: values[lastQuarter],
      ...growth,
    };
  });

  const {
    metrics: priceMetrics,
    priceValues,
    currentPrice,
  } = buildPriceMetrics(
    priceHistory,
    dividendHistory,
    quartersAscending,
    usdTryHistory,
  );

  const enterpriseValueMetrics = buildEnterpriseValueMetrics({
    quartersAscending,
    outstandingShares: stockInfo?.outstandingShares ?? null,
    priceValues,
    currentPrice,
    cashValues: yoyReportsByMetric["Cash and equivalents"]!,
    shortTermDebtValues: yoyReportsByMetric["Short term debt"]!,
    longTermDebtValues: yoyReportsByMetric["Long term debt"]!,
    equityValues: yoyReportsByMetric.Equity!,
    operatingIncomeValues: yoyReportsByMetric["Operating income"]!,
    netIncomeValues: yoyReportsByMetric["Net income"]!,
  });

  return {
    quarters: [...quartersAscending].reverse(),
    metrics: [
      ...financialReportMetrics,
      ...enterpriseValueMetrics,
      ...priceMetrics,
    ],
  };
}

/**
 * Every symbol's data for `region` - loops every symbol (from stock_info,
 * the source of truth for which symbols exist), running the same per-symbol
 * pipeline getStockData uses, and excludes (rather than failing the whole
 * listing) any symbol whose data throws - e.g. a symbol in stock_info that
 * extract-pdf hasn't pushed financial reports for yet.
 */
export async function getAllStockData(
  region: Region,
): Promise<StockSummaryEntry[]> {
  const stockInfoMap = await getStockInfoMap(region);
  const symbols = Object.keys(stockInfoMap);

  const results = await Promise.all(
    symbols.map(async (symbol): Promise<StockSummaryEntry | null> => {
      try {
        const stockSymbol = symbol as StockSymbol;
        const response = await getStockData(region, stockSymbol);
        const quartersAscending = [...response.quarters].reverse();
        const growthSummary = computeGrowthSummary(
          quartersAscending,
          response.metrics,
        );
        const observationStartYield = computeObservationStartYield(
          response.metrics,
        );

        return {
          symbol,
          notes: stockInfoMap[symbol]?.notes ?? null,
          color: stockInfoMap[symbol]?.color ?? null,
          response,
          growthSummary,
          observationStartYield,
        };
      } catch (error) {
        console.warn(
          `Excluding ${symbol} (${region}) from stock list - incomplete data:`,
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    }),
  );

  return results.filter(
    (result): result is StockSummaryEntry => result !== null,
  );
}
