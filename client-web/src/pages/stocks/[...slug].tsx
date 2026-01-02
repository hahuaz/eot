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
import { formatNumber, API_URL } from "@/lib";

import {
  DATES,
  GROWTH_COLUMNS,
  DerivedMetric,
  BaseMetric,
  MetricNames,
  StockResponse,
} from "@/shared/types";

const SECTIONS: Record<string, MetricNames[]> = {
  "Balance sheet": [
    "Cash & cash equivalents",
    "Short term liabilities",
    "Long term liabilities",
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
    "Dividend",
    "Yield",
    "Selected growth median",
  ],
};

export const getStaticPaths: GetStaticPaths = async () => {
  const [stockNamesTr, stockNamesUs] = await Promise.all([
    fetch(`${API_URL}api/stock-names?region=tr`).then((res) => {
      console.log("res", res);
      return res.json();
    }),
    fetch(`${API_URL}api/stock-names?region=us`).then((res) => res.json()),
  ]);

  const pathsTr = stockNamesTr.map((stock: string) => ({
    params: { slug: ["tr", stock] },
  }));

  const pathsUs = stockNamesUs.map((stock: string) => ({
    params: { slug: ["us", stock] },
  }));

  return {
    paths: [...pathsTr, ...pathsUs],
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<StockResponse> = async ({
  params,
}) => {
  const { slug } = params as { slug: string[] };
  const [region, stock] = slug;

  const { stockConfig, baseMetrics, derivedMetrics } = await fetch(
    `${API_URL}api/stock?stock=${stock}&region=${region}`,
  ).then((res) => res.json());

  return {
    props: {
      baseMetrics,
      derivedMetrics,
      stockConfig,
    },
  };
};

/**
 * Prepares metrics for display.
 */
const getDisplayMetrics = (metrics: (BaseMetric | DerivedMetric)[]) => {
  // for some symbols, the metric values are too large, so we need to normalize them to make them more readable
  const NORMALIZED_METRIC_NAMES: MetricNames[] = [
    "Cash & cash equivalents",
    "Short term liabilities",
    "Long term liabilities",
    "Equity",
    "Total assets",
    "Revenue",
    "Operating income",
    "Net income",
    "Enterprise value",
  ];

  const evMetric = metrics.find((m) => m.metricName === "Enterprise value");
  const evValue = (evMetric as any)?.current ?? 0;

  let normalizationDivisor = 1;
  if (typeof evValue === "number") {
    if (evValue > 999_999_999) normalizationDivisor = 1_000_000;
    else if (evValue > 99_999_999) normalizationDivisor = 1_000;
  }

  return metrics.map((metric) => {
    const newMetric: any = { ...metric };

    // Format Growth Columns
    GROWTH_COLUMNS.forEach((field) => {
      const value = (metric as any)[field];
      if (typeof value === "number") {
        newMetric[field] = value.toFixed(2);
      } else if (value === "negative") {
        newMetric[field] = "N/A";
      } else {
        newMetric[field] = "";
      }
    });

    // Format Date Columns
    DATES.forEach((field) => {
      const value = (metric as any)[field];
      if (NORMALIZED_METRIC_NAMES.includes(metric.metricName as MetricNames)) {
        newMetric[field] = formatNumber({
          num: value,
          trim: normalizationDivisor,
        });
      } else {
        if (typeof value === "number") {
          newMetric[field] = value.toFixed(2);
        } else if (value === "negative") {
          newMetric[field] = "N/A";
        } else {
          newMetric[field] = "";
        }
      }
    });

    return newMetric;
  });
};

const StockDetailPage = ({
  baseMetrics,
  derivedMetrics,
  stockConfig,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const allMetrics = [...baseMetrics, ...derivedMetrics];

  console.log("allMetrics", allMetrics);

  const displayMetrics = getDisplayMetrics(allMetrics);

  return (
    <>
      <div className="max-w-[1300px]">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="text-left" />
              {[...GROWTH_COLUMNS, ...DATES].map((field) => (
                <TableHead key={field} className="text-right w-[90px]">
                  {field}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(SECTIONS).map(([sectionName, metrics]) => (
              <React.Fragment key={sectionName}>
                <TableRow>
                  <TableCell className="text-left font-bold" colSpan={1}>
                    {sectionName}
                  </TableCell>
                </TableRow>
                {metrics.map((metricName) => {
                  const metric = displayMetrics.find(
                    (m) => m.metricName === metricName,
                  );

                  if (!metric) return null;

                  return (
                    <TableRow key={metric.metricName}>
                      <TableCell className="text-left">
                        {metric.metricName}
                      </TableCell>

                      {/* Growth Columns */}
                      {GROWTH_COLUMNS.map((field) => (
                        <TableCell key={field} className="text-right">
                          {metric[field]}
                        </TableCell>
                      ))}

                      {/* Date Columns */}
                      {DATES.map((field) => (
                        <TableCell key={field} className="text-right">
                          {metric[field]}
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
      <pre>{JSON.stringify(stockConfig, null, 2)}</pre>
    </>
  );
};

export default StockDetailPage;
