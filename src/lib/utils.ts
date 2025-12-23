import { Inflation } from "@/shared/types";
import { getYearsPassed } from "./dates";

/**
 * Rounds a number to a fixed number of decimal places (limit floating point precision issues).
 */
export function round(value: number): number {
  const TO_FIXED_DIGIT = 5;
  return Number(value.toFixed(TO_FIXED_DIGIT));
}

/**
 * Calculates the real rate of return by adjusting the nominal rate for inflation.
 * Formula: (nominalRate - inflationRate) / (1 + inflationRate)
 */
export function calcRealRate({
  nominalRate,
  inflationRate,
}: {
  nominalRate: number;
  inflationRate: number;
}): number {
  return (nominalRate - inflationRate) / (1 + inflationRate);
}
/**
 * Calculates the yearly growth rate by raising the total growth rate to the power of 1/years passed.
 * Formula: (1 + totalGrowth)^(1/yearsPassed) - 1
 */
export function calcYearlyGrowth({
  totalGrowth,
  startDate,
}: {
  totalGrowth: number;
  startDate: string;
}): number {
  const yearsPassed = getYearsPassed({ date: startDate });
  return Math.pow(1 + totalGrowth, 1 / yearsPassed) - 1;
}
