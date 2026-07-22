import {
  OBSERVATION_START_DATE,
  getDaysBetween,
  MS_IN_DAY,
  DAYS_IN_YEAR,
  calcYearlyGrowth,
  round,
} from "@/lib";
import { CumulativeYield, YoyYield, YieldSymbolData } from "@eot/shared";
import { getYieldSymbols } from "@/db/symbols.repository";
import { getSymbolData } from "@/services/yield/symbol-data-cache";
import {
  getClosestEntry,
  computeNetYield,
  applyBenchmarkAdjustment,
} from "@/services/yield/yield-math";

// Fixed benchmark every genUsdBench composite is adjusted against - just the
// name of the FX rate used for the adjustment, not itself per-symbol config.
const BENCH_SYMBOL = "USDTRY";

type DerivedYieldSymbol = {
  key: string; // requestable name, e.g. "TP2" or the composite "TP2_USDTRY"
  symbol: string; // underlying symbol_prices key price data is read from
  withholdingTax: number;
  isUsdBench: boolean;
};

/**
 * Derives all yield calculated symbols. base symbols + usd benched.
 */
async function deriveYieldSymbols(): Promise<DerivedYieldSymbol[]> {
  const yieldSymbols = await getYieldSymbols();

  return yieldSymbols.flatMap(({ symbol, withholdingTax, genUsdBench }) => {
    const base: DerivedYieldSymbol = {
      key: symbol,
      symbol,
      withholdingTax,
      isUsdBench: false,
    };
    if (!genUsdBench) return [base];

    const usdBenched: DerivedYieldSymbol = {
      key: `${symbol}_${BENCH_SYMBOL}`,
      symbol,
      withholdingTax,
      isUsdBench: true,
    };
    return [base, usdBenched];
  });
}

async function computeCumulativeYields(
  config: DerivedYieldSymbol,
): Promise<CumulativeYield[]> {
  const { symbol, withholdingTax, isUsdBench } = config;

  const symbolData = await getSymbolData(symbol);
  const symbolStartIndex = symbolData.priceHistory.findIndex(
    (entry) => entry.date === OBSERVATION_START_DATE,
  );
  const symbolStartEntry = symbolData.priceHistory[symbolStartIndex];

  const benchData = isUsdBench ? await getSymbolData(BENCH_SYMBOL) : null;
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

async function computeYoyYields(
  config: DerivedYieldSymbol,
): Promise<YoyYield[]> {
  const { symbol, withholdingTax, isUsdBench } = config;

  const symbolData = await getSymbolData(symbol);
  const benchData = isUsdBench ? await getSymbolData(BENCH_SYMBOL) : null;

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
    const yoyYieldPercent = calcYearlyGrowth({
      totalGrowth: netYield,
      startDate: baseEntry.date,
      endDate: currentEntry.date,
    });

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

/**
 * Cumulative + YoY yields for every yield-included symbol (base symbols
 * plus their generated USD-adjusted composites) - computed server-side so
 * callers (the frontend) don't need to know the symbol list up front.
 */
export async function getAllYieldData(): Promise<YieldSymbolData[]> {
  const allSymbols = await deriveYieldSymbols();

  return Promise.all(
    allSymbols.map(async (config): Promise<YieldSymbolData> => {
      const [cumulativeYields, yoyYields] = await Promise.all([
        computeCumulativeYields(config),
        computeYoyYields(config),
      ]);
      return { symbol: config.key, cumulativeYields, yoyYields };
    }),
  );
}
