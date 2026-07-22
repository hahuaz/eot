import { describe, expect, it, vi } from "vitest";

// Stub only the live "current" price - it changes constantly as new
// quotes come in, but everything else this pulls (config, historical
// financial reports, and quarterly price/dividend history) comes straight
// from the DB and only changes when a new quarter is actually added.
vi.mock("@/db/quarterly-stock-prices.repository", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/db/quarterly-stock-prices.repository")
    >();
  return {
    ...actual,
    getQuarterlyPriceHistory: async (region: string, symbol: string) => {
      const real = await actual.getQuarterlyPriceHistory(region, symbol);
      return {
        ...real,
        CURRENT: 105.5,
      };
    },
  };
});

import { getStockData, requireRegion, requireStockSymbol } from "@/services";

describe("StockService regression snapshot", () => {
  it("froto (tr) metrics match snapshot", async () => {
    const data = await getStockData(
      requireRegion("tr"),
      requireStockSymbol("froto"),
    );

    expect(data).toMatchSnapshot();
  });
});
