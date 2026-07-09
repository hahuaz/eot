type BaseSymbolConfig = {
  symbol: string;
  withholdingTax?: number;
  // When true, a `<SYMBOL>_USDTRY` composite return symbol is generated
  // automatically, adjusting this symbol's yield against the USDTRY benchmark.
  genUsdBench?: boolean;
};

// Hand-written base symbols. This is just an initializer - `symbolConfig`
// below expands it into every requestable return symbol (base symbols plus
// their generated USD-adjusted composites), so consumers use that instead.
const baseSymbolConfig = {
  BGP: { symbol: "BGP", withholdingTax: 0.175, genUsdBench: true },
  TP2: { symbol: "TP2", withholdingTax: 0.175, genUsdBench: true },
  BASAKSEHIR: {
    symbol: "BASAKSEHIR",
    withholdingTax: 0,
    genUsdBench: true,
  },
  USDTRY: { symbol: "USDTRY" },
  EURTRY: { symbol: "EURTRY" },
  GOLD: { symbol: "GOLD" },
} as const satisfies Record<string, BaseSymbolConfig>;

export const SYMBOL_USDTRY = "USDTRY";

type SymbolConfig = {
  symbol: string;
  withholdingTax: number;
  isUsdBench: boolean;
};

// Every requestable return symbol (e.g. "TP2" and its generated
// "TP2_USDTRY" composite), pre-resolved so consumers can look symbols up
// directly instead of re-deriving them each time.
export const symbolConfig: Record<string, SymbolConfig> = Object.fromEntries(
  Object.entries(baseSymbolConfig).flatMap(([key, config]) => {
    const withholdingTax =
      "withholdingTax" in config ? (config.withholdingTax ?? 0) : 0;
    const base: [string, SymbolConfig] = [
      key,
      { symbol: config.symbol, withholdingTax, isUsdBench: false },
    ];

    const hasUsdBench = "genUsdBench" in config && config.genUsdBench;
    if (!hasUsdBench) return [base];

    const usdBenchedSymbol: [string, SymbolConfig] = [
      `${key}_${SYMBOL_USDTRY}`,
      { symbol: config.symbol, withholdingTax, isUsdBench: true },
    ];
    return [base, usdBenchedSymbol];
  }),
);

export const allSymbols = Object.keys(symbolConfig);
