import { DAYS_IN_YEAR } from "@/lib";
import { SymbolPrice } from "@/types";

/**
 * Identifies the closest available historical entry relative to a target date.
 */
export function getClosestEntry(
  data: SymbolPrice[],
  targetDate: number,
): SymbolPrice {
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

/**
 * Computes a withholding-tax-adjusted net yield from a raw price ratio.
 */
export function computeNetYield(
  currentValue: number,
  baseValue: number,
  withholdingTax: number,
): number {
  const rawYield = (currentValue - baseValue) / baseValue;
  return rawYield * (1 - withholdingTax);
}

/**
 * Adjusts a net yield against a benchmark symbol's yield over the same
 * period, so the result reflects performance relative to the benchmark
 * rather than in absolute terms.
 */
export function applyBenchmarkAdjustment(
  netYield: number,
  benchCurrentValue: number,
  benchBaseValue: number,
): number {
  const benchYield = (benchCurrentValue - benchBaseValue) / benchBaseValue;
  return (1 + netYield) / (1 + benchYield) - 1;
}
