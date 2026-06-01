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
import { API_URL } from "@/lib";
import { YoyReturn } from "@/shared/types";
import { CUMULATIVE_ALL_SYMBOLS } from "@/shared/constants";

interface YoyReturnsData {
  [key: string]: YoyReturn[];
}

export const getStaticProps: GetStaticProps<{
  yoyReturnsData: YoyReturnsData;
}> = async () => {
  // Fetch data for all base and composite symbols
  const symbolData: Record<string, YoyReturn[]> = {};

  for (const symbol of CUMULATIVE_ALL_SYMBOLS) {
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

  const yoyReturnsData: YoyReturnsData = {
    bgp: symbolData.bgp,
    tp2: symbolData.tp2,
    usdtry: symbolData.usdtry,
    eurtry: symbolData.eurtry,
    gold: symbolData.gold,
    mixedcurrency: symbolData.mixedcurrency,
    bgpusdtry: symbolData.bgpusdtry,
    tp2usdtry: symbolData.tp2usdtry,
  };

  return {
    props: {
      yoyReturnsData,
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
  const allowedSymbols = [
    "bgp",
    "tp2",
    "bgpusdtry",
    "tp2usdtry",
    "gold",
    "mixedcurrency",
    "usdtry",
    "eurtry",
  ];

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([
    "bgpusdtry",
    "tp2usdtry",
    "gold",
  ]);

  const colors: Record<string, string> = {
    bgp: "#8B4513",
    tp2: "#228B22",
    usdtry: "#1E90FF",
    eurtry: "#FFD700",
    gold: "#FFD700",
    mixedcurrency: "#FF8C00",
    bgpusdtry: "#9932CC",
    tp2usdtry: "#FF1493",
  };

  return (
    <div className="w-full">
      <div className="p-6 bg-gradient-to-r from-slate-900 to-slate-800 rounded-lg shadow-lg">
        <h1 className="text-3xl font-bold text-white mb-2">
          Year-over-Year Returns
        </h1>
        <p className="text-slate-300 text-sm">
          Annualized YoY returns for financial instruments. Returns are
          calculated based on the closest data point 1 year prior.
        </p>
      </div>

      {/* Controls */}
      <div className="mt-6 p-4 bg-white rounded-lg shadow">
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Start Date:
          </label>
          <input
            type="date"
            value={new Date(selectedStartDate).toISOString().split("T")[0]}
            onChange={(e) =>
              setSelectedStartDate(new Date(e.target.value).getTime())
            }
            className="border border-gray-300 rounded px-3 py-2 text-sm"
          />
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
        <ResponsiveContainer width="100%" height={500}>
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
                stroke={colors[symbol] || "#000"}
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
