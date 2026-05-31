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

/**
 * This function computes cumulative performance metrics anchored to a specific observation start date. The resulting data series represents the hypothetical sold net profit, effectively simulating a liquidation event on each specific day. Because withholding tax obligations are calculated based on the total realized gain at the moment of sale, the algorithm recalculates the return from the original baseline for every single day to accurately apply the tax and derive the final net value.
 */
export const getCummulativeReturns = (): CumulativeReturns => {
  // Load all symbol histories
  const histories: Record<
    string,
    {
      data: DailyPrice[];
      startValue: number;
    }
  > = {};
  for (const symbol of DAILY_SAVED_SYMBOLS) {
    const { data } = parseCSV<DailyPrice>({
      filePath: path.join(DAILY_DIR, `${symbol}.csv`),
      header: true,
    });

    const startValue = data.find(
      (d) => d.date === OBSERVATION_START_DATE,
    )?.value;
    if (startValue == null) {
      throw new Error(
        `Baseline date ${OBSERVATION_START_DATE} not found in one of the data sources.`,
      );
    }
    histories[symbol] = { data, startValue };
  }

  const isAtOrAfterObservationStart = (date: string) =>
    new Date(date).getTime() >= new Date(OBSERVATION_START_DATE).getTime();

  const sortByDateAsc = (a: DailyPrice, b: DailyPrice) =>
    new Date(a.date).getTime() - new Date(b.date).getTime();

  for (const symbol of DAILY_SAVED_SYMBOLS) {
    histories[symbol].data.sort(sortByDateAsc);
  }

  const commonDates = histories.USDTRY.data
    .map((entry) => entry.date)
    .filter(isAtOrAfterObservationStart)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

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

  const cumulativeUsdtry: CumulativeReturn[] = commonDates
    .filter((date) => date !== OBSERVATION_START_DATE)
    .map((date) => ({
      date,
      value:
        getLastKnownValue(histories.USDTRY.data, date) /
          histories.USDTRY.startValue -
        1,
    }));

  const cumulativeEurtry: CumulativeReturn[] = commonDates
    .filter((date) => date !== OBSERVATION_START_DATE)
    .map((date) => ({
      date,
      value:
        getLastKnownValue(histories.EURTRY.data, date) /
          histories.EURTRY.startValue -
        1,
    }));

  const cumulativeGold: CumulativeReturn[] = commonDates
    .filter((date) => date !== OBSERVATION_START_DATE)
    .map((date) => ({
      date,
      value:
        getLastKnownValue(histories.GOLD.data, date) /
          histories.GOLD.startValue -
        1,
    }));

  const cumulativeTp2: CumulativeReturn[] = commonDates
    .filter((date) => date !== OBSERVATION_START_DATE)
    .map((date) => ({
      date,
      value:
        getLastKnownValue(histories.TP2.data, date) / histories.TP2.startValue -
        1,
    }));

  const cumulativeGrossBGP: CumulativeReturn[] = commonDates
    .filter((date) => date !== OBSERVATION_START_DATE)
    .map((date) => ({
      date,
      value:
        getLastKnownValue(histories.BGP.data, date) / histories.BGP.startValue -
        1,
    }));

  const cumulativeBGPUsdtry: CumulativeReturn[] = commonDates
    .filter((date) => date !== OBSERVATION_START_DATE)
    .map((date) => {
      const currentBGPValue = getLastKnownValue(histories.BGP.data, date);
      const usdtryFactor = getLastKnownValue(histories.USDTRY.data, date);
      const grossBGPReturn = currentBGPValue / histories.BGP.startValue - 1;
      const netBGPFactor = 1 + grossBGPReturn * (1 - TAXES.tr.withholdingTax);

      return {
        date,
        value: netBGPFactor * (histories.USDTRY.startValue / usdtryFactor) - 1,
      };
    });

  const cumulativeTp2Usdtry: CumulativeReturn[] = commonDates
    .filter((date) => date !== OBSERVATION_START_DATE)
    .map((date) => {
      const currentTp2Value = getLastKnownValue(histories.TP2.data, date);
      const usdtryFactor = getLastKnownValue(histories.USDTRY.data, date);
      const grossTp2Return = currentTp2Value / histories.TP2.startValue - 1;
      const netTp2Factor = 1 + grossTp2Return * (1 - TAXES.tr.withholdingTax);

      return {
        date,
        value: netTp2Factor * (histories.USDTRY.startValue / usdtryFactor) - 1,
      };
    });

  const cumulativeMixed: CumulativeReturn[] = commonDates
    .filter((date) => date !== OBSERVATION_START_DATE)
    .map((date) => {
      const usdFactor =
        getLastKnownValue(histories.USDTRY.data, date) /
        histories.USDTRY.startValue;
      const eurFactor =
        getLastKnownValue(histories.EURTRY.data, date) /
        histories.EURTRY.startValue;
      return {
        date,
        value: Math.sqrt(usdFactor * eurFactor) - 1,
      };
    });

  const netCumulativeBGP = cumulativeGrossBGP.map((point) => ({
    date: point.date,
    value: point.value * (1 - TAXES.tr.withholdingTax),
  }));

  const netCumulativeTp2 = cumulativeTp2.map((point) => ({
    date: point.date,
    value: point.value * (1 - TAXES.tr.withholdingTax),
  }));

  return {
    usdtry: cumulativeUsdtry,
    eurtry: cumulativeEurtry,
    mixedCurrency: cumulativeMixed,
    bgp: netCumulativeBGP,
    gold: cumulativeGold,
    tp2: netCumulativeTp2,
    bgpUsdtry: cumulativeBGPUsdtry,
    tp2Usdtry: cumulativeTp2Usdtry,
  };
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
