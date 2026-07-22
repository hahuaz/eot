import { describe, expect, it } from "vitest";

import { YieldService } from "@/services";

const DATE_THRESHOLD = 1780261200000;

function filterByDateThreshold<T extends { date: number }>(
  data: T[],
  threshold: number,
): T[] {
  return data.filter((item) => item.date < threshold);
}

describe("Yield regression snapshots", () => {
  it("all yield-included symbols' cumulative + YoY yields match snapshot", async () => {
    const allYieldData = await YieldService.getAllYieldData();

    const filtered = allYieldData.map(
      ({ symbol, cumulativeYields, yoyYields }) => ({
        symbol,
        cumulativeYields: filterByDateThreshold(
          cumulativeYields,
          DATE_THRESHOLD,
        ),
        yoyYields: filterByDateThreshold(yoyYields, DATE_THRESHOLD),
      }),
    );

    expect(filtered).toMatchSnapshot();
  });
});
