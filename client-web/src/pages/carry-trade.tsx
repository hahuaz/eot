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
  cumulativeTlref: DataPoint[];
  netCumulativeTlref: DataPoint[];
  cumulativeUsdtry: DataPoint[];
  cumulativeEurtry: DataPoint[];
  cumulativeMixed: DataPoint[];
  cumulativeBGP: DataPoint[];
}


export const getStaticProps: GetStaticProps<{
  carryTrade: CarryTradeChartProps;
}> = async () => {

  const carryTrade = await fetch(`${API_URL}api/carry-trade`).then((res) =>
    res.json()
  );

  return {
    props: {
      carryTrade,
    },
  };
};

// Merge all data points by date
const mergeData = (
  cumulativeUsdtry: DataPoint[],
  cumulativeEurtry: DataPoint[],
  cumulativeMixed: DataPoint[],
  cumulativeBGP: DataPoint[]
): {
  date: string;
  tlref?: number;
  netTlref?: number;
  usdtry?: number;
  eurtry?: number;
  mixed?: number;
  bgp?: number;
}[] => {
  const dateSet = new Set<string>([
    ...cumulativeUsdtry.map((d) => d.date),
    ...cumulativeEurtry.map((d) => d.date),
    ...cumulativeMixed.map((d) => d.date),
    ...cumulativeBGP.map((d) => d.date),
  ]);

  const sortedDates = [...dateSet].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );

  return sortedDates.map((date) => ({
    date,
    usdtry: cumulativeUsdtry.find((d) => d.date === date)?.value ?? undefined,
    eurtry: cumulativeEurtry.find((d) => d.date === date)?.value ?? undefined,
    mixed: cumulativeMixed.find((d) => d.date === date)?.value ?? undefined,
    bgp: cumulativeBGP.find((d) => d.date === date)?.value ?? undefined,
  }));
};

const CarryTradeChart = ({
  carryTrade,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const { cumulativeUsdtry, cumulativeEurtry, cumulativeMixed, cumulativeBGP } =
    carryTrade;
  // console.log("carryTrade", carryTrade);

  const data = mergeData(
    cumulativeUsdtry,
    cumulativeEurtry,
    cumulativeMixed,
    cumulativeBGP
  );

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
            dataKey="tlref"
            stroke="#a0efa0"
            name="TLREF Growth"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="netTlref"
            stroke="#f5fd0a"
            name="Net TLREF Growth"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="bgp"
            stroke="#0008ff"
            name="net BGP Yield Growth"
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
