import path from "path";
import {
  parseCSV,
  DAILY_DIR,
  OBSERVATION_START_DATE,
  DAILY_SAVED_SYMBOLS,
  TAXES,
  calcRealRate,
  LAST_DATE,
  round,
} from "@/lib";
import { DailyPrice } from "@/types";
import {
  CumulativeReturn,
  CumulativeReturns,
  DATES,
  Inflation,
  YoyReturn,
} from "@/shared/types";
import {
  cumulativeSymbolsAll,
  cumulativeSymbolsBase,
  cumulativeSymbolsComposite,
  SYMBOL_TAX_CONFIG,
} from "@/shared/constants";

export function isValidSymbol(symbol: any): boolean {
  if (!symbol || typeof symbol !== "string") {
    console.error(`Symbol must be a string.`);
    return false;
  }
  const normalizedSymbol = symbol.toLowerCase();
  if (!cumulativeSymbolsAll.includes(normalizedSymbol)) {
    console.error(`Invalid symbol.`);
    return false;
  }
  return true;
}

function getSymbolData(symbol: string): DailyPrice[] {
  const upperSym = symbol.toUpperCase();
  const { data } = parseCSV<DailyPrice>({
    filePath: path.join(DAILY_DIR, `${upperSym}.csv`),
    header: true,
  });

  if (!data || data.length === 0) {
    throw new Error(`Data for symbol ${symbol} not found or empty.`);
  }

  // symbol data stored as date descending, reverse the data to make it ascending without sorting
  const dataAsc = [];
  for (let i = data.length - 1; i >= 0; i--) {
    dataAsc.push(data[i]);
  }

  // check corruption if previous date is less than next date
  for (let i = 1; i < dataAsc.length; i++) {
    const prevDate = new Date(dataAsc[i - 1].date).getTime();
    const nextDate = new Date(dataAsc[i].date).getTime();
    if (prevDate >= nextDate) {
      throw new Error(
        `Data for symbol ${symbol} is corrupted. Date order is incorrect.`,
      );
    }
  }

  return dataAsc;
}

/**
 * This function computes cumulative performance metrics for a specific symbol anchored to a specific observation start date. The resulting data series represents the hypothetical sold net profit, effectively simulating a liquidation event on each specific day. Because withholding tax obligations are calculated based on the total realized gain at the moment of sale, the algorithm recalculates the return from the original baseline for every single day to accurately apply the tax and derive the final net value.
 * @param symbol - The symbol to calculate cumulative returns for
 */
export const getCummulativeReturns = (symbol: string): CumulativeReturn[] => {
  const normalizedSymbol = symbol.toLowerCase();
  const isAtOrAfterObservationStart = (date: number) =>
    new Date(date).getTime() >= new Date(OBSERVATION_START_DATE).getTime();

  const getLastKnownValue = (history: DailyPrice[], date: number) => {
    let lastValue: number | null = null;
    const targetTime = new Date(date).getTime();
    for (const entry of history) {
      const entryTime = new Date(entry.date).getTime();
      if (entryTime > targetTime) break;
      if (entry.value != null) {
        lastValue = entry.value;
      }
    }
    if (lastValue == null) {
      throw new Error(`Missing historical price for date ${date}`);
    }
    return lastValue;
  };

  const loadSymbolData = (sym: string) => {
    const data = getSymbolData(sym);

    const startValue = data.find(
      (d) => d.date === OBSERVATION_START_DATE,
    )?.value;
    if (startValue == null) {
      throw new Error(
        `Baseline date ${OBSERVATION_START_DATE} not found for symbol ${sym}.`,
      );
    }

    return { data, startValue };
  };

  const calculateBaseSymbolReturns = (symData: {
    data: DailyPrice[];
    startValue: number;
  }): CumulativeReturn[] => {
    const commonDates = symData.data
      .map((entry) => entry.date)
      .filter(isAtOrAfterObservationStart)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    return commonDates
      .filter((date) => date !== OBSERVATION_START_DATE)
      .map((date) => {
        const currentValue = getLastKnownValue(symData.data, date);
        const grossReturn = currentValue / symData.startValue - 1;

        // Apply withholding tax for TR-based symbols
        const withholdingTax =
          SYMBOL_TAX_CONFIG[normalizedSymbol]?.withholdingTax || 0;
        const netReturn = grossReturn * (1 - withholdingTax);

        return {
          date,
          value: netReturn,
        };
      });
  };

  // Handle base symbols
  if (cumulativeSymbolsBase.includes(normalizedSymbol)) {
    const symData = loadSymbolData(normalizedSymbol);
    return calculateBaseSymbolReturns(symData);
  }

  console.log(`Calculating returns for composite symbol: ${normalizedSymbol}`);
  // Handle composite symbols
  if (normalizedSymbol === "mixedcurrency") {
    const usdData = loadSymbolData("USDTRY");
    const eurData = loadSymbolData("EURTRY");

    const commonDates = [
      ...new Set([
        ...usdData.data.map((d) => d.date),
        ...eurData.data.map((d) => d.date),
      ]),
    ]
      .filter(isAtOrAfterObservationStart)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    return commonDates
      .filter((date) => date !== OBSERVATION_START_DATE)
      .map((date) => {
        const usdValue = getLastKnownValue(usdData.data, date);
        const eurValue = getLastKnownValue(eurData.data, date);

        const usdReturn = usdValue / usdData.startValue - 1;
        const eurReturn = eurValue / eurData.startValue - 1;

        return {
          date,
          value: Math.sqrt((1 + usdReturn) * (1 + eurReturn)) - 1,
        };
      });
  }

  if (normalizedSymbol === "bgpusdtry") {
    const bgpData = loadSymbolData("BGP");
    const usdData = loadSymbolData("USDTRY");

    const commonDates = [
      ...new Set([
        ...bgpData.data.map((d) => d.date),
        ...usdData.data.map((d) => d.date),
      ]),
    ]
      .filter(isAtOrAfterObservationStart)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    return commonDates
      .filter((date) => date !== OBSERVATION_START_DATE)
      .map((date) => {
        const bgpValue = getLastKnownValue(bgpData.data, date);
        const usdValue = getLastKnownValue(usdData.data, date);

        const bgpGrossReturn = bgpValue / bgpData.startValue - 1;
        const bgpNetReturn = bgpGrossReturn * (1 - TAXES.tr.withholdingTax);

        const usdReturn = usdValue / usdData.startValue - 1;

        return {
          date,
          value: (1 + bgpNetReturn) / (1 + usdReturn) - 1,
        };
      });
  }

  if (normalizedSymbol === "tp2usdtry") {
    const tp2Data = loadSymbolData("TP2");
    const usdData = loadSymbolData("USDTRY");

    const commonDates = [
      ...new Set([
        ...tp2Data.data.map((d) => d.date),
        ...usdData.data.map((d) => d.date),
      ]),
    ]
      .filter(isAtOrAfterObservationStart)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    return commonDates
      .filter((date) => date !== OBSERVATION_START_DATE)
      .map((date) => {
        const tp2Value = getLastKnownValue(tp2Data.data, date);
        const usdValue = getLastKnownValue(usdData.data, date);

        const tp2GrossReturn = tp2Value / tp2Data.startValue - 1;
        const tp2NetReturn = tp2GrossReturn * (1 - TAXES.tr.withholdingTax);

        const usdReturn = usdValue / usdData.startValue - 1;

        return {
          date,
          value: (1 + tp2NetReturn) / (1 + usdReturn) - 1,
        };
      });
  }

  throw new Error(`Unhandled symbol: ${normalizedSymbol}`);
};

/**
 * Turkey started appreciating its currency around 2025. Calc nightly yield of Turkish lira.
 */
export const getNightlyRealRate = ({
  inflation,
}: {
  inflation: Inflation[];
}): number | null => {
  const { data: bgpData } = parseCSV<DailyPrice>({
    filePath: path.join(DAILY_DIR, `BGP.csv`),
    header: true,
  });

  if (!bgpData || bgpData.length === 0) {
    throw new Error("BGP data not found or empty");
  }

  // ttm bgp price on 2024/12/30
  const previousTtmBGPPrice = 3.329272;
  const liveTtmBGPPrice = bgpData[0].value;
  const nominalBGPYield =
    (liveTtmBGPPrice - previousTtmBGPPrice) / previousTtmBGPPrice;

  const netBGPYield = nominalBGPYield * (1 - TAXES.tr.withholdingTax);

  // calc inflation qoq since 2024/12/30
  const ttmInflationData = inflation.filter(
    (item) =>
      new Date(item.date) > new Date("2024/12/30") &&
      new Date(item.date) <= new Date(LAST_DATE),
  );

  if (ttmInflationData.length === 0) {
    throw new Error("No inflation data found for the TTM period");
  }

  const ttmInflation =
    ttmInflationData.reduce((acc, item) => {
      return acc * (1 + item.qoq);
    }, 1) - 1;

  const ttmNightlyYield = calcRealRate({
    nominalRate: netBGPYield,
    inflationRate: ttmInflation,
  });

  return round(ttmNightlyYield);
};

/**
 * Calculates year-over-year (YoY) annualized returns for a specific symbol.
 * For each date, finds the closest data point 1 year prior (or uses the oldest if 1 year unavailable)
 * and calculates the annualized return based on actual days passed.
 * @param symbol - The symbol to calculate YoY returns for
 */
export const getYoyReturns = (symbol: string): YoyReturn[] => {
  const normalizedSymbol = symbol.toLowerCase();

  const MS_IN_DAY = 24 * 60 * 60 * 1000;
  const DAYS_IN_YEAR = 365;

  /**
   * Finds the index of the data point closest to 1 year (365 days) prior to the current index.
   * If 1 year of history is not available, it returns 0 (the oldest available point).
   */
  const getYoYBaselineIndex = (
    dataPoints: DailyPrice[],
    currentIndex: number,
  ): number => {
    const currentPoint = dataPoints[currentIndex];
    const targetTime =
      new Date(currentPoint.date).getTime() - DAYS_IN_YEAR * MS_IN_DAY;

    if (new Date(dataPoints[0].date).getTime() >= targetTime) {
      return 0;
    }

    let bestIndex = 0;
    let minDiff = Infinity;

    for (let j = 0; j < currentIndex; j++) {
      const diff = Math.abs(
        new Date(dataPoints[j].date).getTime() - targetTime,
      );
      if (diff < minDiff) {
        minDiff = diff;
        bestIndex = j;
      }
    }

    return bestIndex;
  };

  const loadSymbolData = (sym: string) => {
    const upperSym = sym.toUpperCase();
    const { data } = parseCSV<DailyPrice>({
      filePath: path.join(DAILY_DIR, `${upperSym}.csv`),
      header: true,
    });

    const sortedData = [...data].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    return sortedData;
  };

  const calculateBaseSymbolYoyReturns = (
    symData: DailyPrice[],
  ): YoyReturn[] => {
    const results: YoyReturn[] = [];

    for (let i = 1; i < symData.length; i++) {
      const curr = symData[i];
      const baselineIndex = getYoYBaselineIndex(symData, i);
      const baseline = symData[baselineIndex];

      const currDate = new Date(curr.date).getTime();
      const baselineDate = new Date(baseline.date).getTime();
      const yoyDaysPassed = Math.round((currDate - baselineDate) / MS_IN_DAY);

      let yoyReturnPercent = 0;
      if (yoyDaysPassed > 0 && curr.value != null && baseline.value != null) {
        const valueRatio = curr.value / baseline.value;
        // Annualize the return to 365 days
        yoyReturnPercent =
          Math.pow(valueRatio, DAYS_IN_YEAR / yoyDaysPassed) - 1;
      }

      results.push({
        date: new Date(curr.date).getTime(),
        baselineDate: new Date(baseline.date).getTime(),
        daysPassed: yoyDaysPassed,
        yoyReturnPercent: round(yoyReturnPercent),
      });
    }

    return results;
  };

  // Handle base symbols
  if (cumulativeSymbolsBase.includes(normalizedSymbol)) {
    const symData = loadSymbolData(normalizedSymbol);
    return calculateBaseSymbolYoyReturns(symData);
  }

  // Handle composite symbols
  if (normalizedSymbol === "mixedcurrency") {
    const usdData = loadSymbolData("USDTRY");
    const eurData = loadSymbolData("EURTRY");

    const allDates = [
      ...new Set([
        ...usdData.map((d) => d.date),
        ...eurData.map((d) => d.date),
      ]),
    ].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const results: YoyReturn[] = [];

    for (let i = 1; i < allDates.length; i++) {
      const currDate = allDates[i];
      const targetTime =
        new Date(currDate).getTime() - DAYS_IN_YEAR * MS_IN_DAY;

      // Find closest baseline dates for both symbols
      const getBaselineDate = (data: DailyPrice[]) => {
        if (new Date(data[0].date).getTime() >= targetTime) {
          return data[0];
        }
        let best = data[0];
        let minDiff = Infinity;
        for (const point of data) {
          const diff = Math.abs(new Date(point.date).getTime() - targetTime);
          if (diff < minDiff) {
            minDiff = diff;
            best = point;
          }
        }
        return best;
      };

      const usdBaseline = getBaselineDate(usdData);
      const eurBaseline = getBaselineDate(eurData);

      const usdCurrent = usdData.find((d) => d.date === currDate);
      const eurCurrent = eurData.find((d) => d.date === currDate);

      if (usdCurrent && eurCurrent && usdCurrent.value && eurCurrent.value) {
        const currUsdDate = new Date(currDate).getTime();
        const baselineUsdDate = new Date(usdBaseline.date).getTime();
        const yoyDaysPassed = Math.round(
          (currUsdDate - baselineUsdDate) / MS_IN_DAY,
        );

        if (yoyDaysPassed > 0 && usdBaseline.value && eurBaseline.value) {
          const usdRatio = usdCurrent.value / usdBaseline.value;
          const eurRatio = eurCurrent.value / eurBaseline.value;
          const compositeRatio = Math.sqrt(usdRatio * eurRatio);

          const yoyReturnPercent =
            Math.pow(compositeRatio, DAYS_IN_YEAR / yoyDaysPassed) - 1;

          results.push({
            date: new Date(currDate).getTime(),
            baselineDate: new Date(usdBaseline.date).getTime(),
            daysPassed: yoyDaysPassed,
            yoyReturnPercent: round(yoyReturnPercent),
          });
        }
      }
    }

    return results;
  }

  if (normalizedSymbol === "bgpusdtry") {
    const bgpData = loadSymbolData("BGP");
    const usdData = loadSymbolData("USDTRY");

    const allDates = [
      ...new Set([
        ...bgpData.map((d) => d.date),
        ...usdData.map((d) => d.date),
      ]),
    ].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const results: YoyReturn[] = [];

    for (let i = 1; i < allDates.length; i++) {
      const currDate = allDates[i];
      const targetTime =
        new Date(currDate).getTime() - DAYS_IN_YEAR * MS_IN_DAY;

      const getBaselineDate = (data: DailyPrice[]) => {
        if (new Date(data[0].date).getTime() >= targetTime) {
          return data[0];
        }
        let best = data[0];
        let minDiff = Infinity;
        for (const point of data) {
          const diff = Math.abs(new Date(point.date).getTime() - targetTime);
          if (diff < minDiff) {
            minDiff = diff;
            best = point;
          }
        }
        return best;
      };

      const bgpBaseline = getBaselineDate(bgpData);
      const usdBaseline = getBaselineDate(usdData);

      const bgpCurrent = bgpData.find((d) => d.date === currDate);
      const usdCurrent = usdData.find((d) => d.date === currDate);

      if (bgpCurrent && usdCurrent && bgpCurrent.value && usdCurrent.value) {
        const currDate_ms = new Date(currDate).getTime();
        const baselineDate_ms = new Date(bgpBaseline.date).getTime();
        const yoyDaysPassed = Math.round(
          (currDate_ms - baselineDate_ms) / MS_IN_DAY,
        );

        if (yoyDaysPassed > 0 && bgpBaseline.value && usdBaseline.value) {
          const bgpRatio = bgpCurrent.value / bgpBaseline.value;
          const usdRatio = usdCurrent.value / usdBaseline.value;
          const compositeRatio = bgpRatio / usdRatio;

          const yoyReturnPercent =
            Math.pow(compositeRatio, DAYS_IN_YEAR / yoyDaysPassed) - 1;

          results.push({
            date: new Date(currDate).getTime(),
            baselineDate: new Date(bgpBaseline.date).getTime(),
            daysPassed: yoyDaysPassed,
            yoyReturnPercent: round(yoyReturnPercent),
          });
        }
      }
    }

    return results;
  }

  if (normalizedSymbol === "tp2usdtry") {
    const tp2Data = loadSymbolData("TP2");
    const usdData = loadSymbolData("USDTRY");

    const allDates = [
      ...new Set([
        ...tp2Data.map((d) => d.date),
        ...usdData.map((d) => d.date),
      ]),
    ].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const results: YoyReturn[] = [];

    for (let i = 1; i < allDates.length; i++) {
      const currDate = allDates[i];
      const targetTime =
        new Date(currDate).getTime() - DAYS_IN_YEAR * MS_IN_DAY;

      const getBaselineDate = (data: DailyPrice[]) => {
        if (new Date(data[0].date).getTime() >= targetTime) {
          return data[0];
        }
        let best = data[0];
        let minDiff = Infinity;
        for (const point of data) {
          const diff = Math.abs(new Date(point.date).getTime() - targetTime);
          if (diff < minDiff) {
            minDiff = diff;
            best = point;
          }
        }
        return best;
      };

      const tp2Baseline = getBaselineDate(tp2Data);
      const usdBaseline = getBaselineDate(usdData);

      const tp2Current = tp2Data.find((d) => d.date === currDate);
      const usdCurrent = usdData.find((d) => d.date === currDate);

      if (tp2Current && usdCurrent && tp2Current.value && usdCurrent.value) {
        const currDate_ms = new Date(currDate).getTime();
        const baselineDate_ms = new Date(tp2Baseline.date).getTime();
        const yoyDaysPassed = Math.round(
          (currDate_ms - baselineDate_ms) / MS_IN_DAY,
        );

        if (yoyDaysPassed > 0 && tp2Baseline.value && usdBaseline.value) {
          const tp2Ratio = tp2Current.value / tp2Baseline.value;
          const usdRatio = usdCurrent.value / usdBaseline.value;
          const compositeRatio = tp2Ratio / usdRatio;

          const yoyReturnPercent =
            Math.pow(compositeRatio, DAYS_IN_YEAR / yoyDaysPassed) - 1;

          results.push({
            date: new Date(currDate).getTime(),
            baselineDate: new Date(tp2Baseline.date).getTime(),
            daysPassed: yoyDaysPassed,
            yoyReturnPercent: round(yoyReturnPercent),
          });
        }
      }
    }

    return results;
  }

  throw new Error(`Unhandled symbol: ${normalizedSymbol}`);
};
