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
import { round } from "@/lib/utils";
import {
  LAST_DATE,
  CURRENT_DATE,
  LAST_FINISHED_YEAR_DATE,
  PREVIOUS_FINISHED_YEAR_DATE,
  whichQuarter,
  getYearsPassed,
} from "@/lib/dates";
import { GROWTH_APPLIED_METRICS } from "@/lib/constants";
import { getTaxByRegion } from "@/lib/financials";

export const createCurrentColumn = ({
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

export const createEV = ({
  stockContext,
}: {
  stockContext: {
    equityAvailableDates: Dates[];
    baseMetrics: BaseMetric[];
    derivedMetrics: DerivedMetric[];
    stockConfig: StockConfig;
  };
}) => {
  const { equityAvailableDates, baseMetrics, derivedMetrics, stockConfig } =
    stockContext;
  const enterpriseValueMetric = {
    metricName: "Enterprise value",
  } as Partial<DerivedMetric>;

  for (const date of equityAvailableDates) {
    const price = baseMetrics.find((item) => item.metricName === "Price")![
      date
    ];
    const cashValue =
      baseMetrics.find(
        (item) => item.metricName === "Cash & cash equivalents",
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
      marketValue + shortTermLiabilities + longTermLiabilities - cashValue,
    );
  }

  derivedMetrics.push(enterpriseValueMetric as DerivedMetric);
};

export const createNDtoOIMetric = ({
  stockContext,
}: {
  stockContext: {
    equityAvailableDates: Dates[];
    baseMetrics: BaseMetric[];
    derivedMetrics: DerivedMetric[];
    stockConfig: StockConfig;
  };
}) => {
  const { equityAvailableDates, baseMetrics, derivedMetrics, stockConfig } =
    stockContext;
  const netDebtOIMetric = {
    metricName: "Net debt / operating income",
  } as Partial<DerivedMetric>;

  for (const date of equityAvailableDates) {
    const cash =
      baseMetrics.find(
        (item) => item.metricName === "Cash & cash equivalents",
      )?.[date] ?? 0;
    const shortTermLiabilities =
      baseMetrics.find(
        (item) => item.metricName === "Short term liabilities",
      )?.[date] ?? 0;
    const longTermLiabilities =
      baseMetrics.find((item) => item.metricName === "Long term liabilities")?.[
        date
      ] ?? 0;
    const operatingIncome = baseMetrics.find(
      (item) => item.metricName === "Operating income",
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

export const createEVtoOIMetric = ({
  stockContext,
}: {
  stockContext: {
    equityAvailableDates: Dates[];
    baseMetrics: BaseMetric[];
    derivedMetrics: DerivedMetric[];
  };
}) => {
  const { equityAvailableDates, baseMetrics, derivedMetrics } = stockContext;
  const evToOIMetric = {
    metricName: "EV / operating income",
  } as Partial<DerivedMetric>;

  for (const date of equityAvailableDates) {
    const enterpriseValue = derivedMetrics.find(
      (item) => item.metricName === "Enterprise value",
    )![date];
    const operatingIncome = baseMetrics.find(
      (item) => item.metricName === "Operating income",
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

export const createEVtoNI = ({
  stockContext,
}: {
  stockContext: {
    equityAvailableDates: Dates[];
    baseMetrics: BaseMetric[];
    derivedMetrics: DerivedMetric[];
  };
}) => {
  const { equityAvailableDates, baseMetrics, derivedMetrics } = stockContext;
  const evNIMetric = {
    metricName: "EV / net income",
  } as Partial<DerivedMetric>;

  for (const date of equityAvailableDates) {
    const enterpriseValue = derivedMetrics.find(
      (item) => item.metricName === "Enterprise value",
    )?.[date];
    const netIncome = baseMetrics.find(
      (item) => item.metricName === "Net income",
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

export const createMVtoBVMetric = ({
  stockContext,
}: {
  stockContext: {
    equityAvailableDates: Dates[];
    baseMetrics: BaseMetric[];
    derivedMetrics: DerivedMetric[];
    stockConfig: StockConfig;
  };
}) => {
  const { equityAvailableDates, baseMetrics, derivedMetrics, stockConfig } =
    stockContext;
  const mvToBVMetric = {
    metricName: "Market value / book value",
  } as Partial<DerivedMetric>;

  for (const date of equityAvailableDates) {
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
        bookValue,
    );
  }

  derivedMetrics.push(mvToBVMetric as DerivedMetric);
};

export const createYieldMetric = ({
  stockContext,
}: {
  stockContext: {
    baseMetrics: BaseMetric[];
    derivedMetrics: DerivedMetric[];
    inflation: Inflation[];
    region: string;
    priceAvailableDates: Dates[];
  };
}) => {
  const {
    baseMetrics,
    derivedMetrics,
    inflation,
    region,
    priceAvailableDates,
  } = stockContext;
  const dividendIndex = baseMetrics.findIndex(
    (item) => item.metricName === "Dividend",
  );
  const priceIndex = baseMetrics.findIndex(
    (item) => item.metricName === "Price",
  );

  if (dividendIndex === -1 || priceIndex === -1) {
    throw new Error("Dividend or Price metric not found");
  }

  const dividendMetric = baseMetrics[dividendIndex];
  const priceMetric = baseMetrics[priceIndex];

  let earliestPriceDate: Dates | undefined = undefined;
  for (let i = priceAvailableDates.length - 1; i >= 0; i--) {
    const date = priceAvailableDates[i];
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

  const { dividendTax } = getTaxByRegion({ region });

  for (let i = 0; i < availableDates.length; i++) {
    // yield can't be calculated without older date. so break if it's the last date
    if (i === availableDates.length - 1) {
      break;
    }

    const loopDate = availableDates[i];
    const dividendValue = dividendMetric[loopDate] ?? 0;
    const netDividendYield = dividendValue * (1 - dividendTax);
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
    date: priceAvailableDates[priceAvailableDates.length - 1],
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
    yieldFromFinishedYear = quarterlyYield;
  }
  ttmYield = ttmYield * (1 + (yieldFromFinishedYear as number));
  ttmYield = ttmYield - 1;

  yieldMetric["TTM growth"] = round(ttmYield);

  derivedMetrics.push(yieldMetric as DerivedMetric);
};

export const calcGrowths = ({
  stockContext,
}: {
  stockContext: {
    equityAvailableDates: Dates[];
    baseMetrics: BaseMetric[];
  };
}) => {
  const { equityAvailableDates, baseMetrics } = stockContext;
  for (const metricName of GROWTH_APPLIED_METRICS) {
    let metric = baseMetrics.find((item) => item.metricName === metricName);

    if (!metric) {
      throw new Error(`${metricName} not found in metrics`);
    }

    // calc "Total growth" for metric
    const firstDateValue =
      metric?.[equityAvailableDates[equityAvailableDates.length - 1]];
    const lastDateValue = metric?.[LAST_DATE];

    if (firstDateValue == null || lastDateValue == null) {
      throw new Error(
        `${metricName} firstDateValue: ${firstDateValue}, lastDateValue: ${lastDateValue} not found`,
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
        "calcGrowths: TTM growth for end of the year not implemented",
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
        `calcGrowths: ${metricName} ttmStartValue: ${ttmStartValue}, lastDateValue: ${lastDateValue}`,
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
