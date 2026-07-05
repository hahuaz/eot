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
import { CumulativeReturn, YoyReturn } from "@/shared/types";
import {
  returnSymbolConfig,
  cumulativeSymbolsAll,
  ReturnSymbolConfigValue,
} from "@/shared/constants";
import { BadRequestError } from "@/lib/errors";

const USDTRY_SYMBOL = "USDTRY";

/**
 * Calculates returns for a specific financial symbol.
 *
 * Uses a static (class-level) cache to store and share parsed historical price data across all instances, while storing symbol-specific configurations within each instance.
 *
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
    if (!config) {
      throw new Error(`Unhandled symbol config: ${this.symbol}`);
    }
    this.config = config;
  }

  /**
   * Calculates cumulative returns.
   */
  public getCummulativeReturns(): CumulativeReturn[] {
    const config = this.config;

    if (config.kind === "base") {
      const symbolData = this.getPriceHistory(config.symbol);
      const { startEntry, returnDates } = this.startObservation(
        symbolData,
        config.symbol,
      );

      const withholdingTax =
        "withholdingTax" in config ? config.withholdingTax : 0;

      return returnDates.map((entry) => {
        const currentValue = this.getSymbolValue(config.symbol, entry.date);
        const grossReturn = currentValue / startEntry.value - 1;
        const netReturn = grossReturn * (1 - withholdingTax);

        return {
          date: entry.date,
          value: netReturn,
        };
      });
    }

    if (config.kind === "currencyBasket") {
      const [firstCurrencySymbol, secondCurrencySymbol] = config.symbols;
      const firstCurrencyData = this.getPriceHistory(firstCurrencySymbol);
      const secondCurrencyData = this.getPriceHistory(secondCurrencySymbol);

      const { startEntry: firstCurrencyStartEntry } = this.startObservation(
        firstCurrencyData,
        firstCurrencySymbol,
      );
      const { startEntry: secondCurrencyStartEntry } = this.startObservation(
        secondCurrencyData,
        secondCurrencySymbol,
      );

      const commonDates = this.getCommonDates(
        firstCurrencyData,
        secondCurrencyData,
      );

      return commonDates.map((date) => {
        const firstCurrencyValue = this.getSymbolValue(
          firstCurrencySymbol,
          date,
        );
        const secondCurrencyValue = this.getSymbolValue(
          secondCurrencySymbol,
          date,
        );

        const firstCurrencyReturn =
          firstCurrencyValue / firstCurrencyStartEntry.value - 1;
        const secondCurrencyReturn =
          secondCurrencyValue / secondCurrencyStartEntry.value - 1;

        // for currency baskets, we take the geometric average of the returns to reflect the combined effect of both currencies.
        return {
          date,
          value:
            Math.sqrt((1 + firstCurrencyReturn) * (1 + secondCurrencyReturn)) -
            1,
        };
      });
    }

    if (config.kind === "usdAdjusted") {
      const symbolData = this.getPriceHistory(config.symbol);
      const usdtryData = this.getPriceHistory(USDTRY_SYMBOL);

      const { startEntry: symbolStartEntry } = this.startObservation(
        symbolData,
        config.symbol,
      );
      const { startEntry: usdtryStartEntry } = this.startObservation(
        usdtryData,
        USDTRY_SYMBOL,
      );

      const commonDates = this.getCommonDates(symbolData, usdtryData);

      return commonDates.map((date) => {
        const investmentValue = this.getSymbolValue(config.symbol, date);
        const usdtryValue = this.getSymbolValue(USDTRY_SYMBOL, date);

        const symbolGrossReturn = investmentValue / symbolStartEntry.value - 1;
        const withholdingTax =
          "withholdingTax" in config ? config.withholdingTax : 0;
        const symbolNetReturn = symbolGrossReturn * (1 - withholdingTax);

        const usdtryReturn = usdtryValue / usdtryStartEntry.value - 1;

        return {
          date,
          value: (1 + symbolNetReturn) / (1 + usdtryReturn) - 1,
        };
      });
    }

    throw new Error(`Unhandled symbol kind: ${(config as any).kind}`);
  }

  /**
   * Calculates YoY returns.
   */
  public getYoyReturns(): YoyReturn[] {
    const config = this.config;

    if (config.kind === "base") {
      return this.calculateSingleSymbolYoyReturns(config.symbol);
    }

    if (config.kind === "currencyBasket") {
      const [firstSymbol, secondSymbol] = config.symbols;

      return this.calculatePairedSymbolYoyReturns({
        firstSymbol,
        secondSymbol,
        combineRatios: (firstRatio, secondRatio) =>
          Math.sqrt(firstRatio * secondRatio),
      });
    }

    if (config.kind === "usdAdjusted") {
      return this.calculatePairedSymbolYoyReturns({
        firstSymbol: config.symbol,
        secondSymbol: USDTRY_SYMBOL,
        combineRatios: (investmentRatio, usdtryRatio) =>
          investmentRatio / usdtryRatio,
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
    let entry = YieldService.symbolToPrices.get(upperSym);

    if (!entry) {
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

      entry = { priceHistory, timeToPrice };
      YieldService.symbolToPrices.set(upperSym, entry);
    }
    return entry;
  }

  /**
   * Retrieves price history for a symbol.
   */
  private getPriceHistory(symbol: string): DailyPrice[] {
    return YieldService.getSymbolData(symbol).priceHistory;
  }

  /**
   * Retrieves the time-to-price map for a symbol.
   */
  private getTimeToPriceMap(symbol: string): Map<number, number> {
    return YieldService.getSymbolData(symbol).timeToPrice;
  }

  /**
   * Retrieves the price for a symbol at a specific date.
   */
  private getSymbolValue(symbol: string, date: number): number {
    const timeToPrice = this.getTimeToPriceMap(symbol);
    const value = timeToPrice.get(date);
    if (value === undefined) {
      throw new Error(
        `Missing historical price for date ${date} in symbol ${symbol}`,
      );
    }
    return value;
  }

  /**
   * Finds the intersection of timestamps present in both datasets within the observation window.
   */
  private getCommonDates(dataA: DailyPrice[], dataB: DailyPrice[]): number[] {
    const datesA = new Set(dataA.map((d) => d.date));

    return dataB
      .map((d) => d.date)
      .filter(
        (date) =>
          datesA.has(date) &&
          date >= OBSERVATION_START_DATE &&
          date !== OBSERVATION_START_DATE,
      );
  }

  /**
   * Slices historical data starting immediately after the baseline observation date.
   */
  private startObservation(
    data: DailyPrice[],
    symbol: string,
  ): { startEntry: DailyPrice; returnDates: DailyPrice[] } {
    const startIndex = data.findIndex(
      (entry) => entry.date === OBSERVATION_START_DATE,
    );

    if (startIndex === -1) {
      throw new Error(
        `Baseline date ${OBSERVATION_START_DATE} not found for symbol ${symbol}.`,
      );
    }

    return {
      startEntry: data[startIndex],
      returnDates: data.slice(startIndex + 1),
    };
  }

  /**
   * Identifies the closest available historical entry relative to a target date.
   */
  private getClosestEntry(data: DailyPrice[], targetDate: number): DailyPrice {
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

  /**
   * Builds the YoY return payload, annualizing values where appropriate.
   */
  private createYoyReturn({
    currentDate,
    baselineDate,
    ratio,
  }: {
    currentDate: number;
    baselineDate: number;
    ratio: number;
  }): YoyReturn {
    const daysPassed = getDaysBetween(baselineDate, currentDate);

    return {
      date: currentDate,
      baselineDate,
      daysPassed,
      yoyReturnPercent:
        daysPassed > 0
          ? round(YieldService.annualizeRatio(ratio, daysPassed))
          : 0,
    };
  }

  /**
   * YoY calculation strategy for simple symbols.
   */
  private calculateSingleSymbolYoyReturns(symbol: string): YoyReturn[] {
    const symbolData = this.getPriceHistory(symbol);
    const results: YoyReturn[] = [];

    for (let i = 1; i < symbolData.length; i++) {
      const currentEntry = symbolData[i];
      const targetDate = currentEntry.date - DAYS_IN_YEAR * MS_IN_DAY;
      const baselineEntry = this.getClosestEntry(
        symbolData.slice(0, i),
        targetDate,
      );

      const ratio =
        currentEntry.value != null && baselineEntry.value != null
          ? currentEntry.value / baselineEntry.value
          : 1;

      results.push(
        this.createYoyReturn({
          currentDate: currentEntry.date,
          baselineDate: baselineEntry.date,
          ratio,
        }),
      );
    }

    return results;
  }

  /**
   * YoY calculation strategy for structural pairs (e.g., currency combinations).
   */
  private calculatePairedSymbolYoyReturns({
    firstSymbol,
    secondSymbol,
    combineRatios,
  }: {
    firstSymbol: string;
    secondSymbol: string;
    combineRatios: (firstRatio: number, secondRatio: number) => number;
  }): YoyReturn[] {
    const firstData = this.getPriceHistory(firstSymbol);
    const secondData = this.getPriceHistory(secondSymbol);
    const results: YoyReturn[] = [];

    for (const currentDate of this.getCommonDates(firstData, secondData)) {
      const firstValue = this.getSymbolValue(firstSymbol, currentDate);
      const secondValue = this.getSymbolValue(secondSymbol, currentDate);
      const targetDate = currentDate - DAYS_IN_YEAR * MS_IN_DAY;

      const firstBaseline = this.getClosestEntry(firstData, targetDate);
      const secondBaseline = this.getClosestEntry(secondData, targetDate);

      if (firstBaseline.value == null || secondBaseline.value == null) {
        continue;
      }

      const ratio = combineRatios(
        firstValue / firstBaseline.value,
        secondValue / secondBaseline.value,
      );

      results.push(
        this.createYoyReturn({
          currentDate,
          baselineDate: firstBaseline.date,
          ratio,
        }),
      );
    }

    return results;
  }
}
