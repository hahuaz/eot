import { describe, expect, it } from "vitest";

import { cumulativeSymbolsAll } from "@eot/shared";
import { YieldService } from "@/services";

const DATE_THRESHOLD = 1780261200000;

function filterByDateThreshold<T extends { date: number }>(
  data: T[],
  threshold: number,
): T[] {
  return data.filter((item) => item.date < threshold);
}

describe("Yield regression snapshots", () => {
  it.each(cumulativeSymbolsAll)(
    "%s cumulative + YoY yields match snapshot",
    async (symbol) => {
      const cumulativeYields = filterByDateThreshold(
        await YieldService.getCumulativeYields(symbol),
        DATE_THRESHOLD,
      );
      const yoyYields = filterByDateThreshold(
        await YieldService.getYoyYields(symbol),
        DATE_THRESHOLD,
      );

      expect({ cumulativeYields, yoyYields }).toMatchSnapshot();
    },
  );
});
