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
