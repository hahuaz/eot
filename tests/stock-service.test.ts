import { describe, expect, it, vi } from "vitest";

const TEST_STOCKS = [
  { region: "tr", symbol: "froto" },
  { region: "tr", symbol: "astor" },
] as const;

// Stub only the "current price" and color/notes lookups so this snapshot is
// deterministic - the live price changes constantly, but everything else
// the stock service computes (config, historical financial reports, and
// quarterly price/dividend history) comes from the DB and only changes when
// a new financial report quarter is added.
vi.mock("@/db/stock-info.repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/stock-info.repository")>();
  return {
    ...actual,
    getStockInfo: vi.fn(async () => ({})),
    getStockInfoMap: vi.fn(async () => ({})),
  };
});
vi.mock("@/db/quarterly-stock-prices.repository", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/db/quarterly-stock-prices.repository")
    >();
  return {
    ...actual,
    getCurrentPrice: vi.fn(async () => 105.5),
    getCurrentPricesMap: vi.fn(async () => ({})),
  };
});

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
