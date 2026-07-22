export const API_URL = "http://localhost:3333/";

export const DEFAULT_RETURN_SYMBOLS = ["BGP_USDTRY", "TP2_USDTRY", "GOLD"];

// Evenly spaced hues around the color wheel, so every symbol gets a visually
// distinct color no matter how many symbols exist - no per-symbol list to
// keep in sync as symbols are added or removed.
function colorForIndex(index: number, total: number): string {
  const hue = (360 * index) / Math.max(total, 1);
  return `hsl(${hue}, 65%, 45%)`;
}

// The yield symbol list is DB-driven (see YieldService.getAllYieldData), so
// colors are derived per-page from whatever symbols the API actually
// returns, rather than from a static import.
export function colorsForSymbols(symbols: string[]): Record<string, string> {
  return Object.fromEntries(
    symbols.map((symbol, index) => [
      symbol,
      colorForIndex(index, symbols.length),
    ]),
  );
}
