import { STOCK_DATES, StockDate } from "@eot/shared";

export const MS_IN_DAY = 24 * 60 * 60 * 1000;
export const DAYS_IN_YEAR = 365;

export const CURRENT_DATE = STOCK_DATES[0];
export const LAST_DATE = STOCK_DATES[1];
export const TTM_START_DATE = findDateOneYearBefore(LAST_DATE);

function findDateOneYearBefore(dateStr: string): StockDate {
  const target = new Date(dateStr);
  target.setFullYear(target.getFullYear() - 1);

  const match = STOCK_DATES.find((candidate) => {
    if (candidate === "current") return false;
    const parsed = new Date(candidate);
    return (
      parsed.getFullYear() === target.getFullYear() &&
      parsed.getMonth() === target.getMonth() &&
      parsed.getDate() === target.getDate()
    );
  });

  if (!match) {
    throw new Error(
      `STOCK_DATES has no entry exactly one year before ${dateStr} - can't derive TTM_START_DATE`,
    );
  }

  return match;
}

export const whichQuarter = (date: string) => {
  const month = new Date(date).getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return quarter;
};

/**
 * Given the date, calculate the years passed
 */
export const getYearsPassed = ({ date }: { date: string }): number => {
  const lastDateObj = new Date(LAST_DATE);
  const monthsPassed =
    (lastDateObj.getFullYear() - new Date(date).getFullYear()) * 12 +
    (lastDateObj.getMonth() - new Date(date).getMonth());
  const yearsPassed = monthsPassed / 12;
  if (yearsPassed < 0) {
    throw new Error(`getYearsPassed: yearsPassed is negative for date ${date}`);
  }
  return yearsPassed;
};

/**
 * Returns the dates (from the predefined STOCK_DATES constant) for which the
 * given metric record has a defined value. This is particularly useful for
 * stocks with limited historical data (e.g., recently IPO'd), as it filters
 * out dates where no data points exist for the metric.
 *
 */
export const getAvailableDates = (
  metric: Record<StockDate, number | null>,
): StockDate[] => {
  const availableDates: StockDate[] = [];

  for (let i = 0; i < STOCK_DATES.length; i++) {
    const date = STOCK_DATES[i];
    if (metric[date]) {
      availableDates.push(date);
    }
  }

  return availableDates;
};

/**
 * Calculates the number of days between two timestamps.
 */
export const getDaysBetween = (startDate: number, endDate: number): number => {
  return Math.round((endDate - startDate) / MS_IN_DAY);
};
