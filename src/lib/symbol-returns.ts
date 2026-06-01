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
} from "@/shared/types";
import {
  CUMULATIVE_ALL_SYMBOLS,
  CUMULATIVE_BASE_SYMBOLS,
  CUMULATIVE_COMPOSITE_SYMBOLS,
} from "@/shared/constants";

/**
 * This function computes cumulative performance metrics for a specific symbol anchored to a specific observation start date. The resulting data series represents the hypothetical sold net profit, effectively simulating a liquidation event on each specific day. Because withholding tax obligations are calculated based on the total realized gain at the moment of sale, the algorithm recalculates the return from the original baseline for every single day to accurately apply the tax and derive the final net value.
 * @param symbol - The symbol to calculate cumulative returns for
 */
export const getCummulativeReturns = (symbol: string): CumulativeReturn[] => {
  // Validate symbol
  const normalizedSymbol = symbol.toLowerCase();

  if (!CUMULATIVE_ALL_SYMBOLS.includes(normalizedSymbol)) {
    throw new Error(
      `Invalid symbol: ${symbol}. Valid symbols are: ${[...CUMULATIVE_BASE_SYMBOLS, ...CUMULATIVE_COMPOSITE_SYMBOLS].join(", ")}`,
    );
  }

  const isAtOrAfterObservationStart = (date: string) =>
    new Date(date).getTime() >= new Date(OBSERVATION_START_DATE).getTime();

  const sortByDateAsc = (a: DailyPrice, b: DailyPrice) =>
    new Date(a.date).getTime() - new Date(b.date).getTime();

  const getLastKnownValue = (history: DailyPrice[], date: string) => {
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
    const upperSym = sym.toUpperCase();
    const { data } = parseCSV<DailyPrice>({
      filePath: path.join(DAILY_DIR, `${upperSym}.csv`),
      header: true,
    });

    const startValue = data.find(
      (d) => d.date === OBSERVATION_START_DATE,
    )?.value;
    if (startValue == null) {
      throw new Error(
        `Baseline date ${OBSERVATION_START_DATE} not found for symbol ${upperSym}.`,
      );
    }

    const sortedData = [...data].sort(sortByDateAsc);
    return { data: sortedData, startValue };
  };

  const calculateBaseSymbolReturns = (
    symData: { data: DailyPrice[]; startValue: number },
    isTRSymbol: boolean,
  ): CumulativeReturn[] => {
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
        const netReturn = isTRSymbol
          ? grossReturn * (1 - TAXES.tr.withholdingTax)
          : grossReturn;

        return {
          date,
          value: netReturn,
        };
      });
  };

  // Handle base symbols
  if (CUMULATIVE_BASE_SYMBOLS.includes(normalizedSymbol)) {
    const symData = loadSymbolData(normalizedSymbol);
    const isTRSymbol = ["bgp", "tp2"].includes(normalizedSymbol);
    return calculateBaseSymbolReturns(symData, isTRSymbol);
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
