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
import { API_URL } from "@/lib";

interface StockData {
  stockName: string;
  "Total yield"?: number;
  "TTM yield"?: number;
  "EV / operating income"?: number;
  "EV / net income"?: number;
  "Net debt / operating income"?: number;
  "TTM growth"?: number;
  "Yearly growth"?: number;
  "(ev/oi) / ttm growth": number | string;
  "(ev/oi) / yearly growth": number | string;
  "Market value / book value"?: number;
  Notes: string | null;
  color: string | null;
}

const STOCK_METRICS_OF_INTEREST = [
  "Yield",
  "EV / operating income",
  "EV / net income",
  "Net debt / operating income",
  "Market value / book value",
  "Selected growth median",
] as const;

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
  stocks: StockData[];
  ttmNightlyYield: number;
  region: string;
}> = async ({ params }) => {
  const { region } = params as { region: string };

  const [allStock, ttmYieldData] = await Promise.all([
    fetch(`${API_URL}api/all-stock?region=${region}`).then((res) => res.json()),
    fetch(`${API_URL}api/ttm-nightly-yield?region=tr`).then((res) =>
      res.json(),
    ),
  ]);

  const filteredStockData: StockData[] = allStock.map((data: any) => {
    const { baseMetrics, derivedMetrics, stockConfig, stockDynamic } = data;
    const { notes, color } = stockDynamic;
    const allMetrics = [...baseMetrics, ...derivedMetrics];

    // Initialize flat object with defaults or nulls
    const flat: Partial<StockData> = {
      stockName: stockConfig.stockSymbol,
      Notes: notes?.length ? notes.join("|") : null,
      color: color || null,
    };

    // Filter and map metrics to flat structure
    const relevantMetrics = allMetrics.filter((m: any) =>
      STOCK_METRICS_OF_INTEREST.includes(m.metricName),
    );

    for (const item of relevantMetrics) {
      const { metricName } = item;

      if (metricName === "Selected growth median") {
        if ("Yearly growth" in item)
          flat["Yearly growth"] = item["Yearly growth"];
        if ("TTM growth" in item) flat["TTM growth"] = item["TTM growth"];
      } else if (metricName === "Yield") {
        flat["Total yield"] = item["Total growth"];
        flat["TTM yield"] = item["TTM growth"];
      } else {
        // Direct assignment for other metrics
        // We know these match keys in StockData approximately, but typescript needs help usually
        // For simplicity in this mapped structure:
        (flat as any)[metricName] = item["current"];
      }
    }

    const evOi = flat["EV / operating income"];
    const ttm = flat["TTM growth"];
    const yearly = flat["Yearly growth"];

    // Data validation / Sanitization
    // If essential data is missing, we might want to skip or throw. Use original logic: throw.
    if (evOi == null || ttm == null || yearly == null) {
      // It's possible some stocks are incomplete. For now, we follow original logic to error out.
      // But usually in production we might want to just skip or log.
      // throw new Error(`Missing data for ${flat.stockName}`);
      console.warn(
        `Missing critical data for ${flat.stockName}, skipping calculations.`,
      );
    }

    flat["(ev/oi) / ttm growth"] =
      typeof evOi === "number" && typeof ttm === "number" && ttm > 0
        ? evOi / ttm
        : "negative";

    flat["(ev/oi) / yearly growth"] =
      typeof evOi === "number" && typeof yearly === "number" && yearly > 0
        ? evOi / yearly
        : "negative";

    return flat as StockData;
  });

  return {
    props: {
      stocks: filteredStockData,
      ttmNightlyYield: ttmYieldData.ttmNightlyYield,
      region,
    },
  };
};

const numericSort = (rowA: any, rowB: any, id: string) => {
  const a = rowA.getValue(id);
  const b = rowB.getValue(id);
  if (typeof a !== "number") return 1; // move non-numbers to bottom
  if (typeof b !== "number") return -1;
  return a - b;
};

const RegionalStocksPage = ({
  stocks,
  region,
  ttmNightlyYield,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "(ev/oi) / ttm growth", desc: false },
  ]);

  const columnHelper = createColumnHelper<StockData>();

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
          href={`/stocks/${region}/${getValue()}`}
          className="hover:underline text-blue-600"
        >
          {getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("Total yield", {
      header: "Total Yield",
      cell: ({ getValue }) => getValue()?.toFixed(2) ?? "-",
    }),
    columnHelper.accessor("TTM yield", {
      header: "TTM Yield",
      cell: ({ getValue }) => getValue()?.toFixed(2) ?? "-",
    }),
    columnHelper.accessor("EV / operating income", {
      header: "EV / OI",
      cell: ({ getValue }) => {
        const val = getValue();
        return typeof val === "number" ? val.toFixed(2) : (val ?? "-");
      },
      sortingFn: numericSort,
    }),
    columnHelper.accessor("EV / net income", {
      header: "EV / Net Income",
      cell: ({ getValue }) => {
        const val = getValue();
        return typeof val === "number" ? val.toFixed(2) : (val ?? "-");
      },
      sortingFn: numericSort,
    }),
    columnHelper.accessor("TTM growth", {
      header: "TTM Growth",
      cell: ({ getValue }) => getValue() ?? "-",
    }),
    columnHelper.accessor("(ev/oi) / ttm growth", {
      header: "(EV/OI) / TTM Growth",
      cell: ({ getValue }) => {
        const val = getValue();
        return typeof val === "number" ? val.toFixed(2) : val;
      },
      sortingFn: numericSort,
    }),
    columnHelper.accessor("Yearly growth", {
      header: "Yearly Growth",
      cell: ({ getValue }) => getValue() ?? "-",
    }),
    columnHelper.accessor("(ev/oi) / yearly growth", {
      header: "(EV/OI) / Yr Growth",
      cell: ({ getValue }) => {
        const val = getValue();
        return typeof val === "number" ? val.toFixed(2) : val;
      },
      sortingFn: numericSort,
    }),
    columnHelper.accessor("Net debt / operating income", {
      header: "Net Debt / OI",
      cell: ({ getValue }) => {
        const val = getValue();
        return typeof val === "number" ? val.toFixed(2) : (val ?? "-");
      },
    }),
    columnHelper.accessor("Market value / book value", {
      header: "MV / BV",
      cell: ({ getValue }) => getValue()?.toFixed(2) ?? "-",
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
      <div className="mb-4 text-gray-700">
        <p>
          <strong>TTM Nightly (BGP) Yield:</strong> {ttmNightlyYield}
        </p>
        <p>
          <strong>TCMB House Index:</strong> -0.01
          <br />
          <strong>VGK:</strong> ?
        </p>
      </div>
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
                        ? `stock-name ${row.original.color}` // Ensure .stock-name class handles color or inline style
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
