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
  bgp: { kind: "base", symbol: "BGP", withholdingTax: 0.175 },
  tp2: { kind: "base", symbol: "TP2", withholdingTax: 0.175 },
  usdtry: { kind: "base", symbol: "USDTRY" },
  eurtry: { kind: "base", symbol: "EURTRY" },
  gold: { kind: "base", symbol: "GOLD" },
  mixedcurrency: {
    kind: "currencyBasket",
    symbols: ["USDTRY", "EURTRY"],
  },
  bgp_usdtry: {
    kind: "usdAdjusted",
    symbol: "BGP",
    withholdingTax: 0.175,
  },
  tp2_usdtry: {
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
