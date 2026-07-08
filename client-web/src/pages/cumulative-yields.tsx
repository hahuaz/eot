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
import { CumulativeYield, allSymbols } from "@eot/shared";

interface CumulativeYieldsProps {
  [key: string]: CumulativeYield[];
}

export const getStaticProps: GetStaticProps<{
  cumulativeYields: CumulativeYieldsProps;
}> = async () => {
  // Fetch data for all base and composite symbols
  const symbolData: Record<string, CumulativeYield[]> = {};

  for (const symbol of allSymbols) {
    const data = await fetch(
      `${API_URL}api/cumulative-returns?symbol=${symbol}`,
    ).then((res) => res.json());
    symbolData[symbol] = data;
  }

  return {
    props: {
      cumulativeYields: symbolData,
    },
  };
};

/**
 * Merges independent time-series arrays into a single array aligned by date.
 * This unified format ensures all metrics can be plotted on a shared X-axis (date) and handles missing data points automatically.
 */
const alignTimeSeriesData = (
  cumulativeYields: CumulativeYieldsProps,
): {
  date: number;
  [key: string]: number | undefined;
}[] => {
  const dateSet = new Set<number>();
  for (const symbol of Object.keys(cumulativeYields)) {
    cumulativeYields[symbol].forEach((d) => dateSet.add(d.date));
  }

  const sortedDates = [...dateSet].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );

  return sortedDates.map((date) => {
    const entry: {
      date: number;
      [key: string]: number | undefined;
    } = { date };

    for (const symbol of Object.keys(cumulativeYields)) {
      entry[symbol] =
        cumulativeYields[symbol].find((d) => d.date === date)?.value ??
        undefined;
    }

    return entry;
  });
};

const CumulativeYieldsChart = ({
  cumulativeYields,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const allData = alignTimeSeriesData(cumulativeYields);
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

  // pre-determined symbols (keys from CumulativeYields)
  const allowedSymbols = allSymbols;

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(
    DEFAULT_RETURN_SYMBOLS,
  );

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
                  returnSymbolColors[key as keyof typeof returnSymbolColors] ||
                  "#333333"
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

export default CumulativeYieldsChart;
