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
 * if stock is recently made IPO, metric values maybe null for older DATES.
 * we need to find the earliest date that metric has value for
 */
export const getEarliestDefinedDate = ({
  metricName,
  baseMetrics,
  dates,
}: {
  metricName: BaseMetricNames;
  baseMetrics: BaseMetric[];
  dates: typeof DATES;
}): string => {
  const metric = baseMetrics.find((item) => item.metricName === metricName);
  if (!metric) {
    throw new Error(`Metric ${metricName} not found`);
  }

  for (let i = dates.length - 1; i >= 0; i--) {
    const date = dates[i];
    if (metric[date]) {
      return date;
    }
  }
  throw new Error(`Earliest date not found for metric ${metricName}`);
};

/**
 * if stock is recently made IPO, metric values maybe null for older DATES.
 * So yearPassed param is dynamic and calculated based on the earliest date that metric has value for
 */
export const getYearsPassed = ({
  earliestDefinedDate,
}: {
  earliestDefinedDate: string;
}): number => {
  const monthsPassed =
    (lastDateObj.getFullYear() - new Date(earliestDefinedDate).getFullYear()) *
      12 +
    (lastDateObj.getMonth() - new Date(earliestDefinedDate).getMonth());
  const yearsPassed = monthsPassed / 12;
  if (yearsPassed < 0) {
    throw new Error(
      `getYearsPassed: yearsPassed is negative for earliestDefinedDate ${earliestDefinedDate}`,
    );
  }
  return yearsPassed;
};
