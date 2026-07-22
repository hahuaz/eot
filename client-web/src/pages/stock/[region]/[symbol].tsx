import React from "react";
import type {
  InferGetStaticPropsType,
  GetStaticProps,
  GetStaticPaths,
} from "next";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatAbbreviatedNumber, API_URL } from "@/lib";

import { StockMetricName, StockResponse } from "@eot/shared";

const GROWTH_COLUMN_LABELS = [
  "Total growth",
  "Yearly growth",
  "TTM growth",
] as const;

const SECTIONS: Record<string, StockMetricName[]> = {
  "Balance sheet": [
    "Cash and equivalents",
    "Short term debt",
    "Long term debt",
    "Equity",
    "Total assets",
  ],
  "Income statement": ["Revenue", "Operating income", "Net income"],
  Valuation: [
    "Enterprise value",
    "Net debt / operating income",
    "EV / operating income",
    "EV / net income",
    "Market value / book value",
    "Price",
    "USD Price",
    "Dividend Yield",
    "Total USD Yield",
  ],
};

// formatNumber defaults to 0 decimal digits, correct for the large
// balance-sheet/income/enterprise-value figures every other row holds -
// but Price/USD Price are small currency amounts, Dividend Yield/Total USD
// Yield are fractional ratios (e.g. 0.0495 = ~5%), and the EV multiples are
// small-magnitude ratios too (e.g. 5.2x), so rounding those to whole
// numbers shows "0" for nearly every cell. Everything not listed here
// keeps the 0-digit default.
const METRIC_DIGITS: Partial<Record<StockMetricName, number>> = {
  "Net debt / operating income": 2,
  "EV / operating income": 2,
  "EV / net income": 2,
  "Market value / book value": 2,
  Price: 2,
  "USD Price": 2,
  "Dividend Yield": 4,
  "Total USD Yield": 4,
};

// Large absolute-monetary-value rows get abbreviated tradingview.com-style
// (e.g. "42.6B" instead of "42,603,202,000") - ratios/multiples/prices
// (everything in METRIC_DIGITS above) stay as precise decimal numbers,
// where an abbreviation would be meaningless or actively misleading.
const ABBREVIATED_METRIC_NAMES = new Set<StockMetricName>([
  "Cash and equivalents",
  "Short term debt",
  "Long term debt",
  "Equity",
  "Total assets",
  "Revenue",
  "Operating income",
  "Net income",
  "Enterprise value",
]);

export const getStaticPaths: GetStaticPaths = async () => {
  const [symbolsTr, symbolsUs] = await Promise.all([
    fetch(`${API_URL}api/stock/tr/symbols`).then((res) => res.json()),
    fetch(`${API_URL}api/stock/us/symbols`).then((res) => res.json()),
  ]);

  const pathsTr = symbolsTr.map((symbol: string) => ({
    params: { region: "tr", symbol },
  }));
  const pathsUs = symbolsUs.map((symbol: string) => ({
    params: { region: "us", symbol },
  }));

  return {
    paths: [...pathsTr, ...pathsUs],
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<StockResponse> = async ({
  params,
}) => {
  const { region, symbol } = params as { region: string; symbol: string };

  const { quarters, metrics } = await fetch(
    `${API_URL}api/stock/${region}/${symbol}`,
  ).then((res) => res.json());

  return {
    props: { quarters, metrics },
  };
};

/** Value cell content - abbreviated (tradingview.com-style) for large monetary metrics, plain otherwise. */
const formatMetricValue = (
  num: number | "N/A" | null | undefined,
  metricName: StockMetricName,
  digits: number,
): string =>
  ABBREVIATED_METRIC_NAMES.has(metricName)
    ? formatAbbreviatedNumber({ num })
    : formatNumber({ num, digits });

/** Growth cell, colored green/red for positive/negative, blank when null (no prior quarter to compare against, or not comparable). */
const GrowthLabel = ({ growth }: { growth: number | null }) => {
  if (growth == null) return null;

  const colorClass =
    growth > 0 ? "text-green-600" : growth < 0 ? "text-red-600" : "";

  return (
    <span className={`ml-1 text-[10px] ${colorClass}`}>
      ({formatNumber({ num: growth, digits: 2 })})
    </span>
  );
};

const StockDetailPage = ({
  quarters,
  metrics,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  return (
    <div className="">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="text-left" />
            {GROWTH_COLUMN_LABELS.map((label) => (
              <TableHead key={label} className="text-right w-[90px]">
                {label}
              </TableHead>
            ))}
            <TableHead className="text-right w-[130px]">current</TableHead>
            {quarters.map((quarter) => (
              <TableHead key={quarter} className="text-right w-[130px]">
                {quarter}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(SECTIONS).map(([sectionName, metricNames]) => (
            <React.Fragment key={sectionName}>
              <TableRow>
                <TableCell className="text-left font-bold" colSpan={1}>
                  {sectionName}
                </TableCell>
              </TableRow>
              {metricNames.map((metricName) => {
                const metric = metrics.find((m) => m.metricName === metricName);
                if (!metric) return null;

                const digits = METRIC_DIGITS[metric.metricName] ?? 0;

                return (
                  <TableRow key={metric.metricName}>
                    <TableCell className="text-left">
                      {metric.metricName}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber({ num: metric.totalGrowth, digits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber({ num: metric.yearlyGrowth, digits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber({ num: metric.ttmGrowth, digits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMetricValue(
                        metric.current,
                        metric.metricName,
                        digits,
                      )}
                    </TableCell>
                    {quarters.map((quarter) => (
                      <TableCell key={quarter} className="text-right">
                        {formatMetricValue(
                          metric.values[quarter],
                          metric.metricName,
                          digits,
                        )}
                        <GrowthLabel growth={metric.qoqGrowth[quarter]} />
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default StockDetailPage;
