import path from "path";
import { getTaxByRegion, parseCSV, DAILY_DIR, BASELINE_DATE } from "@/lib";
import { DailyPrice, CumulativeReturn } from "@/types";

// ==== Helpers ====
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

export const getCummulativeReturns = (): {
  cumulativeUsdtry: CumulativeReturn[];
  cumulativeEurtry: CumulativeReturn[];
  cumulativeMixed: CumulativeReturn[];
  cumulativeBGP: CumulativeReturn[];
  cummulativeGold: CumulativeReturn[];
} => {
  const usdtryHistory = parseCSV<DailyPrice>({
    filePath: path.join(DAILY_DIR, "USDTRY.csv"),
    header: true,
  });
  const eurtryHistory = parseCSV<DailyPrice>({
    filePath: path.join(DAILY_DIR, "EURTRY.csv"),
    header: true,
  });
  const bgpHistory = parseCSV<DailyPrice>({
    filePath: path.join(DAILY_DIR, "BGP.csv"),
    header: true,
  });

  const goldHistory = parseCSV<DailyPrice>({
    filePath: path.join(DAILY_DIR, "GOLD.csv"),
    header: true,
  });

  // take USDTRY dates as reference
  let commonDates = usdtryHistory.data.map((d) => d.date);
  commonDates = commonDates.filter(
    (d) => new Date(d) >= new Date(BASELINE_DATE),
  );
  ensureCommonDates(commonDates, [
    eurtryHistory.data,
    bgpHistory.data,
    goldHistory.data,
  ]);

  const usd0Obj = usdtryHistory.data.find((d) => d.date === BASELINE_DATE);
  const eur0Obj = eurtryHistory.data.find((d) => d.date === BASELINE_DATE);
  const bgp0Obj = bgpHistory.data.find((d) => d.date === BASELINE_DATE);
  const gold0Obj = goldHistory.data.find((d) => d.date === BASELINE_DATE);

  if (!usd0Obj || !eur0Obj || !bgp0Obj || !gold0Obj) {
    throw new Error(
      `Baseline date ${BASELINE_DATE} not found in one of the data sources.`,
    );
  }

  const usd0 = usd0Obj.value;
  const eur0 = eur0Obj.value;
  const bgp0 = bgp0Obj.value;
  const gold0 = gold0Obj.value;

  // calculate cumulative returns from levels
  const cumulativeUsdtry: CumulativeReturn[] = [];
  const cumulativeEurtry: CumulativeReturn[] = [];
  const cumulativeMixed: CumulativeReturn[] = [];
  const cumulativeGrossBGP: CumulativeReturn[] = [];
  const cumulativeGold: CumulativeReturn[] = [];

  for (const date of commonDates) {
    if (date === BASELINE_DATE) continue;
    const usd = usdtryHistory.data.find((d) => d.date === date)?.value;
    const eur = eurtryHistory.data.find((d) => d.date === date)?.value;
    const bgp = bgpHistory.data.find((d) => d.date === date)?.value;
    const gold = goldHistory.data.find((d) => d.date === date)?.value;

    if (usd == null || eur == null || bgp == null || gold == null)
      throw new Error(`Missing data for date ${date}`);

    // this is the return multiplier (e.g., 1.05 means a 5% increase)
    const usdFactor = usd / usd0;
    const eurFactor = eur / eur0;
    const bgpFactor = bgp / bgp0;
    const goldFactor = gold / gold0;

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
    value: point.value * (1 - getTaxByRegion({ region: "tr" }).withholdingTax),
  }));

  return {
    cumulativeUsdtry,
    cumulativeEurtry,
    cumulativeMixed,
    cumulativeBGP,
    cummulativeGold: cumulativeGold,
  };
};
