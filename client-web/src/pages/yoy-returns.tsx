import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useState } from "react";
import type { InferGetStaticPropsType, GetStaticProps } from "next";
import { API_URL, DEFAULT_RETURN_SYMBOLS, returnSymbolColors } from "@/lib";
import { YoyYield } from "@/shared/types";
import { cumulativeSymbolsAll } from "@/shared/constants";

interface YoyReturnsData {
  [key: string]: YoyYield[];
}

export const getStaticProps: GetStaticProps<{
  yoyReturnsData: YoyReturnsData;
}> = async () => {
  // Fetch data for all base and composite symbols
  const symbolData: Record<string, YoyYield[]> = {};

  for (const symbol of cumulativeSymbolsAll) {
    try {
      const data = await fetch(
        `${API_URL}api/yoy-returns?symbol=${symbol}`,
      ).then((res) => res.json());
      symbolData[symbol] = data;
    } catch (error) {
      console.error(`Failed to fetch YoY returns for ${symbol}:`, error);
      symbolData[symbol] = [];
    }
  }

  return {
    props: {
      yoyReturnsData: symbolData,
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

  // Available symbols
  const allowedSymbols = cumulativeSymbolsAll;

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(
    DEFAULT_RETURN_SYMBOLS,
  );

  return (
    <div className="w-full">
      <div>
        <h1>Year-over-Year Returns</h1>
      </div>

      {/* Controls */}
      <div className="">
        {/* Date range selector */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <label style={{ fontSize: 12 }}>Start Date:</label>
          <select
            style={{ fontSize: 12, padding: "4px 8px" }}
            value={selectedStartDate}
            onChange={(e) => setSelectedStartDate(Number(e.target.value))}
          >
            {allDates.map((date) => (
              <option key={date} value={date}>
                {new Date(date).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Select Symbols:
          </label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {allowedSymbols.map((symbol) => (
              <label key={symbol} className="flex items-center text-sm">
                <input
                  type="checkbox"
                  checked={selectedSymbols.includes(symbol)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedSymbols([...selectedSymbols, symbol]);
                    } else {
                      setSelectedSymbols(
                        selectedSymbols.filter((s) => s !== symbol),
                      );
                    }
                  }}
                  className="mr-2"
                />
                <span className="capitalize">{symbol}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="mt-6 bg-white rounded-lg shadow p-4">
        <ResponsiveContainer width="100%" height={1000}>
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
            <Tooltip
              formatter={(value) => {
                if (value === undefined || typeof value !== "number")
                  return "N/A";
                return `${(value * 100).toFixed(2)}%`;
              }}
              labelFormatter={(date) =>
                new Date(date).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              }
            />
            <Legend />
            {selectedSymbols.map((symbol) => (
              <Line
                key={symbol}
                type="monotone"
                dataKey={symbol}
                stroke={
                  returnSymbolColors[
                    symbol as keyof typeof returnSymbolColors
                  ] || "#000"
                }
                connectNulls
                isAnimationActive={false}
                dot={false}
                name={symbol.toUpperCase()}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Data Table */}
      <div className="mt-6 bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">
                  Date
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">
                  Baseline Date
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">
                  Days Passed
                </th>
                {selectedSymbols.map((symbol) => (
                  <th
                    key={symbol}
                    className="px-4 py-3 text-right font-semibold text-gray-700"
                  >
                    {symbol.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredData.slice(-20).map((row, idx) => (
                <tr key={idx} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(row.date).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {row.baselineDate
                      ? new Date(row.baselineDate).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "N/A"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {row.daysPassed ?? "N/A"}
                  </td>
                  {selectedSymbols.map((symbol) => (
                    <td
                      key={symbol}
                      className="px-4 py-3 text-right font-mono text-gray-600"
                    >
                      {row[symbol] !== undefined
                        ? `${((row[symbol] as number) * 100).toFixed(2)}%`
                        : "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default YoyReturnsChart;
