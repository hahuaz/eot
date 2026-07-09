import { allSymbols } from "@eot/shared";

export const API_URL = "http://localhost:5555/";

export const DEFAULT_RETURN_SYMBOLS = ["BGP_USDTRY", "TP2_USDTRY", "GOLD"];

// Evenly spaced hues around the color wheel, so every symbol gets a visually
// distinct color no matter how many symbols exist - no per-symbol list to
// keep in sync as symbols are added or removed.
function colorForIndex(index: number, total: number): string {
  const hue = (360 * index) / Math.max(total, 1);
  return `hsl(${hue}, 65%, 45%)`;
}

export const returnSymbolColors = allSymbols.reduce(
  (acc, symbol, index) => {
    acc[symbol] = colorForIndex(index, allSymbols.length);
    return acc;
  },
  {} as Record<(typeof allSymbols)[number], string>,
);
