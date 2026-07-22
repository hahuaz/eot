import { getDaysBetween, DAYS_IN_YEAR } from "@/lib";

export const wait = (seconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};

/**
 * Compile-time exhaustiveness check. Call this in the `default` branch of a
 * switch over a union type - if a new variant is ever added without handling
 * it, TypeScript will flag the call site as an error instead of it silently
 * doing nothing at runtime.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}

/**
 * Rounds a number to a fixed number of decimal places (limit floating point precision issues).
 */
export function round(value: number): number {
  const TO_FIXED_DIGIT = 5;
  return Number(value.toFixed(TO_FIXED_DIGIT));
}

// periodicGrowthRate = (1 + totalGrowth) ^ (1 / periods) - 1
// periods are years passed in this case
export function calcYearlyGrowth({
  totalGrowth,
  startDate,
  endDate,
}: {
  totalGrowth: number;
  startDate: number;
  endDate: number;
}): number {
  const daysPassed = getDaysBetween(startDate, endDate);
  if (daysPassed <= 0) return 0;

  const period = daysPassed / DAYS_IN_YEAR;

  return Math.pow(1 + totalGrowth, 1 / period) - 1;
}
