import React, { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { useState } from "react";
import type { InferGetStaticPropsType, GetStaticProps } from "next";
import {
  API_URL,
  DEFAULT_RETURN_SYMBOLS,
  returnSymbolColors,
  formatDate,
} from "@/lib";
import { CumulativeYield, allSymbols } from "@eot/shared";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

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
      `${API_URL}api/yield/cumulative?symbol=${symbol}`,
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

  const chartConfig = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        selectedSymbols.map((symbol) => [
          symbol,
          { label: symbol, color: returnSymbolColors[symbol] },
        ]),
      ),
    [selectedSymbols],
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
              {formatDate(date)}
            </option>
          ))}
        </select>
      </div>

      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-full w-full"
      >
        <LineChart data={filteredData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            minTickGap={20}
            tickFormatter={(date) => formatDate(date)}
          />
          <YAxis
            tickFormatter={(v) => `${(v * 100).toFixed(2)}%`}
            domain={["auto", "auto"]}
          />
          <ChartTooltip
            content={({ active, payload, label }) => (
              <ChartTooltipContent
                active={active}
                label={label}
                // recharts' itemSorter is ignored when a custom `content` is
                // used, so sort the payload ourselves (descending by value).
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
                        {`${(Number(value) * 100).toFixed(2)}%`}
                      </span>
                    </div>
                  </>
                )}
              />
            )}
          />
          <ChartLegend content={<ChartLegendContent />} />

          {/* Render only selected symbol lines */}
          {filteredData.length > 0 &&
            selectedSymbols.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={`var(--color-${key})`}
                name={key}
                dot={false}
              />
            ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
};

export default CumulativeYieldsChart;
