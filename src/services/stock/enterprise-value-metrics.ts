import type { StockMetric } from "@eot/shared";

import { round } from "@/lib/utils";
import {
  NO_GROWTH,
  Value,
  qoqGrowthValue,
} from "@/services/stock/growth-columns";

/**
 * Builds the enterprise-value family of metrics:
 *   Enterprise value = price * outstandingShares + shortTermDebt +
 *                       longTermDebt - cash
 *   Net debt / operating income = (shortTermDebt + longTermDebt - cash) /
 *                                  operatingIncome
 *   EV / operating income = enterpriseValue / operatingIncome
 *   EV / net income = enterpriseValue / netIncome
 *   Market value / book value = (price * outstandingShares) / equity
 * None of these are USD-converted - EV is a plain TRY figure, and the
 * ratios are currency-invariant since both sides would scale together.
 *
 * The financial-report inputs (cash/debt/equity/income) are defined for
 * every quarter in `quartersAscending`. Price is the only input that can be
 * null for a given quarter (e.g. recent IPO).
 *
 * Unlike Market value / book value (a plain ratio, shown as-is even if
 * negative), EV / operating income, EV / net income, and Net debt /
 * operating income resolve to "N/A" when their income denominator is zero
 * or negative.
 *
 * Cash/debt/Equity/income inputs are expected to already be real-absolute-
 * value (trimDigit-multiplied, see getStockData)
 */
export function buildEnterpriseValueMetrics({
  quartersAscending,
  outstandingShares,
  priceValues,
  currentPrice,
  cashValues,
  shortTermDebtValues,
  longTermDebtValues,
  equityValues,
  operatingIncomeValues,
  netIncomeValues,
}: {
  quartersAscending: string[];
  outstandingShares: number | null;
  priceValues: Record<string, number | null>;
  currentPrice: number | null;
  cashValues: Record<string, number | null>;
  shortTermDebtValues: Record<string, number | null>;
  longTermDebtValues: Record<string, number | null>;
  equityValues: Record<string, number | null>;
  operatingIncomeValues: Record<string, number | null>;
  netIncomeValues: Record<string, number | null>;
}): StockMetric[] {
  const lastQuarter = quartersAscending[quartersAscending.length - 1];

  const enterpriseValueAt = (
    price: number | null,
    cash: number | null,
    shortTermDebt: number | null,
    longTermDebt: number | null,
  ): number | null =>
    outstandingShares == null || price == null
      ? null
      : price * outstandingShares +
        (shortTermDebt ?? 0) +
        (longTermDebt ?? 0) -
        (cash ?? 0);

  const evValues: Record<string, number | null> = {};
  for (const quarter of quartersAscending) {
    evValues[quarter] = enterpriseValueAt(
      priceValues[quarter],
      cashValues[quarter],
      shortTermDebtValues[quarter],
      longTermDebtValues[quarter],
    );
  }
  const currentEv = enterpriseValueAt(
    currentPrice,
    cashValues[lastQuarter],
    shortTermDebtValues[lastQuarter],
    longTermDebtValues[lastQuarter],
  );

  /** numerator/denominator, "N/A" if the (income) denominator is <= 0, null if either side is missing. */
  const divideByIncome = (
    numerator: Value,
    denominator: number | null,
  ): Value => {
    if (typeof numerator !== "number" || denominator == null) return null;
    if (denominator <= 0) return "N/A";
    return round(numerator / denominator);
  };

  /** Plain ratio, no "N/A" branch - matches Market value/book value's v1 spec, which shows a negative result as-is. */
  const plainRatio = (
    numerator: number | null,
    denominator: number | null,
  ): number | null =>
    numerator == null || denominator == null
      ? null
      : round(numerator / denominator);

  const netDebtAt = (
    cash: number | null,
    shortTermDebt: number | null,
    longTermDebt: number | null,
  ): number => (shortTermDebt ?? 0) + (longTermDebt ?? 0) - (cash ?? 0);

  const evOiValues: Record<string, Value> = {};
  const netDebtOiValues: Record<string, Value> = {};
  const evNiValues: Record<string, Value> = {};
  const mvBvValues: Record<string, number | null> = {};

  for (const quarter of quartersAscending) {
    evOiValues[quarter] = divideByIncome(
      evValues[quarter],
      operatingIncomeValues[quarter],
    );
    netDebtOiValues[quarter] = divideByIncome(
      netDebtAt(
        cashValues[quarter],
        shortTermDebtValues[quarter],
        longTermDebtValues[quarter],
      ),
      operatingIncomeValues[quarter],
    );
    evNiValues[quarter] = divideByIncome(
      evValues[quarter],
      netIncomeValues[quarter],
    );
    mvBvValues[quarter] =
      outstandingShares == null || priceValues[quarter] == null
        ? null
        : plainRatio(
            priceValues[quarter]! * outstandingShares,
            equityValues[quarter],
          );
  }

  const currentEvOi = divideByIncome(
    currentEv,
    operatingIncomeValues[lastQuarter],
  );
  const currentNetDebtOi = divideByIncome(
    netDebtAt(
      cashValues[lastQuarter],
      shortTermDebtValues[lastQuarter],
      longTermDebtValues[lastQuarter],
    ),
    operatingIncomeValues[lastQuarter],
  );
  const currentEvNi = divideByIncome(currentEv, netIncomeValues[lastQuarter]);
  const currentMvBv =
    outstandingShares == null || currentPrice == null
      ? null
      : plainRatio(currentPrice * outstandingShares, equityValues[lastQuarter]);

  const growthOf = (
    values: Record<string, Value>,
  ): Record<string, number | null> =>
    Object.fromEntries(
      quartersAscending.map((quarter, i) => [
        quarter,
        qoqGrowthValue(
          values[quarter],
          i > 0 ? values[quartersAscending[i - 1]] : null,
        ),
      ]),
    );

  return [
    {
      metricName: "Enterprise value",
      values: evValues,
      qoqGrowth: growthOf(evValues),
      current: currentEv,
      ...NO_GROWTH,
    },
    {
      metricName: "Net debt / operating income",
      values: netDebtOiValues,
      qoqGrowth: growthOf(netDebtOiValues),
      current: currentNetDebtOi,
      ...NO_GROWTH,
    },
    {
      metricName: "EV / operating income",
      values: evOiValues,
      qoqGrowth: growthOf(evOiValues),
      current: currentEvOi,
      ...NO_GROWTH,
    },
    {
      metricName: "EV / net income",
      values: evNiValues,
      qoqGrowth: growthOf(evNiValues),
      current: currentEvNi,
      ...NO_GROWTH,
    },
    {
      metricName: "Market value / book value",
      values: mvBvValues,
      qoqGrowth: growthOf(mvBvValues),
      current: currentMvBv,
      ...NO_GROWTH,
    },
  ];
}
