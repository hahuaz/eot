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
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { API_URL, cn, formatNumber } from "@/lib";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  Notes: string[] | null;
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
      Notes: notes?.length ? notes : null,
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

// Columns whose sign is itself the signal (growth/return figures) - colored
// green/red so the reader can scan for winners/losers without reading digits.
const SIGNED_COLUMNS = new Set([
  "TTM growth",
  "(ev/oi) / ttm growth",
  "Yearly growth",
  "(ev/oi) / yearly growth",
]);

const signedColor = (val: unknown) => {
  if (typeof val !== "number") return "";
  if (val > 0) return "text-green-600 dark:text-green-500";
  if (val < 0) return "text-red-600 dark:text-red-500";
  return "";
};

const FLAG_LABEL: Record<string, string> = {
  red: "Flagged: red",
  green: "Flagged: green",
  yellow: "Flagged: yellow",
};

const FLAG_DOT_CLASS: Record<string, string> = {
  red: "bg-red-500",
  green: "bg-green-500",
  yellow: "bg-yellow-400",
};

const SortIcon = ({ isSorted }: { isSorted: false | "asc" | "desc" }) => {
  if (isSorted === "asc")
    return <ArrowUp className="size-4 shrink-0" strokeWidth={2.75} />;
  if (isSorted === "desc")
    return <ArrowDown className="size-4 shrink-0" strokeWidth={2.75} />;
  return (
    <ChevronsUpDown className="size-3.5 shrink-0 opacity-0 group-hover:opacity-40" />
  );
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
      cell: ({ getValue, row }) => {
        const color = row.original.color;
        const link = (
          <Link
            href={`/stock/${region}/${getValue()}`}
            className="hover:underline"
          >
            {getValue()}
          </Link>
        );
        if (!color) return link;
        return (
          <span className="inline-flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-block size-2 shrink-0 rounded-full",
                    FLAG_DOT_CLASS[color],
                  )}
                />
              </TooltipTrigger>
              <TooltipContent>{FLAG_LABEL[color] ?? color}</TooltipContent>
            </Tooltip>
            {link}
          </span>
        );
      },
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
      cell: ({ getValue }) => {
        const notes = getValue();
        if (!notes?.length) return null;
        return (
          <div className="flex flex-wrap justify-start gap-1">
            {notes.map((note, i) => (
              <Badge key={i} variant="secondary" className="font-normal">
                {note}
              </Badge>
            ))}
          </div>
        );
      },
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
    <div className="p-4">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const isText = ["rowIndex", "stockName", "Notes"].includes(
                  header.column.id,
                );
                const isSorted = header.column.getIsSorted();
                const label = flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                );
                const icon = <SortIcon isSorted={isSorted} />;
                return (
                  <TableHead
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={cn(
                      "group cursor-pointer select-none whitespace-nowrap px-2 transition-colors",
                      header.column.id === "stockName" &&
                        "sticky left-0 z-20 bg-background",
                      isSorted && "bg-accent/60 font-semibold",
                      isText ? "text-left" : "text-right",
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-center gap-1",
                        isText ? "justify-start" : "justify-end",
                      )}
                    >
                      {isText ? (
                        <>
                          {label}
                          {icon}
                        </>
                      ) : (
                        <>
                          {icon}
                          {label}
                        </>
                      )}
                    </div>
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getSortedRowModel().rows.map((row) => (
            <TableRow key={row.id} className="group">
              {row.getVisibleCells().map((cell) => {
                const isText = ["rowIndex", "stockName", "Notes"].includes(
                  cell.column.id,
                );
                return (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      "whitespace-nowrap px-2 py-1",
                      cell.column.id === "stockName" &&
                        "sticky left-0 z-10 bg-background transition-colors group-hover:bg-muted/50",
                      isText ? "text-left" : "text-right",
                      SIGNED_COLUMNS.has(cell.column.id) &&
                        signedColor(cell.getValue()),
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default RegionalStocksPage;
