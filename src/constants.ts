export const REGION_CONFIG = {
  tr: {
    dividendTax: 0.15,
  },
  us: {
    dividendTax: 0.2,
  },
} as const;

export type Region = keyof typeof REGION_CONFIG;

export const REGIONS = Object.keys(REGION_CONFIG) as Region[];
