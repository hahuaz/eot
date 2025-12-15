import {
  Inflation,
  StockConfig,
  DerivedMetric,
  BaseMetric,
  GrowthRecord,
  Dates,
} from "@shared/types";
import { round } from "@/lib/utils";
import { GROWTH_APPLIED_METRICS } from "@/lib/constants";
import {
  LAST_DATE,
  CURRENT_DATE,
  lastDateObj,
  getYearsPassed,
} from "@/lib/dates";
import { StockContext } from "./data-service";

export const getTaxByRegion = ({
  region,
}: {
  region: string;
}): {
  withholdingTax: number;
  dividendTax: number;
} => {
  switch (region) {
    case "tr":
      return {
        withholdingTax: 0.175,
        dividendTax: 0.15,
      };
    case "us":
      return {
        withholdingTax: 0.24,
        dividendTax: 0.2,
      };
    default:
      throw new Error(`Region ${region} not supported for tax calculation`);
  }
};

export const getLiveTtmNightlyYield = ({
  inflation,
}: {
  inflation: Inflation[];
}): number | null => {
  // TODO: get prices dynamically
  // ttm bgp price on 2024/9/30
  const previousTtmBGPPrice = 2.946158;
  // live TTM BGP price (includes up-to-date price, not just between 2024/9/30 and 2025/9/30)
  const liveTtmBGPPrice = 5.008617;
  const nominalBGPYield =
    (liveTtmBGPPrice - previousTtmBGPPrice) / previousTtmBGPPrice;

  const netBGPYield =
    nominalBGPYield * (1 - getTaxByRegion({ region: "tr" }).withholdingTax);

  const ttmInflation = inflation?.find((item) => item.date === LAST_DATE)?.yoy;
  if (ttmInflation == null) {
    throw new Error(`Inflation data not found for date ${LAST_DATE}`);
  }
  const ttmNightlyYield = (netBGPYield - ttmInflation) / (1 + ttmInflation);

  return ttmNightlyYield;
};

export const adjustForInflation = ({
  stockContext,
}: {
  stockContext: StockContext;
}) => {
  const { baseMetrics, derivedMetrics, inflation, equityAvailableDates } =
    stockContext;

  const equityYearsPassed = getYearsPassed({
    date: equityAvailableDates[equityAvailableDates.length - 1],
  });

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
      for (let i = 0; i < equityAvailableDates.length; i++) {
        const date = equityAvailableDates[i];
        // for current and first available date, don't apply inflation
        if (date === CURRENT_DATE || i === equityAvailableDates.length - 1) {
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
          (1 + accumulatedInflation),
      );

      // yearly growth is derived from total growth
      const yearlyGrowth = metric["Total growth"]
        ? Math.pow(1 + metric["Total growth"], 1 / equityYearsPassed) - 1
        : 0;
      metric["Yearly growth"] = round(yearlyGrowth);
    }

    if (metric["TTM growth"] === undefined) {
      throw new Error(`TTM growth not found for metric ${metricName}`);
    }

    if (metric["TTM growth"] !== "negative" && metric["TTM growth"] != null) {
      metric["TTM growth"] = round(
        (metric["TTM growth"] - inflationData?.yoy) / (1 + inflationData.yoy),
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

  stockContext.stockConfig.growthParams.forEach((growthParamName) => {
    const growthMetric = baseMetrics.find(
      (item) => item.metricName === growthParamName,
    );

    if (growthMetric === undefined) {
      throw new Error(`Growth metric ${growthParamName} not found in metrics`);
    }

    const totalGrowth = growthMetric["Total growth"];
    const ttmGrowth = growthMetric["TTM growth"];

    if (typeof totalGrowth != "number" || typeof ttmGrowth != "number") {
      throw new Error(
        `TODO: Growth metric ${growthParamName} is negative handle it graciously for ${stockContext.stockConfig.stockSymbol}`,
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
    number,
  ][];
  console.log("growthEntries", growthEntries);

  growthEntries.forEach(([key, value]) => {
    const medianValue = value / stockContext.stockConfig.growthParams.length;
    selectedGrowth[key] = round(medianValue);
  });

  // calc yearly growth from total growth
  const selectedTotalGrowth = selectedGrowth["Total growth"] as number;
  const selectedYearlyGrowth = selectedTotalGrowth
    ? Math.pow(1 + selectedTotalGrowth, 1 / equityYearsPassed) - 1
    : 0;
  selectedGrowth["Yearly growth"] = round(selectedYearlyGrowth);

  derivedMetrics.push(selectedGrowth as DerivedMetric);
};
