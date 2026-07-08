import {
  getSymbolPriceHistory,
  OBSERVATION_START_DATE,
  round,
  getDaysBetween,
  MS_IN_DAY,
  DAYS_IN_YEAR,
} from "@/lib";
import { DailyPrice } from "@/types";
import { CumulativeYield, YoyYield } from "@/shared/types";
import { returnSymbolConfig, cumulativeSymbolsAll } from "@/shared/constants";
import { BadRequestError } from "@/lib/errors";

const USDTRY_SYMBOL = "USDTRY";

/**
 * Calculates yield series for a financial symbol.
 *
 * This is a stateless utility class with static methods. It uses a static
 * cache to store historical price data fetched from Postgres.
 */
export class YieldService {
  private static readonly symbolToPrices = new Map<
    string,
    {
      priceHistory: DailyPrice[];
      timeToPrice: Map<number, number>;
    }
  >();

  private constructor() {}

  public static requireSymbol(symbol: unknown): string {
    if (typeof symbol !== "string" || !symbol) {
      throw new BadRequestError(`Invalid symbol: ${symbol}`);
    }
    const normalizedSymbol = symbol.toUpperCase();
    if (!cumulativeSymbolsAll.includes(normalizedSymbol)) {
      throw new BadRequestError(`Symbol not supported: ${symbol}`);
    }
    return normalizedSymbol;
  }

  /**
   * Annualizes a return ratio over a given number of days.
   */
  public static annualizeRatio(ratio: number, days: number): number {
    if (days <= 0) return 0;
    return Math.pow(ratio, DAYS_IN_YEAR / days) - 1;
  }

  public static async getCumulativeYields(
    symbol: string,
  ): Promise<CumulativeYield[]> {
    const config =
      returnSymbolConfig[
        YieldService.requireSymbol(symbol) as keyof typeof returnSymbolConfig
      ];
    const withholdingTax =
      "withholdingTax" in config ? config.withholdingTax : 0;
    const symbolData = await YieldService.getPriceHistory(config.symbol);
    const startIndex = symbolData.findIndex(
      (entry) => entry.date === OBSERVATION_START_DATE,
    );
    const startEntry = symbolData[startIndex];

    if (config.kind === "base" || config.kind === "usdAdjusted") {
      let usdtryTimeToPrice: Map<number, number> | undefined;
      let usdtryStartEntry: DailyPrice | undefined;

      if (config.kind === "usdAdjusted") {
        usdtryTimeToPrice = await YieldService.getTimeToPriceMap(USDTRY_SYMBOL);
        const usdtryData = await YieldService.getPriceHistory(USDTRY_SYMBOL);
        usdtryStartEntry = usdtryData.find(
          (entry) => entry.date === OBSERVATION_START_DATE,
        );
      }

      return symbolData.slice(startIndex + 1).flatMap((currentEntry) => {
        if (currentEntry.value == null || startEntry?.value == null) {
          return [];
        }

        let yieldValue =
          (currentEntry.value / startEntry.value - 1) * (1 - withholdingTax);

        if (config.kind === "usdAdjusted") {
          const usdtryCurrentValue = usdtryTimeToPrice!.get(currentEntry.date);

          if (usdtryCurrentValue == null || usdtryStartEntry?.value == null) {
            return [];
          }

          const usdtryYield =
            (usdtryCurrentValue - usdtryStartEntry.value) /
            usdtryStartEntry.value;

          yieldValue = (1 + yieldValue) / (1 + usdtryYield) - 1;
        }

        return [
          {
            date: currentEntry.date,
            value: yieldValue,
          },
        ];
      });
    }

    throw new Error(`Unhandled symbol kind: ${(config as any).kind}`);
  }

  public static async getYoyYields(symbol: string): Promise<YoyYield[]> {
    const config =
      returnSymbolConfig[
        YieldService.requireSymbol(symbol) as keyof typeof returnSymbolConfig
      ];
    const withholdingTax =
      "withholdingTax" in config ? config.withholdingTax : 0;
    const symbolData = await YieldService.getPriceHistory(config.symbol);

    if (config.kind === "base" || config.kind === "usdAdjusted") {
      let usdtryData: DailyPrice[] | undefined;
      let usdtryTimeToPrice: Map<number, number> | undefined;

      if (config.kind === "usdAdjusted") {
        usdtryData = await YieldService.getPriceHistory(USDTRY_SYMBOL);
        usdtryTimeToPrice = await YieldService.getTimeToPriceMap(USDTRY_SYMBOL);
      }

      return symbolData.slice(1).flatMap((currentEntry, index) => {
        const targetDate = currentEntry.date - DAYS_IN_YEAR * MS_IN_DAY;
        const baselineEntry = YieldService.getClosestEntry(
          symbolData.slice(0, index + 1),
          targetDate,
        );
        if (currentEntry.value == null || baselineEntry.value == null) {
          return [];
        }

        const grossYield =
          (currentEntry.value - baselineEntry.value) / baselineEntry.value;
        let netYield = grossYield * (1 - withholdingTax);

        if (config.kind === "usdAdjusted") {
          const usdtryCurrentValue = usdtryTimeToPrice!.get(currentEntry.date);
          if (usdtryCurrentValue == null) {
            return [];
          }

          const usdtryBaselineEntry = YieldService.getClosestEntry(
            usdtryData!,
            targetDate,
          );
          if (usdtryBaselineEntry.value == null) {
            return [];
          }

          const usdtryYield =
            (usdtryCurrentValue - usdtryBaselineEntry.value) /
            usdtryBaselineEntry.value;

          netYield = (1 + netYield) / (1 + usdtryYield) - 1;
        }

        const daysPassed = getDaysBetween(
          baselineEntry.date,
          currentEntry.date,
        );
        const yoyYieldPercent =
          daysPassed > 0
            ? YieldService.annualizeRatio(1 + netYield, daysPassed)
            : 0;

        return [
          {
            date: currentEntry.date,
            baselineDate: baselineEntry.date,
            daysPassed,
            yoyReturnPercent: round(yoyYieldPercent),
          },
        ];
      });
    }

    throw new Error(`Unhandled symbol kind: ${(config as any).kind}`);
  }

  /**
   * Retrieves the whole dataset for a symbol, fetching from Postgres on first
   * access and caching the result in memory for subsequent calls.
   */
  private static async getSymbolData(symbol: string): Promise<{
    priceHistory: DailyPrice[];
    timeToPrice: Map<number, number>;
  }> {
    const upperSym = symbol.toUpperCase();
    let symbolData = YieldService.symbolToPrices.get(upperSym);

    if (!symbolData) {
      // symbol_prices is stored ascending by date already (see getSymbolPriceHistory)
      const priceHistory = await getSymbolPriceHistory(upperSym);

      if (!priceHistory || priceHistory.length === 0) {
        throw new Error(`Data for symbol ${symbol} is missing or empty.`);
      }

      const startEntry = priceHistory.find(
        (d) => d.date === OBSERVATION_START_DATE,
      );
      if (!startEntry || startEntry.value == null) {
        throw new Error(
          `Baseline date ${OBSERVATION_START_DATE} not found for symbol ${symbol}.`,
        );
      }

      // Validate chronological integrity
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

      symbolData = { priceHistory, timeToPrice };
      YieldService.symbolToPrices.set(upperSym, symbolData);
    }
    return symbolData;
  }

  /**
   * Retrieves price history for a symbol.
   */
  private static async getPriceHistory(symbol: string): Promise<DailyPrice[]> {
    return (await YieldService.getSymbolData(symbol)).priceHistory;
  }

  /**
   * Retrieves the time-to-price map for a symbol.
   */
  private static async getTimeToPriceMap(
    symbol: string,
  ): Promise<Map<number, number>> {
    return (await YieldService.getSymbolData(symbol)).timeToPrice;
  }

  /**
   * Identifies the closest available historical entry relative to a target date.
   */
  private static getClosestEntry(
    data: DailyPrice[],
    targetDate: number,
  ): DailyPrice {
    if (data.length === 0) {
      throw new Error("Cannot find closest entry: data set is empty.");
    }

    let closestEntry = data[0];
    let minDiff = Math.abs(closestEntry.date - targetDate);

    for (let i = 1; i < data.length; i++) {
      const diff = Math.abs(data[i].date - targetDate);
      if (diff < minDiff) {
        minDiff = diff;
        closestEntry = data[i];
      }
    }

    return closestEntry;
  }
}
