import { DATES, BaseMetricNames, BaseMetric } from "@shared/types";

export const CURRENT_DATE = DATES[0];
export const LAST_DATE = DATES[1];
// TODO: finished year date either increasing or decreasing based on current date
export const LAST_FINISHED_YEAR_DATE = DATES[4];
export const PREVIOUS_FINISHED_YEAR_DATE = DATES[5];

export const lastDateObj = new Date(LAST_DATE);

export const whichQuarter = (date: string) => {
  const month = new Date(date).getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return quarter;
};

/**
 * Given the date, calculate the years passed
 */
export const getYearsPassed = ({ date }: { date: string }): number => {
  const monthsPassed =
    (lastDateObj.getFullYear() - new Date(date).getFullYear()) * 12 +
    (lastDateObj.getMonth() - new Date(date).getMonth());
  const yearsPassed = monthsPassed / 12;
  if (yearsPassed < 0) {
    throw new Error(`getYearsPassed: yearsPassed is negative for date ${date}`);
  }
  return yearsPassed;
};

export const getAvailableDates = ({
  baseMetrics,
  metricName,
}: {
  baseMetrics: BaseMetric[];
  metricName: BaseMetricNames;
}): (typeof DATES)[number][] => {
  const availableDates: (typeof DATES)[number][] = [];
  const metric = baseMetrics.find((item) => item.metricName === metricName);
  if (!metric) {
    throw new Error(`Metric ${metricName} not found`);
  }

  for (let i = DATES.length - 1; i >= 0; i--) {
    const date = DATES[i];
    if (metric[date]) {
      availableDates.unshift(date);
    }
  }

  return availableDates;
};
