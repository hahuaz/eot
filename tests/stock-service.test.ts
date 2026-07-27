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

// Same idea, one level down: "USD Price"/"Total USD Yield"'s live figure
// (buildPriceMetrics's currentUsdPrice) divides the pinned TL price above by
// the latest USDTRY quote (see usd-conversion.ts's getUsdTryHistory ->
// this), which without this stub still comes live from the DB and drifts
// the snapshot exactly like the unpinned TL price did. Only the latest
// entry needs stubbing - every historical quarter's rate lookup matches by
// closest date within 10 days (see usd-conversion.ts) and none of the
// financial-report quarters here land within 10 days of today, so they
// keep using real historical rates untouched.
vi.mock("@/db/yield-prices.repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/yield-prices.repository")>();
  return {
    ...actual,
    getSymbolPriceHistory: async (symbol: string) => {
      const real = await actual.getSymbolPriceHistory(symbol);
      if (symbol.toUpperCase() !== "USDTRY" || real.length === 0) return real;
      return [...real.slice(0, -1), { ...real[real.length - 1], value: 47.35 }];
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
