// CUMULATIVE_* symbols declares which symbols can be requested for cumulative returns data.
export const CUMULATIVE_BASE_SYMBOLS = [
  "bgp",
  "tp2",
  "usdtry",
  "eurtry",
  "gold",
];
export const CUMULATIVE_COMPOSITE_SYMBOLS = [
  "mixedcurrency",
  "bgpusdtry",
  "tp2usdtry",
];
export const CUMULATIVE_ALL_SYMBOLS = [
  ...CUMULATIVE_BASE_SYMBOLS,
  ...CUMULATIVE_COMPOSITE_SYMBOLS,
];
