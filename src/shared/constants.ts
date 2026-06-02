// CUMULATIVE_* symbols declares which symbols can be requested for cumulative returns data.
export const cumulativeSymbolsBase = ["bgp", "tp2", "usdtry", "eurtry", "gold"];
export const cumulativeSymbolsComposite = [
  "mixedcurrency",
  "bgpusdtry",
  "tp2usdtry",
];
export const cumulativeSymbolsAll = [
  ...cumulativeSymbolsBase,
  ...cumulativeSymbolsComposite,
];

// symbol tax config
export const SYMBOL_TAX_CONFIG: Record<string, { withholdingTax: number }> = {
  bgp: { withholdingTax: 0.175 },
  tp2: { withholdingTax: 0.175 },
};
