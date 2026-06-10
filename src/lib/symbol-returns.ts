import path from "path";
import {
  parseCSV,
  DAILY_DIR,
  OBSERVATION_START_DATE,
  TAXES,
  calcRealRate,
  LAST_DATE,
  round,
} from "@/lib";
import { DailyPrice } from "@/types";
import { CumulativeReturn, Inflation, YoyReturn } from "@/shared/types";
import { returnSymbolConfig, cumulativeSymbolsAll } from "@/shared/constants";

const USDTRY_SYMBOL = "USDTRY";

export const MS_IN_DAY = 24 * 60 * 60 * 1000;
export const DAYS_IN_YEAR = 365;

/**
 * Given two timestamps, calculates the number of days between them.
 */
export const getDaysBetween = (startDate: number, endDate: number): number => {
  return Math.round((endDate - startDate) / MS_IN_DAY);
};

/**
 * Given a price ratio and the number of days it represents, annualizes the return.
 */
export const annualizeRatio = (ratio: number, days: number): number => {
  return Math.pow(ratio, DAYS_IN_YEAR / days) - 1;
};

export function isValidSymbol(symbol: any): boolean {
  if (!symbol || typeof symbol !== "string") {
    console.error(`Symbol must be a string.`);
    return false;
  }
  const normalizedSymbol = symbol.toLowerCase();
  if (!cumulativeSymbolsAll.includes(normalizedSymbol)) {
    console.error(`Invalid symbol.`);
    return false;
  }
  return true;
}

/**
 * A cohesive calculator class for computing cumulative and YoY returns.
 * Caches CSV parsed data and constructed price maps to optimize performance.
 */
export class SymbolReturnsCalculator {
  private readonly symbol: string;
  private readonly config: (typeof returnSymbolConfig)[keyof typeof returnSymbolConfig];

  private static readonly symbolDataCache = new Map<string, DailyPrice[]>();
  private static readonly priceMapCache = new Map<
    string,
    Map<number, number>
  >();

  constructor(symbol: string) {
    if (!isValidSymbol(symbol)) {
      throw new Error(`Invalid symbol: ${symbol}`);
    }
    this.symbol = symbol.toLowerCase();
    const config =
      returnSymbolConfig[this.symbol as keyof typeof returnSymbolConfig];
    if (!config) {
      throw new Error(`Unhandled symbol: ${this.symbol}`);
    }
    this.config = config;
  }

  /**
   * Retrieves historical price data for a given symbol, caching the result.
   */
  private getSymbolData(symbol: string): DailyPrice[] {
    const upperSym = symbol.toUpperCase();
    let data = SymbolReturnsCalculator.symbolDataCache.get(upperSym);
    if (!data) {
      const { data: parsedData } = parseCSV<DailyPrice>({
        filePath: path.join(DAILY_DIR, `${upperSym}.csv`),
        header: true,
      });

      if (!parsedData || parsedData.length === 0) {
        throw new Error(`Data for symbol ${symbol} not found or empty.`);
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
      const dataAsc = [...parsedData].reverse();

      // Validate date integrity
      for (let i = 1; i < dataAsc.length; i++) {
        const prevDate = new Date(dataAsc[i - 1].date).getTime();
        const nextDate = new Date(dataAsc[i].date).getTime();
        if (prevDate >= nextDate) {
          throw new Error(
            `Data for symbol ${symbol} is corrupted. Date order is incorrect.`,
          );
        }
      }

      data = dataAsc;
      SymbolReturnsCalculator.symbolDataCache.set(upperSym, data);
    }
    return data;
  }

  /**
   * Retrieves the price map for a given symbol, caching the result.
   */
  private getPriceMap(symbol: string): Map<number, number> {
    const upperSym = symbol.toUpperCase();
    let priceMap = SymbolReturnsCalculator.priceMapCache.get(upperSym);
    if (!priceMap) {
      const data = this.getSymbolData(symbol);
      priceMap = new Map(data.map((entry) => [entry.date, entry.value]));
      SymbolReturnsCalculator.priceMapCache.set(upperSym, priceMap);
    }
    return priceMap;
  }

  /**
   * Safely retrieves a value from a symbol's price map.
   */
  private getValue(symbol: string, date: number): number {
    const priceMap = this.getPriceMap(symbol);
    const value = priceMap.get(date);
    if (value === undefined) {
      throw new Error(
        `Missing historical price for date ${date} in symbol ${symbol}`,
      );
    }
    return value;
  }

  /**
   * Finds the intersection of dates present in both datasets and
   * filters by the observation window.
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
   * Gets the start entry and returns slice starting after the observation date.
   */
  private getObservationStart(
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
   * For given historical price data and target date, finds the closest prior-year entry.
   */
  private getClosestEntry(data: DailyPrice[], targetDate: number): DailyPrice {
    let closestEntry = data[0];
    let minDiff = Infinity;

    for (const entry of data) {
      const diff = Math.abs(entry.date - targetDate);
      if (diff < minDiff) {
        minDiff = diff;
        closestEntry = entry;
      }
    }

    return closestEntry;
  }

  /**
   * Creates YoYReturn structure.
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
        daysPassed > 0 ? round(annualizeRatio(ratio, daysPassed)) : 0,
    };
  }

  /**
   * YoY returns calculation for single symbols.
   */
  private calculateSingleSymbolYoyReturns(symbol: string): YoyReturn[] {
    const symbolData = this.getSymbolData(symbol);
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
   * YoY returns calculation for paired/combined symbols.
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
    const firstData = this.getSymbolData(firstSymbol);
    const secondData = this.getSymbolData(secondSymbol);
    const results: YoyReturn[] = [];

    for (const currentDate of this.getCommonDates(firstData, secondData)) {
      const firstValue = this.getValue(firstSymbol, currentDate);
      const secondValue = this.getValue(secondSymbol, currentDate);
      const targetDate = currentDate - DAYS_IN_YEAR * MS_IN_DAY;
      const firstBaseline = this.getClosestEntry(firstData, targetDate);
      const secondBaseline = this.getClosestEntry(secondData, targetDate);

      if (!firstBaseline.value || !secondBaseline.value) {
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

  /**
   * Calculates cumulative returns.
   */
  public getCummulativeReturns(): CumulativeReturn[] {
    const config = this.config;

    if (config.kind === "base") {
      const symbolData = this.getSymbolData(config.symbol);
      const { startEntry, returnDates } = this.getObservationStart(
        symbolData,
        config.symbol,
      );

      const withholdingTax =
        "withholdingTax" in config ? config.withholdingTax : 0;

      return returnDates.map((entry) => {
        const currentValue = this.getValue(config.symbol, entry.date);
        const grossReturn = currentValue / startEntry.value - 1;
        const netReturn = grossReturn * (1 - withholdingTax);

        return {
          date: entry.date,
          value: netReturn,
        };
      });
    }

    console.log(`Calculating returns for configured symbol: ${this.symbol}`);

    if (config.kind === "currencyBasket") {
      const [firstCurrencySymbol, secondCurrencySymbol] = config.symbols;
      const firstCurrencyData = this.getSymbolData(firstCurrencySymbol);
      const secondCurrencyData = this.getSymbolData(secondCurrencySymbol);

      const { startEntry: firstCurrencyStartEntry } = this.getObservationStart(
        firstCurrencyData,
        firstCurrencySymbol,
      );
      const { startEntry: secondCurrencyStartEntry } = this.getObservationStart(
        secondCurrencyData,
        secondCurrencySymbol,
      );

      const commonDates = this.getCommonDates(
        firstCurrencyData,
        secondCurrencyData,
      );

      return commonDates.map((date) => {
        const firstCurrencyValue = this.getValue(firstCurrencySymbol, date);
        const secondCurrencyValue = this.getValue(secondCurrencySymbol, date);

        const firstCurrencyReturn =
          firstCurrencyValue / firstCurrencyStartEntry.value - 1;
        const secondCurrencyReturn =
          secondCurrencyValue / secondCurrencyStartEntry.value - 1;

        return {
          date,
          value:
            Math.sqrt((1 + firstCurrencyReturn) * (1 + secondCurrencyReturn)) -
            1,
        };
      });
    }

    if (config.kind === "usdAdjusted") {
      const investmentData = this.getSymbolData(config.symbol);
      const usdtryData = this.getSymbolData(USDTRY_SYMBOL);

      const { startEntry: investmentStartEntry } = this.getObservationStart(
        investmentData,
        config.symbol,
      );
      const { startEntry: usdtryStartEntry } = this.getObservationStart(
        usdtryData,
        USDTRY_SYMBOL,
      );

      const commonDates = this.getCommonDates(investmentData, usdtryData);

      return commonDates.map((date) => {
        const investmentValue = this.getValue(config.symbol, date);
        const usdtryValue = this.getValue(USDTRY_SYMBOL, date);

        const investmentGrossReturn =
          investmentValue / investmentStartEntry.value - 1;
        const withholdingTax =
          "withholdingTax" in config ? config.withholdingTax : 0;
        const investmentNetReturn =
          investmentGrossReturn * (1 - withholdingTax);

        const usdtryReturn = usdtryValue / usdtryStartEntry.value - 1;

        return {
          date,
          value: (1 + investmentNetReturn) / (1 + usdtryReturn) - 1,
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
   * Clears the static cache (useful for testing or if new files are scrape/written dynamically).
   */
  public static clearCache(): void {
    SymbolReturnsCalculator.symbolDataCache.clear();
    SymbolReturnsCalculator.priceMapCache.clear();
  }
}

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
