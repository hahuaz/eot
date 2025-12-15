import {
  DATES,
  Dates,
  StockConfig,
  Inflation,
  StockDynamic,
  DerivedMetric,
  BaseMetric,
  StockSymbol,
} from "@shared/types";
import { Region, regions } from "@/types";
import path from "path";
import { parseCSV, readJsonFile } from "@/lib/file";
import { DATA_DIR } from "@/lib/constants";
import { getAvailableDates } from "@/lib/dates";
import {
  createCurrentColumn,
  createYieldMetric,
  createNDtoOIMetric,
  createEV,
  createEVtoOIMetric,
  createEVtoNI,
  createMVtoBVMetric,
  calcGrowths,
} from "@/lib/metrics";
import { adjustForInflation } from "@/lib/financials";

export const INFLATION_DATA = regions.reduce(
  (acc, region) => {
    const inflationPath = path.join(DATA_DIR, "inflation", `${region}.csv`);
    const { data: inflationData } = parseCSV<Inflation>({
      filePath: inflationPath,
      header: true,
    });
    acc[region] = inflationData;
    return acc;
  },
  {} as Record<Region, Inflation[]>,
);

/**
 * Returns detailed data for a stock by reading its files.
 */
export const getStockInfo = ({
  region,
  stockSymbol,
}: {
  region: Region;
  stockSymbol: StockSymbol;
}): {
  baseMetrics: BaseMetric[];
  stockConfig: StockConfig;
} => {
  const stockPath = path.join(DATA_DIR, "stocks", region, `${stockSymbol}.tsv`);

  let { data: baseMetrics } = parseCSV<BaseMetric>({
    filePath: stockPath,
    header: true,
    delimiter: "\t",
  });

  const configIndex = baseMetrics.findIndex(
    (item) => item.metricName === "#config",
  );

  const configValues =
    configIndex !== -1 ? Object.values(baseMetrics[configIndex]) : [];

  const stockConfig: StockConfig = {
    stockSymbol,
    outstandingShares: configValues[2] as number,
    trimDigit: configValues[3] as number,
    growthParams: (configValues[4] as string)
      .split("|")
      .map((param) => param.trim()),
  };

  baseMetrics = baseMetrics.filter((_, i) => i !== configIndex);

  return {
    baseMetrics,
    stockConfig,
  };
};

export const getStocksDynamic = ({ region }: { region: string }) => {
  const stocksDynamicPath = path.join(
    DATA_DIR,
    "stocks-dynamic",
    `${region}.json`,
  );
  const stocksDynamic = readJsonFile<StockDynamic>(stocksDynamicPath);
  return stocksDynamic;
};

/**
 * Context object containing date-related information for stock calculations.
 */
type DateContext = {
  /** For recently IPO'd stocks, not all historical dates will have values thus available dates is calculated with the earliest defined date */
  equityAvailableDates: Dates[];
  priceAvailableDates: Dates[];
};

function buildDateContext(baseMetrics: BaseMetric[]): DateContext {
  const equityAvailableDates = getAvailableDates({
    baseMetrics,
    metricName: "Equity",
  });

  const priceAvailableDates = getAvailableDates({
    baseMetrics,
    metricName: "Price",
  });

  return { equityAvailableDates, priceAvailableDates };
}

/**
 * Populates a stock with all calculated metrics, including derived metrics and growth rates.
 *
 * This function orchestrates the complete stock data enrichment pipeline:
 * 1. Sets up current column
 * 2. Calculates date context for stocks with limited history (e.g., recent IPOs)
 * 3. Creates derived financial metrics (valuations, ratios)
 * 4. Calculates growth rates (total, TTM, yearly)
 * 5. Adjusts all metrics for inflation
 *
 * @param params - Stock calculation parameters
 * @param params.baseMetrics - Raw financial metrics from stock data files
 * @param params.stockConfig - Stock configuration (symbol, shares, growth params)
 * @param params.stockDynamic - Dynamic stock data (current price, notes)
 * @param params.inflation - Inflation data for the region
 * @param params.region - Region code (e.g., 'tr', 'us')
 * @returns Enriched stock data with base metrics, derived metrics, and config
 */
export const populateStock = ({
  baseMetrics,
  stockConfig,
  stockDynamic,
  inflation,
  region,
}: {
  baseMetrics: BaseMetric[];
  stockConfig: StockConfig;
  stockDynamic: StockDynamic[StockSymbol];
  inflation: Inflation[];
  region: string;
}) => {
  // ═══════════════════════════════════════════════════════════════
  // Phase 1: Setup - Create current column
  // ═══════════════════════════════════════════════════════════════
  // Populate the "current" column with the latest price from dynamic data and copy last quarter values for other metrics
  createCurrentColumn({
    baseMetrics,
    stockDynamic,
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase 2: Build Context - Determine available dates
  // ═══════════════════════════════════════════════════════════════
  // Calculate which dates have data (important for recent IPOs)
  // and how many years of history we have
  const { equityAvailableDates, priceAvailableDates } =
    buildDateContext(baseMetrics);

  // ═══════════════════════════════════════════════════════════════
  // Phase 3: Create Derived Metrics
  // ═══════════════════════════════════════════════════════════════
  // Separate array for derived metrics to maintain type safety
  // and make it easier to distinguish between base and calculated values
  const derivedMetrics: DerivedMetric[] = [];

  // Yield metric (includes dividend yield and price appreciation, adjusted for inflation)
  // Must be calculated first as it has its own date filtering logic based on price availability
  createYieldMetric({
    baseMetrics,
    derivedMetrics,
    inflation,
    region,
    priceAvailableDates,
  });

  // Valuation and financial health metrics
  createNDtoOIMetric({
    equityAvailableDates,
    baseMetrics,
    derivedMetrics,
    stockConfig,
  });

  createEV({
    equityAvailableDates,
    baseMetrics,
    derivedMetrics,
    stockConfig,
  });

  createEVtoOIMetric({
    equityAvailableDates,
    baseMetrics,
    derivedMetrics,
  });

  createEVtoNI({
    equityAvailableDates,
    baseMetrics,
    derivedMetrics,
  });

  createMVtoBVMetric({
    equityAvailableDates,
    baseMetrics,
    derivedMetrics,
    stockConfig,
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase 4: Calculate Growth Rates
  // ═══════════════════════════════════════════════════════════════
  // Calculate total growth, TTM growth, and yearly growth for applicable base metrics
  calcGrowths({
    equityAvailableDates,
    baseMetrics,
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase 5: Adjust for Inflation
  // ═══════════════════════════════════════════════════════════════
  // Apply inflation adjustments to growth metrics and create the "Selected growth" metric
  // This must be done last as it depends on all previous calculations
  adjustForInflation({
    baseMetrics,
    derivedMetrics,
    inflation,
    stockConfig,
    equityAvailableDates,
  });

  return { baseMetrics, derivedMetrics, stockConfig };
};
