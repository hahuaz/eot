import { describe, expect, it } from "vitest";

import { BadRequestError } from "@/lib/errors";
import { StockAnalyzer } from "@/lib/stock-analyzer";

describe("StockAnalyzer", () => {
  it("throws a bad request error for an invalid region", () => {
    expect(
      () => new StockAnalyzer("aapl" as never, "xx" as never),
    ).toThrowError(BadRequestError);
    expect(
      () => new StockAnalyzer("aapl" as never, "xx" as never),
    ).toThrowError("Invalid or missing region parameter: xx");
  });

  it("throws a bad request error for an unknown stock symbol", () => {
    expect(() => new StockAnalyzer("unknown" as never, "us")).toThrowError(
      BadRequestError,
    );
    expect(() => new StockAnalyzer("unknown" as never, "us")).toThrowError(
      "Stock not found in dynamic data: unknown",
    );
  });
});
