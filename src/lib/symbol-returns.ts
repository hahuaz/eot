import path from "path";
import {
  parseCSV,
  DAILY_DIR,
  OBSERVATION_START_DATE,
  DAILY_SAVED_SYMBOLS,
  TAXES,
  calcRealRate,
  LAST_DATE,
} from "@/lib";
import { DailyPrice, CumulativeReturn } from "@/types";
import { Inflation } from "@/shared/types";

function ensureCommonDates(
  referenceDates: string[],
  allHistory: DailyPrice[][],
) {
  for (const symbolHistory of allHistory) {
    for (const date of referenceDates) {
      if (!symbolHistory.some((e) => e.date === date)) {
        throw new Error(`Date ${date} not found in all CSV files`);
      }
    }
  }
}

/**
 * This function computes cumulative performance metrics anchored to a specific observation start date. The resulting data series represents the hypothetical sold net profit, effectively simulating a liquidation event on each specific day. Because withholding tax obligations are calculated based on the total realized gain at the moment of sale, the algorithm recalculates the return from the original baseline for every single day to accurately apply the tax and derive the final net value.
 */
export const getCummulativeReturns = (): {
  usdtry: CumulativeReturn[];
  eurtry: CumulativeReturn[];
  mixed: CumulativeReturn[];
  bgp: CumulativeReturn[];
  gold: CumulativeReturn[];
} => {
  // Load all symbol histories dynamically
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

  // take USDTRY dates as reference
  let commonDates = histories.USDTRY.data.map((d) => d.date);
  commonDates = commonDates.filter(
    (d) => new Date(d) >= new Date(OBSERVATION_START_DATE),
  );
  ensureCommonDates(commonDates, [
    histories.EURTRY.data,
    histories.BGP.data,
    histories.GOLD.data,
  ]);

  // calculate cumulative returns from levels
  const cumulativeUsdtry: CumulativeReturn[] = [];
  const cumulativeEurtry: CumulativeReturn[] = [];
  const cumulativeMixed: CumulativeReturn[] = [];
  const cumulativeGrossBGP: CumulativeReturn[] = [];
  const cumulativeGold: CumulativeReturn[] = [];

  for (const date of commonDates) {
    if (date === OBSERVATION_START_DATE) continue;
    const usd = histories.USDTRY.data.find((d) => d.date === date)?.value;
    const eur = histories.EURTRY.data.find((d) => d.date === date)?.value;
    const bgp = histories.BGP.data.find((d) => d.date === date)?.value;
    const gold = histories.GOLD.data.find((d) => d.date === date)?.value;

    if (usd == null || eur == null || bgp == null || gold == null)
      throw new Error(`Missing data for date ${date}`);

    // this is the return multiplier (e.g., 1.05 means a 5% increase)
    const usdFactor = usd / histories.USDTRY.startValue;
    const eurFactor = eur / histories.EURTRY.startValue;
    const bgpFactor = bgp / histories.BGP.startValue;
    const goldFactor = gold / histories.GOLD.startValue;

    // this is the return percentage (e.g., 0.05 means a 5% increase)
    cumulativeUsdtry.push({ date, value: usdFactor - 1 });
    cumulativeEurtry.push({ date, value: eurFactor - 1 });
    cumulativeGold.push({ date, value: goldFactor - 1 });

    // use geometric mean to calculate basket currency increase
    const mixedReturn = Math.sqrt(usdFactor * eurFactor) - 1;
    cumulativeMixed.push({ date, value: mixedReturn });

    cumulativeGrossBGP.push({ date, value: bgpFactor - 1 });
  }

  // calc net returns for some series
  const cumulativeBGP = cumulativeGrossBGP.map((point) => ({
    date: point.date,
    value: point.value * (1 - TAXES.tr.withholdingTax),
  }));

  return {
    usdtry: cumulativeUsdtry,
    eurtry: cumulativeEurtry,
    mixed: cumulativeMixed,
    bgp: cumulativeBGP,
    gold: cumulativeGold,
  };
};

export const getNightlyYield = ({
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

  const netBGPYield = nominalBGPYield * (1 - TAXES.tr.withholdingTax);

  const ttmInflation = inflation?.find((item) => item.date === LAST_DATE)?.yoy;
  if (ttmInflation == null) {
    throw new Error(`Inflation data not found for date ${LAST_DATE}`);
  }
  const ttmNightlyYield = calcRealRate({
    nominalRate: netBGPYield,
    inflationRate: ttmInflation,
  });

  return ttmNightlyYield;
};
