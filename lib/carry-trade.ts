import path from "path";
import { parseCSV } from "./index";

// ==== Types ====
interface PricePoint {
  date: string;
  value: number;
}
interface ReturnPoint {
  date: string;
  value: number;
}

// ==== Constants ====
const DATA_DIR = path.join(process.cwd(), "local-data");
const DAILY_DIR = path.join(DATA_DIR, "daily");
const BASELINE_DATE = "2024/12/30"; // buy date / start observation
const TAX_RATE = 0.1;

// ==== IO ====
const readDailyCsv = (filename: string) =>
  parseCSV<PricePoint>({
    filePath: path.join(DAILY_DIR, filename),
    header: true,
  });

// ==== Helpers ====
function ensureCommonDates(
  referenceDates: string[],
  allHistory: PricePoint[][]
) {
  for (const symbolHistory of allHistory) {
    for (const date of referenceDates) {
      if (!symbolHistory.some((e) => e.date === date)) {
        throw new Error(`Date ${date} not found in all CSV files`);
      }
    }
  }
}

export const getCarryTrade = () => {
  // ---- Read inputs ----
  const usdtryHistory = readDailyCsv("USDTRY.csv");
  const eurtryHistory = readDailyCsv("EURTRY.csv");
  const bgpHistory = readDailyCsv("BGP.csv");

  // USDTRY dates as reference
  let commonDates = usdtryHistory.data.map((d) => d.date);
  commonDates = commonDates.filter(
    (d) => new Date(d) >= new Date(BASELINE_DATE)
  );
  ensureCommonDates(commonDates, [eurtryHistory.data, bgpHistory.data]);

  const usd0 = usdtryHistory.data.find((d) => d.date === BASELINE_DATE)?.value!;
  const eur0 = eurtryHistory.data.find((d) => d.date === BASELINE_DATE)?.value!;
  const bgp0 = bgpHistory.data.find((d) => d.date === BASELINE_DATE)?.value!;

  // ---- Direct cumulative returns from levels ----
  const cumulativeUsdtry: ReturnPoint[] = [];
  const cumulativeEurtry: ReturnPoint[] = [];
  const cumulativeMixed: ReturnPoint[] = [];
  const cumulativeGrossBGP: ReturnPoint[] = [];

  for (const date of commonDates) {
    if (date === BASELINE_DATE) continue;
    const usd = usdtryHistory.data.find((d) => d.date === date)?.value;
    const eur = eurtryHistory.data.find((d) => d.date === date)?.value;
    const bgp = bgpHistory.data.find((d) => d.date === date)?.value;

    if (usd == null || eur == null || bgp == null)
      throw new Error(`Missing data for date ${date}`);

    const usdFactor = usd / usd0; // = Π(1+r_usd_i)
    const eurFactor = eur / eur0; // = Π(1+r_eur_i)
    const bgpFactor = bgp / bgp0; // = Π(1+r_bgp_i)

    cumulativeUsdtry.push({ date, value: usdFactor - 1 });
    cumulativeEurtry.push({ date, value: eurFactor - 1 });

    // Geometric mean of cumulative factors equals compounding of per-step geometric means
    const mixedReturn = Math.sqrt(usdFactor * eurFactor) - 1;
    cumulativeMixed.push({ date, value: mixedReturn });

    cumulativeGrossBGP.push({ date, value: bgpFactor - 1 });
  }

  // calc net returns for some series
  const cumulativeBGP = cumulativeGrossBGP.map((point) => ({
    date: point.date,
    value: point.value * (1 - TAX_RATE),
  }));

  return {
    cumulativeUsdtry,
    cumulativeEurtry,
    cumulativeMixed,
    cumulativeBGP,
  };
};
