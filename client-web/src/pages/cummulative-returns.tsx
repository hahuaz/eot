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
import type { InferGetStaticPropsType, GetStaticProps } from "next";
import { API_URL } from "@/lib";
import { CumulativeReturns } from "@/shared/types";

interface CummulativeReturnsProps extends CumulativeReturns {}

export const getStaticProps: GetStaticProps<{
  cummulativeReturns: CummulativeReturnsProps;
}> = async () => {
  const cummulativeReturns = await fetch(
    `${API_URL}api/cummulative-returns`,
  ).then((res) => res.json());

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
  gold,
}: CumulativeReturns): {
  date: string;
  usdtry?: number;
  eurtry?: number;
  mixedCurrency?: number;
  bgp?: number;
  gold?: number;
}[] => {
  const dateSet = new Set<string>([
    ...usdtry.map((d) => d.date),
    ...eurtry.map((d) => d.date),
    ...mixedCurrency.map((d) => d.date),
    ...bgp.map((d) => d.date),
    ...gold.map((d) => d.date),
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
    gold: gold.find((d) => d.date === date)?.value ?? undefined,
  }));
};

const CummulativeReturnsChart = ({
  cummulativeReturns,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const data = alignTimeSeriesData(cummulativeReturns);

  return (
    <div className="w-full h-[500px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" minTickGap={20} />
          <YAxis
            tickFormatter={(v) => `${(v * 100).toFixed(2)}%`}
            domain={["auto", "auto"]}
          />
          <Tooltip
            formatter={(value: number) => `${(value * 100).toFixed(2)}%`}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="bgp"
            stroke="#0008ff"
            name="Real BGP Growth"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="gold"
            stroke="#FFD700"
            name="Gold Growth"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="mixedCurrency"
            stroke="#cc0000"
            name="Mixed Currency Growth"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="usdtry"
            stroke="gray"
            name="USDTRY Growth"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="eurtry"
            stroke="#8884d8"
            name="EURTRY Growth"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CummulativeReturnsChart;
