import path from "path";

import { STOCK_DATES, REGIONS, REGION_CONFIG } from "@eot/shared";
import type {
  StockDate,
  StockConfig,
  DerivedMetric,
  BaseMetric,
  BaseMetricNames,
  DerivedMetricNames,
  StockSymbol,
  StockDynamicInfo,
  Region,
} from "@eot/shared";
import { parseCSV } from "@/lib/file";
import { DATA_DIR, OBSERVATION_START_DATE_STR } from "@/lib/constants";
import { getStockPricesMap, getStockPrice } from "@/db/stock-prices.repository";
import { BadRequestError } from "@/lib/errors";
import {
  getAvailableDates,
  LAST_DATE,
  CURRENT_DATE,
  TTM_START_DATE,
} from "@/lib/dates";
import { round, calcYearlyGrowth } from "@/lib/utils";

type DerivedMetricSpec = {
  name: DerivedMetricNames;
  dates: StockDate[];
  compute: (date: StockDate) => number | "N/A" | undefined;
};

type ParsedStockCsv = {
  baseMetrics: BaseMetric[];
  config: StockConfig;
};

// TODO: no region check right now (always converts) - US stocks are
// already USD-denominated, so this currently produces wrong numbers for
// them. Revisit once US handling is addressed.
const toUsdValue = ({
  value,
  date,
}: {
  value: number;
  date: StockDate;
}): number => {
  const DATE_TO_USDTRY = {
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

  const usdTryRate = DATE_TO_USDTRY[date];
  if (usdTryRate == null) {
    throw new Error(`USDTRY rate not found for date ${date}`);
  }

  return value / usdTryRate;
};

// For every stock, growth calculation is done for these metrics. There is
// also a "selected growth metric" set, obtainable from config, which
// declares which of these growths are used for performance calculation.
const GROWTH_APPLIED_METRICS = [
  "Equity",
  "Total assets",
  "Revenue",
  "Operating income",
  "Net income",
] as const;

const SHEET_SECTIONS = ["Balance sheet", "Income statement", "Statistics"];

/**
 * Loads and parses a stock's CSV file into base metric rows plus its config.
 * Pulled out of the class so it can be reasoned about / tested independently
 * of DB access and the rest of the calculation pipeline.
 *
 * NOTE: the "#config" row's fields are read positionally (outstandingShares,
 * trimDigit, selectedGrowthMetrics are columns 2/3/4). That indexing is left
 * untouched here intentionally - fixing it means changing the CSV format
 * itself, which is out of scope for this pass.
 */
function loadStockCsv(
  region: Region,
  stockSymbol: StockSymbol,
): ParsedStockCsv {
  const stockPath = path.join(DATA_DIR, "stocks", region, `${stockSymbol}.csv`);

  let { data: baseMetrics } = parseCSV<BaseMetric>({
    filePath: stockPath,
    header: true,
  });

  baseMetrics = baseMetrics.filter(
    (m) => !SHEET_SECTIONS.includes(m.metricName),
  );

  const configIndex = baseMetrics.findIndex(
    (item) => item.metricName === "#config",
  );

  const configValues =
    configIndex !== -1 ? Object.values(baseMetrics[configIndex]) : [];

  const config: StockConfig = {
    stockSymbol,
    outstandingShares: configValues[2] as number,
    trimDigit: configValues[3] as number,
    selectedGrowthMetrics: (configValues[4] as string)
      .split("|")
      .map((param) => param.trim()),
  };

  // Ignore CSV content after the config metric
  baseMetrics = baseMetrics.filter((_, i) => i < configIndex);

  return { baseMetrics, config };
}

export class StockService {
  // Separate array for derived metrics to maintain type safety and make it easier to distinguish between base and calculated values
  private derivedMetrics: DerivedMetric[] = [];
  private baseMetrics!: BaseMetric[];
  // For recently IPO'd stocks, not all historical dates will have values thus available dates is calculated with the earliest defined date
  private equityDates!: StockDate[];
  private priceDates!: StockDate[];
  private dynamicInfo!: StockDynamicInfo;
  private region!: Region;
  private config!: StockConfig;

  // Name -> metric indexes, built once per instance. These maps + the accessors below give every calculation the same O(1) lookup and the same two well-defined failure modes: getX() throws when a metric is required, tryGetX() returns undefined when it's optional.
  private baseByName = new Map<BaseMetricNames, BaseMetric>();
  private derivedByName = new Map<DerivedMetricNames, DerivedMetric>();

  public static async getStockSymbols(region: Region): Promise<string[]> {
    return Object.keys(await getStockPricesMap(region));
  }

  public static async getAllStockData(region: Region): Promise<
    Array<{
      stockDynamic: StockDynamicInfo;
      baseMetrics: BaseMetric[];
      derivedMetrics: DerivedMetric[];
      stockConfig: StockConfig;
    }>
  > {
    const stocksDynamic = await getStockPricesMap(region);
    const stockNames = Object.keys(stocksDynamic);

    return Promise.all(
      stockNames.map(async (stockSymbol) => {
        const stockDynamic = stocksDynamic[stockSymbol];
        const analyzer = new StockService(
          stockSymbol as StockSymbol,
          region,
          stockDynamic,
        );
        const metrics = analyzer.getMetrics();

        return {
          stockDynamic,
          ...metrics,
        };
      }),
    );
  }

  public static requireRegion(region: unknown): Region {
    if (typeof region !== "string" || !REGIONS.includes(region as Region)) {
      throw new BadRequestError(
        `Invalid or missing region parameter: ${region}`,
      );
    }

    return region as Region;
  }

  public static requireStockSymbol(stockSymbol: unknown): StockSymbol {
    if (typeof stockSymbol !== "string" || !stockSymbol) {
      throw new BadRequestError(`Stock symbol is required.`);
    }

    return stockSymbol as StockSymbol;
  }

  public static async create(
    stock: unknown,
    region: unknown,
  ): Promise<StockService> {
    const validRegion = StockService.requireRegion(region);
    const stockSymbol = StockService.requireStockSymbol(stock);

    const dynamicInfo = await getStockPrice(validRegion, stockSymbol);
    if (!dynamicInfo) {
      throw new BadRequestError(
        `Stock not found in dynamic data: ${stockSymbol}`,
      );
    }

    return new StockService(stockSymbol, validRegion, dynamicInfo);
  }

  private constructor(
    private stockSymbol: StockSymbol,
    region: Region,
    dynamicInfo: StockDynamicInfo,
  ) {
    this.region = region;
    this.dynamicInfo = dynamicInfo;

    // 1. set base metrics
    const { baseMetrics, config } = loadStockCsv(region, this.stockSymbol);
    this.baseMetrics = baseMetrics;
    this.config = config;

    for (const metric of this.baseMetrics) {
      this.baseByName.set(metric.metricName, metric);
    }

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
    this.equityDates = getAvailableDates(this.getBase("Equity"));
    this.priceDates = getAvailableDates(this.getBase("Price"));
  }

  /** Required lookup: throws with a clear message if the base metric isn't present. */
  private getBase(name: BaseMetricNames): BaseMetric {
    const metric = this.baseByName.get(name);
    if (!metric) {
      throw new Error(
        `Base metric "${name}" not found for ${this.stockSymbol}`,
      );
    }
    return metric;
  }

  /** Optional lookup: some calculations tolerate a whole metric being absent (defaulting to 0). */
  private tryGetBase(name: BaseMetricNames): BaseMetric | undefined {
    return this.baseByName.get(name);
  }

  /** Required lookup for a metric this class itself computed earlier in the pipeline. */
  private getDerived(name: DerivedMetricNames): DerivedMetric {
    const metric = this.derivedByName.get(name);
    if (!metric) {
      throw new Error(
        `Derived metric "${name}" not found for ${this.stockSymbol}`,
      );
    }
    return metric;
  }

  /** Records a derived metric so later calculations can look it up by name (e.g. EV/OI depends on Enterprise value). */
  private addDerivedMetric(metric: DerivedMetric) {
    this.derivedMetrics.push(metric);
    this.derivedByName.set(metric.metricName, metric);
  }

  public getMetrics() {
    // 1: create derived metrics
    this.computeSimpleDerivedMetrics();
    this.usdYieldMetric();
    this.observationStartYieldMetric();

    // 2: calculate growth rates
    this.calcGrowths();

    // 3: calculate selected growth median
    this.calcSelectedGrowthMedian();

    return {
      baseMetrics: this.baseMetrics,
      derivedMetrics: this.derivedMetrics,
      stockConfig: this.config,
    };
  }

  private usdYieldMetric() {
    const dividendMetric = this.getBase("Dividend");
    const priceMetric = this.getBase("Price");

    const usdYieldMetric = {
      metricName: "USD Yield",
    } as Partial<DerivedMetric>;

    const { dividendTax } = REGION_CONFIG[this.region];

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
      const usdPriceValue = toUsdValue({ value: priceValue, date });
      const previousUsdPriceValue = toUsdValue({
        value: previousPriceValue,
        date: previousDate,
      });
      const usdPriceYield =
        (usdPriceValue - previousUsdPriceValue) / previousUsdPriceValue;

      usdYieldMetric[date] = round(usdPriceYield + netDividendYield);
    }

    // calculate total growth by multiplying growth rates for each date
    let totalGrowth = 1;
    Object.entries(usdYieldMetric).forEach(([key, value]) => {
      if (key !== "metricName") {
        totalGrowth = totalGrowth * (1 + (value as number));
      }
    });
    totalGrowth = totalGrowth - 1;
    usdYieldMetric["Total growth"] = round(totalGrowth);

    // calculate yearly growth
    const yearlyGrowth = calcYearlyGrowth({
      totalGrowth,
      startDate: this.priceDates[this.priceDates.length - 1],
    });
    usdYieldMetric["Yearly growth"] = round(yearlyGrowth);

    // calculate ttm growth: current date price change is included
    let ttmGrowth = 1;
    const ttmQuarters = STOCK_DATES.slice(
      0,
      STOCK_DATES.indexOf(TTM_START_DATE),
    );
    ttmQuarters.forEach((date) => {
      const dateYield = usdYieldMetric[date] as number;
      ttmGrowth = ttmGrowth * (1 + dateYield);
    });
    ttmGrowth = ttmGrowth - 1;

    usdYieldMetric["TTM growth"] = round(ttmGrowth);

    this.addDerivedMetric(usdYieldMetric as DerivedMetric);
  }

  // Calculates single point-to-point return from the observation start date to today and stores it as the current value.
  private observationStartYieldMetric() {
    const priceMetric = this.getBase("Price");

    const observationStartPrice =
      priceMetric[OBSERVATION_START_DATE_STR as StockDate];

    const metric = {
      metricName: "Observation Start Yield",
    } as Partial<DerivedMetric>;

    // if stock made IPO after observation start date, return cannot be calculated
    if (observationStartPrice == null || observationStartPrice <= 0) {
      this.addDerivedMetric(metric as DerivedMetric);
      return;
    }

    const observationStartUsdPrice = toUsdValue({
      value: observationStartPrice,
      date: OBSERVATION_START_DATE_STR as StockDate,
    });

    const currentPrice = priceMetric[CURRENT_DATE];

    if (!currentPrice) {
      throw new Error(
        `Current price not found while calculating Observation Start Yield for ${this.config.stockSymbol}`,
      );
    }

    const currentUsdPrice = toUsdValue({
      value: currentPrice,
      date: CURRENT_DATE,
    });
    metric[CURRENT_DATE] = round(
      (currentUsdPrice - observationStartUsdPrice) / observationStartUsdPrice,
    );

    this.addDerivedMetric(metric as DerivedMetric);
  }

  private computeSimpleDerivedMetrics() {
    const specs: DerivedMetricSpec[] = [
      {
        name: "USD Price",
        dates: this.priceDates,
        compute: (date) => {
          const priceValue = this.getBase("Price")[date];
          if (priceValue == null) return undefined;
          return toUsdValue({ value: priceValue, date });
        },
      },
      {
        name: "Net debt / operating income",
        dates: this.equityDates,
        compute: (date) => {
          const cash = this.tryGetBase("Cash & cash equivalents")?.[date] ?? 0;
          const shortTermLiabilities =
            this.tryGetBase("Short term liabilities")?.[date] ?? 0;
          const longTermLiabilities =
            this.tryGetBase("Long term liabilities")?.[date] ?? 0;
          const operatingIncome = this.getBase("Operating income")[date];

          if (operatingIncome == null) {
            throw new Error(`Operating income not found for date ${date}`);
          }
          if (operatingIncome <= 0) return "N/A";

          const netDebt = shortTermLiabilities + longTermLiabilities - cash;
          return netDebt / operatingIncome;
        },
      },
      {
        name: "Enterprise value",
        dates: this.priceDates,
        compute: (date) => {
          const price = this.getBase("Price")[date]!;
          const cashValue = this.getBase("Cash & cash equivalents")[date] ?? 0;
          const shortTermLiabilities =
            this.getBase("Short term liabilities")[date] ?? 0;
          const longTermLiabilities =
            this.getBase("Long term liabilities")[date] ?? 0;

          // base metrics are already trimmed by trimDigit. apply same to derived metrics
          const marketValue =
            (price * this.config.outstandingShares) / this.config.trimDigit;
          return (
            marketValue + shortTermLiabilities + longTermLiabilities - cashValue
          );
        },
      },
      {
        name: "EV / operating income",
        dates: this.priceDates,
        compute: (date) => {
          const enterpriseValue = this.getDerived("Enterprise value")[date];
          const operatingIncome = this.getBase("Operating income")[date];

          if (operatingIncome == null) {
            throw new Error(
              `Operating income not found for date ${date} and symbol ${this.config.stockSymbol}`,
            );
          }
          if (enterpriseValue == null) {
            throw new Error(`Enterprise value not found for date ${date}`);
          }
          if (operatingIncome <= 0 || enterpriseValue == "N/A") return "N/A";

          return enterpriseValue / operatingIncome;
        },
      },
      {
        name: "EV / net income",
        dates: this.equityDates,
        compute: (date) => {
          const enterpriseValue = this.getDerived("Enterprise value")?.[date];
          const netIncome = this.getBase("Net income")[date];

          if (netIncome == null) {
            throw new Error(`Net income not found for date ${date}`);
          }
          if (enterpriseValue == null) return undefined;
          if (netIncome <= 0 || enterpriseValue == "N/A") return "N/A";

          return enterpriseValue / netIncome;
        },
      },
      {
        name: "Market value / book value",
        dates: this.equityDates,
        compute: (date) => {
          const price = this.getBase("Price")[date];
          const bookValue = this.getBase("Equity")[date];

          if (bookValue == null) {
            throw new Error(`Book value not found for date ${date}`);
          }
          if (price == null) return undefined;

          return (
            (price * this.config.outstandingShares) /
            this.config.trimDigit /
            bookValue
          );
        },
      },
    ];

    for (const spec of specs) {
      const metric = { metricName: spec.name } as Partial<DerivedMetric>;

      for (const date of spec.dates) {
        const value = spec.compute(date);
        if (value === undefined) continue;
        metric[date] = value === "N/A" ? "N/A" : round(value);
      }

      this.addDerivedMetric(metric as DerivedMetric);
    }
  }

  private calcGrowths() {
    const firstEquityDate = this.equityDates[this.equityDates.length - 1];

    for (const metricName of GROWTH_APPLIED_METRICS) {
      const metric = this.getBase(metricName);

      const firstDateValue = metric[firstEquityDate];
      const lastDateValue = metric[LAST_DATE];

      if (firstDateValue == null || lastDateValue == null) {
        throw new Error(
          `${metricName} firstDateValue: ${firstDateValue}, lastDateValue: ${lastDateValue} not found`,
        );
      }

      if (firstDateValue <= 0 || lastDateValue <= 0) {
        metric["Total growth"] = "N/A";
        metric["Yearly growth"] = "N/A";
      } else {
        const usdFirstDateValue = toUsdValue({
          value: firstDateValue,
          date: firstEquityDate,
        });
        const usdLastDateValue = toUsdValue({
          value: lastDateValue,
          date: LAST_DATE,
        });

        const totalGrowth =
          (usdLastDateValue - usdFirstDateValue) / usdFirstDateValue;
        metric["Total growth"] = round(totalGrowth);
        metric["Yearly growth"] = round(
          calcYearlyGrowth({ totalGrowth, startDate: firstEquityDate }),
        );
      }

      const ttmStartValue = metric[TTM_START_DATE];
      if (ttmStartValue == null || lastDateValue == null) {
        throw new Error(
          `${metricName} ttmStartValue: ${ttmStartValue}, lastDateValue: ${lastDateValue} not found`,
        );
      }

      if (ttmStartValue <= 0 || lastDateValue <= 0) {
        metric["TTM growth"] = "N/A";
      } else {
        const usdTtmStartValue = toUsdValue({
          value: ttmStartValue,
          date: TTM_START_DATE,
        });
        const usdLastDateValue = toUsdValue({
          value: lastDateValue,
          date: LAST_DATE,
        });

        metric["TTM growth"] = round(
          (usdLastDateValue - usdTtmStartValue) / usdTtmStartValue,
        );
      }
    }
  }

  private calcSelectedGrowthMedian() {
    const firstEquityDate = this.equityDates[this.equityDates.length - 1];
    const selectedMetrics = this.config.selectedGrowthMetrics.map((name) => {
      const metric = this.baseByName.get(name as BaseMetricNames);
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
          startDate: firstEquityDate,
        }),
      ),
    } as DerivedMetric;

    this.addDerivedMetric(selectedGrowth);
  }
}
