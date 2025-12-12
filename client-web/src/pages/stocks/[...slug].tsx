import React from "react";

import type {
  InferGetStaticPropsType,
  GetStaticProps,
  GetStaticPaths,
} from "next";

import Link from "next/link";

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
  StockConfig,
  DerivedMetric,
  BaseMetric,
  MetricNames,
} from "@shared/types";



const TABLE_SECTION_HEADERS: MetricNames[] = [
  "Balance sheet",
  "Income statement",
  "Statistics",
];

// remove trailing digits from these metric names
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

// force two digits for these metric names
const TWO_DIGIT_METRIC_NAMES: MetricNames[] = [
  "Price",
  "Dividend",
  "Yield",
  "Net debt / operating income",
  "EV / operating income",
  "EV / net income",
  "Market value / book value",
  "Selected growth",
];

export const getStaticPaths: GetStaticPaths = async () => {
  const stockNamesTr = await fetch(`${API_URL}api/stock-names?region=tr`).then(
    (res) => {
      console.log("res", res);
      return res.json();
    }
  );

  const pathsTr = stockNamesTr.map((stock: string) => ({
    params: { slug: ["tr", stock] },
  }));

  const stockNamesUs = await fetch(`${API_URL}api/stock-names?region=us`).then(
    (res) => res.json()
  );

  const pathsUs = stockNamesUs.map((stock: string) => ({
    params: { slug: ["us", stock] },
  }));

  const mergedPaths = [...pathsTr, ...pathsUs];

  return {
    paths: mergedPaths,
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<{
  baseMetrics: BaseMetric[];
  derivedMetrics: DerivedMetric[];
  stockConfig: StockConfig;
}> = async ({ params }) => {
  const { slug } = params as { slug: string };

  const [region, stock] = slug;

  const { stockConfig, baseMetrics, derivedMetrics } = await fetch(
    `${API_URL}api/stock?stock=${stock}&region=${region}`
  ).then((res) => res.json());

  return {
    props: {
      baseMetrics,
      derivedMetrics,
      stockConfig,
    },
  };
};

const AllPage = ({
  baseMetrics,
  derivedMetrics,
  stockConfig,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  let allMetrics = [...baseMetrics, ...derivedMetrics];

  // move price, dividend and yield to the end of the table before selected growth
  const priceIndex = allMetrics.findIndex(
    (item) => item.metricName === "Price"
  );
  const dividendIndex = allMetrics.findIndex(
    (item) => item.metricName === "Dividend"
  );
  const yieldIndex = allMetrics.findIndex(
    (item) => item.metricName === "Yield"
  );
  const selectedGrowthIndex = allMetrics.findIndex(
    (item) => item.metricName === "Selected growth"
  );

  const price = allMetrics[priceIndex];
  const dividend = allMetrics[dividendIndex];
  const yieldMetric = allMetrics[yieldIndex];
  const selectedGrowth = allMetrics[selectedGrowthIndex];
  allMetrics = allMetrics.filter(
    (item) =>
      item.metricName !== "Price" &&
      item.metricName !== "Dividend" &&
      item.metricName !== "Yield" &&
      item.metricName !== "Selected growth"
  );
  if (priceIndex !== -1) {
    allMetrics.push(price);
  }
  if (dividendIndex !== -1) {
    allMetrics.push(dividend);
  }
  if (yieldIndex !== -1) {
    allMetrics.push(yieldMetric);
  }
  if (selectedGrowthIndex !== -1) {
    allMetrics.push(selectedGrowth);
  }
  // console.log("stockConfig", stockConfig);
  console.log("allMetrics", allMetrics);

  let trimNumber = 1;
  // if ev digit is more than 9 digit, set trim to 1000. if it's more than 12 digit, set trim to 1000000
  const evIndex = allMetrics.findIndex(
    (item) => item.metricName === "Enterprise value"
  );
  const ev = allMetrics[evIndex];
  const evValue = ev?.["current"] ?? 0;
  if ((evValue as number) > 999999999) {
    trimNumber = 1000000;
  } else if ((evValue as number) > 99999999) {
    trimNumber = 1000;
  }

  return (
    <>
      <div className="max-w-[1300px]">
        <Table className="table-fixed ">
          <TableHeader>
            <TableRow>
              <TableHead key={0} className="text-left "></TableHead>

              {[...GROWTH_COLUMNS, ...DATES]?.map((field, i) => (
                <TableHead key={field} className={`text-right w-[90px]`}>
                  {field}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {allMetrics.map((metric, rowIndex) => {
              // if section header, render only first column and leave the rest empty
              if (TABLE_SECTION_HEADERS.includes(metric.metricName)) {
                return (
                  <TableRow key={rowIndex}>
                    <TableCell className="text-left font-bold">
                      {metric.metricName}
                    </TableCell>
                  </TableRow>
                );
              }

              return (
                <TableRow key={rowIndex}>
                  <TableCell className="text-left">
                    {metric.metricName}
                  </TableCell>

                  {GROWTH_COLUMNS.map((field, colIndex) => {
                    let displayValue;
                    if (typeof metric[field] === "number") {
                      displayValue = metric[field]?.toFixed(2);
                    } else if (metric[field] === "negative") {
                      displayValue = "N/A";
                    } else {
                      displayValue = "";
                    }
                    return (
                      <TableCell key={colIndex} className="text-right">
                        {displayValue}
                      </TableCell>
                    );
                  })}

                  {DATES?.map((field, colIndex) => {
                    let displayValue;

                    if (NORMALIZED_METRIC_NAMES.includes(metric.metricName)) {
                      displayValue = formatNumber({
                        num: (metric as BaseMetric)[field],
                        trim: trimNumber,
                      });
                    } else {
                      // if type is number, format it to 2 decimal places or return na
                      if (typeof metric[field] === "number") {
                        displayValue = metric[field]?.toFixed(2);
                      } else if (metric[field] === "negative") {
                        displayValue = "N/A";
                      } else {
                        displayValue = "";
                      }
                    }
                    return (
                      <TableCell key={colIndex} className="text-right">
                        {displayValue}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <pre>{JSON.stringify(stockConfig, null, 2)}</pre>
    </>
  );
};

export default AllPage;
