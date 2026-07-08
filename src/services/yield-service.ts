import {
  getSymbolPriceHistory,
  OBSERVATION_START_DATE,
  round,
  getDaysBetween,
  MS_IN_DAY,
  DAYS_IN_YEAR,
  assertNever,
} from "@/lib";
import { SymbolPrice } from "@/types";
import {
  CumulativeYield,
  YoyYield,
  SymbolConfigValue,
  symbolConfig,
  allSymbols,
} from "@eot/shared";
import { BadRequestError } from "@/lib/errors";

const BENCH_SYMBOL = "USDTRY";

export function requireSymbol(symbol: unknown): string {
  if (typeof symbol !== "string" || !symbol) {
    throw new BadRequestError(`Invalid symbol: ${symbol}`);
  }
  const normalizedSymbol = symbol.toUpperCase();
  if (!allSymbols.includes(normalizedSymbol)) {
    throw new BadRequestError(`Symbol not supported: ${symbol}`);
  }
  return normalizedSymbol;
}

function getReturnConfig(symbol: string): SymbolConfigValue {
  return symbolConfig[requireSymbol(symbol) as keyof typeof symbolConfig];
}

function isBenched(kind: SymbolConfigValue["kind"]): boolean {
  switch (kind) {
    case "base":
      return false;
    case "usdAdjusted":
      return true;
    default:
      return assertNever(kind);
  }
}

type SymbolPriceData = {
  // this is used for ordered access (scanning for the closest entry)
  priceHistory: SymbolPrice[];
  // this is used for O(1) lookup by exact date
  timeToPrice: Map<number, number>;
};

const symbolPriceCache = new Map<string, Promise<SymbolPriceData>>();

function getSymbolData(symbol: string): Promise<SymbolPriceData> {
  const upperSym = symbol.toUpperCase();
  let cached = symbolPriceCache.get(upperSym);

  if (!cached) {
    // Cache the in-flight promise itself (not its resolved value) and don't
    // await it here. This way, concurrent callers for the same symbol all
    // get the same pending promise instead of racing into duplicate queries.
    cached = loadSymbolData(upperSym);
    symbolPriceCache.set(upperSym, cached);
  }
  return cached;
}

async function loadSymbolData(symbol: string): Promise<SymbolPriceData> {
  const priceHistory = await getSymbolPriceHistory(symbol);

  if (priceHistory.length === 0) {
    throw new Error(`Data for symbol ${symbol} is missing or empty.`);
  }

  const startEntry = priceHistory.find(
    (entry) => entry.date === OBSERVATION_START_DATE,
  );
  if (startEntry?.value == null) {
    throw new Error(
      `Baseline date ${OBSERVATION_START_DATE} not found for symbol ${symbol}.`,
    );
  }

  for (let i = 1; i < priceHistory.length; i++) {
    if (priceHistory[i - 1].date >= priceHistory[i].date) {
      throw new Error(
        `Data integrity issue for symbol ${symbol}: duplicate or out-of-order dates detected.`,
      );
    }
  }

  const timeToPrice = new Map(
    priceHistory.map((entry) => [entry.date, entry.value]),
  );
  return { priceHistory, timeToPrice };
}

/**
 * Identifies the closest available historical entry relative to a target date.
 */
function getClosestEntry(data: SymbolPrice[], targetDate: number): SymbolPrice {
  if (data.length === 0) {
    throw new Error("Cannot find closest entry: data set is empty.");
  }

  return data.reduce((closest, entry) =>
    Math.abs(entry.date - targetDate) < Math.abs(closest.date - targetDate)
      ? entry
      : closest,
  );
}

/**
 * Annualizes a return ratio over a given number of days.
 */
export function annualizeRatio(ratio: number, days: number): number {
  if (days <= 0) return 0;
  return Math.pow(ratio, DAYS_IN_YEAR / days) - 1;
}

export async function getCumulativeYields(
  symbol: string,
): Promise<CumulativeYield[]> {
  const config = getReturnConfig(symbol);
  const withholdingTax = "withholdingTax" in config ? config.withholdingTax : 0;

  const symbolData = await getSymbolData(config.symbol);
  const symbolStartIndex = symbolData.priceHistory.findIndex(
    (entry) => entry.date === OBSERVATION_START_DATE,
  );
  const symbolStartEntry = symbolData.priceHistory[symbolStartIndex];

  const benchData = isBenched(config.kind)
    ? await getSymbolData(BENCH_SYMBOL)
    : null;
  const benchStartEntry = benchData
    ? benchData.priceHistory.find(
        (entry) => entry.date === OBSERVATION_START_DATE,
      )
    : null;

  return symbolData.priceHistory
    .slice(symbolStartIndex + 1)
    .flatMap((currentEntry) => {
      if (currentEntry.value == null || symbolStartEntry?.value == null) {
        return [];
      }

      let netYield =
        (currentEntry.value - symbolStartEntry.value) / symbolStartEntry.value;
      netYield = netYield * (1 - withholdingTax);

      if (benchData) {
        const benchCurrentValue = benchData.timeToPrice.get(currentEntry.date);
        if (benchCurrentValue == null || benchStartEntry?.value == null) {
          return [];
        }

        const benchYield =
          (benchCurrentValue - benchStartEntry.value) / benchStartEntry.value;
        netYield = (1 + netYield) / (1 + benchYield) - 1;
      }

      return [{ date: currentEntry.date, value: netYield }];
    });
}

export async function getYoyYields(symbol: string): Promise<YoyYield[]> {
  const config = getReturnConfig(symbol);
  const withholdingTax = "withholdingTax" in config ? config.withholdingTax : 0;

  const symbolData = await getSymbolData(config.symbol);
  const benchData = isBenched(config.kind)
    ? await getSymbolData(BENCH_SYMBOL)
    : null;

  return symbolData.priceHistory.slice(1).flatMap((currentEntry, index) => {
    const targetDate = currentEntry.date - DAYS_IN_YEAR * MS_IN_DAY;
    const baseEntry = getClosestEntry(
      symbolData.priceHistory.slice(0, index + 1),
      targetDate,
    );
    if (currentEntry.value == null || baseEntry.value == null) {
      return [];
    }

    let netYield = (currentEntry.value - baseEntry.value) / baseEntry.value;
    netYield = netYield * (1 - withholdingTax);

    if (benchData) {
      const benchCurrentValue = benchData.timeToPrice.get(currentEntry.date);
      if (benchCurrentValue == null) {
        return [];
      }

      const benchBaseEntry = getClosestEntry(
        benchData.priceHistory,
        targetDate,
      );
      if (benchBaseEntry.value == null) {
        return [];
      }

      const benchYield =
        (benchCurrentValue - benchBaseEntry.value) / benchBaseEntry.value;
      netYield = (1 + netYield) / (1 + benchYield) - 1;
    }

    const daysPassed = getDaysBetween(baseEntry.date, currentEntry.date);
    const yoyYieldPercent =
      daysPassed > 0 ? annualizeRatio(1 + netYield, daysPassed) : 0;

    return [
      {
        date: currentEntry.date,
        baselineDate: baseEntry.date,
        daysPassed,
        yoyReturnPercent: round(yoyYieldPercent),
      },
    ];
  });
}
