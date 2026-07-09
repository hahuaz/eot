type BaseSymbolConfig = {
  kind: "base";
  symbol: string;
  withholdingTax?: number;
};

type UsdAdjustedSymbolConfig = {
  kind: "usdAdjusted";
  symbol: string;
  withholdingTax?: number;
};

export type SymbolConfig = BaseSymbolConfig | UsdAdjustedSymbolConfig;

export const symbolConfig = {
  BGP: { kind: "base", symbol: "BGP", withholdingTax: 0.175 },
  TP2: { kind: "base", symbol: "TP2", withholdingTax: 0.175 },
  USDTRY: { kind: "base", symbol: "USDTRY" },
  EURTRY: { kind: "base", symbol: "EURTRY" },
  GOLD: { kind: "base", symbol: "GOLD" },
  BGP_USDTRY: {
    kind: "usdAdjusted",
    symbol: "BGP",
    withholdingTax: 0.175,
  },
  TP2_USDTRY: {
    kind: "usdAdjusted",
    symbol: "TP2",
    withholdingTax: 0.175,
  },
  BASAKSEHIR_USDTRY: {
    kind: "usdAdjusted",
    symbol: "BASAKSEHIR",
    withholdingTax: 0,
  },
} as const satisfies Record<string, SymbolConfig>;

export const baseSymbols = Object.entries(symbolConfig)
  .filter(([, config]) => config.kind === "base")
  .map(([symbol]) => symbol);

export const usdAdjustedSymbols = Object.entries(symbolConfig)
  .filter(([, config]) => config.kind === "usdAdjusted")
  .map(([symbol]) => symbol);

export const allSymbols = [...baseSymbols, ...usdAdjustedSymbols];
