import {
  DATES,
  StockConfig,
  Inflation,
  StockDynamic,
  DerivedMetric,
  BaseMetric,
  StockSymbol,
} from "@shared/types";
import { Region } from "@/types";
import path from "path";
import { parseCSV, readJsonFile } from "./file";
import { DATA_DIR } from "./constants";
import { CURRENT_DATE, getEarliestDefinedDate, getYearsPassed } from "./dates";
import {
  createCurrentColumn,
  createYieldMetric,
  createNDtoOIMetric,
  createEV,
  createEVtoOIMetric,
  createEVtoNI,
  createMVtoBVMetric,
  calcGrowths,
} from "./metrics";
import { adjustForInflation } from "./financials";

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
  createCurrentColumn({
    baseMetrics,
    stockDynamic,
  });

  // create seperate derivedMetrics array that doesn't include base metrics. Separating them is important for typescript to infer the type correctly and easier to maintain
  const derivedMetrics: DerivedMetric[] = [];

  createYieldMetric({
    baseMetrics,
    derivedMetrics,
    inflation,
    region,
  });

  const earliestDefinedDate = getEarliestDefinedDate({
    metricName: "Equity",
    baseMetrics,
    dates: DATES,
  });

  const availableDates = DATES.filter((date) => {
    // there could be no stock without current date
    if (date === CURRENT_DATE) {
      return true;
    }
    return new Date(date).getTime() >= new Date(earliestDefinedDate).getTime();
  });

  const yearsPassed = getYearsPassed({
    earliestDefinedDate: earliestDefinedDate,
  });

  createNDtoOIMetric({
    availableDates,
    baseMetrics,
    derivedMetrics,
    stockConfig,
  });

  createEV({
    availableDates,
    baseMetrics,
    derivedMetrics,
    stockConfig: stockConfig,
  });

  createEVtoOIMetric({
    availableDates,
    baseMetrics,
    derivedMetrics,
  });

  createEVtoNI({
    availableDates,
    baseMetrics,
    derivedMetrics,
  });

  createMVtoBVMetric({
    availableDates,
    baseMetrics,
    derivedMetrics,
    stockConfig: stockConfig,
  });

  calcGrowths({
    availableDates,
    baseMetrics,
  });

  adjustForInflation({
    baseMetrics,
    derivedMetrics,
    inflation,
    stockConfig,
    availableDates,
    yearsPassed,
  });

  return { baseMetrics, derivedMetrics, stockConfig };
};
