import {
  OBSERVATION_START_DATE,
  getDaysBetween,
  MS_IN_DAY,
  DAYS_IN_YEAR,
  round,
} from "@/lib";
import {
  CumulativeYield,
  YoyYield,
  symbolConfig,
  allSymbols,
  SYMBOL_USDTRY,
} from "@eot/shared";
import { BadRequestError } from "@/lib/errors";
import { getSymbolData } from "@/services/yield/symbol-data-cache";
import {
  getClosestEntry,
  annualizeRatio,
  computeNetYield,
  applyBenchmarkAdjustment,
} from "@/services/yield/yield-math";

const BENCH_SYMBOL = SYMBOL_USDTRY;

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

export async function getCumulativeYields(
  symbol: string,
): Promise<CumulativeYield[]> {
  const config = symbolConfig[symbol];
  const { withholdingTax } = config;

  const symbolData = await getSymbolData(config.symbol);
  const symbolStartIndex = symbolData.priceHistory.findIndex(
    (entry) => entry.date === OBSERVATION_START_DATE,
  );
  const symbolStartEntry = symbolData.priceHistory[symbolStartIndex];

  const benchData = config.isUsdBench
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

      let netYield = computeNetYield(
        currentEntry.value,
        symbolStartEntry.value,
        withholdingTax,
      );

      if (benchData) {
        const benchCurrentValue = benchData.timeToPrice.get(currentEntry.date);
        if (benchCurrentValue == null || benchStartEntry?.value == null) {
          return [];
        }

        netYield = applyBenchmarkAdjustment(
          netYield,
          benchCurrentValue,
          benchStartEntry.value,
        );
      }

      return [{ date: currentEntry.date, value: netYield }];
    });
}

export async function getYoyYields(symbol: string): Promise<YoyYield[]> {
  const config = symbolConfig[symbol];
  const { withholdingTax } = config;

  const symbolData = await getSymbolData(config.symbol);
  const benchData = config.isUsdBench
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

    let netYield = computeNetYield(
      currentEntry.value,
      baseEntry.value,
      withholdingTax,
    );

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

      netYield = applyBenchmarkAdjustment(
        netYield,
        benchCurrentValue,
        benchBaseEntry.value,
      );
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
