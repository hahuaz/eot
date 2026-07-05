import { describe, expect, it } from "vitest";

import { BadRequestError } from "@/lib/errors";
import { SymbolReturnsCalculator } from "@/lib/symbol-returns";

describe("SymbolReturnsCalculator", () => {
  it("throws a bad request error for invalid symbols", () => {
    expect(() => new SymbolReturnsCalculator("not-a-symbol")).toThrowError(
      BadRequestError,
    );
    expect(() => new SymbolReturnsCalculator("not-a-symbol")).toThrowError(
      "Invalid symbol: not-a-symbol",
    );
  });

  it("rejects non-string symbol values in the validator", () => {
    expect(SymbolReturnsCalculator.isValidSymbol(null)).toBe(false);
    expect(SymbolReturnsCalculator.isValidSymbol(123)).toBe(false);
  });
});
