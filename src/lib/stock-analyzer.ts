import {
  DATES,
  Dates,
  StockConfig,
  Inflation,
  DerivedMetric,
  BaseMetric,
  StockSymbol,
  StockDynamicInfoMap,
  StockDynamicInfo,
} from "@shared/types";
import { Region, regions } from "@/types";
import path from "path";
import { parseCSV, readJsonFile } from "@/lib/file";
import { DATA_DIR, OBSERVATION_START_DATE_STR } from "@/lib/constants";
import {
  getAvailableDates,
  LAST_DATE,
  CURRENT_DATE,
  TTM_START_DATE,
  whichQuarter,
  lastDateObj,
} from "@/lib/dates";
import { round, calcRealRate, calcYearlyGrowth } from "@/lib/utils";

export const TAXES = {
  tr: {
    withholdingTax: 0.175,
    dividendTax: 0.15,
  },
  us: {
    withholdingTax: 0.24,
    dividendTax: 0.2,
  },
};

export const DATE_TO_USDTRY = {
  current: 46.31,
  "2026/3/30": 44.5,
  "2025/12/30": 43,
  "2025/9/30": 41.66,
  "2025/6/30": 39.81,
  "2025/3/30": 37.93,
  "2024/12/30": 35.32,
  "2023/12/30": 29.78,
  "2022/12/30": 18.61,
  "2021/12/30": 13.21,
  "2020/12/30": 7.4,
  "2019/12/30": 5.97,
};

const getUsdTryRate = (date: Dates): number => {
  const usdTryRate = DATE_TO_USDTRY[date];
  if (usdTryRate == null) {
    throw new Error(`USDTRY rate not found for date ${date}`);
  }
  return usdTryRate;
};

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

export const STOCKS_DYNAMIC_DATA = regions.reduce(
  (acc, region) => {
    const stocksDynamicPath = path.join(
      DATA_DIR,
      "stocks-dynamic",
      `${region}.json`,
    );
    const stocksDynamic = readJsonFile<StockDynamicInfoMap>(stocksDynamicPath);
    acc[region] = stocksDynamic;
    return acc;
  },
  {} as Record<Region, StockDynamicInfoMap>,
);

export class StockAnalyzer {
  // Separate array for derived metrics to maintain type safety and make it easier to distinguish between base and calculated values
  private derivedMetrics: DerivedMetric[] = [];
  // for every stock, growth calculation is done for below metrics. there is also selected growth metric, which is obtainable from config and it declares which growths are used for performance calculation
  private GROWTH_APPLIED_METRICS = [
    "Equity",
    "Total assets",
    "Revenue",
    "Operating income",
    "Net income",
  ] as const;
  private baseMetrics!: BaseMetric[];
  private config!: StockConfig;
  /** For recently IPO'd stocks, not all historical dates will have values thus available dates is calculated with the earliest defined date */
  private equityDates!: Dates[];
  private priceDates!: Dates[];
  private inflation!: Inflation[];
  private dynamicInfo!: StockDynamicInfo;

  constructor(
    private stockSymbol: StockSymbol,
    private region: Region,
  ) {
    // 1. set base metrics
    const stockPath = path.join(
      DATA_DIR,
      "stocks",
      this.region,
      `${this.stockSymbol}.csv`,
    );

    let { data: baseMetrics } = parseCSV<BaseMetric>({
      filePath: stockPath,
      header: true,
    });
    console.log("baseMetrics", baseMetrics);

    const SHEET_SECTIONS = ["Balance sheet", "Income statement", "Statistics"];
    baseMetrics = baseMetrics.filter(
      (m) => !SHEET_SECTIONS.includes(m.metricName),
    );

    const configIndex = baseMetrics.findIndex(
      (item) => item.metricName === "#config",
    );

    const configValues =
      configIndex !== -1 ? Object.values(baseMetrics[configIndex]) : [];

    const stockConfig: StockConfig = {
      stockSymbol: this.stockSymbol,
      outstandingShares: configValues[2] as number,
      trimDigit: configValues[3] as number,
      selectedGrowthMetrics: (configValues[4] as string)
        .split("|")
        .map((param) => param.trim()),
    };

    // Ignore CSV content after the config metric
    baseMetrics = baseMetrics.filter((_, i) => i < configIndex);

    this.baseMetrics = baseMetrics;

    this.config = stockConfig;
    this.inflation = INFLATION_DATA[this.region];

    const stocksDynamic = STOCKS_DYNAMIC_DATA[this.region];
    const stockDynamic = stocksDynamic[this.stockSymbol];
    if (!stockDynamic) {
      throw new Error("Stock not found in dynamic data");
    }
    this.dynamicInfo = stockDynamic;

    // 2. populate current column
    for (const metric of this.baseMetrics) {
      if (metric.metricName === "Dividend") {
        continue;
      } else if (metric.metricName === "Price") {
        metric["current"] = this.dynamicInfo.price;
      } else {
        metric["current"] = metric[LAST_DATE];
      }
    }

    // 3. calculate dates
    this.equityDates = getAvailableDates({
      baseMetrics: this.baseMetrics,
      metricName: "Equity",
    });
    this.priceDates = getAvailableDates({
      baseMetrics: this.baseMetrics,
      metricName: "Price",
    });
  }

  public getMetrics() {
    // 1: create derived metrics
    this.usdPriceMetric();
    this.usdYieldMetric();
    this.observationStartReturnMetric();
    this.debtMetric();
    this.evMetric();
    this.evToOiMetric();
    this.evToNiMetric();
    this.mvToBvMetric();

    // 2: calculate growth rates
    this.calcGrowths();

    // 3: adjust growths for inflation
    this.calcRealGrowth();

    return {
      baseMetrics: this.baseMetrics,
      derivedMetrics: this.derivedMetrics,
      stockConfig: this.config,
    };
  }

  private usdPriceMetric() {
    const priceMetric = this.baseMetrics.find(
      (item) => item.metricName === "Price",
    );
    if (!priceMetric) {
      throw new Error("Price metric not found");
    }

    const usdPriceMetric = {
      metricName: "USD Price",
    } as Partial<DerivedMetric>;

    for (const date of this.priceDates) {
      const priceValue = priceMetric[date];
      if (priceValue == null) {
        continue;
      }

      usdPriceMetric[date] = round(priceValue / getUsdTryRate(date));
    }

    this.derivedMetrics.push(usdPriceMetric as DerivedMetric);
  }

  private usdYieldMetric() {
    const dividendIndex = this.baseMetrics.findIndex(
      (item) => item.metricName === "Dividend",
    );
    const priceIndex = this.baseMetrics.findIndex(
      (item) => item.metricName === "Price",
    );

    if (dividendIndex === -1 || priceIndex === -1) {
      throw new Error("Dividend or Price metric not found");
    }

    const dividendMetric = this.baseMetrics[dividendIndex];
    const priceMetric = this.baseMetrics[priceIndex];

    const usdYieldMetric = {
      metricName: "USD Yield",
    } as Partial<DerivedMetric>;

    const { dividendTax } = TAXES[this.region];

    for (let dateIndex = 0; dateIndex < this.priceDates.length; dateIndex++) {
      // previous price is needed to calculate yield, so we skip the last date
      if (dateIndex === this.priceDates.length - 1) {
        break;
      }

      const date = this.priceDates[dateIndex];
      const previousDate = this.priceDates[dateIndex + 1];

      const dividendValue = dividendMetric[date] ?? 0;
      const netDividendYield = dividendValue * (1 - dividendTax);

      const priceValue = priceMetric[date] ?? 0;
      const previousPriceValue = priceMetric[previousDate] ?? 0;
      const usdPriceValue = priceValue / getUsdTryRate(date);
      const previousUsdPriceValue =
        previousPriceValue / getUsdTryRate(previousDate);
      const usdPriceYield =
        (usdPriceValue - previousUsdPriceValue) / previousUsdPriceValue;

      usdYieldMetric[date] = round(usdPriceYield + netDividendYield);
    }

    this.addYieldGrowths(usdYieldMetric);

    this.derivedMetrics.push(usdYieldMetric as DerivedMetric);
  }

  private addYieldGrowths(metric: Partial<DerivedMetric>) {
    // calculate total growth by multiplying growth rates for each date
    let totalGrowth = 1;
    Object.entries(metric).forEach(([key, value]) => {
      if (key !== "metricName") {
        totalGrowth = totalGrowth * (1 + (value as number));
      }
    });
    totalGrowth = totalGrowth - 1;
    metric["Total growth"] = round(totalGrowth);

    // calculate yearly growth
    const yearlyGrowth = calcYearlyGrowth({
      totalGrowth,
      startDate: this.priceDates[this.priceDates.length - 1],
    });
    metric["Yearly growth"] = round(yearlyGrowth);

    // calculate ttm growth: current date price change is included
    let ttmGrowth = 1;
    const ttmQuarters = DATES.slice(0, DATES.indexOf(TTM_START_DATE));
    ttmQuarters.forEach((date) => {
      const dateYield = metric[date] as number;
      ttmGrowth = ttmGrowth * (1 + dateYield);
    });
    ttmGrowth = ttmGrowth - 1;

    metric["TTM growth"] = round(ttmGrowth);
  }

  private observationStartReturnMetric() {
    const priceMetric = this.baseMetrics.find(
      (item) => item.metricName === "Price",
    );
    if (!priceMetric) {
      throw new Error("Price metric not found");
    }

    const observationStartPrice =
      priceMetric[OBSERVATION_START_DATE_STR as Dates];
    const observationStartUsdTryRate = getUsdTryRate(
      OBSERVATION_START_DATE_STR as Dates,
    );

    const metric = {
      metricName: "Observation Start Return",
      "Total growth": "N/A",
      "Yearly growth": "N/A",
      "TTM growth": "N/A",
    } as Partial<DerivedMetric>;

    for (const date of DATES) {
      metric[date] = "N/A";
    }

    if (observationStartPrice == null || observationStartPrice <= 0) {
      this.derivedMetrics.push(metric as DerivedMetric);
      return;
    }

    const observationStartUsdPrice =
      observationStartPrice / observationStartUsdTryRate;

    for (const date of this.priceDates) {
      const priceValue = priceMetric[date];
      if (priceValue == null) {
        continue;
      }
      if (new Date(date) < new Date(OBSERVATION_START_DATE_STR)) {
        continue;
      }

      const usdPriceValue = priceValue / getUsdTryRate(date);
      metric[date] = round(
        (usdPriceValue - observationStartUsdPrice) / observationStartUsdPrice,
      );
    }

    const currentPrice = priceMetric[CURRENT_DATE];
    if (currentPrice != null) {
      const currentUsdPrice = currentPrice / getUsdTryRate(CURRENT_DATE);
      metric[CURRENT_DATE] = round(
        (currentUsdPrice - observationStartUsdPrice) / observationStartUsdPrice,
      );
      metric["Total growth"] = metric[CURRENT_DATE];
      metric["Yearly growth"] = round(
        calcYearlyGrowth({
          totalGrowth: metric[CURRENT_DATE] as number,
          startDate: OBSERVATION_START_DATE_STR,
        }),
      );
    }

    this.derivedMetrics.push(metric as DerivedMetric);
  }

  private debtMetric() {
    const debtMetric = {
      metricName: "Net debt / operating income",
    } as Partial<DerivedMetric>;

    for (const date of this.equityDates) {
      const cash =
        this.baseMetrics.find(
          (item) => item.metricName === "Cash & cash equivalents",
        )?.[date] ?? 0;
      const shortTermLiabilities =
        this.baseMetrics.find(
          (item) => item.metricName === "Short term liabilities",
        )?.[date] ?? 0;
      const longTermLiabilities =
        this.baseMetrics.find(
          (item) => item.metricName === "Long term liabilities",
        )?.[date] ?? 0;
      const operatingIncome = this.baseMetrics.find(
        (item) => item.metricName === "Operating income",
      )![date];

      if (operatingIncome == null) {
        console.log("stockConfig", this.config);
        throw new Error(`Operating income not found for date ${date}`);
      }

      if (operatingIncome <= 0) {
        debtMetric[date] = "N/A";
      } else {
        const netDebt = shortTermLiabilities + longTermLiabilities - cash;
        debtMetric[date] = round(netDebt / operatingIncome);
      }
    }

    this.derivedMetrics.push(debtMetric as DerivedMetric);
  }

  private evMetric() {
    const enterpriseValueMetric = {
      metricName: "Enterprise value",
    } as Partial<DerivedMetric>;

    for (const date of this.priceDates) {
      const price = this.baseMetrics.find(
        (item) => item.metricName === "Price",
      )![date]!;
      const cashValue =
        this.baseMetrics.find(
          (item) => item.metricName === "Cash & cash equivalents",
        )![date] ?? 0;
      const shortTermLiabilities =
        this.baseMetrics.find(
          (item) => item.metricName === "Short term liabilities",
        )![date] ?? 0;
      const longTermLiabilities =
        this.baseMetrics.find(
          (item) => item.metricName === "Long term liabilities",
        )![date] ?? 0;

      // base metrics are already trimmed by trimDigit. apply same to derived metrics
      const marketValue =
        (price * this.config.outstandingShares) / this.config.trimDigit;
      enterpriseValueMetric[date] = round(
        marketValue + shortTermLiabilities + longTermLiabilities - cashValue,
      );
    }

    this.derivedMetrics.push(enterpriseValueMetric as DerivedMetric);
  }

  private evToOiMetric() {
    const evToOIMetric = {
      metricName: "EV / operating income",
    } as Partial<DerivedMetric>;

    for (const date of this.priceDates) {
      const enterpriseValue = this.derivedMetrics.find(
        (item) => item.metricName === "Enterprise value",
      )![date];
      const operatingIncome = this.baseMetrics.find(
        (item) => item.metricName === "Operating income",
      )![date];

      if (operatingIncome == null) {
        throw new Error(
          `Operating income not found for date ${date} and symbol ${this.config.stockSymbol}`,
        );
      }

      if (enterpriseValue == null) {
        throw new Error(`Enterprise value not found for date ${date}`);
      }

      if (operatingIncome <= 0 || enterpriseValue == "N/A") {
        evToOIMetric[date] = "N/A";
      } else {
        evToOIMetric[date] = round(enterpriseValue / operatingIncome);
      }
    }

    this.derivedMetrics.push(evToOIMetric as DerivedMetric);
  }

  private evToNiMetric() {
    const evNIMetric = {
      metricName: "EV / net income",
    } as Partial<DerivedMetric>;

    for (const date of this.equityDates) {
      const enterpriseValue = this.derivedMetrics.find(
        (item) => item.metricName === "Enterprise value",
      )?.[date];
      const netIncome = this.baseMetrics.find(
        (item) => item.metricName === "Net income",
      )![date];

      if (netIncome == null) {
        throw new Error(`Net income not found for date ${date}`);
      }
      if (enterpriseValue == null) {
        continue;
      }

      if (netIncome <= 0 || enterpriseValue == "N/A") {
        evNIMetric[date] = "N/A";
      } else {
        evNIMetric[date] = round(enterpriseValue / netIncome);
      }
    }

    this.derivedMetrics.push(evNIMetric as DerivedMetric);
  }

  private mvToBvMetric() {
    const mvToBVMetric = {
      metricName: "Market value / book value",
    } as Partial<DerivedMetric>;

    for (const date of this.equityDates) {
      const price = this.baseMetrics.find(
        (item) => item.metricName === "Price",
      )![date];
      const bookValue = this.baseMetrics.find(
        (item) => item.metricName === "Equity",
      )![date];

      if (bookValue == null) {
        throw new Error(`Book value not found for date ${date}`);
      }

      if (price == null) {
        continue;
      }

      mvToBVMetric[date] = round(
        (price * this.config.outstandingShares) /
          this.config.trimDigit /
          bookValue,
      );
    }

    this.derivedMetrics.push(mvToBVMetric as DerivedMetric);
  }

  private calcGrowths() {
    for (const metricName of this.GROWTH_APPLIED_METRICS) {
      let metric = this.baseMetrics.find(
        (item) => item.metricName === metricName,
      );

      if (!metric) {
        throw new Error(`${metricName} not found in metrics`);
      }

      const firstDateValue =
        metric?.[this.equityDates[this.equityDates.length - 1]];
      const lastDateValue = metric?.[LAST_DATE];

      if (firstDateValue == null || lastDateValue == null) {
        throw new Error(
          `${metricName} firstDateValue: ${firstDateValue}, lastDateValue: ${lastDateValue} not found`,
        );
      }

      if (firstDateValue <= 0 || lastDateValue <= 0) {
        metric["Total growth"] = "N/A";
      } else {
        const totalGrowth = (lastDateValue - firstDateValue) / firstDateValue;
        metric["Total growth"] = round(totalGrowth);
      }

      let ttmStartValue = metric?.[TTM_START_DATE];

      if (ttmStartValue == undefined || lastDateValue == undefined) {
        throw new Error(
          `calcGrowths: ${metricName} ttmStartValue: ${ttmStartValue}, lastDateValue: ${lastDateValue}`,
        );
      }

      if (ttmStartValue <= 0 || lastDateValue <= 0) {
        metric["TTM growth"] = "N/A";
      } else {
        const ttmGrowth = (lastDateValue - ttmStartValue) / ttmStartValue;
        metric["TTM growth"] = round(ttmGrowth);
      }
    }
  }

  private calcRealGrowth() {
    for (const metricName of this.GROWTH_APPLIED_METRICS) {
      const metric = this.baseMetrics.find(
        (item) => item.metricName === metricName,
      );

      if (!metric) {
        throw new Error(`${metricName} not found in metrics`);
      }

      const inflationData = this.inflation.find(
        (item) => item.date === LAST_DATE,
      );
      if (!inflationData) {
        throw new Error(`Inflation data not found for date ${LAST_DATE}`);
      }

      if (metric?.["Total growth"] == null) {
        throw new Error(`Total growth not found for metric ${metricName}`);
      }

      if (metric["Total growth"] === "N/A") {
        metric["Total growth"] = "N/A";
        metric["Yearly growth"] = "N/A";
      } else {
        // for the given symbol, calculate accumulated inflation for its lifetime.
        let accumulatedInflation = 0;
        for (let i = 0; i < this.equityDates.length; i++) {
          const date = this.equityDates[i];
          if (date === CURRENT_DATE || i === this.equityDates.length - 1) {
            continue;
          }
          const inflationData = this.inflation.find(
            (item) => item.date === date,
          );
          if (!inflationData) {
            throw new Error(`Inflation data not found for date ${date}`);
          }

          // for the before of 2024/12/30, use yoy inflation, for the others use qoq inflation to calculate accumulated inflation.
          if (new Date(date) <= new Date("2024-12-30")) {
            if (inflationData.yoy == null) {
              throw new Error(`yoy data not found for date ${date}`);
            }
            accumulatedInflation =
              (1 + accumulatedInflation) * (1 + inflationData.yoy) - 1;
          } else {
            if (inflationData.qoq == null) {
              throw new Error(`qoq data not found for date ${date}`);
            }
            accumulatedInflation =
              (1 + accumulatedInflation) * (1 + inflationData.qoq) - 1;
          }
        }

        metric["Total growth"] = round(
          calcRealRate({
            nominalRate: metric["Total growth"]!,
            inflationRate: accumulatedInflation,
          }),
        );

        // yearly growth is calculated after inflation adjusted total growth calculation
        const yearlyGrowth = calcYearlyGrowth({
          totalGrowth: metric["Total growth"]!,
          startDate: this.equityDates[this.equityDates.length - 1],
        });
        metric["Yearly growth"] = round(yearlyGrowth);
      }

      if (metric["TTM growth"] === undefined) {
        throw new Error(`TTM growth not found for metric ${metricName}`);
      }

      if (metric["TTM growth"] !== "N/A" && metric["TTM growth"] != null) {
        metric["TTM growth"] = round(
          calcRealRate({
            nominalRate: metric["TTM growth"]!,
            inflationRate: inflationData.yoy,
          }),
        );
      }
    }

    // calculate selected growth median
    const selectedMetrics = this.config.selectedGrowthMetrics.map((name) => {
      const metric = this.baseMetrics.find((m) => m.metricName === name);
      if (!metric) {
        throw new Error(`Growth metric ${name} not found in metrics`);
      }

      if (
        typeof metric["Total growth"] !== "number" ||
        typeof metric["TTM growth"] !== "number"
      ) {
        throw new Error(
          `Growth metric ${name} is negative for ${this.config.stockSymbol}. You need to revise the growth selection.`,
        );
      }

      return metric as BaseMetric & {
        "Total growth": number;
        "TTM growth": number;
      };
    });

    const selectedCount = selectedMetrics.length;
    const avgTotalGrowth =
      selectedMetrics.reduce((acc, m) => acc + m["Total growth"], 0) /
      selectedCount;
    const avgTtmGrowth =
      selectedMetrics.reduce((acc, m) => acc + m["TTM growth"], 0) /
      selectedCount;

    const selectedGrowth = {
      metricName: "Selected growth median",
      "Total growth": round(avgTotalGrowth),
      "TTM growth": round(avgTtmGrowth),
      "Yearly growth": round(
        calcYearlyGrowth({
          totalGrowth: avgTotalGrowth,
          startDate: this.equityDates[this.equityDates.length - 1],
        }),
      ),
    } as DerivedMetric;

    this.derivedMetrics.push(selectedGrowth);
  }
}
