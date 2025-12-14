export type Site = {
  // The domain of the site to scrape e.g., "https://fintables.com/"
  domain: string;
  // endpoints to scrape e.g., ["fonlar/ZBJ", "fonlar/PPN", "fonlar/BGP"]
  endpoints: string[];
  querySelector: string;
  isLocalTr?: boolean;
};

export type ScrapeResult = {
  symbol: string;
  value: string;
}[];

export type ScrapeItem = ScrapeResult[number];

export type Daily = {
  date: string;
  value: number;
};

export const regions = ["tr", "us"] as const;
export type Region = (typeof regions)[number];
