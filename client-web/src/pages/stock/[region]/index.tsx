import React, { useState } from "react";
import type {
  GetStaticProps,
  InferGetStaticPropsType,
  GetStaticPaths,
} from "next";
import Link from "next/link";
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  flexRender,
  SortingState,
} from "@tanstack/react-table";
import { API_URL, formatNumber } from "@/lib";
import { StockSummaryEntry } from "@eot/shared";

// One-row-per-stock summary/screener, sourced from GET /api/stock/:region
// (StockService.getAllStockData).
interface StockSummary {
  stockName: string;
  "Observation Start Yield": number | null;
  "Total yield": number | "N/A" | null;
  "TTM yield": number | "N/A" | null;
  "EV / operating income": number | "N/A" | null;
  "EV / net income": number | "N/A" | null;
  "TTM growth": number | "N/A" | null;
  "Yearly growth": number | "N/A" | null;
  "(ev/oi) / ttm growth": number | "N/A";
  "(ev/oi) / yearly growth": number | "N/A";
  "Net debt / operating income": number | "N/A" | null;
  "Market value / book value": number | "N/A" | null;
  Notes: string | null;
  color: string | null;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const regions = ["us", "tr"];
  const paths = regions.map((region: string) => ({
    params: { region },
  }));
  return {
    paths,
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<{
  stocks: StockSummary[];
  region: string;
}> = async ({ params }) => {
  const { region } = params as { region: string };

  const entries: StockSummaryEntry[] = await fetch(
    `${API_URL}api/stock/${region}`,
  ).then((res) => res.json());

  const stockSummary: StockSummary[] = entries.map((entry) => {
    const {
      symbol,
      notes,
      color,
      response,
      growthSummary,
      observationStartYield,
    } = entry;
    const findMetric = (name: string) =>
      response.metrics.find((m) => m.metricName === name);

    const usdYieldMetric = findMetric("Total USD Yield");
    const evOiMetric = findMetric("EV / operating income");
    const evNiMetric = findMetric("EV / net income");
    const netDebtMetric = findMetric("Net debt / operating income");
    const mvBvMetric = findMetric("Market value / book value");

    const evToOperatingIncome = evOiMetric?.current ?? null;
    const { ttmGrowth, yearlyGrowth } = growthSummary;

    const ratioTo = (growth: number | "N/A" | null): number | "N/A" =>
      typeof evToOperatingIncome === "number" &&
      typeof growth === "number" &&
      growth > 0
        ? evToOperatingIncome / growth
        : "N/A";

    return {
      stockName: symbol,
      Notes: notes?.length ? notes.join("|") : null,
      color: color || null,
      "Observation Start Yield": observationStartYield,
      "Total yield": usdYieldMetric?.totalGrowth ?? null,
      "TTM yield": usdYieldMetric?.ttmGrowth ?? null,
      "EV / operating income": evToOperatingIncome,
      "EV / net income": evNiMetric?.current ?? null,
      "TTM growth": ttmGrowth,
      "Yearly growth": yearlyGrowth,
      "(ev/oi) / ttm growth": ratioTo(ttmGrowth),
      "(ev/oi) / yearly growth": ratioTo(yearlyGrowth),
      "Net debt / operating income": netDebtMetric?.current ?? null,
      "Market value / book value": mvBvMetric?.current ?? null,
    };
  });

  return {
    props: { stocks: stockSummary, region },
  };
};

const numericSort = (rowA: any, rowB: any, id: string) => {
  const a = rowA.getValue(id);
  const b = rowB.getValue(id);
  if (typeof a !== "number") return 1; // move non-numbers to bottom
  if (typeof b !== "number") return -1;
  return a - b;
};

const formatCell = (val: unknown) => {
  if (typeof val === "number") return formatNumber({ num: val, digits: 2 });
  return val;
};

const RegionalStocksPage = ({
  stocks,
  region,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "(ev/oi) / ttm growth", desc: false },
  ]);

  const columnHelper = createColumnHelper<StockSummary>();

  const columns = [
    columnHelper.display({
      id: "rowIndex",
      header: "#",
      cell: (info) => info.row.index + 1,
      footer: (info) =>
        `Total: ${info.table.getFilteredRowModel().rows.length}`,
    }),
    columnHelper.accessor("stockName", {
      header: "Stock Name",
      cell: ({ getValue }) => (
        <Link
          href={`/stock/${region}/${getValue()}`}
          className="hover:underline text-blue-600"
        >
          {getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("Observation Start Yield", {
      header: "Obs. Start Return",
      cell: ({ getValue }) => formatCell(getValue()),
      sortingFn: numericSort,
    }),
    columnHelper.accessor("TTM yield", {
      header: "TTM Yield",
      cell: ({ getValue }) => formatCell(getValue()),
      sortingFn: numericSort,
    }),
    columnHelper.accessor("Total yield", {
      header: "Total Yield",
      cell: ({ getValue }) => formatCell(getValue()),
      sortingFn: numericSort,
    }),
    columnHelper.accessor("EV / operating income", {
      header: "EV / OI",
      cell: ({ getValue }) => formatCell(getValue()),
      sortingFn: numericSort,
    }),
    columnHelper.accessor("EV / net income", {
      header: "EV / Net Income",
      cell: ({ getValue }) => formatCell(getValue()),
      sortingFn: numericSort,
    }),
    columnHelper.accessor("TTM growth", {
      header: "TTM Growth",
      cell: ({ getValue }) => formatCell(getValue()),
      sortingFn: numericSort,
    }),
    columnHelper.accessor("(ev/oi) / ttm growth", {
      header: "(EV/OI) / TTM Growth",
      cell: ({ getValue }) => formatCell(getValue()),
      sortingFn: numericSort,
    }),
    columnHelper.accessor("Yearly growth", {
      header: "Yearly Growth",
      cell: ({ getValue }) => formatCell(getValue()),
      sortingFn: numericSort,
    }),
    columnHelper.accessor("(ev/oi) / yearly growth", {
      header: "(EV/OI) / Yr Growth",
      cell: ({ getValue }) => formatCell(getValue()),
      sortingFn: numericSort,
    }),
    columnHelper.accessor("Net debt / operating income", {
      header: "Net Debt / OI",
      cell: ({ getValue }) => formatCell(getValue()),
      sortingFn: numericSort,
    }),
    columnHelper.accessor("Market value / book value", {
      header: "MV / BV",
      cell: ({ getValue }) => formatCell(getValue()),
      sortingFn: numericSort,
    }),
    columnHelper.accessor("Notes", {
      header: "Notes",
      cell: ({ getValue }) => getValue() ?? "",
    }),
  ];

  const table = useReactTable({
    data: stocks,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="p-4 overflow-x-auto bg-white min-h-screen">
      <table className="min-w-full text-sm text-center border-collapse border border-gray-200 shadow-sm">
        <thead className="bg-gray-50">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                  className={`px-3 py-2 border border-gray-200 cursor-pointer select-none hover:bg-gray-100 ${
                    header.column.id === "Notes" ? "w-[300px]" : "w-[110px]"
                  }`}
                >
                  <div className="flex items-center justify-center gap-1">
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    <span>
                      {{
                        asc: " 🔼",
                        desc: " 🔽",
                      }[header.column.getIsSorted() as string] ?? null}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getSortedRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50 transition-colors">
              {row.getVisibleCells().map((cell) => {
                const isColoredColumn = [
                  "TTM growth",
                  "(ev/oi) / ttm growth",
                  "Yearly growth",
                  "(ev/oi) / yearly growth",
                ].includes(cell.column.id);

                return (
                  <td
                    key={cell.id}
                    className={`px-2 py-1 border border-gray-100 ${
                      cell.column.id === "stockName" && row.original.color
                        ? `stock-name ${row.original.color}`
                        : ""
                    } ${isColoredColumn ? "bg-yellow-50" : ""}`}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 font-medium">
          {table.getFooterGroups().map((footerGroup) => (
            <tr key={footerGroup.id}>
              {footerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-3 py-2 border border-gray-200 text-left"
                >
                  {flexRender(
                    header.column.columnDef.footer,
                    header.getContext(),
                  )}
                </th>
              ))}
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
};

export default RegionalStocksPage;
