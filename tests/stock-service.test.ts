import { describe, expect, it, vi } from "vitest";

const TEST_STOCKS = [
  { region: "tr", symbol: "froto" },
  { region: "tr", symbol: "astor" },
] as const;

// Stub the DB-backed "current price" lookup so this snapshot is
// deterministic - the live price changes constantly, but everything else
// the stock service computes comes from the static CSV file and only
// changes when a new financial report date is added to it.
vi.mock("@/db/stock-prices.repository", () => ({
  getStockPrice: vi.fn(async () => ({ price: 105.5 })),
  getStockPricesMap: vi.fn(async () => ({})),
}));

import { StockService } from "@/services";

describe("StockService regression snapshot", () => {
  it.each(TEST_STOCKS)(
    "$symbol ($region) metrics match snapshot",
    async ({ region, symbol }) => {
      const stockService = await StockService.create(symbol, region);
      const metrics = stockService.getMetrics();

      expect(metrics).toMatchSnapshot();
    },
  );
});
