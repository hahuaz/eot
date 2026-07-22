export const MS_IN_DAY = 24 * 60 * 60 * 1000;
export const DAYS_IN_YEAR = 365;

/**
 * Calculates the number of days between two timestamps.
 */
export const getDaysBetween = (startDate: number, endDate: number): number => {
  return Math.round((endDate - startDate) / MS_IN_DAY);
};

// --------------------
// quarter manipulation
// --------------------

/**
 * Quarter-string ('<year>Q<1-4>', e.g. "2025Q1") parser.
 */
export function parseQuarter(quarter: string): { year: number; q: number } {
  return { year: Number(quarter.slice(0, 4)), q: Number(quarter.slice(5)) };
}

// '2025/3/30' -> 1
export const whichQuarter = (date: string | number) => {
  const month =
    typeof date === "string"
      ? Number(date.split("/")[1])
      : new Date(date).getUTCMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return quarter;
};

/**
 * '2025/3/30' -> '2025Q1'.
 */
export const toQuarterLabel = (date: string | number): string => {
  const year =
    typeof date === "string"
      ? Number(date.split("/")[0])
      : new Date(date).getUTCFullYear();
  return `${year}Q${whichQuarter(date)}`;
};

/** The same quarter one year earlier, e.g. "2025Q1" -> "2024Q1" */
export function quarterOneYearBefore(quarter: string): string {
  const { year, q } = parseQuarter(quarter);
  return `${year - 1}Q${q}`;
}

/** Whole/fractional years between two quarters (e.g. "2024Q1" -> "2026Q1" is 2), for annualizing growth - quarters here are always uniformly quarterly, so this is exact. */
export function yearsBetweenQuarters(
  fromQuarter: string,
  toQuarter: string,
): number {
  const from = parseQuarter(fromQuarter);
  const to = parseQuarter(toQuarter);
  return (to.year * 4 + to.q - (from.year * 4 + from.q)) / 4;
}
