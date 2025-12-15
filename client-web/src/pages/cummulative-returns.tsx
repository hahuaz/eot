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

// Props type
type DataPoint = {
  date: string;
  value: number;
};

interface CarryTradeChartProps {
  usdtry: DataPoint[];
  eurtry: DataPoint[];
  mixed: DataPoint[];
  bgp: DataPoint[];
  gold: DataPoint[];
}

export const getStaticProps: GetStaticProps<{
  cummulativeReturns: CarryTradeChartProps;
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

// Merge all data points by date
const mergeData = (
  usdtry: DataPoint[],
  eurtry: DataPoint[],
  mixed: DataPoint[],
  bgp: DataPoint[],
  gold: DataPoint[],
): {
  date: string;
  usdtry?: number;
  eurtry?: number;
  mixed?: number;
  bgp?: number;
}[] => {
  const dateSet = new Set<string>([
    ...usdtry.map((d) => d.date),
    ...eurtry.map((d) => d.date),
    ...mixed.map((d) => d.date),
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
    mixed: mixed.find((d) => d.date === date)?.value ?? undefined,
    bgp: bgp.find((d) => d.date === date)?.value ?? undefined,
    gold: gold.find((d) => d.date === date)?.value ?? undefined,
  }));
};

const CarryTradeChart = ({
  cummulativeReturns,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const { usdtry, eurtry, mixed, bgp, gold } = cummulativeReturns;

  const data = mergeData(usdtry, eurtry, mixed, bgp, gold);

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
            name="net BGP Yield Growth"
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
            dataKey="mixed"
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

export default CarryTradeChart;
