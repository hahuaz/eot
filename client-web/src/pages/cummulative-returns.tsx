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
import { CumulativeReturns, CumulativeReturn } from "@/shared/types";
import { CUMULATIVE_ALL_SYMBOLS } from "@/shared/constants";

interface CummulativeReturnsProps extends CumulativeReturns {}

export const getStaticProps: GetStaticProps<{
  cummulativeReturns: CummulativeReturnsProps;
}> = async () => {
  // Fetch data for all base and composite symbols
  const symbolData: Record<string, CumulativeReturn[]> = {};

  for (const symbol of CUMULATIVE_ALL_SYMBOLS) {
    const data = await fetch(
      `${API_URL}api/cummulative-returns?symbol=${symbol}`,
    ).then((res) => res.json());
    symbolData[symbol] = data;
  }

  const cummulativeReturns: CummulativeReturnsProps = {
    bgp: symbolData.bgp,
    tp2: symbolData.tp2,
    usdtry: symbolData.usdtry,
    eurtry: symbolData.eurtry,
    gold: symbolData.gold,
    mixedCurrency: symbolData.mixedcurrency,
    bgpUsdtry: symbolData.bgpusdtry,
    tp2Usdtry: symbolData.tp2usdtry,
  };

  return {
    props: {
      cummulativeReturns,
    },
  };
};

/**
 * Merges independent time-series arrays into a single array aligned by date.
 * This unified format ensures all metrics can be plotted on a shared X-axis (date) and handles missing data points automatically.
 */
const alignTimeSeriesData = ({
  usdtry,
  eurtry,
  mixedCurrency,
  bgp,
  tp2,
  gold,
  bgpUsdtry,
  tp2Usdtry,
}: CumulativeReturns): {
  date: number;
  usdtry?: number;
  eurtry?: number;
  mixedCurrency?: number;
  bgp?: number;
  tp2?: number;
  gold?: number;
  bgpUsdtry?: number;
  tp2Usdtry?: number;
}[] => {
  const dateSet = new Set<number>([
    ...usdtry.map((d) => d.date),
    ...eurtry.map((d) => d.date),
    ...mixedCurrency.map((d) => d.date),
    ...bgp.map((d) => d.date),
    ...tp2.map((d) => d.date),
    ...gold.map((d) => d.date),
    ...bgpUsdtry.map((d) => d.date),
    ...tp2Usdtry.map((d) => d.date),
  ]);

  const sortedDates = [...dateSet].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );

  return sortedDates.map((date) => ({
    date,
    usdtry: usdtry.find((d) => d.date === date)?.value ?? undefined,
    eurtry: eurtry.find((d) => d.date === date)?.value ?? undefined,
    mixedCurrency:
      mixedCurrency.find((d) => d.date === date)?.value ?? undefined,
    bgp: bgp.find((d) => d.date === date)?.value ?? undefined,
    tp2: tp2.find((d) => d.date === date)?.value ?? undefined,
    gold: gold.find((d) => d.date === date)?.value ?? undefined,
    bgpUsdtry: bgpUsdtry.find((d) => d.date === date)?.value ?? undefined,
    tp2Usdtry: tp2Usdtry.find((d) => d.date === date)?.value ?? undefined,
  }));
};

const CummulativeReturnsChart = ({
  cummulativeReturns,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const allData = alignTimeSeriesData(cummulativeReturns);
  const allDates = [...new Set(allData.map((d) => d.date))].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );

  const [selectedStartDate, setSelectedStartDate] = useState<number>(
    allDates[0],
  );
  const filteredData = allData.filter((d) => {
    const date = new Date(d.date).setHours(0, 0, 0, 0);
    const startDate = new Date(selectedStartDate).setHours(0, 0, 0, 0);
    return date >= startDate;
  });
  console.log("Filtered data for chart:", filteredData);

  // pre-determined symbols (keys from CumulativeReturns)
  const allowedSymbols = [
    "bgp",
    "tp2",
    "bgpUsdtry",
    "tp2Usdtry",
    "gold",
    "mixedCurrency",
    "usdtry",
    "eurtry",
  ];

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([
    "bgpUsdtry",
    "tp2Usdtry",
    "gold",
  ]);

  return (
    <div className="w-full h-[500px]">
      {/* Controls: checkboxes to include symbols in the chart */}
      <div
        style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}
      >
        {allowedSymbols.map((key) => (
          <label key={key} style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={selectedSymbols.includes(key)}
              onChange={() =>
                setSelectedSymbols((prev) =>
                  prev.includes(key)
                    ? prev.filter((p) => p !== key)
                    : [...prev, key],
                )
              }
            />{" "}
            {key}
          </label>
        ))}
      </div>

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

      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={filteredData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            minTickGap={20}
            tickFormatter={(date) => new Date(date).toLocaleDateString()}
          />
          <YAxis
            tickFormatter={(v) => `${(v * 100).toFixed(2)}%`}
            domain={["auto", "auto"]}
          />
          <Tooltip
            formatter={(value: number) => `${(value * 100).toFixed(2)}%`}
            labelFormatter={(label: number) =>
              new Date(label).toLocaleDateString()
            }
          />
          <Legend />

          {/* Render only selected symbol lines */}
          {filteredData.length > 0 &&
            selectedSymbols.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={
                  key === "bgp"
                    ? "#0008ff"
                    : key === "tp2"
                      ? "#00ff00"
                      : key === "bgpUsdtry"
                        ? "#8A2BE2"
                        : key === "tp2Usdtry"
                          ? "#FF4500"
                          : key === "gold"
                            ? "#FFD700"
                            : key === "mixedCurrency"
                              ? "#cc0000"
                              : key === "usdtry"
                                ? "gray"
                                : key === "eurtry"
                                  ? "#8884d8"
                                  : "#333333"
                }
                name={key}
                dot={false}
              />
            ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CummulativeReturnsChart;
