type BaseReturnConfig = {
  kind: "base";
  symbol: string;
  withholdingTax?: number;
};

type CurrencyReturnConfig = {
  kind: "currencyBasket";
  symbols: readonly [string, string];
};

type UsdAdjustedReturnConfig = {
  kind: "usdAdjusted";
  symbol: string;
  withholdingTax?: number;
};

type ReturnSymbolConfig =
  | BaseReturnConfig
  | CurrencyReturnConfig
  | UsdAdjustedReturnConfig;

export type ReturnSymbolConfigValue =
  (typeof returnSymbolConfig)[keyof typeof returnSymbolConfig];

export const returnSymbolConfig = {
  BGP: { kind: "base", symbol: "BGP", withholdingTax: 0.175 },
  TP2: { kind: "base", symbol: "TP2", withholdingTax: 0.175 },
  USDTRY: { kind: "base", symbol: "USDTRY" },
  EURTRY: { kind: "base", symbol: "EURTRY" },
  GOLD: { kind: "base", symbol: "GOLD" },
  MIXEDCURRENCY: {
    kind: "currencyBasket",
    symbols: ["USDTRY", "EURTRY"],
  },
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
} as const satisfies Record<string, ReturnSymbolConfig>;

export const baseSymbols = Object.entries(returnSymbolConfig)
  .filter(([, config]) => config.kind === "base")
  .map(([symbol]) => symbol);

export const currencyBasketSymbols = Object.entries(returnSymbolConfig)
  .filter(([, config]) => config.kind === "currencyBasket")
  .map(([symbol]) => symbol);

export const usdAdjustedSymbols = Object.entries(returnSymbolConfig)
  .filter(([, config]) => config.kind === "usdAdjusted")
  .map(([symbol]) => symbol);

export const cumulativeSymbolsAll = [
  ...baseSymbols,
  ...currencyBasketSymbols,
  ...usdAdjustedSymbols,
];
