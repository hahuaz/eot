export const API_URL = "http://localhost:3333/";

export const DEFAULT_RETURN_SYMBOLS = ["BGP_USDTRY", "TP2_USDTRY", "GOLD"];

export type SymbolTheme = { light: string; dark: string };

// Fixed, colorblind-validated 8-hue categorical order (worst adjacent CVD
// deltaE 9.1 light / 8.4 dark - see validate_palette.js). Colors are assigned
// by position, never generated/cycled, so a symbol's color stays stable as
// the checkbox selection changes and doesn't depend on how many are selected.
const CATEGORICAL_PALETTE: SymbolTheme[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#008300", dark: "#008300" }, // green
  { light: "#4a3aa7", dark: "#9085e9" }, // violet
  { light: "#e34948", dark: "#e66767" }, // red
];

// Symbols past the 8 validated slots fall back to a neutral muted tone
// rather than an unvalidated generated hue.
const FALLBACK_COLOR: SymbolTheme = { light: "#898781", dark: "#898781" };

// The yield symbol list is DB-driven (see YieldService.getAllYieldData), so
// colors are derived per-page from whatever symbols the API actually
// returns, rather than from a static import.
export function colorsForSymbols(
  symbols: string[],
): Record<string, SymbolTheme> {
  return Object.fromEntries(
    symbols.map((symbol, index) => [
      symbol,
      CATEGORICAL_PALETTE[index] ?? FALLBACK_COLOR,
    ]),
  );
}
