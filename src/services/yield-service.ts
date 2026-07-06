import path from "path";
import {
  parseCSV,
  DAILY_DIR,
  OBSERVATION_START_DATE,
  round,
  getDaysBetween,
  MS_IN_DAY,
  DAYS_IN_YEAR,
} from "@/lib";
import { DailyPrice } from "@/types";
import { CumulativeYield, YoyYield } from "@/shared/types";
import {
  returnSymbolConfig,
  cumulativeSymbolsAll,
  ReturnSymbolConfigValue,
} from "@/shared/constants";
import { BadRequestError } from "@/lib/errors";

const USDTRY_SYMBOL = "USDTRY";

/**
 * Calculates return series for a financial symbol.
 *
 * Uses a static (class-level) cache to store and share parsed historical price data across all instances, while storing symbol-specific configurations within each instance.
 */
export class YieldService {
  private readonly symbol: string;
  private readonly config: ReturnSymbolConfigValue;

  private static readonly symbolToPrices = new Map<
    string,
    {
      priceHistory: DailyPrice[];
      timeToPrice: Map<number, number>;
    }
  >();

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

  constructor(symbol: string) {
    this.symbol = YieldService.requireSymbol(symbol);
    const config =
      returnSymbolConfig[this.symbol as keyof typeof returnSymbolConfig];
    this.config = config;
  }

  public getCumulativeYields(): CumulativeYield[] {
    const config = this.config;
    const withholdingTax =
      "withholdingTax" in config ? config.withholdingTax : 0;
    const symbolData = YieldService.getPriceHistory(config.symbol);
    const startIndex = symbolData.findIndex(
      (entry) => entry.date === OBSERVATION_START_DATE,
    );
    const startEntry = symbolData[startIndex];

    if (config.kind === "base" || config.kind === "usdAdjusted") {
      return symbolData.slice(startIndex + 1).flatMap((currentEntry) => {
        if (currentEntry.value == null || startEntry?.value == null) {
          return [];
        }

        let yieldValue =
          (currentEntry.value / startEntry.value - 1) * (1 - withholdingTax);

        if (config.kind === "usdAdjusted") {
          const usdtryData = YieldService.getPriceHistory(USDTRY_SYMBOL);
          const usdtryStartEntry = usdtryData!.find(
            (entry) => entry.date === OBSERVATION_START_DATE,
          );

          const usdtryCurrentValue = YieldService.getSymbolValue(
            USDTRY_SYMBOL,
            currentEntry.date,
          );

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

  public getYoyYields(): YoyYield[] {
    const config = this.config;
    const withholdingTax =
      "withholdingTax" in config ? config.withholdingTax : 0;
    const symbolData = YieldService.getPriceHistory(config.symbol);

    if (config.kind === "base" || config.kind === "usdAdjusted") {
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
          const usdtryData = YieldService.getPriceHistory(USDTRY_SYMBOL);
          const usdtryCurrentValue = YieldService.getSymbolValue(
            USDTRY_SYMBOL,
            currentEntry.date,
          );
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
   * Retrieves the whole dataset for a symbol.
   */
  private static getSymbolData(symbol: string): {
    priceHistory: DailyPrice[];
    timeToPrice: Map<number, number>;
  } {
    const upperSym = symbol.toUpperCase();
    let symbolData = YieldService.symbolToPrices.get(upperSym);

    if (!symbolData) {
      const { data: parsedData } = parseCSV<DailyPrice>({
        filePath: path.join(DAILY_DIR, `${upperSym}.csv`),
        header: true,
      });

      if (!parsedData || parsedData.length === 0) {
        throw new Error(`Data for symbol ${symbol} is missing or empty.`);
      }

      const startEntry = parsedData.find(
        (d) => d.date === OBSERVATION_START_DATE,
      );
      if (!startEntry || startEntry.value == null) {
        throw new Error(
          `Baseline date ${OBSERVATION_START_DATE} not found for symbol ${symbol}.`,
        );
      }

      // Safely reverse descending data to ascending order without mutating original array
      const priceHistory = [...parsedData].reverse();

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
  private static getPriceHistory(symbol: string): DailyPrice[] {
    return YieldService.getSymbolData(symbol).priceHistory;
  }

  /**
   * Retrieves the time-to-price map for a symbol.
   */
  private static getTimeToPriceMap(symbol: string): Map<number, number> {
    return YieldService.getSymbolData(symbol).timeToPrice;
  }

  /**
   * Retrieves the price for a symbol at a specific date.
   */
  private static getSymbolValue(symbol: string, date: number): number {
    const timeToPrice = YieldService.getTimeToPriceMap(symbol);
    const value = timeToPrice.get(date);
    if (value === undefined) {
      throw new Error(
        `Missing historical price for date ${date} in symbol ${symbol}`,
      );
    }
    return value;
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
