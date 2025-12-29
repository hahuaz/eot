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
import { DATA_DIR } from "@/lib/constants";
import {
  getAvailableDates,
  LAST_DATE,
  CURRENT_DATE,
  LAST_FINISHED_YEAR_DATE,
  PREVIOUS_FINISHED_YEAR_DATE,
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
      `${this.stockSymbol}.tsv`,
    );

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
      stockSymbol: this.stockSymbol,
      outstandingShares: configValues[2] as number,
      trimDigit: configValues[3] as number,
      selectedGrowthMetrics: (configValues[4] as string)
        .split("|")
        .map((param) => param.trim()),
    };

    baseMetrics = baseMetrics.filter((_, i) => i !== configIndex);

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
    this.yieldMetric();
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

  private yieldMetric() {
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

    const yieldMetric = {
      metricName: "Yield",
    } as Partial<DerivedMetric>;

    const { dividendTax } = TAXES[this.region];

    for (let dateIndex = 0; dateIndex < this.priceDates.length; dateIndex++) {
      // previous price is needed to calculate yield, so we skip the last date
      if (dateIndex === this.priceDates.length - 1) {
        break;
      }

      const date = this.priceDates[dateIndex];

      // get inflation adjusted dividend yield
      const dividendValue = dividendMetric[date] ?? 0;
      const netDividendYield = dividendValue * (1 - dividendTax);

      // get inflation adjusted price yield
      const priceValue = priceMetric[date] ?? 0;
      const previousPriceValue =
        priceMetric[this.priceDates[dateIndex + 1]] ?? 0;
      const priceYield = (priceValue - previousPriceValue) / previousPriceValue;

      const inflationData = this.inflation.find((item) => item.date === date);
      if (!inflationData && date !== CURRENT_DATE) {
        throw new Error(`Inflation data not found for date ${date}`);
      }

      let inflationForDate: Dates | number = 0;

      if (date === CURRENT_DATE) {
        inflationForDate = 0;
      } else if (new Date(date).getMonth() !== 11) {
        if (inflationData?.qoq == null) {
          throw new Error(`qoq data not found for date ${date}`);
        }
        inflationForDate = inflationData.qoq;
      } else {
        if (inflationData?.yoy == null) {
          throw new Error(`yoy data not found for date ${date}`);
        }
        inflationForDate = inflationData.yoy;
      }

      if (inflationForDate === undefined) {
        throw new Error(`Inflation data not found for date ${date}`);
      }

      const netPriceYield = calcRealRate({
        nominalRate: priceYield,
        inflationRate: inflationForDate,
      });

      yieldMetric[date] = round(netPriceYield + netDividendYield);
    }

    // calculate total growth by multiplying growth rates for each date
    let totalGrowth = 1;
    Object.entries(yieldMetric).forEach(([key, value]) => {
      if (key !== "metricName") {
        totalGrowth = totalGrowth * (1 + (value as number));
      }
    });
    totalGrowth = totalGrowth - 1;
    yieldMetric["Total growth"] = round(totalGrowth);

    // calculate yearly growth
    const yearlyGrowth = calcYearlyGrowth({
      totalGrowth,
      startDate: this.priceDates[this.priceDates.length - 1],
    });
    yieldMetric["Yearly growth"] = round(yearlyGrowth);

    // calculate ttm growth: current date price change is included
    // TODO: soon there will be exact growth rates for all necessary dates:
    // growthFromFinishedYear will be removed
    // quarter will be removed since current + last 4 dates will be used
    let ttmGrowth = 1;
    const quarter = whichQuarter(LAST_DATE);
    // increase the quarter by 1 since current date is included
    const curQuarters = DATES.slice(0, quarter + 1);

    curQuarters.forEach((date) => {
      const dateYield = yieldMetric[date] as number;
      ttmGrowth = ttmGrowth * (1 + dateYield);
    });

    let growthFromFinishedYear: number;
    if (quarter === 4) {
      throw new Error("TTM growth for end of the year not implemented");
    } else {
      const lastFinishedYearYield = yieldMetric[LAST_FINISHED_YEAR_DATE];
      const quarterlyYield = (lastFinishedYearYield as number) / 4;
      growthFromFinishedYear = quarterlyYield * (4 - quarter);
    }
    ttmGrowth = ttmGrowth * (1 + growthFromFinishedYear) - 1;

    yieldMetric["TTM growth"] = round(ttmGrowth);

    this.derivedMetrics.push(yieldMetric as DerivedMetric);
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
        debtMetric[date] = "negative";
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

    for (const date of this.equityDates) {
      const enterpriseValue = this.derivedMetrics.find(
        (item) => item.metricName === "Enterprise value",
      )![date];
      const operatingIncome = this.baseMetrics.find(
        (item) => item.metricName === "Operating income",
      )![date];

      if (operatingIncome == null) {
        throw new Error(`Operating income not found for date ${date}`);
      }

      if (enterpriseValue == null) {
        // TODO
        console.log("how can enterprise value be null?", this.stockSymbol);
        continue;
      }

      if (operatingIncome <= 0 || enterpriseValue == "negative") {
        evToOIMetric[date] = "negative";
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

      if (netIncome <= 0 || enterpriseValue == "negative") {
        evNIMetric[date] = "negative";
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
        metric["Total growth"] = "negative";
      } else {
        const totalGrowth = (lastDateValue - firstDateValue) / firstDateValue;
        metric["Total growth"] = round(totalGrowth);
      }

      // TODO: soon there will be exact growth rates for all necessary dates and this will be removed
      const lastQuarter = whichQuarter(LAST_DATE);
      let ttmStartValue: number | undefined = undefined;
      if (lastQuarter === 4) {
        throw new Error(
          "calcGrowths: TTM growth for end of the year not implemented",
        );
      } else {
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

      if (metric["Total growth"] === "negative") {
        metric["Total growth"] = "negative";
        metric["Yearly growth"] = "negative";
      } else {
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

          if (date === LAST_DATE) {
            accumulatedInflation =
              (1 + accumulatedInflation) * (1 + inflationData.ytd) - 1;
          } else if (
            date.slice(0, 4) === lastDateObj.getFullYear().toString()
          ) {
            continue;
          } else {
            accumulatedInflation =
              (1 + accumulatedInflation) * (1 + inflationData.yoy) - 1;
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

      if (metric["TTM growth"] !== "negative" && metric["TTM growth"] != null) {
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
