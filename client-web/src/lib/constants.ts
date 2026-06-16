import { cumulativeSymbolsAll, returnSymbolConfig } from "@/shared/constants";

export const API_URL = "http://localhost:5555/";

export const DEFAULT_RETURN_SYMBOLS = ["BGP_USDTRY", "TP2_USDTRY", "GOLD"];

export const CHART_COLORS = [
  "#8B4513", // bgp
  "#228B22", // tp2
  "#1E90FF", // usdtry
  "#FFD700", // eurtry
  "#D4AF37", // gold
  "#FF8C00", // mixedcurrency
  "#9932CC", // bgp_usdtry
  "#FF1493", // tp2_usdtry
];

export const returnSymbolColors = cumulativeSymbolsAll.reduce(
  (acc, symbol, index) => {
    acc[symbol as keyof typeof returnSymbolConfig] =
      CHART_COLORS[index % CHART_COLORS.length];
    return acc;
  },
  {} as Record<keyof typeof returnSymbolConfig, string>,
);
