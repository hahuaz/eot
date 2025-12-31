export type Site = {
  // The domain of the site to scrape e.g., "https://fintables.com/"
  domain: string;
  // endpoints to scrape e.g., ["fonlar/ZBJ", "fonlar/PPN", "fonlar/BGP"]
  endpoints: string[];
  querySelector: string;
  isLocalTr?: boolean;
};

export type ScrapeItem = {
  symbol: string;
  value: string;
};

export type ScrapeResult = ScrapeItem[];

export const regions = ["tr", "us"] as const;
export type Region = (typeof regions)[number];

export type DailyPrice = {
  date: string; // YYYY-MM-DD
  value: number;
};
