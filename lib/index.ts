export * from "./file";

import { parseCSV, readJsonFile } from "./file";
import path from "path";

import {
  DATES,
  Dates,
  BaseMetricNames,
  StockConfig,
  Inflation,
  StockDynamic,
  DerivedMetric,
  BaseMetric,
  GrowthRecord,
  StockSymbol,
} from "@shared/types";

import { Region } from "@/types";

export const DATA_DIR = path.join(process.cwd(), "local-data");

// metrics that are applicable for growth calculation
const GROWTH_APPLIED_METRICS: BaseMetricNames[] = [
  "Equity",
  "Total assets",
  "Revenue",
  "Operating income",
  "Net income",
];
const CURRENT_DATE = DATES[0];
export const LAST_DATE = DATES[1];
// TODO: finished year date either increasing or decreasing based on current date
const LAST_FINISHED_YEAR_DATE = DATES[4];
const PREVIOUS_FINISHED_YEAR_DATE = DATES[5];

const lastDateObj = new Date(LAST_DATE);

export const whichQuarter = (date: string) => {
  const month = new Date(date).getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return quarter;
};

const createCurrentColumn = ({
  baseMetrics,
  stockDynamic,
}: {
  baseMetrics: BaseMetric[];
  stockDynamic: StockDynamic[StockSymbol];
}) => {
  for (const metric of baseMetrics) {
    if (metric.metricName === "Price" || metric.metricName === "Dividend") {
      continue;
    }
    // put last date value to current
    metric["current"] = metric[LAST_DATE];
  }

  const { price } = stockDynamic;
  const priceMetric = baseMetrics.find((item) => item.metricName === "Price");
  if (!priceMetric) {
    throw new Error(`Price metric not found in metrics`);
  }

  priceMetric["current"] = price;
};

const createEV = ({
  availableDates,
  baseMetrics,
  derivedMetrics,
  stockConfig,
}: {
  availableDates: Dates[];
  baseMetrics: BaseMetric[];
  derivedMetrics: DerivedMetric[];
  stockConfig: StockConfig;
}) => {
  const enterpriseValueMetric = {
    metricName: "Enterprise value",
  } as Partial<DerivedMetric>;

  for (const date of availableDates) {
    const price = baseMetrics.find((item) => item.metricName === "Price")![
      date
    ];
    const cashValue =
      baseMetrics.find(
        (item) => item.metricName === "Cash & cash equivalents"
      )![date] ?? 0;
    const shortTermLiabilities =
      baseMetrics.find((item) => item.metricName === "Short term liabilities")![
        date
      ] ?? 0;
    const longTermLiabilities =
      baseMetrics.find((item) => item.metricName === "Long term liabilities")![
        date
      ] ?? 0;

    if (price == null) {
      continue;
    }

    const marketValue =
      (price * stockConfig.outstandingShares) / stockConfig.trimDigit;
    enterpriseValueMetric[date] = round(
      marketValue + shortTermLiabilities + longTermLiabilities - cashValue
    );
  }

  derivedMetrics.push(enterpriseValueMetric as DerivedMetric);
};

const createNDtoOIMetric = ({
  availableDates,
  baseMetrics,
  derivedMetrics,
  stockConfig,
}: {
  availableDates: Dates[];
  baseMetrics: BaseMetric[];
  derivedMetrics: DerivedMetric[];
  stockConfig: StockConfig;
}) => {
  const netDebtOIMetric = {
    metricName: "Net debt / operating income",
  } as Partial<DerivedMetric>;

  for (const date of availableDates) {
    const cash =
      baseMetrics.find(
        (item) => item.metricName === "Cash & cash equivalents"
      )?.[date] ?? 0;
    const shortTermLiabilities =
      baseMetrics.find(
        (item) => item.metricName === "Short term liabilities"
      )?.[date] ?? 0;
    const longTermLiabilities =
      baseMetrics.find((item) => item.metricName === "Long term liabilities")?.[
        date
      ] ?? 0;
    const operatingIncome = baseMetrics.find(
      (item) => item.metricName === "Operating income"
    )![date];

    if (operatingIncome == null) {
      console.log("stockConfig", stockConfig);
      throw new Error(`Operating income not found for date ${date}`);
    }

    if (operatingIncome <= 0) {
      netDebtOIMetric[date] = "negative";
    } else {
      const netDebt = shortTermLiabilities + longTermLiabilities - cash;
      netDebtOIMetric[date] = round(netDebt / operatingIncome);
    }
  }

  derivedMetrics.push(netDebtOIMetric as DerivedMetric);
};

const createEVtoOIMetric = ({
  availableDates,
  baseMetrics,
  derivedMetrics,
}: {
  availableDates: Dates[];
  baseMetrics: BaseMetric[];
  derivedMetrics: DerivedMetric[];
}) => {
  const evToOIMetric = {
    metricName: "EV / operating income",
  } as Partial<DerivedMetric>;

  for (const date of availableDates) {
    const enterpriseValue = derivedMetrics.find(
      (item) => item.metricName === "Enterprise value"
    )![date];
    const operatingIncome = baseMetrics.find(
      (item) => item.metricName === "Operating income"
    )![date];

    if (operatingIncome == null) {
      throw new Error(`Operating income not found for date ${date}`);
    }

    if (enterpriseValue == null) {
      continue;
    }

    if (operatingIncome <= 0 || enterpriseValue == "negative") {
      evToOIMetric[date] = "negative";
    } else {
      evToOIMetric[date] = round(enterpriseValue / operatingIncome);
    }
  }

  derivedMetrics.push(evToOIMetric as DerivedMetric);
};

const createEVtoNI = ({
  availableDates,
  baseMetrics,
  derivedMetrics,
}: {
  availableDates: Dates[];
  baseMetrics: BaseMetric[];
  derivedMetrics: DerivedMetric[];
}) => {
  const evNIMetric = {
    metricName: "EV / net income",
  } as Partial<DerivedMetric>;

  for (const date of availableDates) {
    const enterpriseValue = derivedMetrics.find(
      (item) => item.metricName === "Enterprise value"
    )?.[date];
    const netIncome = baseMetrics.find(
      (item) => item.metricName === "Net income"
    )![date];

    if (netIncome == null) {
      throw new Error(`Net income not found for date ${date}`);
    }
    if (enterpriseValue == null) {
      continue;
    }

    if (netIncome <= 0 || enterpriseValue == "negative") {
      evNIMetric[date] = "negative";
    } else {
      evNIMetric[date] = round(enterpriseValue / netIncome);
    }
  }

  derivedMetrics.push(evNIMetric as DerivedMetric);
};
const createMVtoBVMetric = ({
  availableDates,
  baseMetrics,
  derivedMetrics,
  stockConfig,
}: {
  availableDates: Dates[];
  baseMetrics: BaseMetric[];
  derivedMetrics: DerivedMetric[];
  stockConfig: StockConfig;
}) => {
  const mvToBVMetric = {
    metricName: "Market value / book value",
  } as Partial<DerivedMetric>;

  for (const date of availableDates) {
    const price = baseMetrics.find((item) => item.metricName === "Price")![
      date
    ];
    const bookValue = baseMetrics.find((item) => item.metricName === "Equity")![
      date
    ];

    if (bookValue == null) {
      throw new Error(`Book value not found for date ${date}`);
    }

    if (price == null) {
      continue;
    }

    mvToBVMetric[date] = round(
      (price * stockConfig.outstandingShares) /
        stockConfig.trimDigit /
        bookValue
    );
  }

  derivedMetrics.push(mvToBVMetric as DerivedMetric);
};

const createYieldMetric = ({
  baseMetrics,
  derivedMetrics,
  inflation,
  region,
}: {
  baseMetrics: BaseMetric[];
  derivedMetrics: DerivedMetric[];
  inflation: Inflation[];
  region: string;
}) => {
  const dividendIndex = baseMetrics.findIndex(
    (item) => item.metricName === "Dividend"
  );
  const priceIndex = baseMetrics.findIndex(
    (item) => item.metricName === "Price"
  );

  if (dividendIndex === -1 || priceIndex === -1) {
    throw new Error("Dividend or Price metric not found");
  }

  const dividendMetric = baseMetrics[dividendIndex];
  const priceMetric = baseMetrics[priceIndex];

  let earliestPriceDate: Dates | undefined = undefined;
  for (let i = DATES.length - 1; i >= 0; i--) {
    const date = DATES[i];
    if (priceMetric[date]) {
      earliestPriceDate = date;
      break;
    }
  }
  if (earliestPriceDate === undefined) {
    throw new Error("earliestPriceDate not found");
  }

  // use earliestPriceDate to create availableDates
  const availableDates = DATES.filter((date) => {
    // there could be no stock without current date
    if (date === CURRENT_DATE) {
      return true;
    }
    return new Date(date).getTime() >= new Date(earliestPriceDate).getTime();
  });

  const yieldMetric = {
    metricName: "Yield",
  } as Partial<DerivedMetric>;

  const { dividendTaxRate } = getTaxByRegion({ region });

  for (let i = 0; i < availableDates.length; i++) {
    // yield can't be calculated without older date. so break if it's the last date
    if (i === availableDates.length - 1) {
      break;
    }

    const loopDate = availableDates[i];
    const dividendValue = dividendMetric[loopDate] ?? 0;
    const netDividendYield = dividendValue * (1 - dividendTaxRate);
    const priceValue = priceMetric[loopDate] ?? 0;
    const previousPriceValue = priceMetric[availableDates[i + 1]] ?? 0;
    const priceYield = (priceValue - previousPriceValue) / previousPriceValue;

    // adjust for inflation
    const inflationData = inflation.find((item) => item.date === loopDate);
    if (!inflationData && loopDate !== "current") {
      throw new Error(`Inflation data not found for date ${loopDate}`);
    }

    let inflationForDate: Dates | number = 0;

    // select qoq or yoy inflation: if it's end of a year, use yoy inflation, otherwise use qoq inflation
    // don't adjust inflation for current
    if (loopDate === CURRENT_DATE) {
      inflationForDate = 0;
    } else if (new Date(loopDate).getMonth() !== 11) {
      if (inflationData?.qoq == null) {
        throw new Error(`qoq data not found for date ${loopDate}`);
      }
      inflationForDate = inflationData.qoq;
    } else {
      if (inflationData?.yoy == null) {
        throw new Error(`yoy data not found for date ${loopDate}`);
      }
      inflationForDate = inflationData.yoy;
    }

    if (inflationForDate === undefined) {
      throw new Error(`Inflation data not found for date ${loopDate}`);
    }

    let netPriceYield =
      (priceYield! - inflationForDate) / (1 + inflationForDate);

    yieldMetric[loopDate] = round(netPriceYield + netDividendYield);
  }

  let totalGrowth = 1;
  Object.entries(yieldMetric).forEach(([key, value]) => {
    if (key !== "metricName") {
      totalGrowth = totalGrowth * (1 + (value as number));
    }
  });
  totalGrowth = totalGrowth - 1;

  yieldMetric["Total growth"] = round(totalGrowth);

  const priceYearsPassed = getYearsPassed({
    earliestDefinedDate: earliestPriceDate,
  });

  const yearlyGrowth = yieldMetric["Total growth"]
    ? Math.pow(1 + yieldMetric["Total growth"], 1 / priceYearsPassed) - 1
    : 0;
  yieldMetric["Yearly growth"] = round(yearlyGrowth);

  // calc ttm growth
  // TODO: we can't precisely calculate ttm growth because currently we don't have precise yields that is cleansed from inflation. after having previous 4 quarters calculate precisely
  // utilize existing yields which already
  // - include dividend yield
  // - adjusted for inflation
  // it includes current price change intentionally
  let ttmYield = 1;
  const quarter = whichQuarter(LAST_DATE);
  const curQuarters = DATES.slice(0, quarter + 1);
  curQuarters.forEach((date) => {
    const dateYield = yieldMetric[date] as number;
    ttmYield = ttmYield * (1 + dateYield);
  });
  // depending on the quarter, get yield from finished year
  let yieldFromFinishedYear: number | null = null;
  if (quarter === 4) {
    // TODO: handle end of the year
    throw new Error("TTM growth for end of the year not implemented");
  } else {
    // be aware of flat calculation not cumulative
    const lastFinishedYearYield = yieldMetric[LAST_FINISHED_YEAR_DATE];
    const quarterlyYield = (lastFinishedYearYield as number) / 4;
    yieldFromFinishedYear = quarterlyYield * quarter;
  }
  ttmYield = ttmYield * (1 + (yieldFromFinishedYear as number));
  ttmYield = ttmYield - 1;

  yieldMetric["TTM growth"] = round(ttmYield);

  derivedMetrics.push(yieldMetric as DerivedMetric);
};

/**
 * if stock is recently made IPO, metric values maybe null for older DATES.
 * we need to find the earliest date that metric has value for
 */
const getEarliestDefinedDate = ({
  metricName,
  baseMetrics,
  dates,
}: {
  metricName: BaseMetricNames;
  baseMetrics: BaseMetric[];
  dates: typeof DATES;
}): string => {
  const metric = baseMetrics.find((item) => item.metricName === metricName);
  if (!metric) {
    throw new Error(`Metric ${metricName} not found`);
  }

  for (let i = dates.length - 1; i >= 0; i--) {
    const date = dates[i];
    if (metric[date]) {
      return date;
    }
  }
  throw new Error(`Earliest date not found for metric ${metricName}`);
};

/**
 * if stock is recently made IPO, metric values maybe null for older DATES.
 * So yearPassed param is dynamic and calculated based on the earliest date that metric has value for
 */
const getYearsPassed = ({
  earliestDefinedDate,
}: {
  earliestDefinedDate: string;
}): number => {
  const monthsPassed =
    (lastDateObj.getFullYear() - new Date(earliestDefinedDate).getFullYear()) *
      12 +
    (lastDateObj.getMonth() - new Date(earliestDefinedDate).getMonth());
  const yearsPassed = monthsPassed / 12;
  if (yearsPassed < 0) {
    throw new Error(
      `getYearsPassed: yearsPassed is negative for earliestDefinedDate ${earliestDefinedDate}`
    );
  }
  return yearsPassed;
};

const calcGrowths = ({
  availableDates,
  baseMetrics,
}: {
  availableDates: Dates[];
  baseMetrics: BaseMetric[];
}) => {
  for (const metricName of GROWTH_APPLIED_METRICS) {
    let metric = baseMetrics.find((item) => item.metricName === metricName);

    if (!metric) {
      throw new Error(`${metricName} not found in metrics`);
    }

    // calc "Total growth" for metric
    const firstDateValue = metric?.[availableDates[availableDates.length - 1]];
    const lastDateValue = metric?.[LAST_DATE];

    if (firstDateValue == null || lastDateValue == null) {
      throw new Error(
        `${metricName} firstDateValue: ${firstDateValue}, lastDateValue: ${lastDateValue} not found`
      );
    }

    if (firstDateValue <= 0 || lastDateValue <= 0) {
      metric["Total growth"] = "negative";
    } else {
      const totalGrowth = (lastDateValue - firstDateValue) / firstDateValue;
      metric["Total growth"] = round(totalGrowth);
    }

    const lastQuarter = whichQuarter(LAST_DATE);
    let ttmStartValue: number | undefined = undefined;

    // calc "TTM growth" for metric
    if (lastQuarter === 4) {
      // TODO hadle end of the year
      throw new Error(
        "calcGrowths: TTM growth for end of the year not implemented"
      );
    } else {
      // TODO: you need last 8 quarters to calculate precisely but let's use average for now
      // TODO: dynamicly get last years date. you can't direclty access index because as you add new dates, indexes will change
      // calc average quarterly growth for finished years. 2 and 3 indexes of DATES are the last 2 finished years
      const lastFinishedYearValue = metric[LAST_FINISHED_YEAR_DATE] as number;
      const previousFinishedYearValue = metric[
        PREVIOUS_FINISHED_YEAR_DATE
      ] as number;

      const quarterlyIncrease =
        (lastFinishedYearValue - previousFinishedYearValue) / 4;
      ttmStartValue =
        previousFinishedYearValue + quarterlyIncrease * lastQuarter;
    }

    if (ttmStartValue === undefined || lastDateValue === undefined) {
      throw new Error(
        `calcGrowths: ${metricName} ttmStartValue: ${ttmStartValue}, lastDateValue: ${lastDateValue}`
      );
    }

    if (ttmStartValue <= 0 || lastDateValue <= 0) {
      metric["TTM growth"] = "negative";
    } else {
      const ttmGrowth = (lastDateValue - ttmStartValue) / ttmStartValue;
      metric["TTM growth"] = round(ttmGrowth);
    }
  }
};

const adjustForInflation = ({
  baseMetrics,
  derivedMetrics,
  inflation,
  stockConfig,
  availableDates,
  yearsPassed,
}: {
  baseMetrics: BaseMetric[];
  derivedMetrics: DerivedMetric[];
  inflation: Inflation[];
  stockConfig: StockConfig;
  availableDates: Dates[];
  yearsPassed: number;
}) => {
  for (const metricName of GROWTH_APPLIED_METRICS) {
    const metric = baseMetrics.find((item) => item.metricName === metricName);

    if (!metric) {
      throw new Error(`${metricName} not found in metrics`);
    }

    const inflationData = inflation.find((item) => item.date === LAST_DATE);
    if (!inflationData) {
      throw new Error(`Inflation data not found for date ${LAST_DATE}`);
    }

    if (metric?.["Total growth"] == null) {
      throw new Error(`Total growth not found for metric ${metricName}`);
    }

    if (metric["Total growth"] === "negative") {
      metric["Total growth"] = "negative";
      metric["Yearly growth"] = "negative";
    } else {
      // some stocks may recently made IPO so you need to calculate the accumulated inflation for the available dates

      let accumulatedInflation = 0;
      for (let i = 0; i < availableDates.length; i++) {
        const date = availableDates[i];
        // for current and first available date, don't apply inflation
        if (date === CURRENT_DATE || i === availableDates.length - 1) {
          continue;
        }
        const inflationData = inflation.find((item) => item.date === date);
        if (!inflationData) {
          throw new Error(`Inflation data not found for date ${date}`);
        }

        // for last date, use ytd inflation
        if (date === LAST_DATE) {
          accumulatedInflation =
            (1 + accumulatedInflation) * (1 + inflationData.ytd) - 1;
          // if it's current year's old quarter, ignore
        } else if (date.slice(0, 4) === lastDateObj.getFullYear().toString()) {
          // console.log(
          //   "Ignoring current year's old quarter inflation for",
          //   date
          // );
          continue;
        } else {
          // for other dates, use yoy inflation
          accumulatedInflation =
            (1 + accumulatedInflation) * (1 + inflationData.yoy) - 1;
        }
      }

      metric["Total growth"] = round(
        (metric["Total growth"] - accumulatedInflation) /
          (1 + accumulatedInflation)
      );

      // yearly growth is derived from total growth
      const yearlyGrowth = metric["Total growth"]
        ? Math.pow(1 + metric["Total growth"], 1 / yearsPassed) - 1
        : 0;
      metric["Yearly growth"] = round(yearlyGrowth);
    }

    if (metric["TTM growth"] === undefined) {
      throw new Error(`TTM growth not found for metric ${metricName}`);
    }

    if (metric["TTM growth"] !== "negative" && metric["TTM growth"] != null) {
      metric["TTM growth"] = round(
        (metric["TTM growth"] - inflationData?.yoy) / (1 + inflationData.yoy)
      );
    }
  }

  // after inflation adjustment, calculate selected growth
  const selectedGrowth = {
    metricName: "Selected growth",
  } as Partial<DerivedMetric>;

  // merged growth can only include numbers since you explicitly checking it before populating
  type GrowthRecordKeys = keyof GrowthRecord;
  type MergedGrowth = {
    [K in GrowthRecordKeys]: number;
  };

  let mergedGrowth: Partial<MergedGrowth> = {};

  stockConfig.growthParams.forEach((growthParamName) => {
    const growthMetric = baseMetrics.find(
      (item) => item.metricName === growthParamName
    );

    if (growthMetric === undefined) {
      throw new Error(`Growth metric ${growthParamName} not found in metrics`);
    }

    const totalGrowth = growthMetric["Total growth"];
    const ttmGrowth = growthMetric["TTM growth"];

    if (typeof totalGrowth != "number" || typeof ttmGrowth != "number") {
      throw new Error(
        `TODO: Growth metric ${growthParamName} is negative handle it graciously for ${stockConfig.stockSymbol}`
      );
    }

    mergedGrowth["Total growth"] =
      (mergedGrowth["Total growth"] ?? 0) + (totalGrowth ?? 0);
    mergedGrowth["TTM growth"] =
      (mergedGrowth["TTM growth"] ?? 0) + (ttmGrowth ?? 0);
  });

  // when object.entries is used, typescript don't infer the type of the object. recast it
  const growthEntries = Object.entries(mergedGrowth) as [
    keyof GrowthRecord,
    number
  ][];
  console.log("growthEntries", growthEntries);

  growthEntries.forEach(([key, value]) => {
    const medianValue = value / stockConfig.growthParams.length;
    selectedGrowth[key] = round(medianValue);
  });

  // calc yearly growth from total growth
  const selectedTotalGrowth = selectedGrowth["Total growth"] as number;
  const selectedYearlyGrowth = selectedTotalGrowth
    ? Math.pow(1 + selectedTotalGrowth, 1 / yearsPassed) - 1
    : 0;
  selectedGrowth["Yearly growth"] = round(selectedYearlyGrowth);

  derivedMetrics.push(selectedGrowth as DerivedMetric);
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

// %15 of dividend is tax in tr
// %20 of dividend is tax in us(i have paid %20 tax in 2025/07/07 for vgk etf)
export const getTaxByRegion = ({
  region,
}: {
  region: string;
}): {
  dividendTaxRate: number;
} => {
  switch (region) {
    case "tr":
      return {
        dividendTaxRate: 0.15,
      };
    case "us":
      return {
        dividendTaxRate: 0.2,
      };
    default:
      throw new Error(`Region ${region} not supported for tax calculation`);
  }
};

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
    (item) => item.metricName === "#config"
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
    `${region}.json`
  );
  const stocksDynamic = readJsonFile<StockDynamic>(stocksDynamicPath);
  return stocksDynamic;
};

/**
 * Rounds a number to a fixed number of decimal places (limit floating point precision issues).
 */
export function round(value: number): number {
  const TO_FIXED_DIGIT = 5;
  return Number(value.toFixed(TO_FIXED_DIGIT));
}

export const getMoneyFundYield = ({
  inflation,
}: {
  inflation: Inflation[];
}): number | null => {
  // TODO: values are hardcoded for now
  // we will compare money fund yield with stocks' yield for ttm period
  // previous ttm bgp price 2024/9/30
  const previousTtmBGPPrice = 2.946158;
  // current ttm bgp price 2025/9/30
  const currBGPPrice = 4.639166;
  const nominalBGPYield =
    (currBGPPrice - previousTtmBGPPrice) / previousTtmBGPPrice;

  const netBGPYield = nominalBGPYield * (1 - 0.175);

  const inflationForTtm = inflation?.find(
    (item) => item.date === LAST_DATE
  )?.yoy;
  if (inflationForTtm == null) {
    return null;
  }
  const adjustedBGPYield =
    (netBGPYield - inflationForTtm) / (1 + inflationForTtm);

  return adjustedBGPYield;
};
