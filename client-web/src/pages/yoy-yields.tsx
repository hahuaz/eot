import React, { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { useState } from "react";
import type { InferGetStaticPropsType, GetStaticProps } from "next";
import {
  API_URL,
  DEFAULT_RETURN_SYMBOLS,
  colorsForSymbols,
  formatDate,
} from "@/lib";
import { YieldSymbolData, YoyYield } from "@eot/shared";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { YieldFilters } from "@/components/yield-filters";

interface YoyReturnsData {
  [key: string]: YoyYield[];
}

export const getStaticProps: GetStaticProps<{
  yoyReturnsData: YoyReturnsData;
  allowedSymbols: string[];
}> = async () => {
  const allYieldData: YieldSymbolData[] = await fetch(
    `${API_URL}api/yield/all`,
  ).then((res) => res.json());

  const symbolData = Object.fromEntries(
    allYieldData.map(({ symbol, yoyYields }) => [symbol, yoyYields]),
  );

  return {
    props: {
      yoyReturnsData: symbolData,
      allowedSymbols: allYieldData.map(({ symbol }) => symbol),
    },
  };
};

/**
 * Merges independent time-series arrays into a single array aligned by date.
 * This unified format ensures all metrics can be plotted on a shared X-axis (date).
 */
const alignTimeSeriesData = (
  yoyReturnsData: YoyReturnsData,
): {
  date: number;
  baselineDate?: number;
  daysPassed?: number;
  [key: string]: number | undefined;
}[] => {
  const dateSet = new Set<number>();

  // Collect all unique dates
  for (const symbol of Object.keys(yoyReturnsData)) {
    yoyReturnsData[symbol].forEach((d) => dateSet.add(d.date));
  }

  const sortedDates = [...dateSet].sort((a, b) => a - b);

  return sortedDates.map((date) => {
    const entry: {
      date: number;
      baselineDate?: number;
      daysPassed?: number;
      [key: string]: number | undefined;
    } = { date };

    // Get baseline info from the first available symbol
    let baselineFound = false;
    for (const symbol of Object.keys(yoyReturnsData)) {
      const dataPoint = yoyReturnsData[symbol].find((d) => d.date === date);
      entry[symbol] = dataPoint?.yoyReturnPercent ?? undefined;

      if (dataPoint && !baselineFound) {
        entry.baselineDate = dataPoint.baselineDate;
        entry.daysPassed = dataPoint.daysPassed;
        baselineFound = true;
      }
    }

    return entry;
  });
};

const YoyReturnsChart = ({
  yoyReturnsData,
  allowedSymbols,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const allData = alignTimeSeriesData(yoyReturnsData);
  const allDates = [...new Set(allData.map((d) => d.date))].sort(
    (a, b) => a - b,
  );

  const [selectedStartDate, setSelectedStartDate] = useState<number>(
    allDates[0] ?? Date.now(),
  );

  const filteredData = allData.filter((d) => {
    const date = new Date(d.date).setHours(0, 0, 0, 0);
    const startDate = new Date(selectedStartDate).setHours(0, 0, 0, 0);
    return date >= startDate;
  });

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(
    DEFAULT_RETURN_SYMBOLS,
  );

  const symbolColors = useMemo(
    () => colorsForSymbols(allowedSymbols),
    [allowedSymbols],
  );

  const chartConfig = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        selectedSymbols.map((symbol) => [
          symbol,
          { label: symbol, theme: symbolColors[symbol] },
        ]),
      ),
    [selectedSymbols, symbolColors],
  );

  const toggleSymbol = (symbol: string) =>
    setSelectedSymbols((prev) =>
      prev.includes(symbol)
        ? prev.filter((p) => p !== symbol)
        : [...prev, symbol],
    );

  const tableRows = filteredData.slice(-20);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Year-over-Year Returns
      </h1>

      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-[800px] w-full"
      >
        <LineChart data={filteredData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(date) =>
              new Date(date).toLocaleDateString("en-US", {
                month: "short",
                year: "2-digit",
              })
            }
            tick={{ fontSize: 12 }}
          />
          <YAxis
            tickFormatter={(value) => `${(value * 100).toFixed(1)}%`}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip
            content={({ active, payload, label }) => (
              <ChartTooltipContent
                active={active}
                label={label}
                // recharts' itemSorter is ignored when a custom `content`
                // is used, so sort the payload ourselves (descending).
                payload={
                  payload
                    ? [...payload].sort(
                        (a, b) =>
                          (Number(b.value) || 0) - (Number(a.value) || 0),
                      )
                    : payload
                }
                labelFormatter={(_, payload) =>
                  formatDate((payload?.[0]?.payload as { date: number })?.date)
                }
                formatter={(value, name) => (
                  <>
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: `var(--color-${name})` }}
                    />
                    <div className="flex flex-1 items-center justify-between leading-none">
                      <span className="text-muted-foreground">{name}</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {typeof value === "number"
                          ? `${(value * 100).toFixed(2)}%`
                          : "N/A"}
                      </span>
                    </div>
                  </>
                )}
              />
            )}
          />
          <ChartLegend content={<ChartLegendContent />} />
          {selectedSymbols.map((symbol) => (
            <Line
              key={symbol}
              type="monotone"
              dataKey={symbol}
              stroke={`var(--color-${symbol})`}
              connectNulls
              isAnimationActive={false}
              dot={false}
              name={symbol}
            />
          ))}
        </LineChart>
      </ChartContainer>

      <YieldFilters
        allDates={allDates}
        selectedStartDate={selectedStartDate}
        onStartDateChange={setSelectedStartDate}
        allowedSymbols={allowedSymbols}
        selectedSymbols={selectedSymbols}
        onToggleSymbol={toggleSymbol}
        symbolColors={symbolColors}
      />

      <div>
        <h2 className="text-base font-medium">History</h2>
        <p className="text-sm text-muted-foreground">
          Showing the last {tableRows.length} of {filteredData.length} rows
        </p>
        <Table className="mt-2">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Baseline Date</TableHead>
              <TableHead className="text-right">Days Passed</TableHead>
              {selectedSymbols.map((symbol) => (
                <TableHead key={symbol} className="text-right">
                  {symbol}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableRows.map((row) => (
              <TableRow key={row.date}>
                <TableCell>{formatDate(row.date)}</TableCell>
                <TableCell>
                  {row.baselineDate ? formatDate(row.baselineDate) : "N/A"}
                </TableCell>
                <TableCell className="text-right">
                  {row.daysPassed ?? "N/A"}
                </TableCell>
                {selectedSymbols.map((symbol) => (
                  <TableCell
                    key={symbol}
                    className="text-right font-mono tabular-nums"
                  >
                    {row[symbol] !== undefined
                      ? `${((row[symbol] as number) * 100).toFixed(2)}%`
                      : "-"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default YoyReturnsChart;
