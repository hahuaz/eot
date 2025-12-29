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

interface StockData {
  stockName: string;
  "Total yield": number;
  "TTM yield": number;
  "EV / operating income": number;
  "EV / net income": number;
  "Net debt / operating income": number;
  "TTM growth"?: number;
  "Yearly growth"?: number;
  "(ev/oi) / ttm growth": number | string;
  "(ev/oi) / yearly growth": number | string;
  "Market value / book value": number;
  Notes: string | null;
  color: string | null;
}

import { API_URL } from "@/lib";

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

  const allStock = await fetch(`${API_URL}api/all-stock?region=${region}`).then(
    (res) => res.json(),
  );

  const filteredStockData: StockData[] = allStock.map((data: any) => {
    const { baseMetrics, derivedMetrics, stockConfig, stockDynamic } = data;

    const { notes, color } = stockDynamic;

    const allMetrics = [...baseMetrics, ...derivedMetrics];

    const selectedMetrics = [
      "Yield",
      "EV / operating income",
      "EV / net income",
      "Net debt / operating income",
      "Market value / book value",
      "Selected growth median",
    ];

    const filteredMetrics = allMetrics.filter((m: any) =>
      selectedMetrics.includes(m.metricName),
    );
    console.log("filteredMetrics", filteredMetrics);

    const flat: Partial<StockData> = {
      stockName: stockConfig.stockSymbol,
      Notes: notes?.length ? notes.join("|") : null,
      color: color ? color : null,
    };

    for (const item of filteredMetrics) {
      const { metricName } = item;

      if (metricName === "Selected growth median") {
        if ("Yearly growth" in item)
          flat["Yearly growth"] = item["Yearly growth"];
        if ("TTM growth" in item) flat["TTM growth"] = item["TTM growth"];
      } else if (metricName === "Yield") {
        flat["Total yield"] = item["Total growth"];
        flat["TTM yield"] = item["TTM growth"];
      } else {
        // TODO: assign rest without casting type
        flat[metricName as keyof StockData] = item["current"];
      }
    }

    const evOi = flat["EV / operating income"];
    const ttm = flat["TTM growth"];
    const yearly = flat["Yearly growth"];

    if (evOi == null || ttm == null || yearly == null) {
      throw new Error(`Missing data for ${flat.stockName}`);
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

  const { ttmNightlyYield } = await fetch(
    `${API_URL}api/ttm-nightly-yield?region=tr`,
  ).then((res) => res.json());

  return { props: { stocks: filteredStockData, ttmNightlyYield, region } };
};

const Home = ({
  stocks,
  region,
  ttmNightlyYield,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "(ev/oi) / ttm growth", desc: false },
  ]);

  const columnHelper = createColumnHelper<StockData>();

  const sortingFn = (a: any, b: any, columnId: string) => {
    const aVal = a.getValue(columnId);
    const bVal = b.getValue(columnId);
    if (typeof aVal !== "number") return 1;
    if (typeof bVal !== "number") return -1;
    return aVal - bVal;
  };

  const columns = [
    columnHelper.display({
      id: "rowIndex",
      header: "#",
      cell: (info) => {
        const rowIndex = info.row.index + 1;
        return rowIndex;
      },
      footer: (info) => `Total: ${info.table.getRowModel().rows.length}`,
    }),
    columnHelper.accessor("stockName", {
      header: "stockName",
      cell: ({ getValue }) => (
        <Link href={`/stocks/${region}/${getValue()}`}>{getValue()}</Link>
      ),
      footer: (info) => `Total: ${info.table.getRowModel().rows.length} rows`,
    }),
    columnHelper.accessor("Total yield", {
      header: "Total yield",
      cell: ({ getValue }) => getValue().toFixed(2),
    }),
    columnHelper.accessor("TTM yield", {
      header: "TTM yield",
      cell: ({ getValue }) => getValue().toFixed(2),
    }),
    columnHelper.accessor("EV / operating income", {
      header: "EV / operating income",
      cell: (info) => {
        const value = info.getValue();
        return typeof value === "number" ? value.toFixed(2) : value;
      },
      sortingFn,
    }),
    columnHelper.accessor("EV / net income", {
      header: "EV / net income",
      cell: (info) => {
        const value = info.getValue();
        return typeof value === "number" ? value.toFixed(2) : value;
      },
      sortingFn,
    }),
    columnHelper.accessor("TTM growth", {
      header: "TTM growth",
      cell: ({ getValue }) => getValue(),
    }),
    columnHelper.accessor("(ev/oi) / ttm growth", {
      header: "(ev/oi) / ttm growth",
      cell: (info) => {
        const value = info.getValue();
        return typeof value === "number" ? value.toFixed(2) : value;
      },
      sortingFn,
    }),
    columnHelper.accessor("Yearly growth", {
      header: "Yearly growth",
      cell: ({ getValue }) => getValue(),
    }),
    columnHelper.accessor("(ev/oi) / yearly growth", {
      header: "(ev/oi) / yearly growth",
      cell: (info) => {
        const value = info.getValue();
        return typeof value === "number" ? value.toFixed(2) : value;
      },
      sortingFn,
    }),
    columnHelper.accessor("Net debt / operating income", {
      header: "Net debt / operating income",
      cell: (info) => {
        const value = info.getValue();
        return typeof value === "number" ? value.toFixed(2) : value;
      },
    }),
    columnHelper.accessor("Market value / book value", {
      header: "Market value / book value",
      cell: ({ getValue }) => getValue().toFixed(2),
    }),
    columnHelper.accessor("Notes", {
      header: "Notes",
      cell: ({ getValue }) => getValue(),
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
    <div className="p-4 overflow-x-auto">
      <div>
        <p>
          ttm nightly (BGP) yield:
          {ttmNightlyYield}
        </p>
        <p>
          tcmb house index: -0.01
          <br />
          vgk: ?
        </p>
      </div>
      <table className="min-w-full text-sm text-center border-collapse border border-gray-200">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => {
            return (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={`px-3 py-2 border border-gray-200 cursor-pointer ${
                      header.column.id === "Notes" ? "w-[300px]" : "w-[110px]"
                    }`}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    {{
                      asc: " 🔼",
                      desc: " 🔽",
                    }[header.column.getIsSorted() as string] ?? null}
                  </th>
                ))}
              </tr>
            );
          })}
        </thead>
        <tbody>
          {/* using getSortedRowModel instead of rowModel to showcase index of row after dynamic sorting */}
          {table.getSortedRowModel().rows.map((row, index) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => {
                let extraClass = "";
                let coloredColumns = [
                  "TTM growth",
                  "(ev/oi) / ttm growth",
                  "Yearly growth",
                  "(ev/oi) / yearly growth",
                ];
                if (coloredColumns.includes(cell.column.id)) {
                  extraClass = "bg-yellow-50";
                }

                return (
                  <td
                    key={cell.id}
                    className={`px-2 py-1 border border-gray-100 ${
                      cell.column.id === "stockName" && row.original.color
                        ? "stock-name " + row.original.color
                        : ""
                    } ${extraClass}`}
                  >
                    {cell.column.id === "rowIndex"
                      ? index + 1
                      : flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {table.getFooterGroups().map((footerGroup) => (
            <tr key={footerGroup.id}>
              {footerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={`px-3 py-2 border border-gray-200 text-left ${
                    header.column.id === "Notes" ? "w-[300px]" : "w-[110px]"
                  }`}
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

export default Home;
